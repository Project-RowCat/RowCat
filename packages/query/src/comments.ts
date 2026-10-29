import type { StoryCommentReactionKind } from "@rowcat/contracts";
import type { StoryComment, StoryCommentPage } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	type InfiniteData,
	infiniteQueryOptions,
	mutationOptions,
	type QueryClient,
} from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * Server-state definition for story comments: query keys, page appending, and cache policy after
 * writes.
 * - Comments are server state. Conversations and drafts are the source of truth in IndexedDB and
 *   must not also live in Query (that would make two sources of truth). Comments are the reverse:
 *   other people's posts are not on this device, so they live on the server and here, not in the
 *   sync codec registry.
 * - The screen only knows what was clicked; this file decides which cells that click changes and
 *   how.
 * - Two cell kinds: the top-level list, and one reply list per thread. Replies are not nested in
 *   the top-level row (matching the server contract), so a page's cost does not grow with thread
 *   length, and expanding one thread never touches another's cache.
 * - One place where both move: creating a reply increments the parent's replyCount. The rule is
 *   to write back the parent the server returns rather than +1 locally, so the two caches never
 *   disagree.
 */

/**
 * Sibling of ["stories","gallery"] and ["stories","detail"]. Separate prefixes mean invalidating a
 * list does not sweep comments, and vice versa. Comments are not stored with work detail either:
 * detail is fetched once and kept long, while comments keep growing, and merging them would
 * re-render the whole work on every comment written.
 */
export const STORY_COMMENTS_QUERY_KEY_PREFIX = ["stories", "comments"] as const;

/**
 * One cell per story. The cursor is not in the key: the next page is a further slice of the same
 * query, not a different query (same reason as the gallery note).
 */
export const storyCommentsQueryKey = (storyId: string) =>
	[...STORY_COMMENTS_QUERY_KEY_PREFIX, storyId] as const;

/**
 * Sits beneath the top-level key ([…, storyId, "replies", commentId]). Leaving a story sweeps the
 * whole discussion with one prefix, and invalidating one thread touches only its own cell beneath.
 * As siblings, both properties would be lost.
 */
export const storyCommentRepliesQueryKey = (
	storyId: string,
	commentId: string,
) => [...storyCommentsQueryKey(storyId), "replies", commentId] as const;

/** Shape of the infinite comments cache. Write-side cache updates operate on this type. */
export type StoryCommentsInfiniteData = InfiniteData<StoryCommentPage, string>;

/**
 * initialPageParam is the empty string because the contract's "no cursor" means the first page. The
 * next page passes the server's nextCursor through unchanged; the client never builds cursors.
 * staleTime is above zero, as in the gallery, so short back-and-forth navigation does not refetch
 * every loaded page. It is not infinite, since discussion changes more often than work info. No
 * retry on 4xx, as with detail: a work that became private or inaccessible returns a definitive 404
 * for comments, and retrying only delays the message.
 */
