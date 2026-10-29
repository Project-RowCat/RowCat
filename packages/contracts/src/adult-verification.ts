import { z } from "zod";
import { IdentityVerificationHandoff } from "./identity.ts";

/**
 * Protocol for adult-eligibility verification: the member's own identity-verification flow.
 *
 * Kept apart from identity.ts. That file is the capability (how a verifier confirms a person). This
 * file is one consumer that decides what the confirmation means here. Two consumers in one file
 * would let one consumer's vocabulary leak into the other, for example letting a guardian's check
 * open a child's adult access.
 *
 * Deliberately absent:
 * - Birth date, CI/DI, name, and contact. The verifier's identity answer stays on the server
 *   (services/identity/provider.ts).
 * - Verifier references. The browser has no reason to hold them, and sending them back would let
 *   someone attach another person's verification to this request.
 * - Attempt ids. A member has at most one open attempt, so completion has nothing to point at.
 * - Client-asserted results. No request carries verified or adult, and completion has no body.
 * - The adult-content opt-in. It is a separate contract (ShowAdultUpdateDto). Coupling it to
 *   verification would show adult content to someone who only wanted to verify.
 */

/**
 * Rejection codes for adult verification. The set is split only where the screen must say something
 * different.
 *
 * Raw errors from the verifier are not passed through. Their values vary by channel and are outside
 * our control. The screen branches on the next action, not on the wording.
 */
export const ADULT_VERIFICATION_ERROR_CODE = {
	/**
	 * No identity-verification method is configured for this deployment. This is the fail-closed
	 * surface.
	 *
	 * The status must be 503. A 400 or 403 would prompt the user to edit their input, and a 200 would
	 * record an unverified status as verified.
	 */
	unavailable: "identity_verification_unavailable",
	/**
	 * No such attempt. Deliberately not distinguished from another member's attempt.
	 *
	 * If it were, a request naming someone else's attempt id would reveal that the id exists, which
	 * gives probers a way to check ids.
	 */
	notFound: "identity_verification_not_found",
	expired: "identity_verification_expired",
	/**
	 * The verifier has not finished yet (window closed or still in progress). This is not a failure.
	 */
	notCompleted: "identity_verification_not_completed",
	/** Already completed or replaced by another attempt. Guards against replayed completions. */
	conflict: "identity_verification_conflict",
	/**
	 * Too many verification attempts (429), with Retry-After. Each attempt is one paid external call,
	 * which is why there is a cap.
	 *
	 * Kept separate from notCompleted because the next action differs: that one can retry at once,
	 * while this one must wait.
	 */
	rateLimited: "identity_verification_rate_limited",
	/** The verifier could not confirm the person. Retrying is the next step. */
	providerFailed: "identity_verification_provider_failed",
} as const;
export type AdultVerificationErrorCode =
	(typeof ADULT_VERIFICATION_ERROR_CODE)[keyof typeof ADULT_VERIFICATION_ERROR_CODE];

/**
 * Response to starting a verification: only the handoff and the deadline.
 *
 * The attempt identifier is deliberately absent. This is the most important decision in the schema.
 * A member has at most one open attempt per purpose (a partial unique index is the final
 * authority), so completion never needs to name an attempt. A request that cannot name an attempt
 * also cannot point at someone else's or an old one.
 *
 * This also covers refreshes and redirect returns. On mobile the verifier window leaves the page,
 * so memory holding the start response is lost. With no value to point at, nothing is lost either.
 * The returning screen only needs to say the check is finished and ask the user to confirm it.
 */
export const AdultVerificationStartDto = z.object({
	handoff: IdentityVerificationHandoff,
	/**
	 * When this attempt expires. The screen uses it to decide when to ask the user to start again.
	 */
	expiresAt: z.iso.datetime(),
});
export type AdultVerificationStartDto = z.infer<
	typeof AdultVerificationStartDto
>;

/**
 * The completion request has no body. This absence is the most important fact in this contract.
 *
 * If the verifier's browser result (a success flag or check id) were echoed back, it would be a
 * claim rather than evidence. The browser SDK's success only means something inside that browser.
 * The server asks the verifier itself, using its own secret, and decides.
 *
 * The request also names no attempt: the target is the member's single open attempt, resolved from
 * the session. The response is the server-settled viewer (ViewerDto), and the screen corrects its
 * own state from it. The client never supplies verified or adult.
 */
