import { z } from "zod";

/**
 * Wire protocol for `/v2/stories/:id/comments`. Comments are the most public user data here: the
 * server holds plaintext and Postgres is the source of truth. Chats and drafts are the opposite:
 * they live on the device and the server stores only ciphertext. Local-first data has no contract.
 *
 * What is deliberately not accepted:
 * - Author. No request field holds authorId, nickname, or avatarUrl. Ignoring them is not enough:
 *   a field missed in one implementation would become client-controlled.
 * - Story ownership. The path decides the story. A storyId in the body would allow a mismatch.
 * - Parent comment. The path decides the parent too. A parentId in the body would create a
 *   mismatch the depth check cannot resolve.
 * - Depth and root. The one-level rule is a server predicate, not a value the request asserts.
 * - Moderation state. Report counts and hidden flags are operator data, outside the public DTO.
 * - Cursor meaning. nextCursor is opaque; the server owns its shape and the client echoes it.
 *
 * Replies are comments, not a second resource. They share this DTO and gain one parentId field.
 * Separate types would duplicate report targets, moderation actions, and reaction boundaries.
 * Thread depth is one level by product decision: parentId may only point at a top-level comment.
 * Replies are not nested in responses. A recursive replies array would make depth unbounded and tie
 * the cost of drawing a page to thread length (unbounded fan-out).
 */

/**
 * Single source of truth for the body length limit. The screen (character count, send lock) and the
 * server must read the same value. Separate copies let a comment the screen accepts fail with a 400
 * the user cannot explain.
 *
 * 1000 characters because a comment is a reaction, not a review. Longer text belongs to the work
 * description (4000 characters) or a dedicated writing screen, which does not exist yet.
 *
 * Replies use the same limit. A narrower reply limit would create two definitions of a valid body,
 * and short replies are a habit, not a product rule.
 */
export const STORY_COMMENT_LIMITS = { body: 1_000 } as const;

/**
 * Comments fetched per page. Client and server must share it so prefetch and the actual query line
 * up.
 */
export const STORY_COMMENT_PAGE_SIZE = 20;

/**
 * Hard cap on requested page size, for the same reason as the gallery's MAX_PAGE_SIZE. Without a
 * cap, limit=100000 in one request would dump a whole work's discussion and defeat pagination.
 */
export const STORY_COMMENT_MAX_PAGE_SIZE = 50;

/**
 * Replies per page; smaller than the top-level page. Expanding a thread is one action. Expanding
 * twenty lines at once pushes the other comments off screen, and the reader loses their place.
 */
export const STORY_COMMENT_REPLY_PAGE_SIZE = 10;

/**
 * The public reaction vocabulary is one value. Pinning values in advance means the set cannot grow
 * without code to produce it, the same rule as moderation capabilities and notification kinds.
 * Storage has a kind column, so widening later needs no migration, but the product vocabulary is
 * exactly this array. This enforces the decision not to build an emoji picker: a value outside the
 * list is a 400 on the route.
 */
export const STORY_COMMENT_REACTION_KINDS = ["like"] as const;
export const StoryCommentReactionKind = z.enum(STORY_COMMENT_REACTION_KINDS);
export type StoryCommentReactionKind = z.infer<typeof StoryCommentReactionKind>;

/**
 * Public author shape needed to draw a comment row. Sent in the response to avoid one profile
 * lookup per row (N+1). It is only the minimum needed for one row. Bio, follower count, and join
 * date are fetched by the profile screen itself.
 *
 * Not stored as a snapshot in the database: story_comment holds only the member id. A copied
 * nickname would keep the old name on past comments after a rename, and would leave a deleted
 * member's name behind.
 *
 * avatarUrl is nullable by repo convention: unset is null, not an empty string.
 */
export const StoryCommentAuthorDto = z.object({
	id: z.string(),
	nickname: z.string(),
	avatarUrl: z.string().nullable(),
});
export type StoryCommentAuthorDto = z.infer<typeof StoryCommentAuthorDto>;

/**
 * The axis both branches share. parentId null means top-level; a value means a reply to that
 * top-level comment. The server guarantees that a reply's parentId always points to a top-level
 * comment, so the client can decide indentation from this value alone.
 *
 * replyCount is meaningful only on top-level comments and is always 0 on replies, since replies
 * have no replies. It stays on replies rather than being removed, because removing it would split
 * the shape into four cases: visible top-level, visible reply, deleted top-level, deleted reply. A
 * zero in a meaningless spot is narrower than making every screen check which branch it is in.
 */
const commentBase = {
	id: z.string(),
	storyId: z.string(),
	parentId: z.string().nullable(),
	/** ISO 8601. */
	createdAt: z.iso.datetime(),
	replyCount: z.number().int().min(0),
};

/**
 * The live comment row. Body and author exist only here. Merging this with the deleted row into one
 * object (body: string plus deleted: boolean) would make 'deleted but still has a body'
 * representable. Every screen would then have to check both fields together, and one missed check
 * would draw the deleted author's text. Same reasoning as the notification contract, which is a
 * discriminated union.
 */