export function storyCommentsInfiniteQueryOptions(
	client: RowCatClient,
	storyId: string,
) {
	return infiniteQueryOptions<
		StoryCommentPage,
		Error,
		StoryCommentsInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: storyCommentsQueryKey(storyId),
		// Passes the signal through so a query whose screen was left also stops on the network.
		queryFn: ({ pageParam, signal }) =>
			client.comments.list(storyId, { cursor: pageParam }, { signal }),
		initialPageParam: "",
		/** undefined means the end: hasNextPage becomes false. */
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * enabled is not set here: whether a thread is expanded is screen state this function cannot see.
 * The caller adds enabled: expanded. Otherwise opening a list of twenty rows would fire twenty
 * reply queries at once, the exact fan-out this slice is meant to avoid.
 */
export function storyCommentRepliesInfiniteQueryOptions(
	client: RowCatClient,
	storyId: string,
	commentId: string,
) {
	return infiniteQueryOptions<
		StoryCommentPage,
		Error,
		StoryCommentsInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: storyCommentRepliesQueryKey(storyId, commentId),
		queryFn: ({ pageParam, signal }) =>
			client.comments.listReplies(
				storyId,
				commentId,
				{ cursor: pageParam },
				{ signal },
			),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Flattens loaded pages into the single list the screen draws. The flattening is not repeated per
 * screen because it depends on the query shape: if pages ever split differently, only this place
 * should change.
 */
export const storyComments = (
	data: StoryCommentsInfiniteData,
): StoryComment[] => data.pages.flatMap((page) => page.items);

/**
 * Appends a new row to the cache, and only when the last page is loaded. The list is oldest-first,
 * so a new row belongs at the end. If the last page still has a nextCursor, the row sits in an
 * unloaded span, and appending it would show it twice once the user loads that span. No optimistic
 * insert: a temporary row would have to invent the server's timestamp and author data, and it would
 * break the property that every row on screen is a saved row. Replies share this function because
 * their shape and ordering match the top-level list.
 */
function appendToPages(
	queryClient: QueryClient,
	key: readonly unknown[],
	comment: StoryComment,
): void {
	queryClient.setQueryData<StoryCommentsInfiniteData>(key, (data) => {
		if (!data) return data;
		const lastIndex = data.pages.length - 1;
		const last = data.pages[lastIndex];
		// The end has not been seen, so this row sits in an unloaded span: leave the data alone.
		if (!last || last.nextCursor !== null) return data;
		// If the same id is already present, leave it: retries or duplicate responses must not create two
		// copies of a row.
		if (last.items.some((item) => item.id === comment.id)) return data;
		return {
			...data,
			pages: data.pages.map((page, index) =>
				index === lastIndex
					? { ...page, items: [...page.items, comment] }
					: page,
			),
		};
	});
}

/**
 * Replaces an already-cached row with the server-confirmed value. Reactions, reply counts, and the
 * tombstone transition all pass through this one function. A separate update per case would let one
 * forget the state transition, and the screen would keep drawing a deleted row with its body. A
 * page without that row is returned as the same reference, so its rows do not re-render.
 */
function replaceInPages(
	queryClient: QueryClient,
	key: readonly unknown[],
	comment: StoryComment,
): void {
	queryClient.setQueryData<StoryCommentsInfiniteData>(key, (data) => {
		if (!data?.pages.some((p) => p.items.some((i) => i.id === comment.id)))
			return data;
		return {
			...data,
			pages: data.pages.map((page) =>
				page.items.some((i) => i.id === comment.id)
					? {
							...page,
							items: page.items.map((item) =>
								item.id === comment.id ? comment : item,
							),
						}
					: page,
			),
		};
	});
}

/**
 * Removes a deleted row from the cache. Only pages that actually contained the id become new
 * arrays.
 */
function removeFromPages(
	queryClient: QueryClient,
	key: readonly unknown[],
	commentId: string,
): void {
	queryClient.setQueryData<StoryCommentsInfiniteData>(key, (data) => {
		if (!data?.pages.some((p) => p.items.some((i) => i.id === commentId)))
			return data;
		return {
			...data,
			pages: data.pages.map((page) =>
				page.items.some((i) => i.id === commentId)
					? {
							...page,
							items: page.items.filter((i) => i.id !== commentId),
						}
					: page,
			),
		};
	});
}

/**
 * Which cell a row lives in is answered by the row itself. Reactions and deletes apply to top-level
 * rows and replies alike. If the caller decided the cell, web and mobile would each make that
 * decision, and one mistake would mean a tapped heart with no visible change. parentId answers it,
 * so it is read once here: no parent means the list cell; a parent means that parent's thread cell.
 */
function commentKeys(
	storyId: string,
	comment: Pick<StoryComment, "id" | "parentId">,
): readonly unknown[] {
	return comment.parentId
		? storyCommentRepliesQueryKey(storyId, comment.parentId)
		: storyCommentsQueryKey(storyId);
}

/**
 * No refetch after success. The response carries the confirmed row whole, so appending it is
 * enough; invalidation would re-download all accumulated pages, a hundred rows to receive twenty.
 * Work detail and gallery are not touched: there is no comment-count contract, so no value on those
 * caches changes. Invalidating them "just in case" would make one comment trigger a list refetch.
 */
export function createCommentMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
) {
	return mutationOptions<StoryComment, Error, string>({
		/**
		 * Writes to the same story are queued. If a burst of taps went out as parallel requests,
		 * responses could arrive out of order, and the same post could be saved twice. (The screen also
		 * disables the button during submit, but that is guidance, not a guarantee.)
		 */
		scope: { id: `story-comments:${storyId}` },
		mutationFn: (body) => client.comments.create(storyId, body),
		onSuccess: (comment) =>
			appendToPages(queryClient, storyCommentsQueryKey(storyId), comment),
	});
}

/**
 * Creating a reply is the only place where two cells move together. The thread cell gets the
 * confirmed reply appended, if its last page was already reached. The top-level cell replaces that
 * parent row with the server's version, since its replyCount just grew. The screen does not mimic
 * the second step with +1: the guess goes wrong when someone else replies at the same moment, and
 * the mismatch stays hidden until the thread is expanded. The parent may not be in the top-level
 * cell (not yet scrolled to, or reached from another screen). replaceInPages then does nothing,
 * which is correct: inventing a missing row would shift page boundaries. The scope is shared with
 * top-level creation because the server's comment-write rate limit is one window for both.
 */
export function createCommentReplyMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
	commentId: string,
) {
	return mutationOptions<
		{ reply: StoryComment; parent: StoryComment },
		Error,
		string
	>({
		scope: { id: `story-comments:${storyId}` },
		mutationFn: (body) => client.comments.reply(storyId, commentId, body),
		onSuccess: ({ reply, parent }) => {
			appendToPages(
				queryClient,
				storyCommentRepliesQueryKey(storyId, commentId),
				reply,
			);
			replaceInPages(queryClient, storyCommentsQueryKey(storyId), parent);
		},
	});
}

