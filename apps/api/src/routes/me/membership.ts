import {
	AgeDeclarationRequest,
	GUARDIAN_ERROR_CODE,
	type GuardianConsentStateDto,
	type GuardianRequestCreatedDto,
	type ViewerDto,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { readViewer, toViewerDto } from "../../auth/viewer.ts";
import { ApiError, invalidInput, notFound } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	guardianConsentPath,
	readGuardianConsentState,
	startGuardianConsentRequest,
} from "../../services/guardian.ts";
import { declareMemberAge } from "../../services/membership.ts";

/**
 * Membership eligibility: `/v2/me/membership/*`.
 *
 * - Every gate is `requireViewer`, not `requireActiveViewer`. A suspended or blocked member must
 *   be able to declare age and obtain guardian consent, since sanction history, appeals and account
 *   deletion all sit behind the entry gate. These writes update the member's own eligibility state
 *   and leave nothing on anyone else's screen.
 * - There is no slot for a target: the session decides who declares and who is asked for consent.
 *   The contract schema has no member id, so passing one is a type error.
 *
 * What this router deliberately does not do:
 * - Let someone else set a member's age. An operator endpoint for that would be a path that turns
 *   a child into an adult, with no basis for the change.
 * - Let a member create guardian consent. `POST /guardian` creates a request, not consent;
 *   consent is confirmed by an identity-verified guardian through a single-use token
 *   (`routes/guardian.ts`).
 * - Offer a consent-withdrawal button. The person who can withdraw is the guardian, who has no
 *   account, and we keep no stable reference to re-identify them (that would mean storing the CI).
 *   The privacy policy points to the contact channel, handled by a service function and an
 *   operations script.
 */
export const meMembership = new Hono<AppEnv>()
	/**
	 * Age declaration. The only place a birth date passes through this API, and it is not stored.
	 *
	 * The response is the confirmed viewer (same convention as nickname and adult setting), which already carries the next gate (`membershipGate`). Failure reasons are split into
	 * 400s because the screen's remedy differs: a future date and an implausible year are both
	 * user-fixable, and folding them into one message hides what to fix.
	 */
	.post("/age", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = AgeDeclarationRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		const outcome = await declareMemberAge({
			memberId: viewer.id,
			birthDate: parsed.data.birthDate,
		});

		if (outcome.status === "gone") throw notFound("Member not found.");
		if (outcome.status === "invalid")
			throw invalidInput({
				issues: [
					{
						path: ["birthDate"],
						message:
							outcome.reason === "future"
								? "A date after today can't be a date of birth."
								: outcome.reason === "implausible"
									? "Please check your date of birth again."
									: "The date of birth format is invalid.",
					},
				],
			});

		/**
		 * Re-read the confirmed viewer. The middleware's value predates the declaration, so `ageStatus`
		 * is still `unknown` and returning it would re-raise the age gate. `auth/viewer.ts` owns the projection.
		 */
		const updated = await readViewer(viewer.id);
		if (!updated) throw notFound("Member not found.");

		const body: ViewerDto = toViewerDto(updated);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * The member's guardian-consent state, polled by the child's waiting screen.
	 *
	 * The token is never carried here. It rides only on the response that created the request;
	 * retrievable by lookup it would not be single-use, and anyone borrowing the account could take
	 * the consent link.
	 *
	 * Non-children also get 200 (all `null`, `required: false`). A 404 would itself say "this account
	 * is under 14", which must not leak through a status code.
	 */
	.get("/guardian", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: GuardianConsentStateDto = await readGuardianConsentState({
			memberId: viewer.id,
			required: viewer.membershipGate === "guardian_consent_required",
		});
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * New guardian consent request. Creates the link, not consent.
	 *
	 * Non-children get 409: a link that opens nothing would be one more surface for recording
	 * "guardian consent obtained". Any previously open request dies (`startGuardianConsentRequest`);
	 * the server holds only a hash and cannot show the old link again, so "you already have one" would
	 * be a dead end.
	 *
	 * A deployment with no verification method answers 503 (fail-closed). Saying so here matters:
	 * otherwise the child hands the link over and the guardian sees a screen that never opens.
	 */
	.post("/guardian", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		if (viewer.ageStatus !== "child")
			throw new ApiError(
				409,
				GUARDIAN_ERROR_CODE.notRequired,
				"This account doesn't need guardian consent.",
			);

		const created = await startGuardianConsentRequest({ memberId: viewer.id });
		const state = await readGuardianConsentState({
			memberId: viewer.id,
			required: true,
		});

		const body: GuardianRequestCreatedDto = {
			/** A path, not an absolute URL: the browser knows the origin, and a server-built address would point previews and old domains at another deployment. */
			consentPath: guardianConsentPath(created.token),
			expiresAt: created.expiresAt.toISOString(),
			state,
		};
		/** The only response carrying the token; no cache may hold it. */
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});
