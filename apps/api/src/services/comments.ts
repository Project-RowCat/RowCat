import {
	STORY_COMMENT_MAX_PAGE_SIZE,
	type StoryCommentReactionKind,
} from "@rowcat/contracts";
import type {
	CreatorCommentInboxStory,
	StoryComment,
	VisibleStoryComment,
} from "@rowcat/domain";
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { type Db, db } from "../db/client.ts";
import {
	member,
	story,
	story_comment,
	story_comment_reaction,
} from "../db/schema.ts";
import { decodeTimelineCursor, encodeTimelineCursor } from "../lib/cursor.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { newId } from "../lib/id.ts";
import { checkRateLimit } from "../lib/rate-limit/index.ts";
import { avatarUrlOf, memberAvatarMediaId } from "./media.ts";
import { notificationSourceKey, notifySocialEvent } from "./notifications.ts";

/**
 * Story comment rules: read, write, delete and reactions all live here. Routes authenticate and
 * validate, then call this file; scattering relational queries across handlers would copy
 * conditions like delete ownership per route, and one loosened copy deletes other people's comments
 * with an identical success response.
 *
 * What this file does not do:
 * - Exposure decisions. Whether a story's comments may be read or written is decided by the story
 *   side (`getStory` in `services/story/index.ts` plus the route's public check); deciding again
 *   here would let the two drift with no way to tell which is right.
 * - Body logging. Comments are user writing and stay out of operational logs; story id and
 *   comment id are enough to reproduce.
 * - Outbound side effects (mail, push, webhooks, analytics). They never enter the transaction: a
 *   delivery failure would roll back a saved comment and the user would watch their text vanish.
 *   The in-app notification ledger INSERT is not such an effect; it is a write inside the same
 *   database and correctness boundary, which is why creation is a transaction.
 *
 * Rules added with replies and reactions:
 * - A thread is one level: the parent must be top-level; a reply to a reply is a 409.
 * - Deleting forks: a top-level comment with surviving replies becomes a tombstone, anything else
 *   is physically deleted.
 * - Aggregates are read as sets: reply and reaction counts cost two queries per page, not per
 *   row.
 *
 * The delete fork is the delicate part: with physical deletion only, removing your own comment
 * would remove everyone else's replies. All deletion goes through `removeStoryComment`, and the FK
 * is the last line of defence (`db/tables/comment.ts`: deleting a row that still has replies
 * fails).
 */

/** The transaction handle account deletion and operator deletion pass in: the exact type drizzle gives its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A connection or a transaction. */
type Executor = Db | Tx;

/**
 * The cursor is the sort key itself, `(created_at, id)`; format and rationale live in
 * `lib/cursor.ts`. Replies use the same cursor: same sort axis and columns, so a second encoding
 * would let the two lists' page-boundary rules evolve apart.
 */

/**
 * List projection; the author is joined in rather than copied onto the row, so the response carries
 * the author and screens do not re-ask profiles per row (no N+1).
 *
 * This is a `leftJoin` on purpose. It used to be an `innerJoin` because a comment without an author
 * could not exist, but a top-level comment with replies survives as a tombstone, and tombstones
 * have no author. An inner join would drop that row, leaving replies parentless and skewing the
 * `limit + 1` next-page check.
 */
const commentColumns = {
	id: story_comment.id,
	storyId: story_comment.story_id,
	parentId: story_comment.parent_id,
	body: story_comment.body,
	deletedAt: story_comment.deleted_at,
	createdAt: story_comment.created_at,
	authorId: member.id,
	authorNickname: member.nickname,
	/**
	 * Avatar comes from two axes, media pointer first and the legacy column as fallback (`avatarUrlOf`
	 * in `services/media.ts`); the three consumers share one constant so the `status = 'ready'`
	 * condition lives in one place.
	 */
	authorAvatarMediaId: memberAvatarMediaId,
	authorAvatarUrl: member.avatar_url,
};

interface CommentRow {
	id: string;
	storyId: string;
	parentId: string | null;
	body: string;
	deletedAt: Date | null;
	createdAt: Date;
	authorId: string | null;
	authorNickname: string | null;
	authorAvatarMediaId: string | null;
	authorAvatarUrl: string | null;
}

/** Per-page aggregates: row id to reply count, like count and whether this viewer liked it. */
interface CommentAggregates {
	replies: Map<string, number>;
	likes: Map<string, { count: number; viewerLiked: boolean }>;
}

/**
 * DB row plus aggregates to the product value; building the DTO is the route's job.
 *
 * The tombstone is decided first: with `deleted_at` set, author and body are never read, so a
 * column added later cannot leak through a tombstone. A row with NULL author and no `deleted_at`
 * cannot be produced by the service, but if met it folds to a tombstone, which is safer than
 * drawing an identity-less line as live.
 */
function toComment(row: CommentRow, agg: CommentAggregates): StoryComment {
	const replyCount = agg.replies.get(row.id) ?? 0;
	const base = {
		id: row.id,
		storyId: row.storyId,
		parentId: row.parentId,
		createdAt: row.createdAt.toISOString(),
		replyCount,
	};
	if (row.deletedAt !== null || row.authorId === null)
		return { ...base, state: "deleted" };
	const like = agg.likes.get(row.id);
	return {
		...base,
		state: "visible",
		author: {
			id: row.authorId,
			nickname: row.authorNickname ?? "",
			// Unspecified is null, not `""`: the column default does not flow into the domain.
			avatarUrl: avatarUrlOf(
				row.authorAvatarMediaId,
				row.authorAvatarUrl ?? "",
			),
		},
		body: row.body,
		likeCount: like?.count ?? 0,
		viewerLiked: like?.viewerLiked ?? false,
	};
}

