import { isRowCatApiError } from "@rowcat/sdk";
import type { AuthErrorLike } from "../../lib/auth-error.ts";

/**
 * Account-security failure -> human-readable sentence. Same rules as the web `security-error.ts`.
 *
 * - Not the sign-in mapper: sign-in deliberately blurs reasons (distinguishing them turns the
 *   form into a member lookup), but here the person is already authenticated and needs the exact
 *   reason. Only `AuthErrorLike` (the observation that no response arrived) is shared.
 * - Two channels feed one vocabulary: the Better Auth client (`lib/account-security-auth.ts`) and
 *   the RowCat API. Two sentences for one reason would make the user meet one problem twice.
 * - Only `code` and `status` are read. Library messages are English, change silently across
 *   versions, and some describe internal state ("Session is not fresh") instead of what to do.
 *   Caught exceptions are not rendered either (they carry the request URL).
 * - No diagnostic logging: the product path has no `console` call (`lib/boundaries.test.ts`), so
 *   the web's dev-only `logSecurityFailure` is not ported (it would leak emails and session/passkey
 *   references).
 */

/**
 * Better Auth requires a fresh session (24h default) for session listing and method unlinking,
 * while our sessions last 30 days, so this is the normal path for long-signed-in users. It is
 * written as the next step, not an error, and does not say to wait: waiting does not help.
 */
export const RECENT_LOGIN_REQUIRED =
	"For security, a recent sign-in is required. Sign out and sign in again.";

/** Whether only signing in again fixes the failure; decides whether the screen draws that path. */
export function needsRecentLogin(error: unknown): boolean {
	if (isRowCatApiError(error)) return error.code === "recent_login_required";
	const code = (error as AuthErrorLike | null | undefined)?.code;
	return code === "SESSION_NOT_FRESH" || code === "SESSION_EXPIRED";
}

/**
 * No response arrived: `lib/account-security-auth.ts` folds thrown failures into an empty object.
 * With neither status nor code the request never reached the server.
 */
const isTransportFailure = (error: AuthErrorLike): boolean =>
	error.code === undefined && error.status === undefined;

/** Reasons the RowCat server defines; codes the server lacks are not pre-listed. */
const API_MESSAGES: Record<string, string> = {
	recent_login_required: RECENT_LOGIN_REQUIRED,
	login_required: "You've been signed out. Please sign in again.",
	password_already_set:
		"This account already has a password. Reload the screen and use Change password instead.",
	// Linking another method first resolves it; ending at "cannot unlink" reads as a dead end.
	last_login_method:
		"The last sign-in method can't be disconnected. Link another sign-in method first.",
	login_method_not_linked:
		"That sign-in method is already unlinked. Please reload the screen.",
	current_session_revoke:
		"This is the device you're using. Use sign out to end it.",
	// A missing passkey and someone else's share one code (existence hiding); both mean a stale
	// screen.
	passkey_not_found:
		"That passkey is already deleted. Please reload the screen.",
	passkey_update_failed:
		"Couldn't rename the passkey. Please try again in a moment.",
	invalid_input: "The value entered isn't in a valid format.",
	invalid_request: "The value entered isn't in a valid format.",
};

/** Reasons the Better Auth client gives. */
const AUTH_MESSAGES: Record<string, string> = {
	INVALID_PASSWORD: "The current password is incorrect.",
	PASSWORD_TOO_SHORT: "The new password is too short.",
	PASSWORD_TOO_LONG: "The new password is too long.",
	// A change was attempted on an account with no password: the screen's account info is stale (the
	// methods changed on another device).
	CREDENTIAL_ACCOUNT_NOT_FOUND:
		"This account has no password. Reload the screen and try again.",
	SESSION_NOT_FRESH: RECENT_LOGIN_REQUIRED,
	SESSION_EXPIRED: RECENT_LOGIN_REQUIRED,
	UNAUTHORIZED: "You've been signed out. Please sign in again.",
	INVALID_EMAIL: "That email address isn't valid.",
	EMAIL_ALREADY_VERIFIED: "This email is already verified.",
	// Deployment without a mail transport: nothing the user can do, so state the fact; "try again"
	// would be false.
	VERIFICATION_EMAIL_NOT_ENABLED:
		"Email verification isn't available in this app.",
	CHANGE_EMAIL_DISABLED: "Email change isn't available in this app.",
};

/**
 * RowCat API failures: password set, method unlink, sessions, passkeys. A non-API error means the
 * request never reached the server; "try again" is safe because every operation here is reversible
 * or idempotent.
 */
export function securityErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return "Couldn't send the request. Check your connection and try again.";
	return (
		API_MESSAGES[error.code] ??
		"Couldn't process the request. Please try again in a moment."
	);
}

/**
 * Better Auth failures: password change, email change, verification mail, provider link. 429 is
 * separate because it is the only one that improves by waiting.
 *
 * `fallback` is a parameter because four operations share this channel; a fixed "could not change
 * password" would make someone whose verification mail failed think they tried to change it.
 */
export function authSecurityErrorMessage(
	error: AuthErrorLike,
	fallback: string,
): string {
	if (isTransportFailure(error))
		return "Couldn't send the request. Check your connection and try again.";
	if (error.status === 429)
		return "Too many requests. Please try again in a moment.";
	return (error.code ? AUTH_MESSAGES[error.code] : undefined) ?? fallback;
}
