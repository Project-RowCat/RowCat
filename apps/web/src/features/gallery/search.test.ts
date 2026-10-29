import { DEFAULT_GALLERY_FILTERS, filtersForViewer } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	filtersFromSearch,
	searchFromFilters,
	validateGallerySearch,
} from "./search.ts";

/**
 * Navigation state for the gallery: the translation between the address and the filters.
 *
 * The following axis added a rule to this translation. It holds only for members (the server
 * returns 401 to guests), but the address can be opened by guests too. A guest opening a link a
 * member shared must not get a full error screen; yet deleting the value from the address would
 * lose the filter when the guest logs in and comes back. filtersForViewer draws the line between
 * those two, and this file locks that boundary.
 */

describe("following axis round trip", () => {
	it("the address value reaches the filter", () => {
		expect(filtersFromSearch({ following: true }).followingOnly).toBe(true);
	});

	it("stays in the address only when on", () => {
		expect(
			searchFromFilters({ ...DEFAULT_GALLERY_FILTERS, followingOnly: true })
				.following,
		).toBe(true);
		expect(
			searchFromFilters(DEFAULT_GALLERY_FILTERS).following,
		).toBeUndefined();
	});

	it.each([
		["string 1", "1"],
		["number 1", 1],
		["boolean", true],
	])("accepts the on form %s", (_label, raw) => {
		expect(validateGallerySearch({ following: raw }).following).toBe(true);
	});

	it.each([
		["0", 0],
		["false", false],
		["empty string", ""],
		["any string", "yes"],
	])("ignores the non-on value %s", (_label, raw) => {
		expect(validateGallerySearch({ following: raw }).following).toBeUndefined();
	});
});

/**
 * filtersForViewer itself now belongs to the domain (mobile uses the same rule). The checks here
 * cover how that rule meshes with this app's address parsing: that folding affects only the query
 * and leaves the address alone can only be confirmed on the web, so it is verified here.
 */
describe("filtersForViewer and the address", () => {
	const followingFilters = {
		...DEFAULT_GALLERY_FILTERS,
		followingOnly: true,
	};

	it("folds the following axis for guests", () => {
		// Without folding, a guest who opens that link sees an error screen (the server returns 401), not
		// the 'you could see this if you logged in' state.
		expect(filtersForViewer(followingFilters, false).followingOnly).toBe(false);
	});

	it("leaves it for members", () => {
		expect(filtersForViewer(followingFilters, true)).toBe(followingFilters);
	});

	it("filters that are off are the same reference for guests", () => {
		// Returns the same object when nothing changes. A new object would change the query identity on
		// every render and discard the pages accumulated by appending.
		expect(filtersForViewer(DEFAULT_GALLERY_FILTERS, false)).toBe(
			DEFAULT_GALLERY_FILTERS,
		);
	});

	it("folding affects the query only, not the address", () => {
		/**
		 * This function must not rewrite the address, or the filter would be gone when the user returns
		 * from logging in. What this checks is that separation: under the same search state, only the
		 * filters fold.
		 */
		const search = { following: true } as const;
		expect(
			filtersForViewer(filtersFromSearch(search), false).followingOnly,
		).toBe(false);
		expect(search.following).toBe(true);
	});
});

/**
 * Relevance sort in the address: which sort and query combinations get serialized, and which should
 * not.
 */
describe("relevance in the address", () => {
	it("relevance stays in the address with a query", () => {
		expect(
			searchFromFilters({
				...DEFAULT_GALLERY_FILTERS,
				query: "cat",
				sort: "relevance",
			}),
		).toEqual({ q: "cat", sort: "relevance" });
	});

	it("relevance without a query is newest in both address and filter", () => {
		expect(
			searchFromFilters({ ...DEFAULT_GALLERY_FILTERS, sort: "relevance" }).sort,
		).toBeUndefined();
		expect(filtersFromSearch({ sort: "relevance" }).sort).toBe("recent");
		expect(validateGallerySearch({ sort: "relevance" })).toEqual({});
	});

	it("relevance carries no period", () => {
		expect(
			filtersFromSearch({ q: "cat", sort: "relevance", period: "week" }).period,
		).toBe("all");
	});
});

describe("tag in the address", () => {
	it("loses no value in a round trip", () => {
		const filters = { ...DEFAULT_GALLERY_FILTERS, tag: "school-life" };
		expect(searchFromFilters(filters)).toEqual({ tag: "school-life" });
		expect(filtersFromSearch({ tag: "school-life" })).toEqual(filters);
	});

	it("a numeric tag is still a string (router value inference)", () => {
		expect(validateGallerySearch({ tag: 2024 })).toEqual({ tag: "2024" });
	});

	it("a whitespace-only tag is absent", () => {
		expect(validateGallerySearch({ tag: "  " })).toEqual({});
	});

	it("tags and queries over the limit are dropped — truncating would search for something the user did not type", () => {
		expect(validateGallerySearch({ tag: "a".repeat(41) })).toEqual({});
		expect(validateGallerySearch({ q: "a".repeat(101) })).toEqual({});
		expect(validateGallerySearch({ q: "a".repeat(100) })).toEqual({
			q: "a".repeat(100),
			// A query is present, so sort stays at its default. Switching to relevance is the search input's
			// job, not the address's.
		});
	});
});
