import { DEFAULT_PAGE_SIZE, StoryDto } from "@rowcat/contracts";
import {
	effectiveGallerySort,
	type Story,
	type StoryPeriod,
	type StorySort,
} from "@rowcat/domain";
import { z } from "zod";
import { cacheAside, cacheKey } from "../../lib/cache/index.ts";
import { type ListStoriesOptions, listStories } from "./index.ts";

/**
 * Guest gallery cache, the first server-cache consumer in this repository.
 *
 * One page of `/v2/stories` costs Postgres a list query, a `count(*)` on the same predicate,
 * story/member/cover joins, and for period popularity the window aggregation over the play,
 * favorite and view ledgers plus sorting. Anonymous visitors repeat that request identically.
 *
 * `listStories()` itself is not cached because it also serves the public profile grid
 * (`routes/creators.ts`) with different exposure rules (`ownPrivateVisible: false`). Caching inside
 * it would implicitly cache every caller and make it judge whether the result varies by viewer,
 * which must stay right with every new argument; the failure is someone else's list drawn on my
 * screen. SQL functions like `selectPage()` and `countStories()` are no place either: that layer
 * has no request identity.
 *
 * Eligibility: anonymous, no personalization on any axis, and only the first few pages.
 *
 * ```text
 * viewerId === null          no viewer identity
 * blocked.length === 0       a block list does not change the result (always true for guests)
 * favoritedBy === null       not a personal feed
 * followingOf === null       〃
 * creatorId === null         no creator filter (not the public profile grid)
 * adultAllowed === false     adult gate is closed
 * ownAdultAllowed === false  no own-story exception
 * search === ""              arbitrary queries never become keys
 * tag === null               arbitrary tags neither, same reason
 * page <= 3                  bounds key count
 * pageSize === 24            〃 (the default only)
 * ```
 *
 * `ownPrivateVisible` is not listed: `galleryWhere` makes it a predicate only together with
 * `viewerId` (`sel.viewerId && sel.ownPrivateVisible`), and `viewerId` is `null` here, so it cannot
 * change the result (the route passes `true`).
 *
 * The list errs toward closed: if any eligibility fails the request skips the cache entirely. The
 * slice's only security property is that no authenticated request can read a guest's cell, and it
 * is not obtained by putting the member id in the key, which makes a cell per member and leaks as
 * soon as one axis is forgotten.
 *
 * Key count is bounded: orientation 4 × rating 3 × sort 2 × period 4 × page 3 = 288 at most.
 * Narrowing page size to the default does the most work in that product, since the contract allows
 * 1..100 and leaving it open would let a client push 100 copies of one list by varying `pageSize`.
 * This deployment's Redis also holds rate-limit counters and does not rely on an eviction policy,
 * so the bound comes from key design.
 */

/**
 * Cache lifetime. The client already treats the same value as fresh (`staleTime` in
 * `packages/query/src/gallery.ts`); longer would leave the server holding staler data than the
 * client.
 *
 * Short is the whole invalidation strategy: publish, hide, block and account deletion never evict
 * this key, it expires after 30 seconds on its own.
 */
export const GUEST_GALLERY_CACHE_TTL_MS = 30_000;

/**
 * Last cached page. Discovery scrolling concentrates on the first pages, and opening the tail would
 * multiply keys by page count for a low hit rate.
 */
export const GUEST_GALLERY_MAX_CACHED_PAGE = 3;

/** The only cached page size; rationale is the key-count bound in the header. */
export const GUEST_GALLERY_CACHED_PAGE_SIZE = DEFAULT_PAGE_SIZE;

const CACHE_NAMESPACE = "gallery";

/**
 * The axes that set cache identity; nothing that can change the result may be missing.
 *
 * A missing axis shows up as "different query, same cell", where changing a filter returns the
 * previous result (`packages/query/src/gallery.ts` keeps the same rule client-side). There is no
 * slot for viewer axes: with no cell to hold them they cannot be carried.
 */
export interface GuestGalleryDimensions {
	/** `null` when unspecified. */
	readonly orientation: string | null;
	/** `true` = adult only, `false` = all-ages only, `null` = any rating. */
	readonly adult: boolean | null;
	readonly sort: StorySort;
	readonly period: StoryPeriod;
	readonly page: number;
	readonly pageSize: number;
}

