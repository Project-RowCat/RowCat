import { describe, expect, it } from "vitest";
import {
	caretAtEnd,
	clampTextSelection,
	type TextSelection,
} from "./prompt-editing.ts";

/**
 * Cursor hand-off values. The web runs the same table
 * (`apps/web/src/features/create/prompt-editing.test.ts`); drift between the two would only show as
 * the cursor jumping on one platform.
 */

const SELECTION = (start: number, end: number): TextSelection => ({
	start,
	end,
});

describe("clampTextSelection", () => {
	it("null when there's no slot to pass", () => {
		expect(clampTextSelection(null, 10)).toBeNull();
		expect(clampTextSelection(undefined, 10)).toBeNull();
	});

	it("a position inside the body passes as is", () => {
		expect(clampTextSelection(SELECTION(3, 7), 10)).toEqual(SELECTION(3, 7));
	});

	/**
	 * The value can shorten off-screen (a synced edit from another device); an unclamped `selection`
	 * is silently ignored or jumps to the end.
	 */
	it("folds into a shortened body", () => {
		expect(clampTextSelection(SELECTION(80, 120), 12)).toEqual(
			SELECTION(12, 12),
		);
	});

	it("folds negatives and fractions", () => {
		expect(clampTextSelection(SELECTION(-4, 2.6), 10)).toEqual(SELECTION(0, 3));
		expect(clampTextSelection(SELECTION(Number.NaN, 5), 10)).toEqual(
			SELECTION(0, 5),
		);
	});

	/**
	 * A reversed range is kept as is: for a backward drag the direction is the user's anchor, and
	 * normalizing it would move the anchor of someone still dragging.
	 */
	it("keeps the direction of a reversed range", () => {
		expect(clampTextSelection(SELECTION(9, 2), 10)).toEqual(SELECTION(9, 2));
	});

	it("everything is 0 in an empty body", () => {
		expect(clampTextSelection(SELECTION(5, 9), 0)).toEqual(SELECTION(0, 0));
	});
});

describe("caretAtEnd", () => {
	it("points at the end of the text", () => {
		expect(caretAtEnd("abc")).toEqual(SELECTION(3, 3));
		expect(caretAtEnd("")).toEqual(SELECTION(0, 0));
	});
});
