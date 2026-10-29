import {
	DEFAULT_GALLERY_FILTERS,
	filtersForViewer,
	type GalleryFilters,
} from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	discoverReturnPath,
	filtersFromParams,
	paramsFromFilters,
} from "./search.ts";

/**
 * Navigation state of the discover screen: **the translation between the route and the filters.**
 *
 * Three things are locked here:
 *
 * ```text
 * round trips keep their values          conditions survive search → story → back
 * a bad value breaks only one axis       the screen does not crash on a hand-edited deep link
 * defaults clear their parameters        `setParams` merges, so without this the change cannot be reverted
 * ```
 */

const withFilters = (patch: Partial<GalleryFilters>): GalleryFilters => ({
	...DEFAULT_GALLERY_FILTERS,
	...patch,
});

describe("defaults", () => {
	it("empty parameters are the product defaults", () => {
		expect(filtersFromParams({})).toEqual(DEFAULT_GALLERY_FILTERS);
	});

	it("no default remains in the parameters", () => {
		// Keeping them would produce an address such as `/?orientation=null&rating=any&…`.
		expect(paramsFromFilters(DEFAULT_GALLERY_FILTERS)).toEqual({
			q: undefined,
			tag: undefined,
			orientation: undefined,
			rating: undefined,
			sort: undefined,
			period: undefined,
			following: undefined,
		});
	});

	it("default axes still **have** their keys — the value is just undefined", () => {
		/**
		 * `router.setParams` merges, so a missing key is not cleared and its **previous value stays.**
		 * That is exactly where someone who picked an orientation and then reverted to "all" could not go
		 * back.
		 */
		const params = paramsFromFilters(DEFAULT_GALLERY_FILTERS);
		expect(Object.keys(params).sort()).toEqual([
			"following",
			"orientation",
			"period",
			"q",
			"rating",
			"sort",
			"tag",
		]);
	});
});

describe("Round trip", () => {
	it.each([
		["query", withFilters({ query: "Cat" })],
		["Orientation", withFilters({ orientation: "female" })],
		["Rating", withFilters({ rating: "sfw" })],
		["popular + period", withFilters({ sort: "popular", period: "week" })],
		["Following", withFilters({ followingOnly: true })],
		["Tags", withFilters({ tag: "school drama" })],
		["query + relevance", withFilters({ query: "Cat", sort: "relevance" })],
		[
			"all",
			withFilters({
				query: "Cat",
				orientation: "male",
				rating: "adult",
				sort: "popular",
				period: "month",
				followingOnly: true,
			}),
		],
	])("%s survives", (_label, filters) => {
		const params = paramsFromFilters(filters);
		/** The router does not carry keys whose value is `undefined`, so the incoming side never sees them. */
		const arrived = Object.fromEntries(
			Object.entries(params).filter(([, value]) => value !== undefined),
		);
		expect(filtersFromParams(arrived)).toEqual(filters);
	});

	it("the page number appears nowhere", () => {
		/**
		 * In infinite scroll, "how far has been viewed" is query progress, not a shareable address.
		 * Keeping it would make anyone opening that link see a list missing its front part.
		 */
		const params = paramsFromFilters(
			withFilters({ sort: "popular", period: "week" }),
		);
		expect(Object.keys(params)).not.toContain("page");
		expect(JSON.stringify(params)).not.toMatch(/page/i);
	});

	it("the favorites axis isn't in the parameter vocabulary", () => {
		// The domain model has this axis, but the toolbar does not draw it.
		const params = paramsFromFilters(withFilters({ favoritesOnly: true }));
		expect(JSON.stringify(params)).not.toMatch(/favorit/i);
		// The incoming side does not read it either.
		expect(filtersFromParams({ favorited: "1" }).favoritesOnly).toBe(false);
	});
});

describe("normalization", () => {
	it("under recent sort the period folds to all", () => {
		// Without folding, `sort=recent&period=week` and `sort=recent` would put the same response into
		// two cells.
		expect(filtersFromParams({ sort: "recent", period: "week" }).period).toBe(
			"all",
		);
		expect(
			paramsFromFilters(withFilters({ sort: "recent", period: "week" })).period,
		).toBeUndefined();
	});

	it("under popular sort the period stays", () => {
		expect(filtersFromParams({ sort: "popular", period: "week" }).period).toBe(
			"week",
		);
	});

	it("the query is trimmed only on the way out", () => {
		/**
		 * Trimming on the way in would make the value being typed shift each time it returns from the
		 * route. The normalization that sets the query key is already done by `canonicalGalleryFilters`
		 * in `@rowcat/query`.
		 */
		expect(filtersFromParams({ q: "  cat  " }).query).toBe("  cat  ");
		expect(paramsFromFilters(withFilters({ query: "  cat  " })).q).toBe("cat");
		expect(paramsFromFilters(withFilters({ query: "   " })).q).toBeUndefined();
	});

	it("doesn't lowercase the query", () => {
		// How case is treated is decided by the server's search predicate.
		expect(filtersFromParams({ q: "CatTower" }).query).toBe("CatTower");
		expect(paramsFromFilters(withFilters({ query: "CatTower" })).q).toBe(
			"CatTower",
		);
	});
});

