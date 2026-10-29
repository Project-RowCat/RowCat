/**
 * Copy for adult verification, kept here so pure rules stay free of Korean. Decisions live in
 * `@rowcat/domain` (`adultVisibilityState`) and this folder's pure modules. Meaning matches the web
 * slice though sentences may differ (the web opens a window in-page; here the provider's webview
 * runs inside a surface-filling dialog).
 *
 * Deliberately absent:
 * - Wording that promotes adult content: this procedure opens entitlement, not display, and
 *   "verify to see adult works" would fold the two decisions this slice separates.
 * - Provider original messages: PG codes/messages vary per channel, are not ours, and can carry
 *   identity fragments.
 * - Processing deadlines: those promises are the provider's, not ours.
 */

export const ADULT_VERIFY_LABEL = "Verify identity";
/**
 * Re-verification, not a retry. Shown to people verified as under 19 because the server stores no
 * date of birth, so entitlement does not open by itself as they age (`minor` in
 * `adultVisibilityState`). The word is not `Try again`, which would imply the earlier check broke.
 */
export const ADULT_REVERIFY_LABEL = "Verify again";

/**
 * One-year re-verification: entitlement stays, only viewing is closed (Youth Protection Act
 * Enforcement Decree art. 17(2)). The note says that display stays invisible even when on; without
 * it the person reads the switch as broken. The button is the same `Verify identity` as the first check; `Verify
 * again` is the quieter word for under-19 people.
 */
export const ADULT_RENEW_TITLE =
	"It's been a year since identity verification.";
export const ADULT_RENEW_NOTE =
	"Verify your identity again to see adult content. Until then, adult stories stay hidden even with the display on.";

/** What the button says per phase. */
export const ADULT_VERIFICATION_BUSY_LABEL = {
	beginning: "Opening…",
	provider: "In progress in the verification window…",
	completing: "Checking…",
} as const;

/** Title of the provider window; its accessible name. */
export const ADULT_VERIFICATION_SURFACE_TITLE = "Verify identity";
/**
 * What closing does: a cancel, not a failure. Without this sentence the close button over the
 * provider screen reads as one that breaks an in-progress verification.
 */
export const ADULT_VERIFICATION_SURFACE_NOTE =
	"You'll come back automatically when verification finishes. Closing cancels without proceeding.";

/**
 * After a result is applied: says it finished, neither entitlement nor display. The server decides
 * what opened (under 19 opens nothing) and the screen redraws from the refreshed viewer. Not an
 * exception to "no success toasts": the screen can genuinely stay unchanged (an account re-verified
 * as under 19), and without this line the button looks like it did nothing.
 */
export const ADULT_VERIFICATION_DONE =
	"Your identity verification was applied.";

/** Re-checks with the server only; does not reopen the provider window. */
export const ADULT_VERIFICATION_RECHECK_LABEL = "Check the result again";
export const ADULT_VERIFICATION_RECHECK_NOTE =
	"Verification finished, but the result couldn't be applied. Please check again.";

/**
 * Drawn only when the deployment picked a verification method this app does not know. It was once
 * this screen's default (no procedure existed); now it is the exception, expressing that the client
 * is fail-closed: not proceeding is more accurate than guessing a window.
 */
export const ADULT_VERIFY_ON_WEB_LABEL = "Verify on the web";
export const ADULT_VERIFY_ON_WEB_NOTE =
	"Identity verification can't be done in the app right now. Sign in on the web and continue from the account screen.";