/**
 * Predicate that drops blocked authors without dropping tombstones. `notInArray(author, hidden)`
 * alone silently removes tombstones because `NULL not in (...)` is NULL, which WHERE does not treat
 * as true; the symptom is replies floating without a parent, only for viewers who hold a block
 * list, which is hard to reproduce.
 */
const notHiddenAuthor = (hiddenAuthors: string[]) =>
	hiddenAuthors.length
		? or(
				isNull(story_comment.author),
				notInArray(story_comment.author, hiddenAuthors),
			)
		: undefined;

/**
 * Reads a page's aggregates in two queries, collected in one function to structurally prevent a
 * per-row `count(*)` (N+1) whose cost grows with the discussion and shows up only as "comments are
 * slow".
 *
 * ```text
 * reply count  parent_id in (...) group by parent_id    idx_story_comment_replies
 * reactions    comment_id in (...) group by comment_id  story_comment_reaction primary key
 * ```
 *
 * Reply counts honour blocks too: replies by blocked people are absent from that viewer's list
 * (`listStoryCommentReplies` uses the same predicate), so counting them would open an empty list
 * from `View 1 reply`. Reactions yield total (`count(*)`) and "did I press" (`bool_or(member_id =
 * viewer)`) from one query.
 */
async function readAggregates(
	executor: Executor,
	ids: string[],
	viewerId: string | null,
	hiddenAuthors: string[],
): Promise<CommentAggregates> {
	const empty: CommentAggregates = { replies: new Map(), likes: new Map() };
	if (!ids.length) return empty;

	const [replyRows, likeRows] = await Promise.all([
		executor
			.select({
				parentId: story_comment.parent_id,
				n: sql<number>`count(*)`.mapWith(Number),
			})
			.from(story_comment)
			.where(
				and(
					inArray(story_comment.parent_id, ids),
					/** Replies are never tombstones (they are physically deleted), but the predicate pins it. */
					isNull(story_comment.deleted_at),
					notHiddenAuthor(hiddenAuthors),
				),
			)
			.groupBy(story_comment.parent_id),
		executor
			.select({
				commentId: story_comment_reaction.comment_id,
				n: sql<number>`count(*)`.mapWith(Number),
				/**
				 * A guest has no identity to ask about; a constant false keeps one query (splitting by viewer
				 * presence would let two copies drift).
				 */
				mine: viewerId
					? sql<boolean>`bool_or(${story_comment_reaction.member_id} = ${viewerId})`.mapWith(
							Boolean,
						)
					: sql<boolean>`false`.mapWith(Boolean),
			})
			.from(story_comment_reaction)
			.where(
				and(
					inArray(story_comment_reaction.comment_id, ids),
					eq(story_comment_reaction.kind, "like"),
				),
			)
			.groupBy(story_comment_reaction.comment_id),
	]);

	const replies = new Map<string, number>();
	for (const row of replyRows)
		if (row.parentId) replies.set(row.parentId, row.n);
	const likes = new Map<string, { count: number; viewerLiked: boolean }>();
	for (const row of likeRows)
		likes.set(row.commentId, { count: row.n, viewerLiked: row.mine === true });
	return { replies, likes };
}

export interface ListStoryCommentsOptions {
	storyId: string;
	/** An empty string is the first page. */
	cursor: string;
	limit: number;
	/**
	 * Member ids this viewer blocked; their lines drop out for this viewer only. Blocking is pushed
	 * down to comments because a blocked creator's work is already gone from every list
	 * (`galleryWhere`), and leaving their comments would make blocking half-done.
	 *
	 * Rows are not deleted and stay visible to others: a personal block is not moderation. It belongs
	 * in the predicate; filtering after fetching would skew the `limit + 1` next-page check and cut
	 * the list near the last page.
	 *
	 * Blocking does not stop writes; that is moderation's authority, not a personal setting's.
	 */
	hiddenAuthors: string[];
	/** Identity used to fill reactions' `viewerLiked`; null for a guest. */
	viewerId: string | null;
}

/**
 * One page of top-level comments, oldest first: the order a conversation is read in. Newest-first
 * would put answers above questions. Sorting is not user-selectable, since that would give the
 * cursor a per-sort meaning and split the cache per sort.
 *
 * Reads `limit + 1` to know whether a next page exists. No total is counted: no screen reads it and
 * `count(*)` rescans the same span on every page.
 *
 * Replies are not embedded: the list is narrowed to `parent_id is null` and each row carries only a
 * reply count, so a page's cost does not scale with thread length.
 */
