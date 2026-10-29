import {
	effectiveGallerySort,
	GALLERY_PAGE_SIZE,
	type GalleryFilters,
	normalizeGalleryTag,
	type Story,
	type StoryPage,
} from "@rowcat/domain";
import type { RowCatClient, StoriesListInput } from "@rowcat/sdk";
import { type InfiniteData, infiniteQueryOptions } from "@tanstack/react-query";

/**
 * Gallery server-state definitions. The route loader (SSR prefetch) and the components call the
 * same functions. If each wrote its own key and fetcher, a one-character mismatch would split the
 * cache, and data the server already sent would be refetched right after hydration, with no visible
 * sign. No screens live in this package. Navigation, URL parsing and toasts belong to the app; only
 * definitions Expo can reuse as-is stay here. The discovery screen appends pages instead of
 * replacing them. So the query is a column of pages (InfiniteData), and the page count is progress
 * through that column, not part of the cache identity.
 */

/**
 * Normalization that decides cache identity. In newest-first order the period does not affect the
 * server result. Without folding it, `sort=recent&period=week` and `sort=recent` would store the
 * same response in two cells. The search term is trimmed for the same reason. Serialization trims
 * it anyway, so without folding it here only the key would split.
 */
export function canonicalGalleryFilters(f: GalleryFilters): GalleryFilters {
	/**
	 * Relevance sort with no search term is newest-first. The folding rule lives in the domain; this
	 * file only calls it. Sort must be folded first, so the period folding below sees the result. A
	 * relevance sort folded to recent has no period meaning either.
	 */
	const sort = effectiveGallerySort(f);
	return {
		...f,
		query: f.query.trim(),
		tag: normalizeGalleryTag(f.tag),
		sort,
		period: sort === "popular" ? f.period : "all",
	};
}

/**
 * The query key. Every axis that changes the server result must be here. A missing one makes
 * different queries share a cell, so changing a filter would keep showing the previous results.
 * Field order does not affect identity: TanStack Query sorts object keys when hashing. The page
 * number is not in the key. Page 2 of an infinite list is the next slice of the same query, not a
 * different one. Putting it in would create a new cell on every scroll and discard the accumulated
 * list.
 */
export const GALLERY_QUERY_KEY_PREFIX = ["stories", "gallery"] as const;

export const galleryQueryKey = (filters: GalleryFilters) =>
	[...GALLERY_QUERY_KEY_PREFIX, canonicalGalleryFilters(filters)] as const;

/**
 * Maps product filters to the wire query. The two shapes differ on purpose: the screen knows
 * `favoritesOnly`, the server knows `favorited`. Putting this mapping in the route would make URL
 * state aware of HTTP parameter names; putting it in the domain would make the product model aware
 * of transport details. Server-state integration belongs to this package. Only the page number
 * comes from outside the filters. It is not a user-chosen condition but the cursor that Query
 * holds.
 */
const toStoriesInput = (f: GalleryFilters, page: number): StoriesListInput => ({
	orientation: f.orientation,
	rating: f.rating,
	sort: f.sort,
	period: f.period,
	q: f.query,
	tag: f.tag,
	favorited: f.favoritesOnly,
	following: f.followingOnly,
	page,
	pageSize: GALLERY_PAGE_SIZE,
});

/** Cache shape of the accumulated gallery. Optimistic favorite updates operate on this type too. */
export type GalleryInfiniteData = InfiniteData<StoryPage, number>;

/**
 * Infinite-scroll query. A cursor API is not required: the server sends page and pageCount on each
 * page, so the last page alone says whether more exist. The screen must not count page numbers. If
 * components counted, every filter change would require resetting that number, and one missed reset
 * would fetch page 3 of the new filter instead of page 1. staleTime is above 0 because of SSR. If
 * the server-provided data is judged stale, the same request repeats right after hydration. For an
 * appended query that refetch re-requests every accumulated page, so the cost exceeds pagination's.
 * Discovery data does not flip every second, so 30 seconds is enough.
 */
export function galleryInfiniteQueryOptions(
	client: RowCatClient,
	filters: GalleryFilters,
) {
	const canonical = canonicalGalleryFilters(filters);
	return infiniteQueryOptions<
		StoryPage,
		Error,
		GalleryInfiniteData,
		readonly unknown[],
		number
	>({
		queryKey: galleryQueryKey(canonical),
		// The signal is passed through, so a query abandoned by leaving the screen also stops at the
		// network level.
		queryFn: ({ pageParam, signal }) =>
			client.stories.list(toStoriesInput(canonical, pageParam), { signal }),
		initialPageParam: 1,
		/**
		 * `undefined` means no more pages (`hasNextPage` becomes false). The server's pageCount is
		 * trusted rather than deriving pages from total divided by page size. If that quotient disagreed
		 * with the server (for example, items filtered out on the last page), a nonexistent page would be
		 * requested.
		 */
		getNextPageParam: (last) =>
			last.page < last.pageCount ? last.page + 1 : undefined,
		staleTime: 30_000,
	});
}

/**
 * Flattening is not repeated on each screen. It is knowledge tied to the query's shape, so if
 * `pages` ever splits, there should be a single place to change.
 */
export const galleryStories = (data: GalleryInfiniteData): Story[] =>
	data.pages.flatMap((page) => page.items);

/**
 * Server-counted total. Every page carries the same value, but the last page is read because it was
 * fetched most recently.
 */
export const galleryTotal = (data: GalleryInfiniteData): number =>
	data.pages[data.pages.length - 1]?.total ?? 0;
