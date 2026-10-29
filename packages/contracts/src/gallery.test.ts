import { describe, expect, it } from "vitest";
import {
	MAX_PAGE,
	MAX_PAGE_SIZE,
	STORY_SEARCH_MAX_LENGTH,
	STORY_TAG_MAX_LENGTH,
	StoriesQuery,
	toStoriesSearchParams,
} from "./gallery.ts";
import { STORY_PUBLISH_LIMITS } from "./publication.ts";

describe("gallery query parameters", () => {
	it("page numbers are capped; a huge OFFSET cannot force a full sort", () => {
		expect(StoriesQuery.safeParse({ page: MAX_PAGE }).success).toBe(true);
		expect(StoriesQuery.safeParse({ page: MAX_PAGE + 1 }).success).toBe(false);
		expect(StoriesQuery.safeParse({ page: 99_999_999 }).success).toBe(false);
	});
	it("the page size cap is unchanged", () => {
		expect(
			StoriesQuery.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success,
		).toBe(false);
	});
});

describe("query and tag", () => {
	it("relevance is in the sort vocabulary", () => {
		expect(StoriesQuery.parse({ sort: "relevance" }).sort).toBe("relevance");
	});

	it("refuses a query past the cap; substring matching on trigrams makes length the cost", () => {
		expect(
			StoriesQuery.safeParse({ q: "a".repeat(STORY_SEARCH_MAX_LENGTH) })
				.success,
		).toBe(true);
		expect(
			StoriesQuery.safeParse({ q: "a".repeat(STORY_SEARCH_MAX_LENGTH + 1) })
				.success,
		).toBe(false);
	});

	it("a tag is accepted only up to a storable length, and absent is null", () => {
		expect(StoriesQuery.parse({}).tag).toBeNull();
		expect(StoriesQuery.parse({ tag: "school" }).tag).toBe("school");
		expect(
			StoriesQuery.safeParse({ tag: "a".repeat(STORY_TAG_MAX_LENGTH + 1) })
				.success,
		).toBe(false);
	});

	it("the tag cap equals the publish cap; a filter that cannot be stored is refused", () => {
		expect(STORY_PUBLISH_LIMITS.tag).toBe(STORY_TAG_MAX_LENGTH);
	});

	it("serialization carries the tag and does not fold relevance to the default", () => {
		const sp = toStoriesSearchParams(
			StoriesQuery.parse({ q: "Cat", sort: "relevance", tag: " school " }),
		);
		expect(sp.get("q")).toBe("Cat");
		expect(sp.get("sort")).toBe("relevance");
		expect(sp.get("tag")).toBe("school");
		expect(toStoriesSearchParams(StoriesQuery.parse({})).has("tag")).toBe(
			false,
		);
	});
});