export async function listStoryComments({
	storyId,
	cursor,
	limit,
	hiddenAuthors,
	viewerId,
}: ListStoryCommentsOptions): Promise<{
	items: StoryComment[];
	nextCursor: string | null;
}> {
	// The contract sets the cap; it is re-checked because a second caller (script, seed) may bypass
	// the contract.
	const take = Math.min(Math.max(1, limit), STORY_COMMENT_MAX_PAGE_SIZE);
	const after = cursor ? decodeTimelineCursor(cursor) : null;

	const rows = await db
		.select(commentColumns)
		.from(story_comment)
		.leftJoin(member, eq(member.id, story_comment.author))
		.where(
			and(
				eq(story_comment.story_id, storyId),
				/** Top-level only; replies have their own resource. */
				isNull(story_comment.parent_id),
				/**
				 * One row comparison covers both keys. The expanded `or` form gives the same result but whether
				 * it uses the index depends on the plan, and one misplaced parenthesis is silently wrong.
				 */
				after
					? sql`(${story_comment.created_at}, ${story_comment.id}) > (${after.createdAt}::timestamptz, ${after.id}::text)`
					: undefined,
				notHiddenAuthor(hiddenAuthors),
			),
		)
		.orderBy(asc(story_comment.created_at), asc(story_comment.id))
		.limit(take + 1);

	const page = rows.slice(0, take);
	const agg = await readAggregates(
		db,
		page.map((row) => row.id),
		viewerId,
		hiddenAuthors,
	);
	const last = page[page.length - 1];
	return {
		items: page.map((row) => toComment(row, agg)),
		/** The cursor is given only when a next page exists; otherwise the client would fetch one extra empty page at the end. */
		nextCursor: rows.length > take && last ? encodeTimelineCursor(last) : null,
	};
}

export interface ListStoryCommentRepliesOptions
	extends ListStoryCommentsOptions {
	/** Parent top-level comment; whether it belongs to this story is checked below in the predicate. */
	parentId: string;
}

/**
 * One page of a thread's replies, oldest first, same cursor rule. The only difference from the
 * top-level list is the predicate: narrowed by parent rather than story. The story axis is still
 * checked so a request whose path story and parent's story disagree cannot read story B's thread
 * through story A's boundary without passing B's exposure gate.
 */
export async function listStoryCommentReplies({
	storyId,
	parentId,
	cursor,
	limit,
	hiddenAuthors,
	viewerId,
}: ListStoryCommentRepliesOptions): Promise<{
	items: StoryComment[];
	nextCursor: string | null;
}> {
	/**
	 * The parent must be a top-level comment of this story, otherwise 404 rather than an empty page.
	 * An empty page folds three cases into one response (no replies, another story's comment,
	 * nonexistent id) and makes a 200 mean "something is there", a probe for other stories' comment
	 * ids. Pointing at a reply is also a 404: "replies of a reply" is not a resource.
	 *
	 * A tombstone passes: deleting the parent does not delete other people's replies.
	 */
	const [parent] = await db
		.select({ id: story_comment.id })
		.from(story_comment)
		.where(
			and(
				eq(story_comment.id, parentId),
				eq(story_comment.story_id, storyId),
				isNull(story_comment.parent_id),
			),
		)
		.limit(1);
	if (!parent) throw notFound("Comment not found.");

	const take = Math.min(Math.max(1, limit), STORY_COMMENT_MAX_PAGE_SIZE);
	const after = cursor ? decodeTimelineCursor(cursor) : null;

	const rows = await db
		.select(commentColumns)
		.from(story_comment)
		.leftJoin(member, eq(member.id, story_comment.author))
		.where(
			and(
				eq(story_comment.story_id, storyId),
				eq(story_comment.parent_id, parentId),
				after
					? sql`(${story_comment.created_at}, ${story_comment.id}) > (${after.createdAt}::timestamptz, ${after.id}::text)`
					: undefined,
				notHiddenAuthor(hiddenAuthors),
			),
		)
		.orderBy(asc(story_comment.created_at), asc(story_comment.id))
		.limit(take + 1);

	const page = rows.slice(0, take);
	/** Replies have no replies so the reply-count aggregate is always empty, but reactions attach; the same function serves both rather than writing aggregation twice. */
	const agg = await readAggregates(
		db,
		page.map((row) => row.id),
		viewerId,
		hiddenAuthors,
	);
	const last = page[page.length - 1];
	return {
		items: page.map((row) => toComment(row, agg)),
		nextCursor: rows.length > take && last ? encodeTimelineCursor(last) : null,
	};
}

export interface ListCreatorCommentInboxOptions {
	/** The member the session resolved; this one value is the whole ownership decision. */
	ownerId: string;
	cursor: string;
	limit: number;
	/** Member ids this creator blocked; their lines drop out of this list. */
	hiddenAuthors: string[];
}

/**
 * One page of comments on my works, newest first: the opposite direction of the story comment list,
 * which is read as a conversation while this is scanned for what is new. Same cursor format
 * (`lib/cursor.ts`), comparison is `<`.
 *
 * Ownership sits in the predicate: `story.owner = :ownerId` is in the join condition. It is not
 * split into "list my stories, then ask for their comments", because that moves the "which stories'
 * comments may I read" decision out of this function and a second caller would make it two
 * decisions. The contract has no slot to point at someone else's story
 * (`CreatorCommentInboxQuery`).
 *
 * The set matches the analytics `A comment` metric (`services/creator-analytics.ts`): tombstones are
 * excluded (no body or identity to read), plus lines I wrote (not received) and lines by members I
 * blocked. `author <> :ownerId` also filters NULL authors, which is harmless because only
 * tombstones have NULL authors and they are already excluded.
 *
 * Not filtered by story exposure: comments that accumulated on an archived or operator-hidden work
 * still belong to its creator, and whether the screen can navigate there is decided by the domain
 * predicate (`creatorCommentDestination`).
 *
 * Cost: narrow by owner (`idx_story_owner`), use the per-story time index
 * (`idx_story_comment_timeline`), then merge-sort. It scales with this creator's received comments,
 * not the platform's. Aggregates use the same two-query function as the list.
 */
