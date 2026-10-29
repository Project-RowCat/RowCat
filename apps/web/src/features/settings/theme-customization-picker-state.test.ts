import { describe, expect, it } from "vitest";
import { hsvToHex } from "./theme-customization-color.ts";
import {
	huePosition,
	openThemeColorPicker,
	type PickerRect,
	pointToHue,
	pointToSv,
	svPosition,
	themeColorPickerColor,
	themeColorPickerWithHex,
	themeColorPickerWithHsv,
} from "./theme-customization-picker-state.ts";

/**
 * Picker rules, checked by value without rendering. This file guards three things, all silent on
 * screen:
 *
 * 1. A pointer dragged outside the surface never produces a value outside the surface.
 * 2. Dragging through gray or black does not erase the user's hue.
 * 3. An unfinished hex entry does not erase the last valid color.
 */

const RECT: PickerRect = { left: 100, top: 50, width: 200, height: 100 };

describe("coordinates: the 2D surface", () => {
	/** The top-left corner is saturation 0 and value 1. The inverted vertical axis is encoded here. */
	it("the four corners", () => {
		expect(pointToSv({ clientX: 100, clientY: 50 }, RECT)).toEqual({
			s: 0,
			v: 1,
		});
		expect(pointToSv({ clientX: 300, clientY: 50 }, RECT)).toEqual({
			s: 1,
			v: 1,
		});
		expect(pointToSv({ clientX: 100, clientY: 150 }, RECT)).toEqual({
			s: 0,
			v: 0,
		});
		expect(pointToSv({ clientX: 300, clientY: 150 }, RECT)).toEqual({
			s: 1,
			v: 0,
		});
	});

	it("the center", () => {
		expect(pointToSv({ clientX: 200, clientY: 100 }, RECT)).toEqual({
			s: 0.5,
			v: 0.5,
		});
	});

	/**
	 * A pointer that leaves the surface was not lost; the user dragged to the end. Clamping is
	 * required: without it saturation exceeds 1. Color creation clamps it again, so only the handle
	 * would end up off the surface.
	 */
	it("clamps outside the bounds", () => {
		expect(pointToSv({ clientX: -500, clientY: -500 }, RECT)).toEqual({
			s: 0,
			v: 1,
		});
		expect(pointToSv({ clientX: 9999, clientY: 9999 }, RECT)).toEqual({
			s: 1,
			v: 0,
		});
	});

	/**
	 * Do not divide on a surface with zero width (not laid out yet). Otherwise `Infinity` lands in
	 * state.
	 */
	it("zero width gives 0", () => {
		expect(
			pointToSv(
				{ clientX: 100, clientY: 50 },
				{ left: 100, top: 50, width: 0, height: 0 },
			),
		).toEqual({ s: 0, v: 1 });
	});

	/**
	 * The handle position goes through the same vertical flip as the coordinate conversion. If the two
	 * differ, only the color is inverted.
	 */
	it("the handle position follows the axes", () => {
		expect(svPosition({ h: 0, s: 0, v: 1 })).toEqual({ left: 0, top: 0 });
		expect(svPosition({ h: 0, s: 1, v: 0 })).toEqual({ left: 100, top: 100 });
		expect(svPosition({ h: 0, s: 0.25, v: 0.25 })).toEqual({
			left: 25,
			top: 75,
		});
	});
});

describe("coordinates: the hue slider", () => {
	const track = { left: 100, width: 360 };

	it("left end, middle, right end", () => {
		expect(pointToHue(100, track)).toBe(0);
		expect(pointToHue(280, track)).toBe(180);
		expect(pointToHue(460, track)).toBe(360);
	});

	it("clamps outside the bounds", () => {
		expect(pointToHue(-100, track)).toBe(0);
		expect(pointToHue(9999, track)).toBe(360);
	});

	/**
	 * The right end does not fold to 0. Folding would jump the handle to the left end while the color
	 * stays the same, which looks like a bug to someone dragging. That the two ends give the same
	 * color is decided where color is created.
	 */
	it("the end does not jump to the left and is still the same color", () => {
		expect(huePosition(pointToHue(460, track))).toBe(100);
		expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe(
			hsvToHex({ h: 0, s: 1, v: 1 }),
		);
	});
});

describe("on open: the draft does not change", () => {
	/**
	 * A cell with no value starts from the preset color. That does not make it a draft: `rawHex` stays
	 * an empty string, so the value leaving this state is also empty.
	 */
	it("without a chosen value it starts from the preset color and the draft is empty", () => {
		const state = openThemeColorPicker("", "#18181b");
		expect(themeColorPickerColor(state)).toBe("#18181b");
		expect(state.rawHex).toBe("");
	});

	it("with a chosen value it starts from that color", () => {
		const state = openThemeColorPicker("#9a83ff", "#18181b");
		expect(themeColorPickerColor(state)).toBe("#9a83ff");
		expect(state.rawHex).toBe("#9a83ff");
	});

	it("also reads values before normalization", () => {
		expect(
			themeColorPickerColor(openThemeColorPicker("9A83FF", "#18181b")),
		).toBe("#9a83ff");
	});

	/**
	 * If the saved value is not valid syntax, the preset color is shown. It must not fall back to
	 * black.
	 */
	it("an invalid value draws with the preset color", () => {
		expect(
			themeColorPickerColor(openThemeColorPicker("#zz00", "#fffaf2")),
		).toBe("#fffaf2");
	});
});

