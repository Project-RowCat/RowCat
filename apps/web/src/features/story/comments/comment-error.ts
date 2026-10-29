import {
	CAPABILITY_ERROR_CODE,
	STORY_COMMENT_ERROR_CODE,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Maps a comment failure to one human-readable line. Branches on the error `code`, not the HTTP
 * status (repo convention). The server text is not shown because it speaks to developers.
 *
 * Only 429 gets its own branch, since the user can fix it by waiting. Everything else leaves
 * nothing to do but try again.
 */
export function commentErrorMessage(error: unknown): string {
	const t = translator("comments");
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return t("error.saveFailed");

	switch (apiError.code) {
		case STORY_COMMENT_ERROR_CODE.rateLimited:
			return t("error.tooFast");
		/**
		 * Hearts have a separate window from posting (the server has two policies), so the copy differs
		 * too.
		 */
		case STORY_COMMENT_ERROR_CODE.reactionRateLimited:
			return t("error.reactTooFast");
		/**
		 * Two reply rejections. The screen already blocks both (`canReplyToComment`), but the state can
		 * change behind the screen: if another device deletes the parent while the reply box is open, or
		 * the list is stale, submitting produces this code. Falling back to the default 'try again later'
		 * text would never succeed on retry.
		 */
		case STORY_COMMENT_ERROR_CODE.replyDepth:
			return t("error.replyDepth");
		case STORY_COMMENT_ERROR_CODE.replyToDeleted:
			return t("error.replyToDeleted");
		/**
		 * Restrictions come in two codes: whole account (`account_restricted`) and capability-only
		 * (`capability_restricted`). Missing the second would show the generic 'try again later' text,
		 * and retrying would never succeed. Cover and avatar uploads receive the same two codes in the
		 * same place (`features/create/cover/file.ts`, `features/account/avatar-file.ts`).
		 *
		 * The reason is not rendered. The authority is `GET /v2/me/moderation`, and repeating it per
		 * failure would split one fact across two places.
		 */
		case CAPABILITY_ERROR_CODE.restricted:
		case "account_restricted":
			return t("error.restricted");
		case "login_required":
			return t("error.loginRequired");
		case "invalid_input":
			return t("error.invalid");
		default:
			/**
			 * 404 does not guess a reason. The work may have gone private or been deleted, and the server
			 * deliberately hides which. If the screen traced it, that boundary would break.
			 */
			return apiError.status === 404
				? t("error.unavailable")
				: t("error.saveFailed");
	}
}

/**
 * Copy for a failed list load. It is kept apart from the posting failure because what the user can
 * do differs.
 */
export const commentsLoadFailure = (): string =>
	translator("comments")("error.loadFailed");

/**
 * Copy for a failed load of one thread's replies. It differs from the list failure because of
 * scope: this failure means only that one thread did not open, while the rest of the comments stay
 * on screen. Using the list copy would make a user who expanded a thread think the whole discussion
 * vanished.
 */
export const repliesLoadFailure = (): string =>
	translator("comments")("error.repliesLoadFailed");
