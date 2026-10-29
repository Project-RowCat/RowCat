import { describe, expect, it } from "vitest";
import {
	appliedGalleryFilters,
	periodApplies,
	sortTriggerLabel,
} from "./gallery-filter-state.ts";
import {
	DEFAULT_GALLERY_FILTERS,
	type GalleryFilters,
	hasActiveFilters,
} from "./story.ts";

/**
 * Table of active filters. Once the controls move into a menu, the results still need explaining
 * outside it. This test pins two things: the table agrees with the domain's default-value checks,
 * and removing one token resets only its own axis.
 */

describe("appliedGalleryFilters", () => {
	it("no token at the default", () => {
		expect(appliedGalleryFilters(DEFAULT_GALLERY_FILTERS, true)).toEqual([]);
	});

	it("one token per narrowing axis", () => {
		const applied = appliedGalleryFilters(
			{
				...DEFAULT_GALLERY_FILTERS,
				orientation: "female",
				rating: "adult",
				followingOnly: true,
			},
			true,
		);
		expect(applied.map((a) => a.text)).toEqual([
			"Orientation: For women",
			"Rating: Adult",
			"Following",
		]);
		expect(applied.map((a) => a.removeLabel)).toEqual([
			"Remove Orientation For women filter",
			"Remove Rating Adult filter",
			"Remove Following filter",
		]);
	});

	it("removing one token reverts only that axis", () => {
		const filters = {
			...DEFAULT_GALLERY_FILTERS,
			orientation: "female" as const,
			rating: "adult" as const,
			followingOnly: true,
		};
		const [orientation] = appliedGalleryFilters(filters, true);
		const next = { ...filters, ...orientation?.patch };
		expect(next.orientation).toBeNull();
		expect(next.rating).toBe("adult");
		expect(next.followingOnly).toBe(true);
	});

	it("removing every token leaves domain with no conditions too", () => {
		let filters: GalleryFilters = {
			...DEFAULT_GALLERY_FILTERS,
			orientation: "male",
			rating: "sfw",
			followingOnly: true,
		};
		for (const applied of appliedGalleryFilters(filters, true)) {
			filters = { ...filters, ...applied.patch };
		}
		expect(hasActiveFilters(filters)).toBe(false);
	});

	it("guests have no Following token", () => {
		// Drawing a token the user cannot change would make its × a control that does nothing.
		expect(
			appliedGalleryFilters(
				{ ...DEFAULT_GALLERY_FILTERS, followingOnly: true },
				false,
			),
		).toEqual([]);
	});

	it("the query, sort and period are not tokens", () => {
		// The search input and the sort trigger already show that value as text.
		expect(
			appliedGalleryFilters(
				{
					...DEFAULT_GALLERY_FILTERS,
					query: "Cat",
					sort: "popular",
					period: "week",
				},
				true,
			),
		).toEqual([]);
	});
});

describe("how sort and period relate", () => {
	it("the period changes results only under popular", () => {
		expect(periodApplies({ sort: "popular" })).toBe(true);
		expect(periodApplies({ sort: "recent" })).toBe(false);
	});

	it("the trigger writes only a meaningful period", () => {
		expect(sortTriggerLabel({ sort: "recent", period: "all", query: "" })).toBe(
			"Newest",
		);
		expect(
			sortTriggerLabel({ sort: "popular", period: "all", query: "" }),
		).toBe("Popular");
		expect(
			sortTriggerLabel({ sort: "popular", period: "week", query: "" }),
		).toBe("Popular · Last 7 days");
		// A leftover period under newest-first does not change results, so it is not written into the
		// label.
		expect(
			sortTriggerLabel({ sort: "recent", period: "week", query: "" }),
		).toBe("Newest");
	});

	it("relevance is that word only with a query", () => {
		expect(
			sortTriggerLabel({ sort: "relevance", period: "all", query: "Cat" }),
		).toBe("Relevance");
		expect(
			sortTriggerLabel({ sort: "relevance", period: "all", query: "" }),
		).toBe("Newest");
		// Relevance has no period, so none is appended to its label.
		expect(
			sortTriggerLabel({ sort: "relevance", period: "week", query: "Cat" }),
		).toBe("Relevance");
	});

	it("a tag becomes a token; it is the only axis without a toolbar control, so this is the only place to revert it", () => {
		const [token] = appliedGalleryFilters(
			{ ...DEFAULT_GALLERY_FILTERS, tag: "school" },
			false,
		);
		expect(token?.text).toBe("Tag: #school");
		expect(token?.removeLabel).toBe("Remove Tag school filter");
		expect({
			...DEFAULT_GALLERY_FILTERS,
			tag: "school",
			...token?.patch,
		}).toEqual(DEFAULT_GALLERY_FILTERS);
	});
});
