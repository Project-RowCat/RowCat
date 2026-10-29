import { describe, expect, it } from "vitest";
import { hexToOklab, mixOklab, oklabToHex, shiftLightness } from "./oklab.ts";
import { oklchToHex } from "./oklch.ts";
import { relativeLuminance } from "./theme-customization.ts";
import { darkColors, lightColors } from "./tokens.ts";

/**
 * Perceptual color space conversion. Tests two claims: that there is a single matrix, and that the
 * lightness scale actually moves perceived brightness.
 *
 * The failures are silent. A wrong conversion drifts derived colors into another hue (purple
 * borders on a blue surface). A broken round trip makes the relationship between a chosen color and
 * the surfaces derived from it impossible to explain.
 */

describe("round-tripping preserves color", () => {
	/**
	 * Round trips within one rounding step, not exactly, because the output is encoded as integers
	 * 0-255.
	 */
	it("hex → OKLab → hex is itself", () => {
		for (const hex of [
			"#000000",
			"#ffffff",
			"#16324f",
			"#7957ff",
			"#ffd400",
			"#0b3d2e",
			"#f4f4f5",
			"#27272a",
		]) {
			const lab = hexToOklab(hex);
			expect(lab, hex).not.toBeNull();
			expect(oklabToHex(lab as NonNullable<typeof lab>), hex).toBe(hex);
		}
	});

	/** Also runs over a grid, to rule out a conversion that only holds for particular colors. */
	it("round-trips across the whole grid", () => {
		for (let r = 0; r < 256; r += 51)
			for (let g = 0; g < 256; g += 51)
				for (let b = 0; b < 256; b += 51) {
					const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
					const lab = hexToOklab(hex);
					expect(oklabToHex(lab as NonNullable<typeof lab>), hex).toBe(hex);
				}
	});

	/** Non-hex values return null. Nothing is invented and nothing throws. */
	it("malformed values are null", () => {
		for (const bad of ["red", "#fff", "#12345678", "rgb(1,2,3)", "", "  "])
			expect(hexToOklab(bad), bad).toBeNull();
	});
});

describe("there is one set of matrices", () => {
	it("generated tokens pass the same conversion", () => {
		for (const token of [
			...Object.values(lightColors),
			...Object.values(darkColors),
		]) {
			const hex = oklchToHex(token);
			const lab = hexToOklab(hex);
			expect(lab, token).not.toBeNull();
			expect(oklabToHex(lab as NonNullable<typeof lab>), token).toBe(hex);
		}
	});
});

describe("the lightness step moves only lightness", () => {
	it("positive lightens, negative darkens", () => {
		for (const hex of ["#16324f", "#f4f4f5", "#7957ff"]) {
			expect(relativeLuminance(shiftLightness(hex, 0.08)), hex).toBeGreaterThan(
				relativeLuminance(hex),
			);
			expect(relativeLuminance(shiftLightness(hex, -0.08)), hex).toBeLessThan(
				relativeLuminance(hex),
			);
		}
	});

	/**
	 * Hue and chroma are preserved. RGB channel arithmetic breaks here in practice: when one channel
	 * hits the ceiling first, the hue shifts.
	 */
	it("the hue does not shift", () => {
		const source = hexToOklab("#16324f") as NonNullable<
			ReturnType<typeof hexToOklab>
		>;
		for (const delta of [0.06, 0.115, -0.06]) {
			const moved = hexToOklab(shiftLightness("#16324f", delta)) as NonNullable<
				ReturnType<typeof hexToOklab>
			>;
			expect(moved.a, `${delta}`).toBeCloseTo(source.a, 2);
			expect(moved.b, `${delta}`).toBeCloseTo(source.b, 2);
		}
	});

	/** Clamps at the extremes: no throw, and no output outside the gamut. */
	it("clamps at the extremes", () => {
		expect(shiftLightness("#ffffff", 0.5)).toBe("#ffffff");
		expect(shiftLightness("#000000", -0.5)).toBe("#000000");
		expect(shiftLightness("nope", 0.1)).toBe("nope");
	});
});

describe("interpolation happens in perceptual space", () => {
	it("both ends are themselves", () => {
		expect(mixOklab("#000000", "#ffffff", 0)).toBe("#000000");
		expect(mixOklab("#000000", "#ffffff", 1)).toBe("#ffffff");
	});

	/**
	 * The midpoint is perceptually midway: the mixed color's L is exactly halfway between the
	 * endpoints. Interpolating gamma-encoded sRGB channels breaks this; the byte midpoint #808080 has
	 * an L near 0.6. That bias makes faint text darker than intended, and it varies with the surface.
	 */
	it("the midpoint's perceptual lightness is exactly halfway", () => {
		const mid = hexToOklab(mixOklab("#000000", "#ffffff", 0.5)) as NonNullable<
			ReturnType<typeof hexToOklab>
		>;
		expect(mid.L).toBeCloseTo(0.5, 2);

		const byteMid = hexToOklab("#808080") as NonNullable<
			ReturnType<typeof hexToOklab>
		>;
		expect(byteMid.L).toBeGreaterThan(0.55);
	});

	it("the ratio clamps and malformed values return as is", () => {
		expect(mixOklab("#000000", "#ffffff", -1)).toBe("#000000");
		expect(mixOklab("#000000", "#ffffff", 2)).toBe("#ffffff");
		expect(mixOklab("nope", "#ffffff", 0.5)).toBe("nope");
	});
});
