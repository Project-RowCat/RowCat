import { describe, expect, it } from "vitest";
import { runtimeEditorTabLabels } from "./tab-labels.ts";

/**
 * Tab labels grow only when names collide. Getting this wrong fails silently in two ways. Always
 * using the basename makes three `index.ts` tabs look identical. Always using the full path lets
 * one tab consume the strip and push the rest out of view. Both fail to show what is open.
 */

describe("just the file name when there's no overlap", () => {
	it("different names in the same folder", () => {
		expect(runtimeEditorTabLabels(["src/a.ts", "src/b.ts"])).toEqual([
			"a.ts",
			"b.ts",
		]);
	});

	it("different names stay as they are even in different folders", () => {
		expect(
			runtimeEditorTabLabels(["src/main.tsx", "src/lib/format.ts"]),
		).toEqual(["main.tsx", "format.ts"]);
	});

	it("always just the name when there's one", () => {
		expect(runtimeEditorTabLabels(["a/b/c/deep.ts"])).toEqual(["deep.ts"]);
	});

	it("an empty list is an empty list", () => {
		expect(runtimeEditorTabLabels([])).toEqual([]);
	});
});

describe("on overlap, prefixes only as much as needed to tell them apart", () => {
	it("one parent segment tells them apart", () => {
		expect(
			runtimeEditorTabLabels([
				"src/components/index.ts",
				"src/runtime/index.ts",
			]),
		).toEqual(["components/index.ts", "runtime/index.ts"]);
	});

	it("three follow the same rule", () => {
		expect(
			runtimeEditorTabLabels([
				"src/components/index.ts",
				"src/runtime/index.ts",
				"src/utils/index.ts",
			]),
		).toEqual(["components/index.ts", "runtime/index.ts", "utils/index.ts"]);
	});

	/**
	 * Does not fall back to the full path. It stops at the shallowest depth that tells the labels
	 * apart.
	 */
	it("uses only what's needed even in deep paths", () => {
		expect(
			runtimeEditorTabLabels(["foo/a/index.ts", "bar/b/index.ts"]),
		).toEqual(["a/index.ts", "b/index.ts"]);
	});

	it("goes one more segment when the parents match too", () => {
		expect(
			runtimeEditorTabLabels(["foo/ui/index.ts", "bar/ui/index.ts"]),
		).toEqual(["foo/ui/index.ts", "bar/ui/index.ts"]);
	});

	/** Non-colliding entries stay short. One colliding pair must not lengthen the whole list. */
	it("only the overlapping ones get longer", () => {
		expect(
			runtimeEditorTabLabels([
				"src/main.tsx",
				"src/components/index.ts",
				"src/runtime/index.ts",
			]),
		).toEqual(["main.tsx", "components/index.ts", "runtime/index.ts"]);
	});

	it("overlapping a root file gives only one side a folder", () => {
		expect(runtimeEditorTabLabels(["index.ts", "src/index.ts"])).toEqual([
			"index.ts",
			"src/index.ts",
		]);
	});
});

/**
 * The result is an array of the same length as the input, not a path-to-label map. A map would
 * collapse entries in a frame where the list is briefly out of sync, and a tab would disappear.
 */
describe("termination and shape", () => {
	it("terminates even with two identical paths", () => {
		const labels = runtimeEditorTabLabels(["src/a.ts", "src/a.ts"]);
		expect(labels).toHaveLength(2);
		expect(labels[0]).toBe(labels[1]);
	});

	it("does not change the input order", () => {
		expect(runtimeEditorTabLabels(["z/index.ts", "a/index.ts"])).toEqual([
			"z/index.ts",
			"a/index.ts",
		]);
	});
});
