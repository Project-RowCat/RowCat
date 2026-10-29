import { describe, expect, it } from "vitest";
import {
	caretAtEnd,
	clampTextSelection,
	PROMPT_DIALOG_FIELD,
	PROMPT_FIELD_GROWTH,
	PROMPT_FIELD_ROWS,
	promptExpand,
	type TextSelection,
} from "./prompt-editing.ts";

/**
 * Geometry and caret rules for the prompt field. Violations here all render normally, with no
 * error. An uncapped box shows no symptom with a short body; it only grows the document with long
 * manuscripts. A caret without clamping jumps to the end only when the value became shorter while
 * off-screen.
 */

const SELECTION = (start: number, end: number): TextSelection => ({
	start,
	end,
});

describe("field geometry", () => {
	/**
	 * Capping and scrolling come as a pair. Either alone fails differently: a cap alone clips overflow
	 * with no way to reach it, and scrolling alone never scrolls because the box keeps growing.
	 */
	it("the growth cap carries both containment and scrolling", () => {
		expect(PROMPT_FIELD_GROWTH).toMatch(/max-h-\[\d+dvh\]/);
		expect(PROMPT_FIELD_GROWTH).toContain("overflow-y-auto");
	});

	/**
	 * `dvh`, not `vh`. The app runs with `interactive-widget=resizes-content`, so the soft keyboard
	 * shrinks the layout viewport, which `vh` ignores. Measuring the cap to the area under the
	 * keyboard leaves the caret hidden beneath it.
	 */
	it("the cap is in dynamic viewport units", () => {
		expect(PROMPT_FIELD_GROWTH).not.toMatch(/max-h-\[\d+vh\]/);
	});

	/** Wide screens get more height. One number is not used for both widths. */
	it("the cap differs by width", () => {
		expect(PROMPT_FIELD_GROWTH).toMatch(/lg:max-h-\[\d+dvh\]/);
	});

	/**
	 * If the minimum sits next to the cap, the growing range disappears: even short prompts would only
	 * grow an empty box. Twelve rows is roughly a third of the screen, leaving room below the cap
	 * (50dvh).
	 */
	it("the usual height is well below the cap", () => {
		expect(PROMPT_FIELD_ROWS).toBeGreaterThanOrEqual(8);
		expect(PROMPT_FIELD_ROWS).toBeLessThanOrEqual(14);
	});

	/**
	 * Inside the dialog the field does not grow. Without `field-sizing-fixed`, the same problem recurs
	 * inside the window: the window, not the field, overflows and becomes the scroller. Without
	 * `min-h-0`, `flex-1` cannot shrink, because a flex child's default minimum height is its content.
	 */
	it("the field in the window fills the remaining space and scrolls itself", () => {
		expect(PROMPT_DIALOG_FIELD).toContain("field-sizing-fixed");
		expect(PROMPT_DIALOG_FIELD).toContain("min-h-0");
		expect(PROMPT_DIALOG_FIELD).toContain("flex-1");
		expect(PROMPT_DIALOG_FIELD).toContain("overflow-y-auto");
	});
});

describe("copy", () => {
	/**
	 * The label is not `Save` (save). This window has no save action, and closing confirms nothing. The
	 * word would mean 'unsaved work is lost unless closed', a promise this editor never made, since
	 * the save model is autosave only.
	 */
	it("does not imply a confirm step", () => {
		for (const line of Object.values(promptExpand())) {
			expect(line).not.toMatch(/\bSave\b/);
			expect(line).not.toContain("Apply");
			expect(line).not.toContain("Cancel");
		}
		expect(promptExpand().close).toBe("Done");
	});
});

describe("clampTextSelection", () => {
	it("null when there is no position to pass", () => {
		expect(clampTextSelection(null, 10)).toBeNull();
		expect(clampTextSelection(undefined, 10)).toBeNull();
	});

	it("a position inside the text passes through", () => {
		expect(clampTextSelection(SELECTION(3, 7), 10)).toEqual(SELECTION(3, 7));
	});

	/**
	 * The value can shrink while off-screen (edits in another tab, sync; see `edited-value.ts`), so
	 * the restored caret must be clamped.
	 */
	it("folds into a shortened text", () => {
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
	 * The direction of a reversed range is the user's anchor point, so it is not normalized. Sorting
	 * would move the anchor of someone still extending the selection backward.
	 */
	it("keeps the direction of a reversed range", () => {
		expect(clampTextSelection(SELECTION(9, 2), 10)).toEqual(SELECTION(9, 2));
	});

	it("everything is 0 for empty text", () => {
		expect(clampTextSelection(SELECTION(5, 9), 0)).toEqual(SELECTION(0, 0));
	});
});

describe("caretAtEnd", () => {
	it("points at the end of the text", () => {
		expect(caretAtEnd("abc")).toEqual(SELECTION(3, 3));
		expect(caretAtEnd("")).toEqual(SELECTION(0, 0));
	});
});
