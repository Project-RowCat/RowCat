import { toast } from "@rowcat/ui-web/components/toast";

/**
 * Toast: the layer that tells the user that the action they just pressed failed. This file owns
 * placement and lifetime, but no copy. The rules that map a reason to a sentence live in each
 * feature's pure module (features/auth/social-sign-in.ts, auth-error.ts, and so on). Moving them
 * here would make those rules impossible to check without rendering, and each screen would start to
 * word the same failure differently.
 *
 * Where failures go:
 * - Toast: the user's action just failed and there is no place on screen for the failure. The
 *   button was about to leave the screen, or the place disappears when the action ends.
 * - Inline: form fields, open dialogs, and state carried by the address.
 * - None: failures the user did not start.
 *
 * The third line is an existing rule of this repo. Automatic sync failures do not show a toast. The
 * user did not cause them, and repeating the same message while Wi-Fi is down is noise. The viewer
 * preload quietly falling back to guest follows the same reason. Do not move either of those into
 * this function.
 *
 * The hardest case in the second line is state carried by the address. A social sign-in that
 * returns as a failure (/login?authError=1) is not a recent event. It is a value that stays true as
 * long as the address stays the same. It must survive reload and be present in the server-rendered
 * first HTML. The screen renders it.
 */

/** Value of one toast. Structurally compatible with the `add` options of `@base-ui/react`. */
export interface ErrorToastOptions {
	type: "error";
	description: string;
	timeout: 0;
	/**
	 * Announces to assistive technology immediately. A failure should not wait before being announced.
	 */
	priority: "high";
}

/**
 * Converts a message into the value of an error toast. This is a pure function so that lifetime is
 * testable. `timeout: 0` and `priority` are this layer's promises. If they were scattered across
 * call sites, one screen could make its errors disappear after three seconds, and that mismatch
 * would only show when the screen actually fails. Being a plain value, the tests can lock it.
 */
export const errorToastOptions = (message: string): ErrorToastOptions => ({
	type: "error",
	description: message,
	timeout: 0,
	priority: "high",
});

/**
 * Shows a failure. Call it only in the browser, from event handlers and effects. Calling it during
 * render would run on the server, and the same failure would add a line on every re-render.
 */
export function showErrorToast(message: string): void {
	toast.add(errorToastOptions(message));
}
