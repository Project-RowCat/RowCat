import { describe, expect, it } from "vitest";
import {
	clampHue,
	clampUnit,
	type HsvColor,
	hexToHsv,
	hexToRgb,
	hsvToHex,
	hsvToRgb,
	normalizeHue,
	preserveHue,
	rgbToHex,
	rgbToHsv,
} from "./theme-customization-color.ts";

/**
 * Color conversion values. The axes the picker shows must match the stored string. Failures here
 * are silent: a one-digit rounding error changes the color slightly, and the user notices only by
 * comparing the picked and saved colors. The round trip (`#rrggbb` to axes and back) is the center
 * of this file.
 */

const hsv = (h: number, s: number, v: number): HsvColor => ({ h, s, v });

describe("hex ↔ channels", () => {
	it("reads six digits", () => {
		expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
		expect(hexToRgb("#9a83ff")).toEqual({ r: 154, g: 131, b: 255 });
	});

	/**
	 * Values outside the contract shape return null. Three-digit and eight-digit hex, and color names,
	 * are not guessed.
	 */
	it("null when not the contract's shape", () => {
		for (const value of ["#fff", "#ff0000ff", "rgb(255,0,0)", "red", "", "#"])
			expect(hexToRgb(value), value).toBeNull();
	});

	/** Uppercase input is read, but output is always lowercase (one shape of the contract). */
	it("reads uppercase and writes lowercase", () => {
		expect(hexToRgb("#9A83FF")).toEqual({ r: 154, g: 131, b: 255 });
		expect(rgbToHex({ r: 154, g: 131, b: 255 })).toBe("#9a83ff");
	});

	it("pads single-digit channels with 0", () => {
		expect(rgbToHex({ r: 0, g: 10, b: 255 })).toBe("#000aff");
	});

	/** Channels outside 0-255 are clamped, so the output is never a string with extra digits. */
	it("clamps channels to 0..255", () => {
		expect(rgbToHex({ r: -20, g: 300, b: 128 })).toBe("#00ff80");
	});
});

describe("channels ↔ axes", () => {
	it("the three primaries", () => {
		expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual(hsv(0, 1, 1));
		expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual(hsv(120, 1, 1));
		expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual(hsv(240, 1, 1));
	});

	it("white, black, gray", () => {
		expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual(hsv(0, 0, 1));
		expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual(hsv(0, 0, 0));

		const gray = rgbToHsv({ r: 128, g: 128, b: 128 });
		expect(gray.h).toBe(0);
		expect(gray.s).toBe(0);
		expect(gray.v).toBeCloseTo(128 / 255, 10);
	});

	/**
	 * Colors with no hue return 0, and that 0 is not red. This is why `preserveHue` exists: state must
	 * not treat it as a real hue.
	 */
	it("an achromatic color's hue is 0", () => {
		expect(hexToHsv("#808080")?.h).toBe(0);
		expect(hexToHsv("#000000")?.h).toBe(0);
	});

	it("one arbitrary color", () => {
		const value = hexToHsv("#9a83ff");
		expect(value).not.toBeNull();
		expect(value?.h).toBeCloseTo(251.13, 1);
		expect(value?.s).toBeCloseTo(0.4863, 3);
		expect(value?.v).toBeCloseTo(1, 6);
	});
});

describe("round trip: hex is stable", () => {
	/**
	 * A color that passes through the axes must come back as the same string. Otherwise opening and
	 * closing the popover alone would enable the Save button, and users would save a value they did
	 * not change.
	 */
	it("representative colors come back unchanged", () => {
		for (const hex of [
			"#ff0000",
			"#00ff00",
			"#0000ff",
			"#ffffff",
			"#000000",
			"#808080",
			"#9a83ff",
			"#fffaf2",
			"#18181b",
			"#0a0a0a",
			"#00ffff",
			"#ff00ff",
			"#ffff00",
			"#123456",
			"#7f7f80",
		]) {
			const axes = hexToHsv(hex);
			expect(axes, hex).not.toBeNull();
			expect(hsvToHex(axes as HsvColor), hex).toBe(hex);
		}
	});

	/** Records that the test is not a narrow sample: it walks all 256 gray levels. */
	it("all 256 steps of the gray axis come back", () => {
		for (let level = 0; level < 256; level += 1) {
			const hex = rgbToHex({ r: level, g: level, b: level });
			expect(hsvToHex(hexToHsv(hex) as HsvColor), hex).toBe(hex);
		}
	});
});

describe("hue is a circle", () => {
	it("folds any degree into a half-open range", () => {
		expect(normalizeHue(0)).toBe(0);
		expect(normalizeHue(360)).toBe(0);
		expect(normalizeHue(450)).toBe(90);
		expect(normalizeHue(-90)).toBe(270);
		expect(normalizeHue(Number.NaN)).toBe(0);
	});

	/**
	 * 360 and 0 degrees are the same color. The slider places them at different positions (folding the
	 * right end to 0 would make the handle jump), but color creation must treat them as equal.
	 */
	it("the end and start give the same color", () => {
		expect(hsvToHex(hsv(360, 1, 1))).toBe(hsvToHex(hsv(0, 1, 1)));
		expect(hsvToRgb(hsv(360, 0.5, 0.5))).toEqual(hsvToRgb(hsv(0, 0.5, 0.5)));
	});

	it("the slider range clamps inclusive of the end", () => {
		expect(clampHue(-10)).toBe(0);
		expect(clampHue(400)).toBe(360);
		expect(clampHue(360)).toBe(360);
		expect(clampHue(Number.NaN)).toBe(0);
	});

	it("saturation and brightness clamp to 0..1", () => {
		expect(clampUnit(-1)).toBe(0);
		expect(clampUnit(2)).toBe(1);
		expect(clampUnit(Number.NaN)).toBe(0);
		expect(clampUnit(0.42)).toBe(0.42);
	});
});

describe("hue preservation", () => {
	/**
	 * At zero saturation (gray) or zero value (black), the color leaves no hue in its channels.
	 * Recomputing the hue there would turn a purple pick into red, a change the user did not make.
	 */
	it("the previous hue survives going achromatic", () => {
		expect(preserveHue(hsv(270, 0.6, 0.9), hsv(0, 0, 0.5)).h).toBe(270);
		expect(preserveHue(hsv(270, 0.6, 0.9), hsv(0, 0.8, 0)).h).toBe(270);
	});

	/** A color that has a real hue keeps it: an older value does not override a new one. */
	it("a chromatic color keeps its own hue", () => {
		expect(preserveHue(hsv(270, 0.6, 0.9), hsv(30, 0.5, 0.5)).h).toBe(30);
	});
});
