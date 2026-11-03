import {
	appliedGalleryFilters,
	commentRepliesLabel,
	DEFAULT_GALLERY_FILTERS,
	DELETED_COMMENT_PLACEHOLDER,
	DELETED_CREATOR_LABEL,
	sortTriggerLabel as domainSortTriggerLabel,
	GALLERY_FILTER_AXIS_LABEL,
	ORIENTATION_LABEL,
	STORY_PERIOD_LABEL,
	STORY_RATING_LABEL,
	STORY_SORT_LABEL,
	STORY_START_LABEL,
	STORY_VISIBILITY_LABEL,
} from "@rowcat/domain";
import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "./instance.ts";
import { en } from "./messages/en/index.ts";
import {
	localizedAppliedFilters,
	repliesLabel,
	sortTriggerLabel,
	visibilityBadgeLabel,
} from "./vocab.ts";

/**
 * The domain's label tables are the English source for the product vocabulary, and the screens used
 * to draw them directly. Moving the words into the dictionary must not change one English letter —
 * the web's `vocab` holds the same English — so the two are compared by value here. Diverge, and the
 * same code reads as two different words in the two apps.
 */
describe("English vocab is the domain's own words", () => {
	it.each([
		["orientation", ORIENTATION_LABEL],
		["rating", STORY_RATING_LABEL],
		["sort", STORY_SORT_LABEL],
		["period", STORY_PERIOD_LABEL],
		["filterAxis", GALLERY_FILTER_AXIS_LABEL],
		["visibility", STORY_VISIBILITY_LABEL],
		["start", STORY_START_LABEL],
	] as const)("%s", (group, table) => {
		expect(en.vocab[group]).toEqual({ ...table });
	});

	it("the two state words", () => {
		expect(en.vocab.deletedCreator).toBe(DELETED_CREATOR_LABEL);
		expect(en.vocab.deletedComment).toBe(DELETED_COMMENT_PLACEHOLDER);
	});
});

describe("the named decisions match the domain's in English", () => {
	afterEach(() => setActiveLocale("en"));

	it("applied filter tokens", () => {
		const filters = {
			...DEFAULT_GALLERY_FILTERS,
			orientation: "female" as const,
			rating: "adult" as const,
			tag: "밤",
			followingOnly: true,
		};
		const strip = (list: ReturnType<typeof appliedGalleryFilters>) =>
			list.map(({ axis, text, removeLabel, patch }) => ({
				axis,
				text,
				removeLabel,
				patch,
			}));
		expect(strip(localizedAppliedFilters(filters, true))).toEqual(
			strip(appliedGalleryFilters(filters, true)),
		);
	});

	it("sort trigger", () => {
		for (const sort of ["recent", "popular", "relevance"] as const)
			for (const period of ["all", "day", "week", "month"] as const)
				for (const query of ["", "밤"]) {
					const filters = { sort, period, query };
					expect(sortTriggerLabel(filters)).toBe(
						domainSortTriggerLabel(filters),
					);
				}
	});

	it("replies button, including its absence at 0", () => {
		for (const count of [0, 1, 2, 31])
			expect(repliesLabel(count)).toBe(commentRepliesLabel(count));
	});

	it("public gets no badge in any language", () => {
		setActiveLocale("ko");
		expect(visibilityBadgeLabel("public")).toBeNull();
		expect(visibilityBadgeLabel("unlisted")).toBe("링크 공개");
	});
});
