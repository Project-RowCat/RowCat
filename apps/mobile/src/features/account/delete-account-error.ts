import type { AuthErrorLike } from "../../lib/auth-error.ts";

/**
 * Deletion failure to a human-readable sentence; counterpart of web `delete-account-error.ts`.
 *
 * Kept apart from sign-in errors (`auth-error.ts`), which blur the reason on purpose so the login
 * form is not a member lookup. Here the requester is already authenticated, so nothing needs
 * hiding, and the exact reason tells them what to do next: retyping the password and signing in
 * again are different actions.
 *
 * Reads only error codes, never the library's English strings, which change with a release.
 */

/** No response at all; the empty object is its shape (`account-deletion-auth.ts`). */
const isTransportFailure = (failure: AuthErrorLike): boolean =>
	failure.code === undefined && failure.status === undefined;

const MESSAGES: Record<string, string> = {
	INVALID_PASSWORD: "The password is incorrect.",
	/**
	 * A password was sent for an account with no credential method: the screen's account info
	 * disagrees with the real account (the method changed on another device).
	 */
	CREDENTIAL_ACCOUNT_NOT_FOUND:
		"This account has no password. Reopen the screen and try again.",
	/**
	 * Named "expired" but really means the login is old. The user must sign out and in again; `Try again`
	 * alone gets the same answer.
	 */
	SESSION_EXPIRED:
		"For security, a recent sign-in is required. Sign out, sign in again, then come back to the account screen and try.",
	UNAUTHORIZED: "You've been signed out. Please sign in again.",
};

export function deleteAccountErrorMessage(failure: AuthErrorLike): string {
	/**
	 * Deletion is special when no response arrives: the server may already have deleted the account
	 * and only the response was lost. "Failed, try again" may be false and leads the user to repeat
	 * deletion on a nonexistent account, so we tell them to check the current state.
	 */
	if (isTransportFailure(failure))
		return "Couldn't confirm the result of deleting your account. Check your connection, then reopen the app to see whether the account still exists.";

	if (failure.status === 429)
		return "Too many requests. Please try again in a moment.";

	if (failure.status === 401) return MESSAGES.UNAUTHORIZED as string;

	const code = failure.code?.toUpperCase();
	return (
		(code && MESSAGES[code]) ??
		"Couldn't delete the account. Please try again in a moment."
	);
}