/**
 * Axes to key.
 *
 * Folding `period` under recent sort is the only normalization. It does not affect the server
 * result (`selectPage` builds a cutoff only for `sort === "popular"`), so without folding
 * `sort=recent&period=week` and `sort=recent` would split the same response over four cells. The
 * client already folds the same way (`canonicalGalleryFilters`).
 */
export function guestGalleryCacheKey(d: GuestGalleryDimensions): string {
	return cacheKey(CACHE_NAMESPACE, [
		"guest",
		d.orientation,
		d.adult,
		d.sort,
		d.sort === "recent" ? "all" : d.period,
		d.page,
		d.pageSize,
	]);
}

/**
 * Whether this request may be cached: the dimensions if so, else `null`.
 *
 * It returns the dimensions rather than a boolean so callers cannot compute the two separately;
 * split, "eligible but missing an axis" becomes representable, and that is exactly a leak.
 */
export function guestGalleryCacheDimensions(
	opts: ListStoriesOptions,
): GuestGalleryDimensions | null {
	const eligible =
		opts.viewerId === null &&
		opts.blocked.length === 0 &&
		opts.favoritedBy === null &&
		opts.followingOf === null &&
		opts.creatorId === null &&
		/**
		 * Queries that include unlisted stories are not cached. The gallery route currently always passes
		 * false, so this line is effectively true, but it does not lean on that: the question is whether
		 * several guests may share this response, and an axis not written here silently drops out of the
		 * cache key when one is added (different queries then read the same entry).
		 */
		opts.unlistedVisible === false &&
		opts.adultAllowed === false &&
		opts.ownAdultAllowed === false &&
		opts.search.trim() === "" &&
		opts.tag === null &&
		opts.page >= 1 &&
		opts.page <= GUEST_GALLERY_MAX_CACHED_PAGE &&
		opts.pageSize === GUEST_GALLERY_CACHED_PAGE_SIZE;
	if (!eligible) return null;
	return {
		orientation: opts.orientation,
		adult: opts.adult,
		/**
		 * With an empty query, relevance is always recent here. The server predicate folds the same way
		 * (`selectPage`), so the two are the same response, and unfolded they would sit in two cells.
		 */
		sort: effectiveGallerySort({ sort: opts.sort, query: opts.search }),
		period: opts.period,
		page: opts.page,
		pageSize: opts.pageSize,
	};
}

/**
 * Shape of a cached value; stored values are not trusted.
 *
 * Bytes in Redis were written by us but possibly by an older build (a rolling deploy shares one
 * Redis between two versions for 30 seconds). Casting would let one mis-shaped entry flow to the
 * screen, the same kind of value as the jsonb playback payload that `routes/stories/index.ts`
 * re-parses against the contract.
 *
 * The wire contract (`StoryDto`) is used because it is exactly this value's shape: 1:1 with the
 * domain `Story` (`packages/domain/src/story.ts` header), and timestamps are already ISO strings,
 * so a JSON round trip does not change them (a stored `Date` would come back as a string and
 * quietly differ).
 */
const CachedGalleryPage = z.object({
	items: z.array(StoryDto),
	total: z.number().int().nonnegative(),
});

interface GalleryPage {
	items: Story[];
	total: number;
}

const decodeGalleryPage = (raw: unknown): GalleryPage | null => {
	const parsed = CachedGalleryPage.safeParse(raw);
	return parsed.success ? parsed.data : null;
};

/**
 * One gallery page: through the cache, or straight to Postgres.
 *
 * The route calls only this. An ineligible request is identical to calling `listStories()` directly
 * (no key is built and Redis is not touched).
 *
 * With Redis missing or down the adapter answers a miss, so this still reaches Postgres: the cache
 * is an optimization, not a dependency (`lib/cache/redis-store.ts`).
 */
export function listGalleryStories(
	opts: ListStoriesOptions,
): Promise<GalleryPage> {
	const dimensions = guestGalleryCacheDimensions(opts);
	if (!dimensions) return listStories(opts);
	return cacheAside({
		key: guestGalleryCacheKey(dimensions),
		ttlMs: GUEST_GALLERY_CACHE_TTL_MS,
		decode: decodeGalleryPage,
		load: () => listStories(opts),
	});
}
