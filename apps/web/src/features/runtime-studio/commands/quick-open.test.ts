import { describe, expect, it } from "vitest";
import { searchRuntimeFiles } from "./quick-open.ts";

/**
 * Quick-open ranking must be deterministic. The same query must always produce the same order, or
 * arrow keys would not move as expected. The screen cannot verify this, since it only looks roughly
 * right. A wrong order shows up as Enter opening a different file.
 */

const files = [
	{ id: "1", path: "src/main.tsx" },
	{ id: "2", path: "src/components/button.tsx" },
	{ id: "3", path: "src/components/index.ts" },
	{ id: "4", path: "src/runtime/index.ts" },
	{ id: "5", path: "src/lib/format-main.ts" },
];

const paths = (query: string) =>
	searchRuntimeFiles(files, query).map((file) => file.path);

describe("empty query", () => {
	/** If the list is empty as the dialog opens, the user is not told what they can type. */
	it("returns everything", () => {
		expect(searchRuntimeFiles(files, "")).toHaveLength(files.length);
	});

	it("whitespace only is an empty query", () => {
		expect(searchRuntimeFiles(files, "   ")).toHaveLength(files.length);
	});

	it("shorter paths first", () => {
		expect(paths("")[0]).toBe("src/main.tsx");
	});
});

describe("ranking", () => {
	/** The two exact-name matches come first, and between them the shorter path ranks higher. */
	it("an exact file name match ranks first", () => {
		expect(paths("index.ts").slice(0, 2)).toEqual([
			"src/runtime/index.ts",
			"src/components/index.ts",
		]);
	});

	/** A name prefix ranks above a match inside the name, since users usually type file names. */
	it("a name prefix ranks above inside the name", () => {
		expect(paths("main")).toEqual(["src/main.tsx", "src/lib/format-main.ts"]);
	});

	it("finds it in the path when not in the name", () => {
		expect(paths("components")).toEqual([
			"src/components/index.ts",
			"src/components/button.tsx",
		]);
	});

	it("an empty list with no match", () => {
		expect(paths("nope")).toEqual([]);
	});
});

describe("case", () => {
	it("folds the query", () => {
		expect(paths("MAIN.TSX")[0]).toBe("src/main.tsx");
	});

	it("folds the target too", () => {
		expect(
			searchRuntimeFiles([{ id: "x", path: "src/Main.tsx" }], "main"),
		).toHaveLength(1);
	});
});

describe("determinism", () => {
	it("the same input gives the same order", () => {
		expect(paths("index")).toEqual(paths("index"));
	});

	/**
	 * Input order does not change results. The repository's listing order is not an axis of this
	 * function.
	 */
	it("input order doesn't change the result", () => {
		const reversed = [...files].reverse();
		expect(searchRuntimeFiles(reversed, "index").map((f) => f.path)).toEqual(
			paths("index"),
		);
	});

	it("same rank and length is lexicographic", () => {
		const same = [
			{ id: "b", path: "src/b/x.ts" },
			{ id: "a", path: "src/a/x.ts" },
		];
		expect(searchRuntimeFiles(same, "x.ts").map((f) => f.path)).toEqual([
			"src/a/x.ts",
			"src/b/x.ts",
		]);
	});
});

describe("cap", () => {
	/** Truncation happens after sorting, so the best match is never cut off. */
	it("cuts after sorting", () => {
		const many = [
			{ id: "far", path: "z/deep/nested/target.ts" },
			{ id: "near", path: "target.ts" },
		];
		expect(searchRuntimeFiles(many, "target", 1).map((f) => f.path)).toEqual([
			"target.ts",
		]);
	});
});
