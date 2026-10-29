import { describe, expect, it } from "vitest";
import {
	COMPACT_EDITOR_MIN_WINDOW_HEIGHT,
	messageEditPresentation,
} from "./edit-presentation.ts";

/**
 * The container choice comes from device geometry alone. Inside a component this decision could not
 * be checked without rendering, and a mistake is quiet: only small-device users see a clipped form.
 */
describe("the container for message editing", () => {
	it("on a roomy device it is a centered box", () => {
		// iPhone 13/15, Pixel 8, most Android devices.
		expect(messageEditPresentation(844)).toBe("dialog");
		expect(messageEditPresentation(852)).toBe("dialog");
		expect(messageEditPresentation(800)).toBe("dialog");
	});

	it("on a short device it fills the surface", () => {
		// iPhone SE (667): with the keyboard up, a centered box effectively fills the screen.
		expect(messageEditPresentation(667)).toBe("full");
		expect(messageEditPresentation(568)).toBe("full");
	});

	it("the boundary is locked to one value", () => {
		expect(messageEditPresentation(COMPACT_EDITOR_MIN_WINDOW_HEIGHT)).toBe(
			"dialog",
		);
		expect(messageEditPresentation(COMPACT_EDITOR_MIN_WINDOW_HEIGHT - 1)).toBe(
			"full",
		);
	});

	// Values that really arrive on first render or in test harnesses. Erring toward the wide side is
	// safe: that mistake makes the form larger than needed, the opposite clips text.
	it("an unknown value leans to the wide side", () => {
		expect(messageEditPresentation(0)).toBe("full");
		expect(messageEditPresentation(-1)).toBe("full");
		expect(messageEditPresentation(Number.NaN)).toBe("full");
	});

	// A sheet is not a branch of this decision; a short screen's answer is a bigger form surface.
	it("there are only two branches", () => {
		const outcomes = new Set(
			[320, 568, 667, 700, 844, 1024].map(messageEditPresentation),
		);
		expect([...outcomes].sort()).toEqual(["dialog", "full"]);
	});
});
