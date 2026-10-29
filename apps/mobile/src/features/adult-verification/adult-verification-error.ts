import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Failure vocabulary for adult verification; the axis is the next action, not the sentence. Folding
 * failures into one makes the screen draw the same `Try again`, which here means three different
 * things:
 *
 * ```text
 * begin failed      recreate the attempt on the RowCat server
 * provider failed   reopen the provider screen
 * completion failed do NOT reopen the provider; only re-ask the server for the result
 * ```
 *
 * The last is the costliest distinction: if the connection drops right after the provider finished,
 * reopening it makes the user verify again (one more paid external call, and it looks like the app
 * lost their verification).
 *
 * Provider original messages are not drawn: PG codes/messages vary per channel, are not ours, and
 * can carry identity fragments that would persist in screenshots, the accessibility tree and the
 * app switcher. Decisions use structured fields (presence of `code`); the sentences are ours.
 */

/**
 * What went wrong: eight kinds, each with a different recovery. `provider_cancelled` is in the
 * failure list on purpose so the screen can distinguish it from other failures and not draw it as
 * one.
 */
export type AdultVerificationFailureKind =
	/** The RowCat server could not create the attempt. */
	| "begin_failed"
	/** The user closed the provider screen. Not a failure. */
	| "provider_cancelled"
	/** The provider refused (a structured `code` arrived). */
	| "provider_failed"
	/** The provider screen itself failed to open (SDK, webview, network). */
	| "provider_surface_failed"
	/** The provider finished but the server could not confirm; do not reopen. */
	| "completion_failed"
	/** The attempt expired; a new one is needed. */
	| "attempt_expired"
	/** The account changed mid-procedure; dropped silently. */
	| "stale_account"
	/** The deployment picked a verification method this app does not know; do not proceed. */
	| "unsupported_handoff";

export interface AdultVerificationFailure {
	kind: AdultVerificationFailureKind;
	/**
	 * Sentence for the screen. `null` draws nothing: cancel and account switch (something the user did
	 * themselves, or happened without their knowledge).
	 */
	message: string | null;
}

/**
 * What can be pressed after a failure. Keeps the screen from scattering `if (failure.kind ===
 * ...)`: eight kinds but only three actions, and scattered conditions eventually give one kind the
 * wrong button, which looks ordinary on screen.
 */
export type AdultVerificationRecovery =
	/** Start over: create a new attempt on the server and open the provider screen. */
	| "restart"
	/** Re-ask only the server; do not open the provider screen. */
	| "recheck"
	/** Nothing to do in this app; point to the canonical place on the web. */
	| "web"
	/** Nothing to press. */
	| "none";

export function adultVerificationRecovery(
	failure: AdultVerificationFailure,
): AdultVerificationRecovery {
	switch (failure.kind) {
		case "completion_failed":
			return "recheck";
		case "unsupported_handoff":
			return "web";
		case "stale_account":
			return "none";
		default:
			// Cancel lands here too: the action is `restart`, but with no sentence (see `providerCancelled`)
			// the screen keeps only the usual verify button.
			return "restart";
	}
}

/**
 * RowCat server refusal -> sentence the user reads. Only codes this screen can actually produce are
 * handled; pre-listing absent codes hides which branches are live. Same code set as the web's
 * `adultVerificationErrorMessage`, with sentences of its own.
 */
export function adultVerificationErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return "Couldn't send the request. Please check your connection.";

	switch (error.code) {
		// No verification method in this deployment; not something the user can fix.
		case "identity_verification_unavailable":
			return "Identity verification isn't available right now. Please check again in a moment.";
		case "identity_verification_not_found":
			return "No identity verification is in progress. Please start again from the beginning.";
		case "identity_verification_expired":
			return "The identity verification screen expired. Please start again.";
		// Window closed or not finished yet; not a failure.
		case "identity_verification_not_completed":
			return "Identity verification didn't complete. Please try again.";
		case "identity_verification_conflict":
			return "Identity verification was carried out somewhere else. Please start over.";
		case "identity_verification_provider_failed":
			return "Identity verification failed. Please try again.";
		case "identity_verification_rate_limited":
			return "Too many identity verification attempts. Please try again in a moment.";
		// Under 14. This screen does not draw that button, but an account re-judged while the window was
		// open can exist; the server refuses then.
		case "minor_adult_restricted":
			return "Accounts under 14 can't use adult content.";
		case "login_required":
			return "You've been signed out. Please sign in again.";
		default:
			return "Couldn't complete identity verification. Please try again in a moment.";
	}
}

/**
 * Whether the server said the attempt itself is over. Not judged by the device clock:
 * `AdultVerificationStartDto.expiresAt` exists, but comparing it with local time drops healthy
 * attempts or holds dead ones on a skewed clock. The server's code is the authority.
 */
export function isExhaustedAttempt(error: unknown): boolean {
	if (!isRowCatApiError(error)) return false;
	return (
		error.code === "identity_verification_expired" ||
		error.code === "identity_verification_not_found" ||
		error.code === "identity_verification_conflict"
	);
}

export const beginFailure = (error: unknown): AdultVerificationFailure => ({
	kind: "begin_failed",
	message: adultVerificationErrorMessage(error),
});

/**
 * Verification finished but could not be applied; can re-ask if the attempt is still alive. When
 * the server says it does not exist, expired or was superseded, asking again gets the same answer,
 * so start over.
 */
export const completionFailure = (error: unknown): AdultVerificationFailure =>
	isExhaustedAttempt(error)
		? { kind: "attempt_expired", message: adultVerificationErrorMessage(error) }
		: {
				kind: "completion_failed",
				message: adultVerificationErrorMessage(error),
			};

/** The user closed it: no sentence; an error is not shown for their own action. */
export const providerCancelled = (): AdultVerificationFailure => ({
	kind: "provider_cancelled",
	message: null,
});

/** The provider refused. The original text is not carried (see header). */
export const providerFailed = (): AdultVerificationFailure => ({
	kind: "provider_failed",
	message: "Identity verification didn't complete. Please try again.",
});

export const providerSurfaceFailed = (): AdultVerificationFailure => ({
	kind: "provider_surface_failed",
	message:
		"Couldn't open the verification screen. Please try again in a moment.",
});

/** The account changed mid-procedure; nothing is said to the new account. */
export const staleAccount = (): AdultVerificationFailure => ({
	kind: "stale_account",
	message: null,
});

export const unsupportedHandoff = (): AdultVerificationFailure => ({
	kind: "unsupported_handoff",
	message:
		"Identity verification can't be done in the app right now. Please continue on the web.",
});