export async function listCreatorCommentInbox({
	ownerId,
	cursor,
	limit,
	hiddenAuthors,
}: ListCreatorCommentInboxOptions): Promise<{
	items: { comment: VisibleStoryComment; story: CreatorCommentInboxStory }[];
	nextCursor: string | null;
}> {
	const take = Math.min(Math.max(1, limit), STORY_COMMENT_MAX_PAGE_SIZE);
	const before = cursor ? decodeTimelineCursor(cursor) : null;

	const rows = await db
		.select({
			...commentColumns,
			storyTitle: story.title,
			storyVisibility: story.visibility,
			storyHidden: story.hidden,
		})
		.from(story_comment)
		.innerJoin(
			story,
			and(eq(story.id, story_comment.story_id), eq(story.owner, ownerId)),
		)
		.leftJoin(member, eq(member.id, story_comment.author))
		.where(
			and(
				isNull(story_comment.deleted_at),
				ne(story_comment.author, ownerId),
				before
					? sql`(${story_comment.created_at}, ${story_comment.id}) < (${before.createdAt}::timestamptz, ${before.id}::text)`
					: undefined,
				notHiddenAuthor(hiddenAuthors),
			),
		)
		.orderBy(desc(story_comment.created_at), desc(story_comment.id))
		.limit(take + 1);

	const page = rows.slice(0, take);
	/** `viewerLiked` is the creator's own, since the viewer of this list is that person; it matches the same row on the story detail. */
	const agg = await readAggregates(
		db,
		page.map((row) => row.id),
		ownerId,
		hiddenAuthors,
	);
	const items: {
		comment: VisibleStoryComment;
		story: CreatorCommentInboxStory;
	}[] = [];
	for (const row of page) {
		const comment = toComment(row, agg);
		/**
		 * The predicate already excluded tombstones, so rows here are always live; the type does not know
		 * that, so this checks and folds to not drawing. Leaking a tombstone into an inbox row would make
		 * contract validation reject the whole response.
		 */
		if (comment.state !== "visible") continue;
		items.push({
			comment,
			story: {
				id: row.storyId,
				title: row.storyTitle,
				visibility: row.storyVisibility,
				hidden: row.storyHidden,
			},
		});
	}
	const last = page[page.length - 1];
	return {
		items,
		nextCursor: rows.length > take && last ? encodeTimelineCursor(last) : null,
	};
}

/**
 * Re-reads one committed comment for the response. It is where a line's current state (author plus
 * aggregates) is built after create, delete or reaction; it goes through the same columns and
 * aggregates as the list, so a just-written line and the one the list returns next cannot differ in
 * shape (a difference would sit in the cache and show up only on screen).
 */
async function readComment(
	executor: Executor,
	commentId: string,
	viewerId: string | null,
	hiddenAuthors: string[] = [],
): Promise<StoryComment | null> {
	const [row] = await executor
		.select(commentColumns)
		.from(story_comment)
		.leftJoin(member, eq(member.id, story_comment.author))
		.where(eq(story_comment.id, commentId))
		.limit(1);
	if (!row) return null;
	const agg = await readAggregates(executor, [row.id], viewerId, hiddenAuthors);
	return toComment(row, agg);
}

/**
 * Burst and spam defence belongs to the shared limiter; this file has no cap or counter.
 *
 * It used to count recent `story_comment` rows, which could not count across replicas, could not
 * count deleted comments (a write-delete-write loop passed the cap), and added an index lookup to
 * every write path. The cap itself did not change when it moved.
 *
 * Replies use the same policy (`storyCommentCreate`): a separate window would let one person write
 * ten rows in 30 seconds, and what is counted is how fast a person writes, not which list the row
 * lands in.
 */

export interface CreateStoryCommentOptions {
	storyId: string;
	/** Member id resolved from the session; no path lets a request body value reach here. */
	authorId: string;
	/** Body already trimmed and validated by the contract. */
	body: string;
	/** Block list; used only to align the response's aggregates with the viewer. */
	hiddenAuthors: string[];
}

/**
 * Creates one top-level comment.
 *
 * The author arrives only as an argument: the contract has no such field and the route reads it
 * from the session, so there is structurally no path to write under someone else's name.
 *
 * What enters the transaction and what cannot:
 * - Notification ledger INSERT: same database, same correctness boundary; it comes in. Split, a
 *   "comment exists but the story owner never learns" state would stay committed and not heal.
 * - Push, mail, webhooks, queues: outbound calls; they stay out, since a delivery failure would
 *   roll back a saved comment.
 */
