import { describe, expect, it } from "vitest";
import { isBlankLore, loreSummary, splitKeys } from "./lore-fields.ts";

/**
 * Two lore card rules that must be checked without rendering: keyword splitting and the collapsed
 * summary. Both fail silently. The first leaves empty keywords in the save model, which publish
 * validation reads as 'has keywords'. The second folds every entry into the same word, so the user
 * cannot pick the entry they want.
 */
describe("splitting lore keywords", () => {
	/**
	 * This function also runs while typing. It used to run only on blur, so a user who typed a keyword
	 * and reloaded immediately lost it, with no warning because the save indicator never switched to
	 * pending. For intermediate states to be safe to save, empty fragments must not enter the array:
	 * an empty keyword matches nothing in a conversation, but publish validation reads it as 'has
	 * keywords'.
	 */
	it("splits on commas and drops surrounding whitespace", () => {
		expect(splitKeys("library, librarian")).toEqual(["library", "librarian"]);
		expect(splitKeys("  library  ,librarian ")).toEqual([
			"library",
			"librarian",
		]);
	});

	it("makes no empty pieces from an in-progress state", () => {
		// The state right after typing a comma and space: the part after the comma is still empty.
		expect(splitKeys("library, ")).toEqual(["library"]);
		expect(splitKeys("library,")).toEqual(["library"]);
		expect(splitKeys(",,")).toEqual([]);
	});

	it("empty input is an empty array", () => {
		expect(splitKeys("")).toEqual([]);
		expect(splitKeys("   ")).toEqual([]);
	});
});

const entry = (over: Partial<Parameters<typeof loreSummary>[0]> = {}) => ({
	keys: ["library", "librarian"],
	constant: false,
	position: "system_bottom" as const,
	order: 0,
	...over,
});

describe("collapsed lore card summary", () => {
	it("the keywords are the headline", () => {
		const summary = loreSummary(entry());
		expect(summary.headline).toBe("library, librarian");
		expect(summary.hasKeys).toBe(true);
	});

	it("without keywords it says so instead", () => {
		const summary = loreSummary(entry({ keys: [] }));
		expect(summary.headline).toBe("No keywords");
		expect(summary.hasKeys).toBe(false);
	});

	/**
	 * Why `hasKeys` is a separate axis from the headline. A keyword that happens to equal the fallback
	 * phrase (`No keywords`) is valid and must not be dimmed. Judging by string comparison would get that
	 * case silently wrong.
	 */
	it("a keyword equal to the fallback text is not treated as empty", () => {
		expect(loreSummary(entry({ keys: ["No keywords"] })).hasKeys).toBe(true);
	});

	it("position and priority always appear; always-include appears only when on", () => {
		expect(loreSummary(entry({ order: 2 })).meta).toEqual([
			"After the system prompt",
			"Priority 2",
		]);
		expect(
			loreSummary(entry({ constant: true, position: "system_top", order: 5 }))
				.meta,
		).toEqual(["Always include", "Before the system prompt", "Priority 5"]);
	});
});

/**
 * The reason the card starts expanded. It answers from the record alone rather than from 'was just
 * added', so an empty entry delivered by sync gets the same treatment.
 */
describe("blank lore check", () => {
	it("true only when both keywords and content are empty", () => {
		expect(isBlankLore({ keys: [], content: "" })).toBe(true);
		expect(isBlankLore({ keys: [], content: "   " })).toBe(true);
		expect(isBlankLore({ keys: ["library"], content: "" })).toBe(false);
		expect(isBlankLore({ keys: [], content: "there is a librarian" })).toBe(
			false,
		);
	});
});
