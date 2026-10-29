import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Account write failure to user-facing copy; same rule as web `account-error.ts`.
 *
 * Server messages are not drawn as-is: a caught exception may carry internals such as the request
 * URL (network errors), and what the screen branches on is the reason (`code`, decided by the
 * server), not the sentence.
 *
 * Only reasons this screen (nickname, bio, adult display) can actually produce are handled; listing
 * codes that cannot occur hides which branches are live. Avatars have their own table
 * (`avatar-file.ts`, since the error vocabulary belongs to the media domain).
 */
export function accountErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return "Couldn't send the request. Please check your connection.";

	switch (error.code) {
		/** Filtered by the client before sending; never reached the server. */
		case "invalid_request":
			return "The value entered isn't in a valid format.";
		/**
		 * Rejected by a server rule. The message is ours so it is shown as-is except for the leading
		 * field path (`showAdult: `), which is for logs and developers; an English contract field name
		 * before a Korean sentence makes the error look like a system log.
		 */
		case "invalid_input":
			return error.message.replace(/^[A-Za-z_][\w.]*:\s*/, "");
		case "account_restricted":
			return "This account is restricted, so it can't be changed.";
		case "login_required":
			return "You've been signed out. Please sign in again.";
		default:
			return "Couldn't save the change. Please try again in a moment.";
	}
}
