import { deferredGroup } from "../../lib/i18n/instance.ts";

/**
 * Copy for adult verification. The sentences live in the dictionaries (`membership.adult`, English
 * and Korean); this module names them. Decisions live in
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

/**
 * Every word this procedure draws:
 *
 * - `verify` / `reverify` — `reverify` is re-verification, not a retry. It is shown to people
 *   verified as under the adult age because the server stores no date of birth, so entitlement does
 *   not open by itself as they age (`minor` in `adultVisibilityState`). It is not `Try again`, which
 *   would imply the earlier check broke.
 * - `renewTitle` / `renewNote` — one-year re-verification: entitlement stays, only viewing is closed
 *   (Youth Protection Act Enforcement Decree art. 17(2)). The note says display stays invisible even
 *   when on; without it the person reads the switch as broken.
 * - `busy` — what the button says per phase.
 * - `surfaceTitle` / `surfaceNote` — the provider window's accessible name, and that closing is a
 *   cancel, not a failure (without it the close button reads as breaking the verification).
 * - `done` — says it finished, neither entitlement nor display. The server decides what opened, and
 *   the screen can genuinely stay unchanged (an account re-verified as under the adult age), so this
 *   is not an exception to "no success toasts".
 * - `recheck` / `recheckNote` — re-asks the server only; does not reopen the provider window.
 * - `onWeb` / `onWebNote` — drawn only when the deployment picked a verification method this app does
 *   not know: not proceeding is more accurate than guessing a window.
 */
export const ADULT_VERIFICATION_COPY = deferredGroup("membership", "adult");