describe("a strange value breaks only one axis", () => {
	it("an unknown flavor resets only that axis to default", () => {
		const filters = filtersFromParams({
			orientation: "banana",
			rating: "sfw",
			q: "Cat",
		});
		expect(filters.orientation).toBeNull();
		// The other axes stay as they are. One bad character must not reset the whole screen.
		expect(filters.rating).toBe("sfw");
		expect(filters.query).toBe("Cat");
	});

	it("unknown ratings, sorts and periods each drop alone too", () => {
		const filters = filtersFromParams({
			rating: "r19",
			sort: "trending",
			period: "century",
			orientation: "male",
		});
		expect(filters.rating).toBe("any");
		expect(filters.sort).toBe("recent");
		expect(filters.period).toBe("all");
		expect(filters.orientation).toBe("male");
	});

	it("when the same key comes twice it uses the first value", () => {
		expect(filtersFromParams({ rating: ["sfw", "adult"] }).rating).toBe("sfw");
		expect(filtersFromParams({ q: ["Cat", "dog"] }).query).toBe("Cat");
	});
});

describe("following axis", () => {
	it.each([
		["the form we emit", "1"],
		["a hand-written true", "true"],
	])("accepts the on value %s", (_label, raw) => {
		expect(filtersFromParams({ following: raw }).followingOnly).toBe(true);
	});

	it.each(["0", "false", "", "yes"])("the non-on value %s is off", (raw) => {
		// Folding any string to true would leave someone who edited the address unable to tell why the
		// list is empty.
		expect(filtersFromParams({ following: raw }).followingOnly).toBe(false);
	});

	/**
	 * **§98 — The route stays the same even when identity changes.**
	 *
	 * Only the query is folded, so the same address is the public feed for a guest and the following
	 * feed for a member. Clearing the parameter would make the filters of someone returning after
	 * sign-in disappear.
	 */
	it("for guests only the lookup folds and the route stays", () => {
		const params = { following: "1" } as const;
		const requested = filtersFromParams(params);

		expect(filtersForViewer(requested, false).followingOnly).toBe(false);
		expect(filtersForViewer(requested, true).followingOnly).toBe(true);
		// The route parameter stays as it is.
		expect(params.following).toBe("1");
		expect(paramsFromFilters(requested).following).toBe("1");
	});

	it("when identity can't be checked it folds to non-member", () => {
		/**
		 * A personal feed requested with an unconfirmed session falls to a 401, and the user sees an
		 * error with no visible cause. The screen passes only `phase === "authenticated"` as true, which
		 * is that judgment. Here the result when that argument is false is locked.
		 */
		expect(
			filtersForViewer(withFilters({ followingOnly: true }), false)
				.followingOnly,
		).toBe(false);
	});
});

describe("where to return", () => {
	it("carries the active axes as is", () => {
		expect(
			discoverReturnPath(withFilters({ query: "cat", sort: "popular" })),
		).toBe(`/?q=${encodeURIComponent("cat")}&sort=popular`);
	});

	it("the default state is the first screen", () => {
		expect(discoverReturnPath(DEFAULT_GALLERY_FILTERS)).toBe("/");
	});

	it("encodes the query", () => {
		/**
		 * Concatenated as is, a search containing `&` becomes a **different path**, and a value
		 * containing a space is rejected by `safeMobileReturnPath` and folded to the first screen.
		 */
		const path = discoverReturnPath(withFilters({ query: "a&b c" }));
		expect(path).toBe("/?q=a%26b%20c");
		expect(path).not.toContain(" ");
	});
});

describe("relevance and tags", () => {
	it("relevance without a query is recent in both parameters and filters", () => {
		expect(filtersFromParams({ sort: "relevance" })).toEqual(
			DEFAULT_GALLERY_FILTERS,
		);
		expect(
			paramsFromFilters(withFilters({ sort: "relevance" })).sort,
		).toBeUndefined();
	});

	it("no period attaches to relevance", () => {
		expect(
			filtersFromParams({ q: "Cat", sort: "relevance", period: "week" }).period,
		).toBe("all");
		expect(
			paramsFromFilters(
				withFilters({ query: "Cat", sort: "relevance", period: "week" }),
			).period,
		).toBeUndefined();
	});

	it("tags fold only whitespace, and empty removes the key", () => {
		expect(filtersFromParams({ tag: " school drama " }).tag).toBe(
			"school drama",
		);
		expect(filtersFromParams({ tag: "  " }).tag).toBeNull();
		expect(paramsFromFilters(withFilters({ tag: "school drama" })).tag).toBe(
			"school drama",
		);
	});

	it("tags and queries over the limit are dropped — no lookup with values the server refuses", () => {
		expect(filtersFromParams({ tag: "a".repeat(41) }).tag).toBeNull();
		expect(filtersFromParams({ q: "a".repeat(101) }).query).toBe("");
	});

	it("the tag rides on the return path", () => {
		expect(discoverReturnPath(withFilters({ tag: "school  drama" }))).toBe(
			"/?tag=school%20%20drama",
		);
	});
});