export async function createStoryComment({
	storyId,
	authorId,
	body,
	hiddenAuthors,
}: CreateStoryCommentOptions): Promise<StoryComment> {
	await checkRateLimit("storyCommentCreate", authorId);

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(story_comment)
			.values({
				id: newId(),
				story_id: storyId,
				parent_id: null,
				author: authorId,
				body,
			})
			.returning({ id: story_comment.id });
		if (!row) throw new Error("the comment was not saved");

		/**
		 * The recipient is decided here, not passed in by the route: "who owns this story" is a
		 * relational question and belongs to the service; a route deciding would let the HTTP layer own
		 * social relations and the rule would be copied by a second caller.
		 *
		 * The owner may be absent (`owner` is nullable: a public work whose identity was erased by
		 * account deletion); then there is no one to notify and the comment still succeeds.
		 *
		 * Own comments on own work and comments by authors the owner blocked do not notify;
		 * `notifySocialEvent` holds both gates.
		 */
		const [target] = await tx
			.select({ owner: story.owner })
			.from(story)
			.where(eq(story.id, storyId))
			.limit(1);
		if (target?.owner)
			await notifySocialEvent(tx, {
				recipientId: target.owner,
				actorId: authorId,
				kind: "story_comment",
				sourceKey: notificationSourceKey.comment(row.id),
				storyId,
				commentId: row.id,
			});

		const created = await readComment(tx, row.id, authorId, hiddenAuthors);
		if (!created) throw new Error("couldn't read the comment just saved");
		return created;
	});
}

export interface CreateStoryCommentReplyOptions
	extends CreateStoryCommentOptions {
	/** The top-level comment the reply attaches to; comes only from the path. */
	parentId: string;
}

/**
 * Creates one reply, checking three parent conditions inside the transaction:
 *
 * ```text
 * a comment of this story   blocks a request whose path story and parent's story differ -> 404
 * top-level                 a thread is one level -> 409 comment_reply_depth_exceeded
 * alive                     a tombstone takes no new replies -> 409 comment_reply_to_deleted
 * ```
 *
 * The check is inside the transaction with `FOR UPDATE`. Reading outside and inserting inside would
 * let the parent be deleted in between, leaving a new reply under a tombstone that does not heal
 * and reads, to whoever deleted, as the conversation continuing after deletion.
 *
 * The lock takes the same row the delete path locks (`removeStoryComment` locks the parent), so a
 * reply racing a parent delete is ordered: delete first makes this a 409, reply first makes the
 * delete produce a tombstone. The third condition does not leak existence because whoever reaches
 * that branch can already see that comment (a missing parent is a 404 on the first line).
 *
 * The notification goes only to the parent comment's author. Also sending `story_comment` to the
 * story owner would give two rows for one reply, each explaining it differently; a reply is that
 * thread's conversation, not new feedback on the work, and an owner who wrote the thread's root
 * receives `comment_reply` anyway.
 */
export async function createStoryCommentReply({
	storyId,
	parentId,
	authorId,
	body,
	hiddenAuthors,
}: CreateStoryCommentReplyOptions): Promise<{
	reply: StoryComment;
	parent: StoryComment;
}> {
	await checkRateLimit("storyCommentCreate", authorId);

	return db.transaction(async (tx) => {
		const [parent] = await tx
			.select({
				id: story_comment.id,
				parentId: story_comment.parent_id,
				deletedAt: story_comment.deleted_at,
				author: story_comment.author,
			})
			.from(story_comment)
			.where(
				and(
					eq(story_comment.id, parentId),
					eq(story_comment.story_id, storyId),
				),
			)
			.for("update")
			.limit(1);
		if (!parent) throw notFound("Comment not found.");
		if (parent.parentId !== null)
			throw new ApiError(
				409,
				"comment_reply_depth_exceeded",
				"You can't reply to a reply.",
			);
		if (parent.deletedAt !== null)
			throw new ApiError(
				409,
				"comment_reply_to_deleted",
				"You can't reply to a deleted comment.",
			);

		const [row] = await tx
			.insert(story_comment)
			.values({
				id: newId(),
				story_id: storyId,
				/** The parent is the locked row's id; using the argument would let the check and the save see different values. */
				parent_id: parent.id,
				author: authorId,
				body,
			})
			.returning({ id: story_comment.id });
		if (!row) throw new Error("the reply was not saved");

		/**
		 * Notifies the parent's author. A NULL author was already ruled out above (tombstone). The self
		 * and blocked gates live in `notifySocialEvent`; rewriting them here would copy the rule into a
		 * fourth caller.
		 */
		if (parent.author)
			await notifySocialEvent(tx, {
				recipientId: parent.author,
				actorId: authorId,
				kind: "comment_reply",
				sourceKey: notificationSourceKey.commentReply(row.id),
				storyId,
				/** The target is the reply; if it disappears the row loses its destination. */
				commentId: row.id,
			});

		/**
		 * Read in sequence: statements in a transaction queue on one connection anyway, so `Promise.all`
		 * gains nothing, and writing them side by side would later read as concurrent code and invite
		 * building on that.
		 */
		const reply = await readComment(tx, row.id, authorId, hiddenAuthors);
		const updatedParent = await readComment(
			tx,
			parent.id,
			authorId,
			hiddenAuthors,
		);
		if (!reply || !updatedParent)
			throw new Error("couldn't read the reply just saved");
		return { reply, parent: updatedParent };
	});
}

export interface StoryCommentReactionOptions {
	storyId: string;
	commentId: string;
	memberId: string;
	kind: StoryCommentReactionKind;
	hiddenAuthors: string[];
}

/**
 * Whether the target is a live line of this story; the gate both reaction operations share. The
 * story axis is checked as in delete: story A's boundary must not react to story B's comment.
 * Tombstones are excluded because no utterance remains, and they get the same 404 as a missing
 * comment because distinguishing them would turn the response into "something was there".
 */
