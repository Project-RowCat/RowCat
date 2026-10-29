import { z } from "zod";
import {
	STORY_COMMENT_MAX_PAGE_SIZE,
	STORY_COMMENT_PAGE_SIZE,
	VisibleStoryCommentDto,
} from "./comments.ts";
import { StoryVisibility } from "./publication.ts";

/**
 * Creator comment inbox, GET /v2/me/creator-comments. It is not a new messaging system: it is a
 * read over two existing resources. Comments are written under works (/v2/stories/:id/comments),
 * and this endpoint only collects the ones on the caller's own works, newest first.
 *
 * Deliberately absent:
 * - Read state. The inbox's first expected feature, but there is nowhere to store it. It is one
 *   creator's private state, so it cannot live on the comment row. A separate table would
 *   immediately call for an unread badge and a clear action. Notifications already track this
 *   (story_comment, comment_reply). Two inboxes should not each track read state.
 * - Reply, assignment, tags, or status. That is support-ticket vocabulary. Replying happens in
 *   the work's comment section; this list only links there.
 * - Target member. No slot in path, query, or body. The owner comes only from the session.
 * - Moderation axis. Report counts and hidden state belong to operators and are not in the public
 *   comment DTO. They are not added here.
 *
 * The included set matches the analytics comments metric. Included: live comments and replies on
 * the caller's works. Excluded: tombstones (no body and no identity, nothing to read), the caller's
 * own comments (received, not sent), and comments from members the caller has blocked (blocking
 * means hiding from one's own screen). The first two must match analytics' comments count. If they
 * diverge, analytics might say 12 comments while the inbox draws 10 rows, and nothing would explain
 * the gap. The other two differences are already explained by the list's name, `Comments received`.
 */

/** Default page size matches the work comment list, so rows are drawn at the same density. */
export const CREATOR_COMMENT_INBOX_PAGE_SIZE = STORY_COMMENT_PAGE_SIZE;

/**
 * Cursor and page size only. No story filter: one work's discussion is already drawn by that work's
 * comment section. Adding the filter here would make 'comments on this work' answerable in two
 * places. No sort axis either; the inbox is newest-first only.
 */
export const CreatorCommentInboxQuery = z.object({
	/**
	 * An empty string means the first page. The value is the opaque string the server returned, passed
	 * back unchanged.
	 */
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(STORY_COMMENT_MAX_PAGE_SIZE)
		.default(CREATOR_COMMENT_INBOX_PAGE_SIZE),
});
export type CreatorCommentInboxQuery = z.infer<typeof CreatorCommentInboxQuery>;

/**
 * The work a row points to. Only what is needed to draw one line and navigate there. visibility and
 * hidden are included for the navigation decision. Works archived or hidden by an operator return
 * 404 even to their owner (isOwnWorkViewable), and private works have no comment section. Without
 * these fields the screen would draw links that always 404. No cover, play payload, or metrics: the
 * row draws only the title.
 */
export const CreatorCommentInboxStoryDto = z.object({
	id: z.string(),
	title: z.string(),
	visibility: StoryVisibility,
	hidden: z.boolean(),
});
export type CreatorCommentInboxStoryDto = z.infer<
	typeof CreatorCommentInboxStoryDto
>;

export const CreatorCommentInboxItemDto = z.object({
	comment: VisibleStoryCommentDto,
	story: CreatorCommentInboxStoryDto,
});
export type CreatorCommentInboxItemDto = z.infer<
	typeof CreatorCommentInboxItemDto
>;

/**
 * One page, newest first, chained by cursor. The direction is the opposite of the work comment list
 * (oldest first). That order reads a conversation; this one scans what just arrived. The cursor
 * format is the same: the sort key is (created_at, id) in both, and the query sets the direction.
 *
 * No total count. Each page would pay an extra count(*), and no judgment reads the number. How many
 * comments exist is already answered by the analytics count.
 */
export const CreatorCommentInboxPage = z.object({
	items: z.array(CreatorCommentInboxItemDto),
	nextCursor: z.string().nullable(),
});
export type CreatorCommentInboxPage = z.infer<typeof CreatorCommentInboxPage>;

export function toCreatorCommentInboxSearchParams(
	q: CreatorCommentInboxQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.cursor) sp.set("cursor", q.cursor);
	if (q.limit !== CREATOR_COMMENT_INBOX_PAGE_SIZE)
		sp.set("limit", String(q.limit));
	return sp;
}
