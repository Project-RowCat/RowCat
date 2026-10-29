import type { VisibleStoryComment } from "./comment.ts";
import {
	isOwnWorkViewable,
	isStoryDirectlyViewable,
	type StoryVisibility,
} from "./story.ts";

/**
 * Product model for the creator's comment inbox: comments on the creator's works, newest first.
 * Matches the CreatorCommentInboxPage contract field for field. It lives here because contracts
 * decide whether incoming values are trustworthy, while this file decides what they mean. One
 * meaning matters: where tapping a row leads (creatorCommentDestination).
 *
 * The comment shape is not redefined. A row's comment is the same VisibleStoryComment that the
 * story comment list draws. Having no tombstone variant encodes in the type that this list holds
 * live statements only.
 */

/** The creator's work that a row points to: its title, plus the two axes that navigation needs. */
export interface CreatorCommentInboxStory {
	id: string;
	title: string;
	visibility: StoryVisibility;
	hidden: boolean;
}

export interface CreatorCommentInboxItem {
	comment: VisibleStoryComment;
	story: CreatorCommentInboxStory;
}

export interface CreatorCommentInboxPage {
	items: CreatorCommentInboxItem[];
	nextCursor: string | null;
}

/**
 * URL fragment of the comments section on the story detail page. The detail page uses the same
 * value as its section id. It is defined here so the two screens share the name without importing
 * each other. Renaming it on one side only would leave links opening while scrolling silently
 * stops.
 */
export const STORY_COMMENTS_ANCHOR = "comments";

/**
 * Destination of an inbox row: the story detail's comments section, or null when there is nowhere
 * to go.
 *
 * Not the individual comment. Notification destinations make the same decision. Anchoring to one
 * comment would require knowing its page and, for a reply, which thread to expand, which entangles
 * with cursor pagination. The section still saves the user the work of scrolling down to the
 * comments.
 *
 * Identified by id only (storyId, commentId). The row's position in the list is not used: when the
 * next page loads or a new comment appears at the top, a position would point at a different row.
 *
 * No destination in two cases. Do not draw a link that always ends in a 404 or an empty comments
 * page; that looks the same as a broken product.
 * - Archived or operator-hidden: even the owner gets a 404 on the detail page
 *   (isOwnWorkViewable).
 * - Private: the detail page opens but has no comments section, since public discussion cannot
 *   happen.
 *
 * Both checks reuse existing predicates rather than restating them here. If the boundary between
 * the detail page and the comments changes, this list alone does not start drawing dead links.
 */
export function creatorCommentDestination(item: CreatorCommentInboxItem): {
	storyId: string;
	commentId: string;
	hash: typeof STORY_COMMENTS_ANCHOR;
} | null {
	if (!isOwnWorkViewable(item.story)) return null;
	if (!isStoryDirectlyViewable(item.story.visibility)) return null;
	return {
		storyId: item.story.id,
		commentId: item.comment.id,
		hash: STORY_COMMENTS_ANCHOR,
	};
}

/*
 * Display rules that both apps read. The web comments panel and the mobile one call the same
 * function. If each app wrote its own, one could draw failures as an empty list or omit the reason
 * a row has no destination. That drift is only visible by comparing the two screens side by side.
 * resolveProfileActions lives here for the same reason.
 */

export type CreatorCommentsPanelState =
	/** No connection and no held data. This is waiting, not an error. */
	| "offline"
	/** The session ended. The fix is signing in, not retrying. */
	| "reauth"
	/** The query failed and there is no held data. */
	| "error"
	| "loading"
	/** No comments were actually received. This must be distinguished from a failure. */
	| "empty"
	| "ready";

/**
 * Accepts only the query axes it reads. The failure cause arrives folded into one question: was it
 * a 401? The 401 judgment uses the transport layer's vocabulary (@rowcat/sdk), which this package
 * cannot see, so the caller does the folding.
 */
export interface CreatorCommentsPanelInput {
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	hasData: boolean;
	itemCount: number;
	/** Whether the last failure was a session-expired response (401). */
	sessionLost: boolean;
}

export interface CreatorCommentsPanelView {
	state: CreatorCommentsPanelState;
	/**
	 * Whether rows are on screen while the last refresh failed or was paused. The rows stay; only a
	 * retry path is added.
	 */
	retryable: boolean;
}

/**
 * Decides what the panel draws. The order is the whole function: held rows -> paused -> reauth ->
 * error -> loading -> empty
 *
 * Paused must come before loading, since a paused query is still pending; otherwise an offline user
 * sees a placeholder that never ends. Error must come before empty, or a failed query shows 'no
 * comments yet'. Folding a 401 into a generic failure would make retry return the same 401 forever.
 *
 * Held rows are never cleared, even on failure or 401. They are facts the server confirmed at that
 * moment. Signing in again resets this panel anyway, since login empties ["viewer"].
 */
export function creatorCommentsPanelView(
	q: CreatorCommentsPanelInput,
): CreatorCommentsPanelView {
	if (q.hasData)
		return {
			state: q.itemCount === 0 ? "empty" : "ready",
			retryable: q.isError || q.isPaused,
		};
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError)
		return q.sessionLost
			? { state: "reauth", retryable: false }
			: { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	return { state: "empty", retryable: false };
}

export const creatorCommentKindLabel = (comment: {
	parentId: string | null;
}): "Comment" | "Reply" => (comment.parentId === null ? "Comment" : "Reply");

/**
 * Why a row has no destination. Operator hiding is checked first. Without a reason, some rows look
 * tappable and others do not, with no explanation. Hiding is something the creator did not do, so
 * if it were buried silently, the creator would never learn why. The creator's own visibility comes
 * next. Rows with a destination (public or unlisted) return null: silence is better than an
 * invented reason.
 */
export function creatorCommentUnreachableReason(
	item: CreatorCommentInboxItem,
): string | null {
	if (creatorCommentDestination(item)) return null;
	const { story } = item;
	if (story.hidden) return "Hidden under the operating policy";
	if (story.visibility === "archived") return "Archived story";
	if (story.visibility === "private") return "Private story";
	return null;
}