async function requireReactableComment(
	executor: Executor,
	storyId: string,
	commentId: string,
): Promise<string> {
	const [row] = await executor
		.select({ id: story_comment.id })
		.from(story_comment)
		.where(
			and(
				eq(story_comment.id, commentId),
				eq(story_comment.story_id, storyId),
				isNull(story_comment.deleted_at),
			),
		)
		.limit(1);
	if (!row) throw notFound("Comment not found.");
	return row.id;
}

/**
 * Turns a reaction on; idempotent.
 *
 * It states a target state rather than toggling: a toggle would let a retry after a lost response
 * cancel what the user just pressed. `onConflictDoNothing` guarantees idempotency in the database,
 * so five rapid presses are one row (counts come from the rows, not a counter).
 *
 * No notification: likes are quiet. One popular comment would fill the inbox and people would stop
 * reading it, along with sanction and appeal notices.
 */
export async function addStoryCommentReaction({
	storyId,
	commentId,
	memberId,
	kind,
	hiddenAuthors,
}: StoryCommentReactionOptions): Promise<StoryComment> {
	await checkRateLimit("storyCommentReact", memberId);
	return db.transaction(async (tx) => {
		const id = await requireReactableComment(tx, storyId, commentId);
		await tx
			.insert(story_comment_reaction)
			.values({ comment_id: id, member_id: memberId, kind })
			.onConflictDoNothing();
		const comment = await readComment(tx, id, memberId, hiddenAuthors);
		if (!comment)
			throw new Error("couldn't read the comment that received the reaction");
		return comment;
	});
}

/**
 * Turns a reaction off; idempotent. Calling it when never pressed succeeds and returns the current
 * state; a 404 would make the response a probe for whether you pressed, and a retry after a lost
 * response would read as a failure.
 */
export async function removeStoryCommentReaction({
	storyId,
	commentId,
	memberId,
	kind,
	hiddenAuthors,
}: StoryCommentReactionOptions): Promise<StoryComment> {
	await checkRateLimit("storyCommentReact", memberId);
	return db.transaction(async (tx) => {
		const id = await requireReactableComment(tx, storyId, commentId);
		await tx
			.delete(story_comment_reaction)
			.where(
				and(
					eq(story_comment_reaction.comment_id, id),
					eq(story_comment_reaction.member_id, memberId),
					eq(story_comment_reaction.kind, kind),
				),
			);
		const comment = await readComment(tx, id, memberId, hiddenAuthors);
		if (!comment)
			throw new Error("couldn't read the comment whose reaction was removed");
		return comment;
	});
}

/**
 * The authority a delete is made under. With a single `authorId` argument there was one authority;
 * operator deletion split it into this union, and the point is not to write the same deletion again
 * in a new file, since the same predicate in two places lets one loosen unnoticed.
 *
 * There is no default that reads as `null` = anyone: it would silently delete someone else's
 * writing if it slipped in; a missing authority must be inexpressible.
 *
 * Only author deletion requires `storyId`, deliberately: it comes under a story path, so a request
 * whose path and comment disagree must be blocked, while operator deletion comes from a case, not a
 * path.
 */
export type StoryCommentDeleteTarget =
	| { kind: "author"; storyId: string; commentId: string; authorId: string }
	| { kind: "moderator"; commentId: string };

/** The deleted comment's original text; the audit basis for operator deletion. */
export interface StoryCommentSnapshot {
	id: string;
	storyId: string;
	authorId: string;
	body: string;
	createdAt: Date;
	/** Parent id for a reply, so the audit record can answer which thread it was. */
	parentId: string | null;
	/** Whether the result is a tombstone (replies remained); callers use it to build the response. */
	tombstoned: boolean;
}

/**
 * Deletes one comment; there are two outcomes and the fork is the core of this slice.
 *
 * ```text
 * live replies remain                  -> tombstone: keep the row, erase body, identity, reactions
 * otherwise (a reply, or empty thread) -> physical delete: the row disappears
 * ```
 *
 * Physically deleting a top-level comment with replies would delete other people's replies, and
 * deleting your own writing must not delete someone else's. Leaving it would keep the deleter's
 * text and name readable. A tombstone is the only answer between the two: structure remains,
 * content does not.
 *
 * Order and locking:
 * 1. Lock the row with the authority predicate in place (`FOR UPDATE`). A request pointing at
 *    someone else's comment gets 0 rows here, so there is no read-then-delete TOCTOU.
 * 2. Check for live replies. None can appear meanwhile because reply creation locks the parent
 *    row (`createStoryCommentReply`).
 * 3. Tombstone: one UPDATE (body, identity and timestamp change in one statement) plus reaction
 *    deletion. Otherwise one DELETE.
 *
 * The single UPDATE is the invariant of `deleted_at`: it is the only such UPDATE in this file, so a
 * row with only `deleted_at` set or a tombstone keeping its body cannot be produced.
 *
 * No deleted row returns `null`, which the route maps to 404. "Missing" and "not yours" are not
 * distinguished because that would reveal the comment exists. The original text is returned for the
 * operator audit; it comes from the locked read so the snapshot is the same on either path (`UPDATE
 * ... RETURNING` yields the new values and cannot be used, which is also why the order is what it
 * is).
 *
 * It takes an `executor` because operator deletion must share a transaction with the action record;
 * without one it opens its own, since this is no longer a single statement.
 */
