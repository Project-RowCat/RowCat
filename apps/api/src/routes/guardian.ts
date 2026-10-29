import {
	GuardianConsentSubmitRequest,
	type GuardianConsentViewDto,
	type IdentityVerificationHandoff,
} from "@rowcat/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../app.ts";
import { webOrigin } from "../env.ts";
import { ApiError, invalidInput } from "../lib/errors.ts";
import {
	beginGuardianVerification,
	declineGuardianConsent,
	guardianConsentPath,
	readGuardianConsentView,
	submitGuardianConsent,
	submitGuardianVerification,
} from "../services/guardian.ts";

/** The consent body is a checkbox value; cap it at 8KiB before parsing. */
export const GUARDIAN_CONSENT_MAX_BODY_BYTES = 8 * 1024;

const limitGuardianConsentBody = bodyLimit({
	maxSize: GUARDIAN_CONSENT_MAX_BODY_BYTES,
	onError: () => {
		throw new ApiError(
			413,
			"payload_too_large",
			"The consent request body is too large.",
		);
	},
});

/**
 * Guardian consent, `/v2/guardian/*`. It lives outside `/me` on purpose.
 *
 * - The caller is not a member: no session, no account, only the link the child handed over.
 *   Under `/me` the prefix ("the requester's own") would be false, and a child's session could
 *   confirm its own consent, turning the whole procedure into a formality.
 * - The path token is the request's only credential. A missing, revoked or account-deleted token
 *   (the FK cascade already removed the row) is the same 404, or the response would confirm that an
 *   account existed to someone who never verified identity.
 * - Responses contain no child data (nickname, email, member id, signup date): a misdelivered
 *   link reveals only that an under-14 signup request exists.
 * - Everything is `no-store`: it is the state of a legal procedure and must not resurface via the
 *   back button on a shared device.
 */

/**
 * The verification-attempt cap belongs to the shared limiter; this file holds no counter.
 *
 * What it prevents is not enumeration (tokens are 256 bits) but repeated result submission that
 * uses the identity-verification authority as an oracle, which costs money and leaves records on
 * their side. This used to be an in-process `Map`, which loosened with more than one replica; it
 * moved to `lib/rate-limit/` with the same limit (`RATE_LIMIT_POLICIES.guardianVerify`, 10 per 10
 * minutes per token). Now it counts across replicas and rejects when the store is unreadable
 * (fail-closed), because the operation makes a paid external call and ends in opening a child
 * account (`policy.ts`).
 *
 * The subject is the consent request id obtained after validating the token, so invalid path
 * strings create no counter key and the raw token never reaches Redis keys, `MONITOR` or backups
 * (`services/guardian.ts`).
 */

/** Path token; an empty one is folded to 404 by the service below. */
const tokenOf = (value: string | undefined): string => value ?? "";

export const guardian = new Hono<AppEnv>()
	/**
	 * First lookup for the guardian screen.
	 *
	 * Finished requests answer 200 too (`allowResolved`): a guardian who just consented and refreshed
	 * would otherwise read a 404 as failure and ask the child for a new link, collecting an already
	 * valid consent again.
	 */
	.get("/:token", async (c) => {
		const body: GuardianConsentViewDto = await readGuardianConsentView(
			tokenOf(c.req.param("token")),
		);
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Start identity verification: builds the handoff to the verification authority.
	 *
	 * The return address is built by the server, never taken from the client, since that parameter
	 * would be an open redirect carrying the consent link elsewhere. The origin is this deployment's
	 * canonical one (first `WEB_ORIGIN` entry) and the path comes from the same function that builds
	 * the guardian screen's path, so moving the route fixes both.
	 *
	 * The response is a handoff method (`IdentityVerificationHandoff`), not a single URL: authorities
	 * differ (server-built URL vs browser SDK), and letting the screen guess would make it follow the
	 * wrong procedure when a deployment switches authority.
	 */
	.post("/:token/verification", async (c) => {
		const token = tokenOf(c.req.param("token"));
		const returnUrl = new URL(guardianConsentPath(token), webOrigin).toString();
		const body: IdentityVerificationHandoff = await beginGuardianVerification({
			token,
			returnUrl,
		});
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Report that verification finished: `pending` -> `verified`.
	 *
	 * There is no request body. If the client could send a name, birth date, adult flag or, above all,
	 * the verification identifier, the value would be a claim rather than evidence, and attaching
	 * someone else's verification to this request would become possible. The server queries the
	 * authority with the reference it stored at start.
	 */
	.post("/:token/verify", async (c) => {
		const token = tokenOf(c.req.param("token"));

		const body: GuardianConsentViewDto = await submitGuardianVerification({
			token,
		});
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Confirm consent. This one request opens the child account.
	 *
	 * `agreed` is the literal `true`, so refusal cannot be a different value of the same body (that is
	 * the endpoint below).
	 *
	 * Replay is a 409. The conditional UPDATE hits 0 rows the second time, and folding "already
	 * processed" into success would show consent just given, while a new request the child made in
	 * between has no consent.
	 */
	.post("/:token/consent", limitGuardianConsentBody, async (c) => {
		const parsed = GuardianConsentSubmitRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: GuardianConsentViewDto = await submitGuardianConsent({
			token: tokenOf(c.req.param("token")),
		});
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Decline: same conditional UPDATE, different terminal state.
	 *
	 * A separate endpoint for the same reason as the contract above: as another value of one body, a
	 * default slipping through could become consent, which is a defect in legal consent.
	 *
	 * Declining does not delete the child's account; that is withdrawal, a different decision. The
	 * child can create a new request.
	 */
	.post("/:token/decline", async (c) => {
		const body: GuardianConsentViewDto = await declineGuardianConsent({
			token: tokenOf(c.req.param("token")),
		});
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});
