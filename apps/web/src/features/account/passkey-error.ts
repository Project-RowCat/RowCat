import { isRowCatApiError } from "@rowcat/sdk";
import type { AuthFailure } from "#/features/auth/auth-error.ts";
import { isTransportFailure } from "#/features/auth/auth-error.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Passkey failures to sentences. **Two channels feed this.**
 *
 * ```text
 * registration                      auth client — the plugin runs the browser ceremony itself
 * list · rename · delete            RowCat API  — the server wraps these for a sanitized projection
 *                                                 and security notices
 * ```
 *
 * It is a separate file from `security-error.ts` because of its nature, not its vocabulary. The
 * sentences there all say what the user can do now, but passkeys have a case that cannot be phrased
 * that way: **cancellation**. Closing the browser prompt also arrives as an error, and drawing a
 * failure message for it would make someone who stopped on their own doubt their account.
 */

/**
 * Registration failure to sentence.
 *
 * The neutral default is the point of this function. The codes sent when a user closes the prompt
 * differ across browsers and platforms (and are sometimes absent). Enumerating all of them is a bet
 * that will eventually be wrong, so the default is a sentence that **does not assert failure**.
 */
export function passkeyRegisterErrorMessage(error: AuthFailure): string {
	if (isTransportFailure(error))
		return translator("account")("passkeyError.couldnTRegisterThePasskey");
	switch (error.code) {
		/**
		 * This authenticator is already registered to this account. The user has something to do: find it
		 * in the list, or register from another device.
		 */
		case "PREVIOUSLY_REGISTERED":
			return translator("account")("passkeyError.aPasskeyIsAlreadyRegistered");
		/**
		 * The normal path for someone who has been signed in for a while. The plugin requires a fresh
		 * session to issue registration options (we do not turn that off). That requirement is what stops
		 * one stolen session cookie from becoming a permanent sign-in method.
		 */
		case "SESSION_NOT_FRESH":
		case "SESSION_EXPIRED":
			return translator("account")("passkeyError.forSecurityARecentSign");
		case "UNAUTHORIZED":
		case "SESSION_REQUIRED":
			return translator("account")("passkeyError.youVeBeenSignedOut");
		default:
			/**
			 * **Cancellation arrives here.** That is why this does not say "failed": nothing may actually
			 * have gone wrong.
			 */
			return translator("account")(
				"passkeyError.passkeyRegistrationDidnTComplete",
			);
	}
}

/** List, rename and delete failures to sentences. This side uses our server's vocabulary. */
export function passkeyApiErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return translator("account")("passkeyError.couldnTSendTheRequest");
	switch (error.code) {
		/**
		 * A missing passkey and **someone else's passkey** arrive with the same code (existence hiding).
		 * The screen does not tell them apart either: to the user, either case means the screen is stale.
		 */
		case "passkey_not_found":
			return translator("account")("passkeyError.thisPasskeyWasAlreadyDeleted");
		case "passkey_update_failed":
			return translator("account")("passkeyError.couldnTRenameThePasskey");
		case "recent_login_required":
			return translator("account")("passkeyError.forSecurityARecentSign");
		case "login_required":
			return translator("account")("passkeyError.youVeBeenSignedOut");
		case "invalid_input":
		case "invalid_request":
			return translator("account")("passkeyError.theValueEnteredIsnT");
		default:
			return translator("account")("passkeyError.couldnTProcessTheRequest");
	}
}