export const VisibleStoryCommentDto = z.object({
	...commentBase,
	state: z.literal("visible"),
	author: StoryCommentAuthorDto,
	body: z.string(),
	likeCount: z.number().int().min(0),
	/** Whether the viewer has liked it. Guests always get false. */
	viewerLiked: z.boolean(),
});
export type VisibleStoryCommentDto = z.infer<typeof VisibleStoryCommentDto>;

/**
 * A tombstone: a deleted comment whose row stays because it still has replies. Only top-level
 * comments with replies become tombstones. Physically deleting the row would also erase other
 * people's replies, so removing your own comment would remove someone else's statements. Keeping
 * the content and identity would keep showing the deleted author and text.
 *
 * So the row stays and content and identity are removed. The type has no author and no body by
 * design: the server cleared those values, so there is nothing to send. Because the fields are
 * absent from the contract, a later change to draw a greyed-out deleted body is blocked at the
 * contract level.
 *
 * likeCount and viewerLiked are absent too. Reactions belonged to the statement, which is gone, so
 * the server deletes those rows as well. What remains is id (the anchor replies point to),
 * createdAt (the thread order), and replyCount.
 */
export const DeletedStoryCommentDto = z.object({
	...commentBase,
	state: z.literal("deleted"),
});
export type DeletedStoryCommentDto = z.infer<typeof DeletedStoryCommentDto>;

/**
 * The discriminant is state. A screen that detects deletion by checking body === '' relies on the
 * fact that an empty string cannot be stored (the min(1) rule). That assumption would break
 * silently the day the contract changes.
 *
 * Old clients: the visible branch is a superset of the old StoryCommentDto. It keeps id, storyId,
 * author, body, and createdAt and only adds fields, so the old z.object drops the extra keys and
 * accepts it.
 *
 * Tombstones are different. Old clients cannot represent this new state, and the server must not
 * hide it behind a fake author and empty body. That would show a nameless member writing an empty
 * comment, putting a non-existent person in the place of the deleted one.
 */
export const StoryCommentDto = z.discriminatedUnion("state", [
	VisibleStoryCommentDto,
	DeletedStoryCommentDto,
]);
export type StoryCommentDto = z.infer<typeof StoryCommentDto>;

/**
 * No page number. Comments keep growing while being read, so offset does not fit. If one item is
 * added while viewing page 2, a boundary row shows twice or is skipped. A cursor marks the last row
 * seen and is unaffected by changes in between.
 */
export const StoryCommentsQuery = z.object({
	/**
	 * An empty string means the first page. This follows the repo convention that an unset query value
	 * is an empty string.
	 */
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(STORY_COMMENT_MAX_PAGE_SIZE)
		.default(STORY_COMMENT_PAGE_SIZE),
});
export type StoryCommentsQuery = z.infer<typeof StoryCommentsQuery>;

/**
 * Same shape as the top-level query with a different default. It is a separate type because the
 * default page size differs (see the constant comment above). Passing a different limit to the same
 * type would scatter that default across call sites.
 */
export const StoryCommentRepliesQuery = z.object({
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(STORY_COMMENT_MAX_PAGE_SIZE)
		.default(STORY_COMMENT_REPLY_PAGE_SIZE),
});
export type StoryCommentRepliesQuery = z.infer<typeof StoryCommentRepliesQuery>;

/**
 * No total count, unlike the gallery (StoriesPage). The gallery must say 'N of M', and its total
 * explains the sort and filter results. For comments, a total costs an extra count(*) on every page
 * and no judgment uses it. Design it when a product requirement shows the count, and still do not
 * pre-build a counter.
 *
 * nextCursor null means the end. An empty string does not mean the end, because 'no value' and
 * 'empty value' with the same shape lead readers to treat both as true by mistake.
 *
 * Replies are not included. An embedded reply array per row would tie the cost of a page to thread
 * length (unbounded fan-out) and force a second pagination design. Only a count is included;
 * expansion uses the dedicated resource below.
 */
export const StoryCommentsPage = z.object({
	items: z.array(StoryCommentDto),
	nextCursor: z.string().nullable(),
});
export type StoryCommentsPage = z.infer<typeof StoryCommentsPage>;

/** Same shape as the comments page: oldest first, chained by cursor. */
export const StoryCommentRepliesPage = StoryCommentsPage;
export type StoryCommentRepliesPage = z.infer<typeof StoryCommentRepliesPage>;

/**
 * Serialization omits defaults; the server reads an omitted value as its default. As with the
 * gallery, the contract owns this rule. If each client wrote its own, the same query would go to
 * different URLs.
 */
export function toStoryCommentsSearchParams(
	q: StoryCommentsQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.cursor) sp.set("cursor", q.cursor);
	if (q.limit !== STORY_COMMENT_PAGE_SIZE) sp.set("limit", String(q.limit));
	return sp;
}

/** Same omission rule; only the default that triggers omission differs. */
export function toStoryCommentRepliesSearchParams(
	q: StoryCommentRepliesQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.cursor) sp.set("cursor", q.cursor);
	if (q.limit !== STORY_COMMENT_REPLY_PAGE_SIZE)
		sp.set("limit", String(q.limit));
	return sp;
}

