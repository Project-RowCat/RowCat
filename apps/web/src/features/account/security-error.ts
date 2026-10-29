import { isRowCatApiError } from "@rowcat/sdk";
import {
	type AuthFailure,
	isTransportFailure,
} from "#/features/auth/auth-error.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Maps account security failures to sentences a person can read.
 *
 * This is the third mapper after sign-in (`auth-error.ts`) and account deletion
 * (`delete-account-error.ts`). They are not merged because the three screens must say opposite
 * things about the same failure:
 *
 * ```text
 * sign-in    deliberately vague: distinguishing reasons would turn the form into a member lookup
 * deletion   on no response, must say the account may already be erased
 * security   must state the exact reason: the person is already authenticated, and signing in
 *            again is a different action from retyping the password
 * ```
 *
 * The only shared piece is a shape fact (`isTransportFailure`): no response arrived. That is an
 * observation, not a rule of any one screen.
 *
 * Failures arrive through two channels: the Better Auth client (password change, provider linking)
 * and the RowCat API (password set, method unlink, sessions). There are two mappers here, but the
 * vocabulary is shared: if the channels word the same reason differently, the user meets the same
 * problem in two different ways.
 *
 * Only `code` is read. Library strings are English, change silently between versions, and some
 * describe internal state ("Session is not fresh") instead of what the user should do.
 */

/**
 * The sentence this slice will show most often. Better Auth requires a fresh session (24 hours by
 * default) to list sessions and unlink methods. Our sessions last 30 days, so for someone signed in
 * for a while this is the normal path. The message is therefore written as the next step, not as an
 * error, and it does not say "wait": waiting does not clear this state.
 */
export const recentLoginRequired = (): string =>
	translator("account")("securityError.forSecurityARecentSign");

/** Whether signing in again clears this failure. The screen uses it to decide whether to offer that path. */
export function needsRecentLogin(error: unknown): boolean {
	if (isRowCatApiError(error)) return error.code === "recent_login_required";
	const code = (error as AuthFailure | null)?.code;
	return code === "SESSION_NOT_FRESH" || code === "SESSION_EXPIRED";
}

/** Reasons defined by the RowCat server. Codes the server does not emit are not listed in advance. */
const apiMessages = (): Record<string, string> => ({
	recent_login_required: recentLoginRequired(),
	login_required: translator("account")("securityError.youVeBeenSignedOut"),
	password_already_set: translator("account")(
		"securityError.thisAccountAlreadyHasA",
	),
	/**
	 * The user has a real next step here: connect another method first, and this clears. Stopping at
	 * "cannot be unlinked" would read as a dead end.
	 */
	last_login_method: translator("account")("securityError.theLastSignInMethod"),
	login_method_not_linked: translator("account")(
		"securityError.thisSignInMethodWas",
	),
	current_session_revoke: translator("account")(
		"securityError.thisIsTheDeviceYou",
	),
	invalid_input: translator("account")("securityError.theValueEnteredIsnT"),
	invalid_request: translator("account")("securityError.theValueEnteredIsnT"),
});

/** Reasons returned by the Better Auth client. */
const authMessages = (): Record<string, string> => ({
	INVALID_PASSWORD: translator("account")(
		"securityError.theCurrentPasswordIsIncorrect",
	),
	PASSWORD_TOO_SHORT: translator("account")(
		"securityError.theNewPasswordIsToo",
	),
	PASSWORD_TOO_LONG: translator("account")(
		"securityError.theNewPasswordIsToo2",
	),
	/**
	 * A change was attempted on an account with no password. The screen's view of the account is stale
	 * (another device changed the sign-in method), so the user is told to reload.
	 */
	CREDENTIAL_ACCOUNT_NOT_FOUND: translator("account")(
		"securityError.thisAccountHasNoPassword",
	),
	SESSION_NOT_FRESH: recentLoginRequired(),
	SESSION_EXPIRED: recentLoginRequired(),
	UNAUTHORIZED: translator("account")("securityError.youVeBeenSignedOut"),
});

/**
 * Failures from the RowCat API: password set, method unlink, sessions.
 *
 * If the error is not a `isRowCatApiError`, the request never reached the server (network or
 * cancel). Saying "please try again" is correct here because every operation in this slice is
 * either reversible or idempotent. Deletion takes the opposite route for the same branch.
 */
export function securityErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return translator("account")("securityError.couldnTSendTheRequest");
	return (
		apiMessages()[error.code] ??
		translator("account")("securityError.couldnTProcessTheRequest")
	);
}

/**
 * Failures from the Better Auth side: password change.
 *
 * 429 is separate because it is the only failure that clears by waiting. Every other failure has an
 * action the user can take now.
 */
export function changePasswordErrorMessage(error: AuthFailure): string {
	if (isTransportFailure(error))
		return translator("account")("securityError.couldnTSendTheRequest");
	if (error.status === 429)
		return translator("account")("securityError.tooManyRequestsPleaseTry");
	return (
		(error.code && authMessages()[error.code]) ??
		translator("account")("securityError.couldnTChangeThePassword")
	);
}

/**
 * Diagnostic logged in development only.
 *
 * Input values are never included: not the password, not the email, not session references. Only
 * which operation failed, and with which code, is recorded. The call is removed from production
 * bundles.
 */
export function logSecurityFailure(action: string, error: AuthFailure): void {
	if (!import.meta.env.DEV) return;
	console.warn(
		`[account-security] ${action} failed — code=${error.code ?? "(none)"} status=${error.status ?? "(none)"}`,
	);
}
