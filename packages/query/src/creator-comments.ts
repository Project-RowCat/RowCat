import type {
	CreatorCommentInboxItem,
	CreatorCommentInboxPage,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { type InfiniteData, infiniteQueryOptions } from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * The comments column of the creator workspace: what comments have been left on the creator's
 * works. It is not merged with the per-story comment cache (`["stories","comments",storyId]`). That
 * cache is one work's public discussion, the same rows for any viewer. This list is one creator's
 * private inbox: titles of stored works appear, and what appears depends on the viewer's block
 * list. The prefix sits under ["viewer"], like the published-works and analytics columns. Logout
 * resets it (viewer.ts), and login's ["viewer"] reset clears it too. The key has no viewer id, for
 * the same reason as those columns. No mutation invalidates this prefix. The list moves with
 * comments other people leave on the creator's works, not with writes on this device. Reporting
 * changes no public state in the list, and the creator's own replies never appear here (own
 * comments are not received). Freshness decides. There is no polling or SSE: new-comment alerts are
 * already handled by notifications.
 */
export const CREATOR_COMMENTS_QUERY_KEY_PREFIX = [
	"viewer",
	"creator-comments",
] as const;

export type CreatorCommentsInfiniteData = InfiniteData<
	CreatorCommentInboxPage,
	string
>;

/**
 * Received comments, appended with a cursor (`Show more`). The cursor is not part of the key: the next
 * page is another slice of the same query, not a different query. 4xx responses are not retried. A
 * 401 would return the same answer three more times while the screen sits on a placeholder.
 */
export function creatorCommentsInfiniteQueryOptions(client: RowCatClient) {
	return infiniteQueryOptions<
		CreatorCommentInboxPage,
		Error,
		CreatorCommentsInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: CREATOR_COMMENTS_QUERY_KEY_PREFIX,
		queryFn: ({ pageParam, signal }) =>
			client.me.creatorComments({ cursor: pageParam }, { signal }),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Drops duplicate comment ids so that each renders once. The cursor is (created_at, id), so
 * duplicates do not occur on the normal path. But the newest-first list gains rows at the top: a
 * refetch of the first page can overlap with a later page's append, putting the same row on two
 * pages. The screen uses this id as the React key, so a duplicate must collapse silently into one
 * row rather than cause a key collision.
 */
export function creatorCommentInboxItems(
	data: CreatorCommentsInfiniteData,
): CreatorCommentInboxItem[] {
	const seen = new Set<string>();
	const items: CreatorCommentInboxItem[] = [];
	for (const page of data.pages)
		for (const item of page.items) {
			if (seen.has(item.comment.id)) continue;
			seen.add(item.comment.id);
			items.push(item);
		}
	return items;
}
