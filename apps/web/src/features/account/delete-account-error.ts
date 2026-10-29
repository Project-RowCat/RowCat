import {
	type AuthFailure,
	isTransportFailure,
} from "#/features/auth/auth-error.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Account deletion failure → one human-readable sentence.
 *
 * Opposite in direction to sign-in failures (`auth-error.ts`), so it lives in its own file. That
 * side deliberately blurs the reasons: distinguishing them would turn the login form into a member
 * lookup. Here the requester is **already authenticated as themselves**, so there is nothing to
 * hide, and stating the reason exactly is what tells them what to do next: retyping the password
 * and signing in again are entirely different actions.
 *
 * The rule of not drawing library strings is the same: read the code only, and the sentence is
 * decided here.
 */

const messages = (): Record<string, string> => ({
	INVALID_PASSWORD: translator("account")(
		"deleteAccountError.thePasswordIsIncorrect",
	),
	/**
	 * The password was sent but the account has no credential method: the account info the screen saw
	 * differs from the actual account (the method was changed on another device). Guide the user to
	 * reload.
	 */
	CREDENTIAL_ACCOUNT_NOT_FOUND: translator("account")(
		"deleteAccountError.thisAccountHasNoPassword",
	),
	/**
	 * Not "recent sign-in". The name says "expired", but it really means the sign-in is old; what the
	 * user must do is sign in again, not wait.
	 */
	SESSION_EXPIRED: translator("account")(
		"deleteAccountError.forSecurityARecentSign",
	),
	UNAUTHORIZED: translator("account")("deleteAccountError.youVeBeenSignedOut"),
});

export function deleteAccountErrorMessage(error: AuthFailure): string {
	/**
	 * For a failure with no response, deletion has a particular reason to be careful: **the server may
	 * already have deleted the account and only the response was lost.** So we must not say "it
	 * failed, try again": that may not be true, and the user would re-enter a password against an
	 * account that no longer exists. Telling them to check the current state is the most we can
	 * honestly do.
	 */
	if (isTransportFailure(error))
		return translator("account")("deleteAccountError.couldnTConfirmTheResult");

	if (error.status === 429)
		return translator("account")("deleteAccountError.tooManyRequestsPleaseTry");

	if (error.status === 401) return messages().UNAUTHORIZED as string;

	return (
		(error.code && messages()[error.code]) ??
		translator("account")("deleteAccountError.couldnTDeleteTheAccount")
	);
}

/**
 * Diagnostic kept only during development.
 *
 * **Does not include input values**: not the password, and not the email or member id either.
 * Leaving the identifier of a deleted account in the browser console would not be deletion. In
 * production bundles this call disappears entirely.
 */
export function logDeleteAccountFailure(error: AuthFailure): void {
	if (!import.meta.env.DEV) return;
	console.warn(
		`[account] delete failed — code=${error.code ?? "(none)"} status=${error.status ?? "(none)"}`,
	);
}