describe("interaction makes a custom value", () => {
	/**
	 * Results do not reveal intent. Someone who deliberately picks the same black as a black preset
	 * has still made a custom choice. What decides it is whether manipulation happened, not the
	 * resulting color.
	 */
	it("choosing the same color as the preset still fills the draft", () => {
		const opened = openThemeColorPicker("", "#18181b");
		const next = themeColorPickerWithHsv(opened.hsv);
		expect(next.rawHex).toBe("#18181b");
	});

	it("moving an axis makes the draft that color", () => {
		const next = themeColorPickerWithHsv({
			h: 0,
			s: 1,
			v: 1,
		});
		expect(next.rawHex).toBe("#ff0000");
		expect(themeColorPickerColor(next)).toBe("#ff0000");
	});

	it("an out-of-range axis comes in clamped", () => {
		const next = themeColorPickerWithHsv({
			h: 400,
			s: 2,
			v: -1,
		});
		expect(next.hsv).toEqual({ h: 360, s: 1, v: 0 });
	});
});

describe("the hue survives passing through gray and black", () => {
	const purple = themeColorPickerWithHsv({
		h: 270,
		s: 0.6,
		v: 0.9,
	});

	/**
	 * Purple, then saturation 0 (gray), then saturation back up. It must not return to red.
	 * Implementations that rederive the axes from the result color fail exactly here, because a gray's
	 * channels contain no purple.
	 */
	it("dropping saturation to 0 and raising it returns to purple", () => {
		const gray = themeColorPickerWithHsv({ ...purple.hsv, s: 0 });
		expect(gray.rawHex).toBe(hsvToHex({ h: 270, s: 0, v: 0.9 }));
		expect(gray.hsv.h).toBe(270);

		const back = themeColorPickerWithHsv({ ...gray.hsv, s: 0.6 });
		expect(back.rawHex).toBe(purple.rawHex);
	});

	it("dropping brightness to 0 and raising it returns to purple", () => {
		const black = themeColorPickerWithHsv({ ...purple.hsv, v: 0 });
		expect(black.rawHex).toBe("#000000");
		expect(black.hsv.h).toBe(270);
		expect(black.hsv.s).toBe(0.6);

		const back = themeColorPickerWithHsv({ ...black.hsv, v: 0.9 });
		expect(back.rawHex).toBe(purple.rawHex);
	});

	/**
	 * The same holds when the user types a gray hex directly. That color does not represent the hue,
	 * so the hue is kept, not lost.
	 */
	it("typing an achromatic color keeps the hue", () => {
		const gray = themeColorPickerWithHex(purple, "#808080", "#18181b");
		expect(gray.hsv.h).toBe(270);
		expect(themeColorPickerColor(gray)).toBe("#808080");
	});
});

describe("hex field: a half-typed value clears nothing", () => {
	const red = themeColorPickerWithHsv({
		h: 0,
		s: 1,
		v: 1,
	});

	/**
	 * While a hand-typed value is incomplete (`#`, `#9`, `#9a`, ...), the picker keeps its last valid
	 * color. Parsing every keystroke and overwriting state would make the field impossible to edit.
	 */
	it("the color stays while the value is half-typed", () => {
		let state = red;
		for (const draft of ["#", "#9", "#9a", "#9a8", "#9a83", "#9a83f"]) {
			state = themeColorPickerWithHex(state, draft, "#18181b");
			expect(state.rawHex, draft).toBe(draft);
			expect(themeColorPickerColor(state), draft).toBe("#ff0000");
		}
	});

	it("an invalid value stays and does not clear the color", () => {
		const state = themeColorPickerWithHex(red, "#zz0000", "#18181b");
		expect(state.rawHex).toBe("#zz0000");
		expect(themeColorPickerColor(state)).toBe("#ff0000");
	});

	it("the picker follows the moment it becomes valid", () => {
		const state = themeColorPickerWithHex(red, "#9a83ff", "#18181b");
		expect(themeColorPickerColor(state)).toBe("#9a83ff");
		expect(state.hsv.h).toBeCloseTo(251.13, 1);
	});

	/** Six digits without `#` are the same color. Normalization belongs to the draft rule alone. */
	it("typing without # gives the same color", () => {
		expect(
			themeColorPickerColor(themeColorPickerWithHex(red, "9a83ff", "#18181b")),
		).toBe("#9a83ff");
	});

	/** Clearing the field means `Use preset colors` (use the preset color). */
	it("clearing it returns to the preset color", () => {
		const state = themeColorPickerWithHex(red, "", "#fffaf2");
		expect(state.rawHex).toBe("");
		expect(themeColorPickerColor(state)).toBe("#fffaf2");
	});
});