export async function deleteStoryComment(
	target: StoryCommentDeleteTarget,
	executor?: Executor,
): Promise<StoryCommentSnapshot | null> {
	if (executor) return removeStoryComment(target, executor);
	return db.transaction((tx) => removeStoryComment(target, tx));
}

async function removeStoryComment(
	target: StoryCommentDeleteTarget,
	executor: Executor,
): Promise<StoryCommentSnapshot | null> {
	const where =
		target.kind === "author"
			? and(
					eq(story_comment.id, target.commentId),
					/**
					 * The story axis is checked too. A request whose path story and comment's story differ is
					 * malformed, and letting it pass would delete story B's comment through story A's boundary
					 * without passing B's exposure gate.
					 */
					eq(story_comment.story_id, target.storyId),
					eq(story_comment.author, target.authorId),
					/**
					 * A tombstone is already deleted. The NULL author would exclude it above too, but stating it
					 * keeps the intent (a second delete is a 404).
					 */
					isNull(story_comment.deleted_at),
				)
			: and(
					eq(story_comment.id, target.commentId),
					isNull(story_comment.deleted_at),
				);

	const [row] = await executor
		.select({
			id: story_comment.id,
			storyId: story_comment.story_id,
			parentId: story_comment.parent_id,
			authorId: story_comment.author,
			body: story_comment.body,
			createdAt: story_comment.created_at,
		})
		.from(story_comment)
		.where(where)
		.for("update")
		.limit(1);
	if (!row || !row.authorId) return null;

	/**
	 * Is there any live reply; the block list is not consulted. This decision asks about the data, not
	 * the viewer's screen: not counting a blocked person's reply would physically delete the parent
	 * for them and actually destroy someone else's reply.
	 */
	const [surviving] = row.parentId
		? []
		: await executor
				.select({ id: story_comment.id })
				.from(story_comment)
				.where(eq(story_comment.parent_id, row.id))
				.limit(1);

	const snapshot: StoryCommentSnapshot = {
		id: row.id,
		storyId: row.storyId,
		parentId: row.parentId,
		authorId: row.authorId,
		body: row.body,
		createdAt: row.createdAt,
		tombstoned: !!surviving,
	};

	if (surviving) {
		await tombstoneComments(executor, [row.id]);
		return snapshot;
	}

	if (row.parentId) {
		/**
		 * Lock the parent before deleting the reply. The last reply under a tombstone also removes that
		 * tombstone (`pruneEmptyTombstones`); counting without the lock lets the last two replies under
		 * one tombstone, deleted concurrently, each still see the other's row and leave the tombstone
		 * forever. The parent lock orders them: the later one sees the earlier commit.
		 *
		 * Order is reply, then parent (the reply row is already locked above). Other paths locking the
		 * parent (reply creation, parent delete) do not lock reply rows, so no deadlock.
		 */
		await executor
			.select({ id: story_comment.id })
			.from(story_comment)
			.where(eq(story_comment.id, row.parentId))
			.for("update")
			.limit(1);
	}

	await executor.delete(story_comment).where(eq(story_comment.id, row.id));
	if (row.parentId) await pruneEmptyTombstones(executor, [row.parentId]);
	return snapshot;
}

/**
 * Removes tombstones left with no replies. A tombstone stands to protect other people's replies;
 * once they are all gone it protects nothing, yet nobody can delete it: the author predicate misses
 * it (NULL author) and the operator predicate excludes rows with `deleted_at` set. Left alone, an
 * empty "deleted comment" line would stand on that story forever.
 *
 * All three predicates are required: a tombstone (`deleted_at`), top-level (replies never become
 * tombstones, pinned anyway), and childless. A live top-level comment is never deleted here.
 * Moderation cases and notifications carry no FK to comments (see those table headers), so this
 * deletion takes no enforcement record with it.
 */
async function pruneEmptyTombstones(
	executor: Executor,
	parentIds: string[],
): Promise<void> {
	if (!parentIds.length) return;
	await executor.delete(story_comment).where(
		and(
			inArray(story_comment.id, parentIds),
			isNotNull(story_comment.deleted_at),
			isNull(story_comment.parent_id),
			sql`not exists (
					select 1 from ${story_comment} child
					where child.parent_id = ${story_comment.id}
				)`,
		),
	);
}

/**
 * Turns rows into tombstones; the only place in this file with that UPDATE.
 *
 * Changing the three values in one statement is the invariant of `deleted_at` (no tombstone keeps a
 * body or an identity). The original is not moved to another column, since moving is not deleting.
 * Reactions are deleted too because the FK cascade does not reach a surviving row; they belonged to
 * that utterance, and keeping them would give a tombstone a like count.
 */
async function tombstoneComments(
	executor: Executor,
	ids: string[],
): Promise<void> {
	if (!ids.length) return;
	await executor
		.update(story_comment)
		.set({ body: "", author: null, deleted_at: new Date() })
		.where(
			and(inArray(story_comment.id, ids), isNull(story_comment.deleted_at)),
		);
	await executor
		.delete(story_comment_reaction)
		.where(inArray(story_comment_reaction.comment_id, ids));
}

/**
 * Turns a delete result into the response value: the line's current state for a tombstone, `null`
 * for a physical delete. The server answers so the screen does not guess from `replyCount`
 * (contract comment); this function gathers the two branches in one place.
 */
