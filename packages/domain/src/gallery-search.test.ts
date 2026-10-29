import { describe, expect, it } from "vitest";
import {
	applyGalleryQuery,
	DEFAULT_GALLERY_FILTERS,
	effectiveGallerySort,
	type GalleryFilters,
	hasActiveFilters,
	normalizeGalleryTag,
	relevanceApplies,
	STORY_SORT_LABEL,
	STORY_SORTS,
} from "./story.ts";

/**
 * Relevance sort and the tag axis: a search query moves the sort, and relevance does not exist
 * without one. Both apps call the same function, so pinning values here is what makes the two
 * screens equivalent. If each screen kept its own copy, search results would come out newest-first
 * on one side only, and that difference would show only when the screens are compared side by side.
 */

const filters = (patch: Partial<GalleryFilters>): GalleryFilters => ({
	...DEFAULT_GALLERY_FILTERS,
	...patch,
});

describe("vocabulary", () => {
	it("relevance is in the sort vocabulary and has a word", () => {
		expect(STORY_SORTS).toContain("relevance");
		expect(STORY_SORT_LABEL.relevance).toBe("Relevance");
	});

	it("the default has no tag", () => {
		expect(DEFAULT_GALLERY_FILTERS.tag).toBeNull();
		expect(hasActiveFilters(filters({ tag: "school" }))).toBe(true);
	});
});

describe("effectiveGallerySort", () => {
	it("relevance without a query is newest", () => {
		expect(effectiveGallerySort({ sort: "relevance", query: "" })).toBe(
			"recent",
		);
		expect(effectiveGallerySort({ sort: "relevance", query: "   " })).toBe(
			"recent",
		);
	});

	it("with a query the chosen sort stays", () => {
		expect(effectiveGallerySort({ sort: "relevance", query: "Cat" })).toBe(
			"relevance",
		);
		expect(effectiveGallerySort({ sort: "popular", query: "Cat" })).toBe(
			"popular",
		);
		expect(effectiveGallerySort({ sort: "recent", query: "Cat" })).toBe(
			"recent",
		);
	});

	it("relevanceApplies treats a whitespace-only query as none", () => {
		expect(relevanceApplies({ query: " " })).toBe(false);
		expect(relevanceApplies({ query: "a" })).toBe(true);
	});
});

describe("applyGalleryQuery", () => {
	it("a query appearing under the default sort moves to relevance", () => {
		expect(applyGalleryQuery(DEFAULT_GALLERY_FILTERS, "Cat")).toEqual(
			filters({ query: "Cat", sort: "relevance" }),
		);
	});

	it("when the query goes, relevance returns to newest", () => {
		expect(
			applyGalleryQuery(filters({ query: "Cat", sort: "relevance" }), ""),
		).toEqual(DEFAULT_GALLERY_FILTERS);
	});

	it("popular stays whether a query appears or goes; the user chose it explicitly", () => {
		const popular = filters({ sort: "popular", period: "week" });
		expect(applyGalleryQuery(popular, "Cat")).toEqual({
			...popular,
			query: "Cat",
		});
		expect(applyGalleryQuery({ ...popular, query: "Cat" }, "")).toEqual(
			popular,
		);
	});

	it("the sort does not wobble while the query is edited", () => {
		const searching = filters({ query: "cat", sort: "relevance" });
		expect(applyGalleryQuery(searching, "Cat").sort).toBe("relevance");
	});

	it("nothing to change returns the same reference, so the query identity does not change every render", () => {
		const searching = filters({ query: "Cat", sort: "relevance" });
		expect(applyGalleryQuery(searching, "Cat")).toBe(searching);
		expect(applyGalleryQuery(DEFAULT_GALLERY_FILTERS, "")).toBe(
			DEFAULT_GALLERY_FILTERS,
		);
	});

	it("other axes are untouched", () => {
		const narrowed = filters({
			orientation: "female",
			rating: "sfw",
			tag: "school",
			followingOnly: true,
		});
		const next = applyGalleryQuery(narrowed, "Cat");
		expect(next).toEqual({ ...narrowed, query: "Cat", sort: "relevance" });
	});
});

describe("normalizeGalleryTag", () => {
	it("trims whitespace only and keeps case (same as publication normalization)", () => {
		expect(normalizeGalleryTag("  school ")).toBe("school");
		expect(normalizeGalleryTag("Cat")).toBe("Cat");
	});

	it("an empty value is no tag", () => {
		expect(normalizeGalleryTag("")).toBeNull();
		expect(normalizeGalleryTag("   ")).toBeNull();
		expect(normalizeGalleryTag(null)).toBeNull();
		expect(normalizeGalleryTag(undefined)).toBeNull();
	});
});
