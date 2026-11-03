import { STORY_COMMENT_ERROR_CODE } from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "../../../lib/i18n/instance.ts";

/** The comment failure sentences, in the language being drawn (`story.comments.error`). */
const t = (key: keyof typeof keys) => translator("story")(keys[key]);
const keys = {
	saveFailed: "comments.error.saveFailed",
	tooFast: "comments.error.tooFast",
	reactTooFast: "comments.error.reactTooFast",
	replyDepth: "comments.error.replyDepth",
	replyToDeleted: "comments.error.replyToDeleted",
	restricted: "comments.error.restricted",
	loginRequired: "comments.error.loginRequired",
	invalid: "comments.error.invalid",
	unavailable: "comments.error.unavailable",
	loadFailed: "comments.error.loadFailed",
	repliesLoadFailed: "comments.error.repliesLoadFailed",
} as const;

/**
 * Comment failure → one human-readable line.
 *
 * Branches on `code`, not on the status code (this repository's convention). The server message is
 * not drawn as-is, because it is written for developers; the screen has to say what to do now.
 *
 * This is the same table as web's `comment-error.ts`. The copy exists in two places not because the
 * two apps' words could diverge (they must not), but because there is no shared place for this
 * table yet: `@rowcat/query` holds no screen copy, and `@rowcat/contracts` holds only codes. When
 * the vocabulary grows, change **both** together.
 */
export function commentErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return t("saveFailed");

	switch (apiError.code) {
		case STORY_COMMENT_ERROR_CODE.rateLimited:
			return t("tooFast");
		/** The heart (reaction) and writing have separate windows on the server, so their wording is separate too. */
		case STORY_COMMENT_ERROR_CODE.reactionRateLimited:
			return t("reactTooFast");
		/**
		 * The two reply rejections. **The screen already blocks this state** (`canReplyToComment`), but
		 * they still need copy because the state **changes behind the screen**: if another device deletes
		 * that comment while the reply form is open (or the list holds a stale value), pressing gets this
		 * code. Falling back to the default wording would say "try again later", and pressing again
		 * always gets the same answer.
		 */
		case STORY_COMMENT_ERROR_CODE.replyDepth:
			return t("replyDepth");
		case STORY_COMMENT_ERROR_CODE.replyToDeleted:
			return t("replyToDeleted");
		case "account_restricted":
			return t("restricted");
		case "login_required":
			return t("loginRequired");
		case "invalid_input":
			return t("invalid");
		default:
			/**
			 * A 404 does not guess the reason. The work may have gone private or been deleted, and the
			 * server hides that distinction on purpose; if the screen tried to tell them apart, the boundary
			 * would break.
			 */
			return apiError.status === 404 ? t("unavailable") : t("saveFailed");
	}
}

/** Failure wording for loading the list. Kept apart from the write failure because what the user can do differs. */
export const commentsLoadFailure = (): string => t("loadFailed");

/**
 * A single thread's replies failed to load — **the same sentence as web.**
 *
 * Kept apart from the list failure because of **scope**: this failure means only that one thread
 * did not open, and the rest of the comments are still on screen.
 */
export const repliesLoadFailure = (): string => t("repliesLoadFailed");
