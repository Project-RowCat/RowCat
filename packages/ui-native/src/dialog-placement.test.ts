import { describe, expect, it } from "vitest";
import {
	DIALOG_ADAPTIVE_CENTER_MIN_WIDTH,
	resolveDialogPlacement,
} from "./dialog-placement.ts";

/**
 * A wrong placement result is silent and shows only on certain devices: tablets where the sheet
 * sticks to the bottom, or 320pt phones where the box covers the whole screen. The app's tests do
 * not render React, so a rule inside a component could only be checked by running the app. Keeping
 * it here makes it testable.
 */
describe("where a dialog stands", () => {
	/**
	 * The default is center, and this line matters most in this file. Changing the default to adaptive
	 * would move every window that is centered now (rename, message edit) with no decision at the call
	 * site, and the change would still pass compile and tests.
	 */
	it("an explicit placement ignores width", () => {
		for (const width of [320, 390, 744, 1024]) {
			expect(resolveDialogPlacement("center", width)).toBe("center");
			expect(resolveDialogPlacement("bottom", width)).toBe("bottom");
		}
	});

	it("docks to the bottom at handheld widths", () => {
		for (const width of [320, 360, 375, 390, 414, 430])
			expect(resolveDialogPlacement("adaptive", width), `${width}pt`).toBe(
				"bottom",
			);
	});

	/**
	 * Tablet widths. The smallest iPad is 744pt in portrait, and landscape falls in the same range.
	 */
	it("floats centered at tablet widths", () => {
		for (const width of [744, 768, 834, 1024, 1366])
			expect(resolveDialogPlacement("adaptive", width), `${width}pt`).toBe(
				"center",
			);
	});

	/** The boundary is inclusive: the minimum width itself and anything above it is center. */
	it("there is one split point at the boundary", () => {
		expect(
			resolveDialogPlacement("adaptive", DIALOG_ADAPTIVE_CENTER_MIN_WIDTH),
		).toBe("center");
		expect(
			resolveDialogPlacement("adaptive", DIALOG_ADAPTIVE_CENTER_MIN_WIDTH - 1),
		).toBe("bottom");
	});

	/**
	 * An unknown width (0 or negative) folds to the hand-held side. An error there makes a tablet
	 * sheet slightly wide; the opposite error would make a small device's box cover the whole screen.
	 */
	it("unknown widths fold to the safe side", () => {
		expect(resolveDialogPlacement("adaptive", 0)).toBe("bottom");
		expect(resolveDialogPlacement("adaptive", -1)).toBe("bottom");
		expect(resolveDialogPlacement("adaptive", Number.NaN)).toBe("bottom");
	});
});
