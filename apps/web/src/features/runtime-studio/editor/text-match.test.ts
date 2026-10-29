import { describe, expect, it } from "vitest";
import { searchRuntimeFiles } from "../commands/quick-open.ts";
import {
	highlightRuntimeMatch,
	type RuntimeTextMatchPart,
} from "./text-match.ts";

/**
 * Highlighting must draw what search actually matched.
 *
 * This property is invisible on screen: bold text looks plausible wherever it appears. When it is
 * wrong, the symptom is 'why is this row in the list?', which is never reported as a bug.
 */

const text = (parts: RuntimeTextMatchPart[]) =>
	parts.map((part) => part.text).join("");
const matched = (parts: RuntimeTextMatchPart[]) =>
	parts.filter((part) => part.matched).map((part) => part.text);

describe("keeps the original text", () => {
	/** Joining the fragments always gives back the original text, and the screen draws only them. */
	it.each([
		"button.tsx",
		"src/components",
		"index.ts",
	])("restores %s as is", (input) => {
		for (const query of ["", "b", "on", "nomatch", "SRC"])
			expect(text(highlightRuntimeMatch(input, query))).toBe(input);
	});
});

describe("file name", () => {
	it("marks a substring", () => {
		expect(highlightRuntimeMatch("button.tsx", "button")).toEqual([
			{ text: "button", matched: true },
			{ text: ".tsx", matched: false },
		]);
	});

	it("marks it in the middle too", () => {
		expect(matched(highlightRuntimeMatch("format-main.ts", "main"))).toEqual([
			"main",
		]);
	});

	/**
	 * Ranking looks only at the first position, but highlighting marks all of them. If only the first
	 * were bold, the reader could not tell why the later matches are missing.
	 */
	it("marks every occurrence", () => {
		expect(matched(highlightRuntimeMatch("main-main.ts", "main"))).toEqual([
			"main",
			"main",
		]);
	});

	it("does not count overlapping matches twice", () => {
		expect(highlightRuntimeMatch("aaa.ts", "aa")).toEqual([
			{ text: "aa", matched: true },
			{ text: "a.ts", matched: false },
		]);
	});
});

describe("path", () => {
	/**
	 * A query that matches only a folder segment is also highlighted. That is why the row is listed.
	 */
	it("marks a folder segment", () => {
		expect(
			matched(highlightRuntimeMatch("src/components", "components")),
		).toEqual(["components"]);
	});

	it("marks a query containing a separator", () => {
		expect(matched(highlightRuntimeMatch("src/ui", "src/"))).toEqual(["src/"]);
	});
});

describe("case", () => {
	it("folds the query", () => {
		expect(matched(highlightRuntimeMatch("Button.tsx", "BUTTON"))).toEqual([
			"Button",
		]);
	});

	/**
	 * Displayed text is the original characters. Drawing folded text would change the file name on
	 * screen.
	 */
	it("returns the original's case", () => {
		expect(matched(highlightRuntimeMatch("Main.tsx", "main"))).toEqual([
			"Main",
		]);
	});
});

describe("when there is nothing to mark", () => {
	it("an empty query is one piece", () => {
		expect(highlightRuntimeMatch("button.tsx", "")).toEqual([
			{ text: "button.tsx", matched: false },
		]);
	});

	it("whitespace only is an empty query", () => {
		expect(matched(highlightRuntimeMatch("button.tsx", "   "))).toEqual([]);
	});

	it("no match is one piece", () => {
		expect(highlightRuntimeMatch("button.tsx", "zzz")).toEqual([
			{ text: "button.tsx", matched: false },
		]);
	});

	it("an empty string has no pieces to draw", () => {
		expect(highlightRuntimeMatch("", "b")).toEqual([]);
	});
});

/**
 * Highlighting and ranking must share one normalization. A copy can diverge in one direction, for
 * example trimming on one side only or case folding on one side only. The row then stays in the
 * list with no bold text, and no error is raised.
 */
describe("looks at the same thing as search", () => {
	const files = [
		{ id: "1", path: "src/main.tsx" },
		{ id: "2", path: "src/components/Button.tsx" },
	];

	it.each([
		"  main  ",
		"BUTTON",
		"components",
	])("%s: a listed row has a place to highlight", (query) => {
		for (const file of searchRuntimeFiles(files, query)) {
			const parts = [
				...highlightRuntimeMatch(file.path, query),
				...highlightRuntimeMatch(file.path.split("/").pop() ?? "", query),
			];
			expect(parts.some((part) => part.matched)).toBe(true);
		}
	});
});