/**
 * Toggling a reaction replaces the row with the server-confirmed value; there is no optimistic
 * update. The repository's mutation conventions have no layer that handles that rollback safely,
 * and counts drift under repeated taps: five taps would stack five +/-1 changes, while the server's
 * truth is always 0 or 1. Writing the server's row means the last response is always right; the
 * unique constraint is the final authority. scope is per row: repeated taps on one row run in
 * order, while hearts on different rows do not wait on each other.
 */
export function reactToCommentMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
	comment: Pick<StoryComment, "id" | "parentId">,
	kind: StoryCommentReactionKind = "like",
) {
	return mutationOptions<StoryComment, Error, boolean>({
		scope: { id: `story-comment-reaction:${comment.id}` },
		mutationFn: (liked) =>
			liked
				? client.comments.react(storyId, comment.id, kind)
				: client.comments.unreact(storyId, comment.id, kind),
		onSuccess: (updated) =>
			replaceInPages(queryClient, commentKeys(storyId, comment), updated),
	});
}

/**
 * Deleting one's own comment or reply is not optimistic. The action is irreversible, and if the
 * server refuses (already deleted, or not yours), a restored row would show a deleted post coming
 * back. The user already passed a confirmation dialog, so waiting a few hundred milliseconds is
 * fine. The server's result decides the update: null means the row is gone and is removed from the
 * cache; a returned row means it became a tombstone, and that slot is replaced with it. replyCount
 * is not used to guess: the value on screen can be stale if someone just replied, and deleting then
 * would drop a thread that has replies entirely (it would come back on refresh). A tombstoned
 * thread's reply cell is left alone, since its replies stay alive for anyone who expanded it. Other
 * stories' lists and galleries are not touched: this action changes one row of this story's
 * discussion.
 */
export function deleteCommentMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
) {
	return mutationOptions<
		StoryComment | null,
		Error,
		Pick<StoryComment, "id" | "parentId">
	>({
		scope: { id: `story-comments:${storyId}` },
		mutationFn: (comment) => client.comments.remove(storyId, comment.id),
		onSuccess: (result, comment) => {
			const key = commentKeys(storyId, comment);
			if (result) replaceInPages(queryClient, key, result);
			else removeFromPages(queryClient, key, comment.id);
		},
	});
}
