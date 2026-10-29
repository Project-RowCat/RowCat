import {
	type CreatorAnalyticsPage,
	type CreatorAnalyticsSummary,
	type CreatorAnalyticsWindow,
	type CreatorAnalyticsWork,
	DEFAULT_CREATOR_ANALYTICS_WINDOW,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
} from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * Third column of the creator workspace: how the creator's works are being read. It stays separate
 * from the `Published works` column because the resources and invalidation axes differ. `Published works` changes
 * through the creator's own publishes. Analytics changes through other people's reads, favorites
 * and comments, so freshness decides when it refetches. No realtime mechanism (auto-sync, SSE,
 * polling): the values move through other people, and polling would keep server aggregation running
 * for a screen that does not need it. Favorite and comment mutations do not invalidate this prefix,
 * since they mostly target other people's works. The prefix sits under ["viewer"] because
 * unpublished titles and read counts live here. Logout resets this cell (viewer.ts) rather than
 * invalidating it. The key has no viewer id: this resource has no per-user axis, and including one
 * would leave the previous user's cell under a different key.
 */

export const CREATOR_ANALYTICS_QUERY_KEY_PREFIX = [
	"viewer",
	"creator-analytics",
] as const;

export type CreatorAnalyticsInfiniteData = InfiniteData<
	CreatorAnalyticsPage,
	number
>;

/**
 * Performance of the creator's works, appended through `Show more`. staleTime is longer than the sibling
 * column's 30 seconds. These values change slowly through other people's activity, and a short
 * staleTime would re-run the aggregation query on every tab switch. 4xx responses are not retried.
 * A 401 (expired session) would return the same answer three more times while the screen sits on a
 * placeholder.
 */
/**
 * The window is the query identity. Each window gets its own cell under the prefix, so
 * `invalidateCreatorAnalytics` sweeps all of them and the logout reset of ["viewer"] covers them
 * too. Each window needs its own cell because the results differ. A shared cell would paint the
 * previous window's value for a frame after a window switch.
 */
export const creatorAnalyticsQueryKey = (window: CreatorAnalyticsWindow) =>
	[...CREATOR_ANALYTICS_QUERY_KEY_PREFIX, window] as const;

export function creatorAnalyticsInfiniteQueryOptions(
	client: RowCatClient,
	window: CreatorAnalyticsWindow = DEFAULT_CREATOR_ANALYTICS_WINDOW,
) {
	return infiniteQueryOptions<
		CreatorAnalyticsPage,
		Error,
		CreatorAnalyticsInfiniteData,
		readonly unknown[],
		number
	>({
		queryKey: creatorAnalyticsQueryKey(window),
		queryFn: ({ pageParam, signal }) =>
			client.me.creatorAnalytics({ page: pageParam, window }, { signal }),
		initialPageParam: 1,
		/**
		 * `undefined` marks the end. The total is not divided by page size; the server's pageCount is
		 * trusted directly, because a mismatch would request a page that does not exist.
		 */
		getNextPageParam: (last) =>
			last.page < last.pageCount ? last.page + 1 : undefined,
		staleTime: 60_000,
		retry: retryUnlessClientError,
	});
}

export const creatorAnalyticsWorks = (
	data: CreatorAnalyticsInfiniteData,
): CreatorAnalyticsWork[] => data.pages.flatMap((page) => page.items);

/**
 * The total is the value the server counted across the owner's whole set, so the function does not
 * sum the loaded rows. A sum would grow on every `Show more` press and read as views rising. The server
 * sends the same summary on every page, so the first page holds the full value.
 */
export const creatorAnalyticsSummary = (
	data: CreatorAnalyticsInfiniteData,
): CreatorAnalyticsSummary | null => data.pages[0]?.summary ?? null;

/** Total works as counted by the server, not the number of rows loaded so far. */
export const creatorAnalyticsTotal = (
	data: CreatorAnalyticsInfiniteData,
): number | null => data.pages[0]?.total ?? null;

/**
 * Makes this column refetch after a publish. Rows are never inserted or patched by hand. The
 * publish response is a public projection with no metric fields. Inventing zeros for a new work
 * would erase the view counts a republished work already has. Where the row sorts by performance is
 * decided by the server. Invalidation covers this one prefix. Invalidating ["viewer"] as a whole
 * would refetch viewer, personalization, notifications, account and billing on every publish.
 */
export function invalidateCreatorAnalytics(queryClient: QueryClient): void {
	void queryClient.invalidateQueries({
		queryKey: CREATOR_ANALYTICS_QUERY_KEY_PREFIX,
	});
}
