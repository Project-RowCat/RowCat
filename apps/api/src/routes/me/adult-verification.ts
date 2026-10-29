import type { AdultVerificationStartDto, ViewerDto } from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { readViewer, toViewerDto } from "../../auth/viewer.ts";
import { webOrigin } from "../../env.ts";
import { notFound } from "../../lib/errors.ts";
import { requireNonChild, requireViewer } from "../../lib/gates.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	beginAdultVerification,
	completeAdultVerification,
} from "../../services/adult-verification.ts";

/**
 * `/v2/me/adult-verification/*`.
 *
 * ```text
 * POST /          start identity verification; returns how to hand off to the authority
 * POST /verify    "it is done, please confirm": the server asks the authority and applies the result
 * ```
 *
 * No `set-adult` / `grant-adult` endpoints: those name an internal result rather than a user
 * action, and one such route would let anyone switch on their own adult entitlement (same rule as
 * having no role patch under `/me`).
 *
 * Nothing names a target: no member id and not even an attempt id. There is one open attempt per
 * member and purpose (partial unique index), so a request pointing at someone else's or an old
 * attempt has no argument to express it.
 *
 * Two gates:
 *
 * ```text
 * requireViewer    any signed-in member; suspended or blocked accounts may still verify themselves
 * requireNonChild  under-14 members have no such procedure at all
 * ```
 *
 * The first matches `/me/account` and `/me/moderation`: this is identity confirmation, not outward
 * interaction. The second is enforced by the server because hiding a button is not authorization,
 * and it does not reuse the adult gate's code: `adult_verification_required` tells the member to
 * complete verification, which is false for an under-14.
 *
 * Not an entry gate: `MembershipGate` gets no `adult_verification_required`. Adult content is a
 * choice, and only reasons to block the whole product belong in that vocabulary.
 *
 * Everything is `no-store`: this is in-progress identity verification state that must not revive
 * from the back button on a shared device.
 */
export const meAdultVerification = new Hono<AppEnv>()
	/**
	 * Starts verification and builds the handoff method for the authority.
	 *
	 * The server builds the return address. A client-supplied value would be an open redirect that
	 * sends the verification's return point to another site. The origin is this deployment's canonical
	 * one (first `WEB_ORIGIN` entry) and the path is the screen that started the procedure (account).
	 *
	 * The response is a handoff method, not a single URL (`IdentityVerificationHandoff`): methods
	 * differ per authority, and letting the screen guess would silently follow the wrong procedure the
	 * day a deployment switches authority.
	 *
	 * A deployment with no verification means answers 503 (fail-closed), stated here so the user does
	 * not wait for a window that never opens.
	 */
	.post("/", async (c) => {
		const viewer = requireNonChild(requireViewer(await getViewer(c)), "adult");
		/**
		 * Before the authority call: checking afterwards would reject after a record exists on their side
		 * and our money is spent, which is the cost this gate exists to prevent.
		 *
		 * Start and verify share one policy (`adultVerification`) because they are one procedure for the
		 * user; split budgets would let "start succeeds, verify is blocked" after the person already went
		 * through the authority's window.
		 */
		await checkRateLimit("adultVerification", viewer.id);

		const started = await beginAdultVerification({
			memberId: viewer.id,
			/**
			 * Back to the account screen, which starts the procedure and is where the confirmation is
			 * submitted. No dedicated return route: it would be a second surface carrying "verification
			 * finished" in the address.
			 */
			returnUrl: new URL("/account", webOrigin).toString(),
		});

		const body: AdultVerificationStartDto = {
			handoff: started.handoff,
			expiresAt: started.expiresAt.toISOString(),
		};
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Reports that verification finished; the server asks the authority and applies the result.
	 *
	 * No request body. The client cannot carry a name, birth date, adult flag, verification identifier
	 * or attempt id: such a value would be a claim rather than evidence, and accepting an identifier
	 * would open a path to attach someone else's verification to your own request.
	 *
	 * The response is the confirmed viewer, so the screen seats the server's `verified` / `adult`
	 * instead of guessing them (age declaration follows the same convention).
	 * The viewer is re-read because the middleware's copy was read before the result was applied;
	 * returning it would make the screen cache the just-succeeded verification and draw "identity
	 * verification required" again.
	 */
	.post("/verify", async (c) => {
		const viewer = requireNonChild(requireViewer(await getViewer(c)), "adult");
		/** Same budget as start: this request also makes a paid call to the authority. */
		await checkRateLimit("adultVerification", viewer.id);

		await completeAdultVerification({ memberId: viewer.id });

		const updated = await readViewer(viewer.id);
		if (!updated) throw notFound("Member not found.");

		const body: ViewerDto = toViewerDto(updated);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});
