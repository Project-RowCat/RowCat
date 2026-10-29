import {
	STORY_SEARCH_MAX_LENGTH,
	STORY_TAG_MAX_LENGTH,
} from "@rowcat/contracts";
import {
	DEFAULT_GALLERY_FILTERS,
	effectiveGallerySort,
	type GalleryFilters,
	normalizeGalleryTag,
	ORIENTATIONS,
	type Orientation,
	STORY_PERIODS,
	STORY_RATINGS,
	STORY_SORTS,
	type StoryPeriod,
	type StoryRating,
	type StorySort,
} from "@rowcat/domain";
import { z } from "zod";

/**
 * Gallery navigation state lives in the URL. In a global store, refresh, back, and link sharing
 * would each need separate work; the address bar already provides all three, so this file defines
 * only the translation between the URL and the product filters (`GalleryFilters` in
 * @rowcat/domain).
 *
 * zod is used only at the router boundary. The domain does not judge whether values arriving from
 * outside are trustworthy.
 */

/**
 * URL keys: short, readable names chosen over internal ones such as `favoritesOnly`.
 *
 * Pages are not serialized. Discover is infinite scroll, so 'how many pages were seen' is query
 * state, not a shareable address. Keeping `?page=7` would show whoever opens the link a list
 * missing the first six pages.
 */
export interface GallerySearch {
	q?: string;
	orientation?: Orientation;
	rating?: StoryRating;
	sort?: StorySort;
	period?: StoryPeriod;
	/**
	 * Tag filter: `?tag=school-life`. It is the only axis with no control in the toolbar. It is set from the
	 * tag on a work's detail page, and removed by the token in the toolbar (appliedGalleryFilters).
	 *
	 * It lives in the address for the same reason as search: a result narrowed by tag should be
	 * shareable, and it should still be there when a work is opened and the user returns.
	 */
	tag?: string;
	/**
	 * Works by followed creators only: `?following=true`.
	 *
	 * Unlike the other axes, this holds only for logged-in users (the server returns 401 to guests).
	 * It is still in the URL for the same reason as the rest: refresh, back, and link sharing come for
	 * free; otherwise this axis alone would need its own state store.
	 *
	 * Keeping guests from landing on a 401 when they open this address is the job of the folding side
	 * (filtersForViewer). If the parser dropped the value, a member's link opened before login and
	 * reopened after login would have lost its filter.
	 *
	 * Favorites (`favoritesOnly`) are not in the URL yet, because no screen toggles them. When one
	 * does, the same rule applies.
	 */
	following?: boolean;
}

/**
 * The router parser turns `?q=123` into a number and `?q=true` into a boolean (qss value
 * inference). Search text is always a string, so it is converted back here. `z.coerce` is not used
 * because it would also turn objects and arrays into strings, silently letting typos through.
 */
const urlText = z
	.union([z.string(), z.number(), z.boolean()])
	.transform(String)
	.optional()
	.catch(undefined);

/**
 * Each axis falls back to its own default on failure instead of taking the whole thing down
 * (`.catch`). If one hand-edited character in the URL turned the gallery into an error screen, the
 * user would have no way to know what went wrong.
 */
const RawGallerySearch = z
	.object({
		q: urlText,
		tag: urlText,
		orientation: z.enum(ORIENTATIONS).optional().catch(undefined),
		rating: z.enum(STORY_RATINGS).optional().catch(undefined),
		sort: z.enum(STORY_SORTS).optional().catch(undefined),
		period: z.enum(STORY_PERIODS).optional().catch(undefined),
		/**
		 * Only the enabling values count as true.
		 *
		 * The router serializes as `?following=true` and the parser returns a boolean, but a hand-typed
		 * `?following=1` is also accepted (it arrives as a number). `0`, `false`, and `abc` are all off.
		 * Folding any string to true would leave someone who hand-edited the address unable to tell why
		 * the list is empty.
		 */
		following: z
			.union([z.literal("1"), z.literal(1), z.literal(true)])
			// Several spellings mean on, so they are folded to one value here; the mapping below does not
			// re-check the shape.
			.transform(() => true as const)
			.optional()
			.catch(undefined),
	})
	.catch({});

/**
 * Maps URL search state to product filters. Axes missing from the URL take the product defaults, so
 * no second defaults table exists.
 */
export function filtersFromSearch(search: GallerySearch): GalleryFilters {
	/**
	 * Over-long search text or tags are dropped, not truncated. The server contract rejects that
	 * length. Truncating would make a different search from what the user typed, and passing it
	 * through would turn the gallery into an error screen. The rule of this file: one bad value in a
	 * hand-edited address must not take down the screen.
	 */
	const query =
		search.q !== undefined && search.q.length <= STORY_SEARCH_MAX_LENGTH
			? search.q
			: DEFAULT_GALLERY_FILTERS.query;
	const tag =
		search.tag !== undefined && search.tag.length <= STORY_TAG_MAX_LENGTH
			? normalizeGalleryTag(search.tag)
			: DEFAULT_GALLERY_FILTERS.tag;
	/**
	 * A relevance sort with no search text is newest. The folding rule belongs to the domain
	 * (effectiveGallerySort).
	 */
	const sort = effectiveGallerySort({
		sort: search.sort ?? DEFAULT_GALLERY_FILTERS.sort,
		query,
	});
	return {
		...DEFAULT_GALLERY_FILTERS,
		orientation: search.orientation ?? DEFAULT_GALLERY_FILTERS.orientation,
		rating: search.rating ?? DEFAULT_GALLERY_FILTERS.rating,
		sort,
		// The period changes results only under popularity sort. Folding here means the toolbar and the
		// URL see the same thing.
		period:
			sort !== "popular"
				? "all"
				: (search.period ?? DEFAULT_GALLERY_FILTERS.period),
		query,
		tag,
		/**
		 * Following is in the URL but favorites are not; the asymmetry is intentional. Only axes actually
		 * present in the toolbar go in the address. When a favorites-only list screen exists, one line
		 * following the same rule is added here.
		 */
		followingOnly: search.following ?? DEFAULT_GALLERY_FILTERS.followingOnly,
	};
}

/**
 * Guest folding of the following axis is owned by the domain (filtersForViewer). It is not
 * web-only: mobile opens the same address and asks the same server. A copy here would let one side
 * get fixed alone, and that symptom would appear only for links a guest opens. The URL resolution
 * below is tied to this app's router, so it stays here.
 */

/**
 * Product filters to URL search state. Axes at their default stay `undefined`: the router's
 * serialization skips `undefined`, so URLs like `/?orientation=null&rating=any&...` are never
 * generated.
 */
export function searchFromFilters(filters: GalleryFilters): GallerySearch {
	const sort = effectiveGallerySort(filters);
	return {
		q: filters.query.trim() || undefined,
		tag: normalizeGalleryTag(filters.tag) ?? undefined,
		orientation: filters.orientation ?? undefined,
		rating: filters.rating === "any" ? undefined : filters.rating,
		sort: sort === "recent" ? undefined : sort,
		period:
			sort !== "popular" || filters.period === "all"
				? undefined
				: filters.period,
		// The default (off) is not kept in the address, so no `?following=0` link is created.
		following: filters.followingOnly ? true : undefined,
	};
}

/**
 * Validation at the router boundary. The parsed value is not returned as read; it passes through
 * the filters once for normalization. That way URLs with overlapping meaning, such as
 * `?sort=recent&period=week`, produce one value for both the screen and the cache.
 */
export const validateGallerySearch = (
	input: Record<string, unknown>,
): GallerySearch =>
	searchFromFilters(filtersFromSearch(RawGallerySearch.parse(input)));