/**
 * Normalization lives in the schema (.trim()). If trimming sat in a service or a screen, the rule
 * for a valid body would exist twice, and fixing only one side would let whitespace-only comments
 * through. Only leading and trailing whitespace is trimmed. Internal line breaks are the author's
 * paragraphing and are kept.
 *
 * No profanity masking, no markdown rewriting, no regex HTML sanitizing. The first two rewrite what
 * the user wrote. The last imitates safety with a regex. Safety belongs to the render path: plain
 * text, and no dangerouslySetInnerHTML.
 */
export const StoryCommentCreateRequest = z.object({
	body: z.string().trim().min(1).max(STORY_COMMENT_LIMITS.body),
});
export type StoryCommentCreateRequest = z.infer<
	typeof StoryCommentCreateRequest
>;

/**
 * Alias so the call site records what the request is. It has the same value because a reply is a
 * comment. The point of this type is that it has no parentId: the path decides the parent (see the
 * file header).
 */
export const StoryCommentReplyCreateRequest = StoryCommentCreateRequest;
export type StoryCommentReplyCreateRequest = z.infer<
	typeof StoryCommentReplyCreateRequest
>;

/**
 * Returns the comment exactly as the server confirmed it. The screen appends this value to its
 * cache.
 */
export const StoryCommentCreateResponse = z.object({
	comment: StoryCommentDto,
});
export type StoryCommentCreateResponse = z.infer<
	typeof StoryCommentCreateResponse
>;

/**
 * Returns the confirmed reply and the parent's new state. The parent is included because replyCount
 * has just changed. If the client incremented it locally, the guess would drift when someone else
 * replies at the same moment, and the drift would stay hidden until the thread is expanded. Sending
 * the server's count closes that gap.
 */
export const StoryCommentReplyCreateResponse = z.object({
	reply: StoryCommentDto,
	parent: StoryCommentDto,
});
export type StoryCommentReplyCreateResponse = z.infer<
	typeof StoryCommentReplyCreateResponse
>;

/**
 * Delete response: removed, or turned into a tombstone. This changed from 204 to 200. Once replies
 * exist the outcome has two forms, and if the screen cannot tell them apart it must guess whether
 * to remove the row from the cache or swap in a tombstone. That guess relies on the local
 * replyCount, which goes stale when someone else replies. The screen would then remove a whole
 * thread that still has replies, and it would come back on refresh.
 *
 * null means the row is gone (a comment without replies, or a reply). A value means a tombstone.
 *
 * Old clients do not read this body. The SDK's requestVoid discards it, so 200 and 204 look the
 * same to them.
 */
export const StoryCommentDeleteResponse = z.object({
	comment: StoryCommentDto.nullable(),
});
export type StoryCommentDeleteResponse = z.infer<
	typeof StoryCommentDeleteResponse
>;

/**
 * Returns the comment after the change, not just the count. The screen needs likeCount and
 * viewerLiked together. Sending them separately would make each client assemble the pair. With the
 * whole comment, the cache only has to replace that row.
 *
 * Idempotent, so the response has the same shape every time. Re-PUT on an already-liked comment, or
 * DELETE on an unliked one, both return the current confirmed state. Reporting 'nothing changed'
 * with another code would make retries read as failures.
 */
export const StoryCommentReactionResponse = z.object({
	comment: StoryCommentDto,
});
export type StoryCommentReactionResponse = z.infer<
	typeof StoryCommentReactionResponse
>;

/**
 * Error codes for the comment boundary. Some reasons cannot be told apart by status code alone.
 *
 * `unavailable` is for a work that is visible but has no comments, such as a private work the owner
 * opened. It is a 404 like an invisible work, but the screen must word them differently ('cannot
 * comment on this work' vs. 'no such work'). Only people who can already see the work reach this
 * code, so existence hiding is not broken.
 *
 * The two reply codes (replyDepth, replyToDeleted) have the same property. They reach only callers
 * for whom the parent exists in this work (a missing parent is a 404), so nothing leaks. Their
 * actions differ: the first says to reply to the original comment, the second says no more replies
 * can be added. Folding them into one would be wrong in one of the two cases.
 */
export const STORY_COMMENT_ERROR_CODE = {
	/** Private or archived works, where public discussion does not hold. */
	unavailable: "story_comments_unavailable",
	/** Too many writes in a short window (429). A Retry-After header comes with the response. */
	rateLimited: "comment_rate_limited",
	/** Tried to reply to a reply. Threads are one level deep (409). */
	replyDepth: "comment_reply_depth_exceeded",
	/** Tried to add a reply to a tombstoned comment (409). */
	replyToDeleted: "comment_reply_to_deleted",
	/** Reactions pressed too quickly (429). */
	reactionRateLimited: "comment_reaction_rate_limited",
} as const;
export type StoryCommentErrorCode =
	(typeof STORY_COMMENT_ERROR_CODE)[keyof typeof STORY_COMMENT_ERROR_CODE];
