import { SOCIAL_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Follow or block failure → one human-readable line.
 *
 * Branching uses `code`, not the status code (the repository convention). The server's message is
 * not drawn as-is because it is addressed to developers; the screen needs to say what the user can
 * do now.
 *
 * This is the same table as `features/social/social-error.ts` on the web. It is not lifted into a
 * shared package because what it carries is copy, not rules. A Korean string in a pure package
 * would tie the rule to one locale (the same split as the chat action table, which keeps only
 * vocabulary in the package). What must not diverge is which code means what, and
 * `@rowcat/contracts` owns that.
 *
 * Only refusal for a blocked counterpart has a next step. The others (self, missing member) cannot
 * be reached through normal screen actions, so they end briefly. If one arrives anyway, the screen
 * is stale or the request was issued directly, and the user has nothing to do either way.
 */
function socialErrorMessage(
	error: unknown,
	action: "Follow" | "Block",
): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return `Couldn't ${action}. Please try again in a moment.`;

	switch (apiError.code) {
		case SOCIAL_ERROR_CODE.blockedTarget:
			return "You've blocked this creator. Unblock them to follow.";
		case SOCIAL_ERROR_CODE.selfFollow:
			return "You can't follow yourself.";
		case SOCIAL_ERROR_CODE.selfBlock:
			return "You can't block yourself.";
		case "account_restricted":
			return `A restricted account can't ${action}.`;
		case "login_required":
			return "You need to sign in.";
		default:
			/**
			 * A 404 does not guess the reason. The server deliberately answers a missing member and a
			 * deleted member identically (existence hiding); the screen re-deriving the reason would break
			 * that boundary.
			 */
			return apiError.status === 404
				? "Creator not found."
				: `Couldn't ${action}. Please try again in a moment.`;
	}
}

export const followErrorMessage = (error: unknown): string =>
	socialErrorMessage(error, "Follow");

export const blockErrorMessage = (error: unknown): string =>
	socialErrorMessage(error, "Block");
