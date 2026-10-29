import { DEFAULT_GALLERY_FILTERS, type GalleryFilters } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { canonicalGalleryFilters, galleryQueryKey } from "./gallery.ts";

/**
 * Identity of a gallery query. Every axis that changes the server result is in the key, and
 * combinations that do not change the result collapse into one cell. A missing axis shows up as
 * different queries sharing one cell. An uncollapsed combination shows up as the same response in
 * two cells. Neither raises an error, which is why these tests exist.
 */

const filters = (patch: Partial<GalleryFilters>): GalleryFilters => ({
	...DEFAULT_GALLERY_FILTERS,
	...patch,
});

describe("canonicalGalleryFilters", () => {
	it("relevance without a query folds to newest", () => {
		expect(canonicalGalleryFilters(filters({ sort: "relevance" }))).toEqual(
			DEFAULT_GALLERY_FILTERS,
		);
		expect(galleryQueryKey(filters({ sort: "relevance" }))).toEqual(
			galleryQueryKey(DEFAULT_GALLERY_FILTERS),
		);
	});

	it("relevance with a query is a different query from newest", () => {
		expect(
			galleryQueryKey(filters({ query: "Cat", sort: "relevance" })),
		).not.toEqual(galleryQueryKey(filters({ query: "Cat", sort: "recent" })));
	});

	it("a period left under relevance folds away; only popular is changed by the period", () => {
		expect(
			canonicalGalleryFilters(
				filters({ query: "Cat", sort: "relevance", period: "week" }),
			).period,
		).toBe("all");
		expect(
			canonicalGalleryFilters(filters({ sort: "popular", period: "week" }))
				.period,
		).toBe("week");
	});

	it("the tag is part of query identity and only whitespace folds", () => {
		expect(galleryQueryKey(filters({ tag: "school" }))).not.toEqual(
			galleryQueryKey(DEFAULT_GALLERY_FILTERS),
		);
		expect(galleryQueryKey(filters({ tag: " school " }))).toEqual(
			galleryQueryKey(filters({ tag: "school" })),
		);
		expect(galleryQueryKey(filters({ tag: "   " }))).toEqual(
			galleryQueryKey(DEFAULT_GALLERY_FILTERS),
		);
	});

	it("different tags are different cells", () => {
		expect(galleryQueryKey(filters({ tag: "school" }))).not.toEqual(
			galleryQueryKey(filters({ tag: "Fantasy" })),
		);
	});
});
