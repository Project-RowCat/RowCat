/**
 * Product model for story comments: the shape the screens and rules work with. It matches the
 * StoryCommentDto contract in @rowcat/contracts field for field. Like Story, it stays separate from
 * that package: contracts decide whether an incoming value can be trusted, while this file decides
 * what it means in the product.
 *
 * What is missing marks the boundary: no editing, pinning, sort keys, report state, mentions, or
 * search. Adding any of them would let screens draw them and bring storage, sync, and moderation
 * rules along.
 *
 * Two things were added: one-level replies and a single like reaction. Both are either the comment
 * itself (a reply is a comment with a parentId) or an aggregate attached to a comment, not a
 * property of it.
 */

/**
 * Public author shown on a comment row. This is only the minimum one row needs, not the full
 * profile.
 */
export interface StoryCommentAuthor {
	/** RowCat member id. Ownership checks use this as the only identity; the nickname is not used. */
	id: string;
	nickname: string;
	/** Null when there is no avatar; the caller renders a placeholder in its place. */
	avatarUrl: string | null;
}

interface StoryCommentBase {
	id: string;
	storyId: string;
	/**
	 * Null for a top-level comment. A value means this is a reply to a top-level comment. Threads are
	 * only one level deep.
	 */
	parentId: string | null;
	/** ISO 8601. */
	createdAt: string;
	/** Count of live replies. Always 0 on a reply. */
	replyCount: number;
}

/**
 * A live comment. author can never be null: a row whose author identity is gone is a tombstone (see
 * below), not an authorless comment. Story.creator is nullable for the opposite reason: a story is
 * a catalog entry kept on purpose, while a comment is the person's own statement.
 */
export interface VisibleStoryComment extends StoryCommentBase {
	state: "visible";
	author: StoryCommentAuthor;
	body: string;
	likeCount: number;
	/** Whether the viewer has liked this comment. Guests are always false. */
	viewerLiked: boolean;
}

/**
 * A tombstone: a deleted comment kept in the thread's structure. It exists only when a top-level
 * comment that has replies is deleted. A physical delete would take the replies with it, so
 * deleting one's own post would erase other people's statements. Leaving the row with its content
 * would keep showing the deleted author's text and name. So only the row remains; the content and
 * identity are removed.
 *
 * author, body, and likeCount are absent. Screens must be unable to draw those values, and the
 * absence sits in the type, so that a later 'show it faded out' idea is blocked at the model level.
 */
export interface DeletedStoryComment extends StoryCommentBase {
	state: "deleted";
}

export type StoryComment = VisibleStoryComment | DeletedStoryComment;

/**
 * One cursor-paged chunk. A null nextCursor means the end. There is no total count. The
 * contract-side comment gives the reason: no screen reads that number yet, and it would cost a
 * count on every page.
 */
export interface StoryCommentPage {
	items: StoryComment[];
	nextCursor: string | null;
}

/**
 * Whether the comment is the viewer's own. Compares member ids only. Nicknames are not used: they
 * are public display names, not unique, and can change, so a same-named stranger would see a delete
 * button on someone else's comment. Pressing it deletes nothing, since the server makes the final
 * authorization decision, but a screen that appears to allow deletion is still a defect.
 *
 * A tombstone belongs to no one. Its identity is removed, so there is nothing to compare and
 * nothing left to delete. Returning true here would bring back a delete button on an already
 * removed row.
 */
export const isOwnComment = (
	comment: StoryComment,
	viewerId: string | null,
): boolean =>
	comment.state === "visible" &&
	viewerId !== null &&
	comment.author.id === viewerId;

/**
 * Whether a reply can be added to this row. There are only two conditions, and the server re-checks
 * both. This is a function so that screens do not re-write `parentId === null` at every place. The
 * two conditions fail for different reasons:
 * - Must be top-level: threads are one level deep, and the server rejects a reply to a reply with
 *   409.
 * - Must be live: a tombstone is only structure, not a conversation partner. Replying there would
 *   speak to the person who deleted the comment. Returning false does not hide existing replies;
 *   they stay readable. Only adding new ones is blocked.
 */
export const canReplyToComment = (comment: StoryComment): boolean =>
	comment.state === "visible" && comment.parentId === null;

/**
 * Text drawn in place of a tombstone. Both apps use the same value. If each app wrote its own, web
 * and mobile would describe the same row in different words, and neither the compiler nor the tests
 * would catch it. The point of the sentence is that it does not say who deleted the comment
 * (author, operator, or account withdrawal). That information is not for other users to see, and
 * the row no longer holds it.
 */
export const DELETED_COMMENT_PLACEHOLDER = "This comment was deleted.";

/**
 * Label for the row that expands a thread, e.g. `View 3 replies`. The count is in the text so the user
 * knows what will open before pressing. Returns null for 0, so nothing is drawn: `View 0 replies` would
 * be a button that does nothing.
 */
export const commentRepliesLabel = (count: number): string | null =>
	count > 0 ? `View ${count} ${count === 1 ? "reply" : "replies"}` : null;

/**
 * Accessible name of the like button. A heart icon alone would give every row a button with the
 * same name for users who cannot see the screen. The current state (pressed or not) must be part of
 * the name: describing the action instead (`Remove like`) would drop the state that assistive
 * technology reads.
 */
export const commentLikeLabel = (comment: StoryComment): string | null => {
	if (comment.state !== "visible") return null;
	return comment.viewerLiked
		? `Unlike (${comment.likeCount} now)`
		: `Like (${comment.likeCount} now)`;
};