export async function readCommentAfterDelete(
	snapshot: StoryCommentSnapshot,
	viewerId: string | null,
	hiddenAuthors: string[] = [],
): Promise<StoryComment | null> {
	if (!snapshot.tombstoned) return null;
	return readComment(db, snapshot.id, viewerId, hiddenAuthors);
}

/**
 * Lookup for confirming a report target; makes no exposure decision. Callers already pass the story
 * boundary (the same predicate as `requireCommentableStory`) before calling; deciding again would
 * let the two drift (the rule in this file's header).
 *
 * Looking up by the `(storyId, commentId)` pair is the point: the report request carries both
 * (`ReportTarget`), so another story's comment cannot be passed off as this story's. Tombstones
 * answer as absent: no utterance remains and the evidence snapshot is body and author, both empty
 * on a tombstone, which would file an empty report. Replies are found as comments.
 */
export async function getStoryCommentSnapshot(
	storyId: string,
	commentId: string,
): Promise<Omit<StoryCommentSnapshot, "tombstoned"> | null> {
	const [row] = await db
		.select({
			id: story_comment.id,
			storyId: story_comment.story_id,
			parentId: story_comment.parent_id,
			authorId: story_comment.author,
			body: story_comment.body,
			createdAt: story_comment.created_at,
		})
		.from(story_comment)
		.where(
			and(
				eq(story_comment.id, commentId),
				eq(story_comment.story_id, storyId),
				isNull(story_comment.deleted_at),
			),
		)
		.limit(1);
	return row?.authorId ? { ...row, authorId: row.authorId } : null;
}

/**
 * One comment by id alone, with no exposure decision: the operator review screen asks whether a
 * comment still exists. It is separate from the pair lookup above because authorization differs:
 * that one is called on a reporter's path and must check the story boundary, while this one is
 * reachable only by routes that already passed `requireModeratorViewer`. A tombstone is absent here
 * too; drawing one as "still there" would let an enforcement action be filed against text that is
 * already gone.
 */
export async function getStoryCommentById(
	commentId: string,
): Promise<Omit<StoryCommentSnapshot, "tombstoned"> | null> {
	const [row] = await db
		.select({
			id: story_comment.id,
			storyId: story_comment.story_id,
			parentId: story_comment.parent_id,
			authorId: story_comment.author,
			body: story_comment.body,
			createdAt: story_comment.created_at,
		})
		.from(story_comment)
		.where(
			and(eq(story_comment.id, commentId), isNull(story_comment.deleted_at)),
		)
		.limit(1);
	return row?.authorId ? { ...row, authorId: row.authorId } : null;
}

/**
 * Removes every comment this member wrote; called by account deletion. It has two steps because of
 * replies:
 *
 * ```text
 * 1. my top-level comments with other people's replies -> turn into tombstones
 * 2. all my remaining comments and replies             -> delete
 * ```
 *
 * Skipping step 1 makes step 2's DELETE fail (the FK blocks at statement end), which is the
 * intended direction: the whole deletion transaction stops loudly instead of silently deleting
 * other people's replies. The order cannot be reversed; after tombstoning, `author` is NULL and
 * misses step 2's predicate, so the steps do not intrude on each other.
 *
 * My top-level comment with only my own replies does not become a tombstone: parent and child are
 * both mine, one statement takes both, and nothing points at the row at statement end.
 *
 * It is explicit despite the FK cascade because deletion must show what is erased and records
 * counts in the audit; the cascade is now `set null`, so leaving it to the FK would leave rows that
 * should be deleted as tombstones.
 */
export async function deleteCommentsByAuthor(
	tx: Tx,
	memberId: string,
): Promise<{ deletedIds: string[]; tombstonedIds: string[] }> {
	/** My top-level comments that carry other people's replies; replies by me alone must not qualify, or rows that can simply be deleted would remain as tombstones. */
	const doomed = await tx
		.select({ id: story_comment.id })
		.from(story_comment)
		.where(
			and(
				eq(story_comment.author, memberId),
				isNull(story_comment.parent_id),
				sql`exists (
					select 1 from ${story_comment} child
					where child.parent_id = ${story_comment.id}
					  and (child.author is null or child.author <> ${memberId})
				)`,
			),
		);
	const tombstonedIds = doomed.map((row) => row.id);
	await tombstoneComments(tx, tombstonedIds);

	const deleted = await tx
		.delete(story_comment)
		.where(eq(story_comment.author, memberId))
		.returning({ id: story_comment.id, parentId: story_comment.parent_id });
	/**
	 * Removes other people's tombstones whose last reply was mine. Same hole as author deletion: if my
	 * reply was all a tombstone protected, it would remain as an empty line nobody can delete. These
	 * tombstones are not in the returned list (case cleanup targets): their author is not this member
	 * and this deletion has no basis to touch that person's cases.
	 */
	await pruneEmptyTombstones(tx, [
		...new Set(deleted.flatMap((row) => (row.parentId ? [row.parentId] : []))),
	]);
	/**
	 * Returns ids, since counts alone are not enough: moderation cases hold comment ids as targets, so
	 * the caller must know what vanished to clean up related cases. Tombstoned ids are included; those
	 * lines are gone as report targets too.
	 */
	return { deletedIds: deleted.map((row) => row.id), tombstonedIds };
}
