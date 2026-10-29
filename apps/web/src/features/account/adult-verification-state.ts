import type { AdultVisibilityState } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";
import type { IdentityHandoffOutcome } from "#/lib/identity/handoff.ts";

/**
 * **Screen state** of adult eligibility verification: two pure functions.
 *
 * Kept out of render for the same reason as `adultVisibilityState` (@rowcat/domain). Four things
 * must stay distinct: what to offer now, which phase is running, what failed, and what to say about
 * that failure. The screen shows only one button and one sentence, so putting the conditions inline
 * in JSX folds two states the user can act on differently into one branch.
 *
 * ## What this file does not decide
 *
 * **It does not decide eligibility.** `verified` and `adult` are decided by the server and arrive
 * on the viewer; this file only adds "what to offer now" on top. Re-deriving eligibility here would
 * open a window where an account the server has not yet unlocked briefly appears unlocked.
 */

/**
 * **What to offer** this person right now. There are exactly four values.
 *
 * ```text
 * none      nothing to offer: a child, or already eligible and verified within the year
 * verify    identity verification has not been done yet
 * reverify  verification was done, but the person was under 19 at that time
 * renew     eligible, but the last verification is over a year old; it must be repeated to show
 * ```
 *
 * `renew` and `reverify` are both "verify again" but for opposite people. The first is an adult
 * with a clear next step, so it is offered with the same weight as `verify`. The second has nothing
 * to do but wait, so it is kept quiet. Folding them together would make one of the two sentences
 * wrong.
 *
 * `reverify` exists separately because this slice **does not store birth dates**. Eligibility never
 * opens on its own when the person turns 19 (the server does not know their birthday), so
 * re-verifying is the only path, and the screen must say so.
 *
 * It is **not drawn with the same weight as `verify`.** Offering a big retry button to someone
 * under 19 would encourage them to try a different age; all they can actually do is wait.
 */
export type AdultVerificationOffer = "none" | "verify" | "reverify" | "renew";

/**
 * Eligibility state → offer.
 *
 * **A child always gets `none`.** `adultVisibilityState` decides child first, and this function
 * inherits that order: telling someone under 14 that "identity verification will do" is false, and
 * anyone following it searches for a procedure that does not exist. The server gates on the same
 * decision (`requireNonChild`).
 */
export function adultVerificationOffer(
	state: AdultVisibilityState,
): AdultVerificationOffer {
	if (state.kind === "unverified") return "verify";
	if (state.kind === "minor") return "reverify";
	/**
	 * One-year re-verification: the decision is the server's (`Viewer.adultRecheckRequired`). The
	 * deadline is not counted here: the last verification time does not arrive on the viewer, and
	 * counting would require the device clock.
	 */
	if (state.kind === "eligible" && state.recheckRequired) return "renew";
	return "none";
}

/**
 * **Phase** of the procedure: decides what the screen says and what it locks.
 *
 * Not collapsed into one boolean (`isLoading`), because the user sees something different in each
 * phase. `starting` waits on our server. `provider` means **the identity provider's window is
 * open** (our screen does nothing meanwhile). `completing` means we are asking the provider for the
 * result. If the window is closed during the last phase, verification has finished but is not yet
 * applied, so the screen must be able to say so.
 */
export type AdultVerificationPhase =
	| "idle"
	| "starting"
	| "provider"
	| "completing";

/** Button label for each busy phase, kept together with the phase. */
export function adultVerificationBusyLabel(
	phase: Exclude<AdultVerificationPhase, "idle">,
): string {
	const t = translator("account");
	switch (phase) {
		case "starting":
			return t("adultVerificationState.opening");
		case "provider":
			return t("adultVerificationState.inProgressInTheVerification");
		case "completing":
			return t("adultVerificationState.checking");
	}
}

/**
 * Failure → sentence the user reads.
 *
 * Server copy is not drawn verbatim, for the same reason as `accountErrorMessage`: a caught
 * exception may carry internal details such as the request URL, and what the screen must branch on
 * is the **next step**, not the sentence.
 *
 * **The provider's raw error is never drawn.** Its values differ per channel, we do not control
 * them, and to the user they read only as a "PG response code". The server log keeps what
 * diagnostics need but no identity (`no-secret-logging.test.ts`).
 *
 * Only codes this screen can actually produce are handled. Listing codes that never occur would
 * make it impossible to tell which branches are live.
 */
export function adultVerificationErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return translator("account")(
			"adultVerificationState.couldnTSendTheRequest",
		);

	switch (error.code) {
		/**
		 * This deployment has no verification method: **the user cannot fix this.** Writing "try again"
		 * would make the person repeat something that cannot work.
		 */
		case "identity_verification_unavailable":
			return translator("account")(
				"adultVerificationState.identityVerificationIsnTAvailable",
			);
		case "identity_verification_not_found":
			return translator("account")(
				"adultVerificationState.noIdentityVerificationIsIn",
			);
		case "identity_verification_expired":
			return translator("account")(
				"adultVerificationState.theIdentityVerificationWindowExpired",
			);
		/**
		 * The window was closed or the flow has not finished: **this is not a failure.** Telling the
		 * person "it failed" would make them suspect their device or carrier.
		 */
		case "identity_verification_not_completed":
			return translator("account")(
				"adultVerificationState.identityVerificationDidnTComplete",
			);
		case "identity_verification_conflict":
			return translator("account")(
				"adultVerificationState.identityVerificationWentAheadIn",
			);
		case "identity_verification_provider_failed":
			return translator("account")(
				"adultVerificationState.identityVerificationFailedPleaseTry",
			);
		/**
		 * Under 14. This screen does not draw that button, but an account may re-declare its age while
		 * the verification window is open; the server rejects it at that point.
		 */
		case "minor_adult_restricted":
			return translator("account")(
				"adultVerificationState.accountsUnder14CanT",
			);
		case "login_required":
			return translator("account")("adultVerificationState.youVeBeenSignedOut");
		default:
			return translator("account")(
				"adultVerificationState.couldnTCompleteIdentityVerification",
			);
	}
}

/**
 * Handoff outcome → sentence. **Only two of the four outcomes say anything.**
 *
 * `navigating` is a page leaving, so anything drawn disappears. `cancelled` is the user closing the
 * window, which is not a failure: showing an error would make them doubt their device. `completed`
 * leads to the next request rather than a sentence, so it is not answered here.
 */
export function identityHandoffMessage(
	outcome: IdentityHandoffOutcome,
): string | null {
	if (outcome.status === "failed")
		return translator("account")(
			"adultVerificationState.identityVerificationDidnTComplete",
		);
	/**
	 * The deployment chose an identity provider this screen does not know. **Do not guess and open
	 * some window.** The client is fail-closed too, and the user is told it is not available now.
	 */
	if (outcome.status === "unsupported")
		return translator("account")(
			"adultVerificationState.identityVerificationCanTProceed",
		);
	return null;
}
