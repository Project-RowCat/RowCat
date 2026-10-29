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

/**
 * The discover screen's query axes are owned by the **route.**
 *
 * Putting them in a global store (Context, Zustand) or AsyncStorage would make "search → open a
 * story → back" a feature that each piece must handle. The navigation stack already holds
 * parameters per screen, so the search text and filters survive the return **for free**. What this
 * file defines is only the translation between those parameters and the product filters
 * (`GalleryFilters` in `@rowcat/domain`).
 *
 * It sits where the web's `features/gallery/search.ts` does and follows the same rules. The point
 * is that it is an **adapter for a different router**, not a copy. Everything that must not diverge
 * (which values are valid, whether following is folded for guests) lives in domain. What remains
 * here is only the shape in which this router passes parameters back and forth. That is also why
 * zod is not used: the one thing to verify is "does this string belong to the domain vocabulary",
 * and an array answers that.
 *
 * **Page number is not a parameter.** In infinite scroll, "how far has been viewed" is query
 * progress, not a shareable address. Keeping it would make anyone opening the link see a list
 * missing its front part.
 *
 * **No favorites axis (`favoritesOnly`) either.** It exists in the domain model, but the discover
 * toolbar does not draw it. Being expressible in the model is not a reason to grow the screen. Once
 * a value exists in the parameter vocabulary, the screen starts drawing it.
 */

/**
 * Route parameter keys. Chosen to be short and readable, rather than internal names such as
 * `favoritesOnly`.
 *
 * They use the **same words** as the web's URL keys. There is no reason for two apps to name the
 * same axis differently, and a web link opened in the app (deep link) would not need
 * re-translating.
 */
export const DISCOVER_PARAM_KEYS = [
	"q",
	"tag",
	"orientation",
	"rating",
	"sort",
	"period",
	"following",
] as const;

export type DiscoverParamKey = (typeof DISCOVER_PARAM_KEYS)[number];

/**
 * Outgoing values. `undefined` means **clear that key.**
 *
 * Default axes must not simply be omitted. `router.setParams` merges, so a missing key is not
 * cleared and its **previous value stays**. That is exactly where someone who picked an orientation
 * and then reverted to "all" could not go back. So this type carries **all** six keys.
 */
export type DiscoverParams = Record<DiscoverParamKey, string | undefined>;

/**
 * Incoming values, in the shape `useLocalSearchParams()` provides.
 *
 * A key repeated in the URL arrives as an array (`?rating=sfw&rating=adult`). This happens only in
 * hand-edited deep links, but the screen must not crash, so the first value is used.
 */
export type RouteParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
	Array.isArray(value) ? value[0] : value;

/**
 * `undefined` if the value is not in the vocabulary. **Only that axis** falls back to its default.
 *
 * The rule is not to throw everything away because one axis looks wrong (the same judgment as the
 * web's `.catch(undefined)`). If one hand-edited character turned the workspace into an error
 * screen, the person would read it as their list having disappeared.
 */
const oneOf = <T extends string>(
	vocabulary: readonly T[],
	value: string | string[] | undefined,
): T | undefined => {
	const raw = first(value);
	return vocabulary.includes(raw as T) ? (raw as T) : undefined;
};

/**
 * Only an **enabling** value reads as true.
 *
 * We emit just `following=1`, but a hand-written `true` is accepted too. `0`, `false` and any other
 * string all mean off. If anything were folded to true, someone who edited the address could not
 * tell why the list is empty.
 */
const isOn = (value: string | string[] | undefined): boolean => {
	const raw = first(value);
	return raw === "1" || raw === "true";
};

/**
 * Route parameters → product filters. Missing axes take the product default (no second default
 * table).
 *
 * The search text is **not trimmed.** The text the user is typing sits in the route as is. The
 * normalization that sets the query key (trimming the ends) is already done by
 * `canonicalGalleryFilters` in `@rowcat/query`. Trimming here too would let two places decide what
 * the canonical form is. **It is not lowercased either.** How the server treats case is the
 * server's business.
 */
export function filtersFromParams(params: RouteParams): GalleryFilters {
	/**
	 * Over-long search text and tags are **dropped, not truncated.** The server contract rejects those
	 * lengths. Truncating would send a different search from what the user typed, and sending them as
	 * is would turn the discover screen into an error. (The web's `filtersFromSearch` makes the same
	 * judgment.)
	 */
	const rawQuery = first(params.q);
	const query =
		rawQuery !== undefined && rawQuery.length <= STORY_SEARCH_MAX_LENGTH
			? rawQuery
			: DEFAULT_GALLERY_FILTERS.query;
	const rawTag = first(params.tag);
	const tag =
		rawTag !== undefined && rawTag.length <= STORY_TAG_MAX_LENGTH
			? normalizeGalleryTag(rawTag)
			: DEFAULT_GALLERY_FILTERS.tag;
	/** Relevance without a query is newest. The folding rule lives in domain. */
	const sort = effectiveGallerySort({
		sort: oneOf<StorySort>(STORY_SORTS, params.sort) ?? "recent",
		query,
	});
	return {
		...DEFAULT_GALLERY_FILTERS,
		orientation:
			oneOf<Orientation>(ORIENTATIONS, params.orientation) ??
			DEFAULT_GALLERY_FILTERS.orientation,
		rating:
			oneOf<StoryRating>(STORY_RATINGS, params.rating) ??
			DEFAULT_GALLERY_FILTERS.rating,
		sort,
		/**
		 * Only in popularity sort does the period change server results. Folding here means the toolbar,
		 * the parameters and the query key all see the same value (`canonicalGalleryFilters` applies the
		 * same folding).
		 */
		period:
			sort !== "popular"
				? "all"
				: (oneOf<StoryPeriod>(STORY_PERIODS, params.period) ??
					DEFAULT_GALLERY_FILTERS.period),
		query,
		tag,
		followingOnly: isOn(params.following),
	};
}

/**
 * Product filters → route parameters. Default axes are set to `undefined` **explicitly** (see the
 * type comment above).
 *
 * The search text is trimmed only here, because this is where it leaves in canonical form. An empty
 * string clears the key, so no `?q=` address is produced.
 */
export function paramsFromFilters(filters: GalleryFilters): DiscoverParams {
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
		// The default (off) is not kept, so no link carrying `following=0` is produced.
		following: filters.followingOnly ? "1" : undefined,
	};
}

/**
 * The **internal path** the discover screen is currently on. This is where a sign-in returns to.
 *
 * It is rebuilt from the filters rather than asking the router for the current URL. `usePathname()`
 * gives only the path, not the parameters, so returning with it would show a discover screen with
 * the search and filters gone.
 *
 * Encoding the values is the rest of this function's job. A search can contain `&`, `#` or spaces,
 * and concatenated as is, the result would be a **different path** (`safeMobileReturnPath` rejects
 * values containing spaces, so the symptom is "after signing in I land on the first screen").
 */
export function discoverReturnPath(filters: GalleryFilters): string {
	const params = paramsFromFilters(filters);
	const query = DISCOVER_PARAM_KEYS.flatMap((key) => {
		const value = params[key];
		return value === undefined ? [] : [`${key}=${encodeURIComponent(value)}`];
	}).join("&");
	return query ? `/?${query}` : "/";
}
