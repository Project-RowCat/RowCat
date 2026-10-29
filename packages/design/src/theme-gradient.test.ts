import { describe, expect, it } from "vitest";
import {
	DEFAULT_THEME_GRADIENT_ANGLE,
	defaultThemeGradient,
	isThemeGradientAngle,
	isThemeGradientReadable,
	normalizeThemeGradientAngle,
	readableForegroundAcross,
	resolveEffectiveThemeGradient,
	resolveEffectiveThemeOverrides,
	resolveThemeGradient,
	THEME_FOREGROUND_ON_DARK,
	THEME_FOREGROUND_ON_LIGHT,
	themeGradientContrast,
	themeGradientForeground,
	themeGradientStop,
	themeSurfaceScheme,
} from "./index.ts";

/**
 * Tests that the gradient layer stays presentational and does not contaminate semantic colors. Each
 * failure mode is silent on screen:
 * - A gradient is drawn with no first stop, producing invalid CSS.
 * - An image leaks into the semantic color table, so color readers become silently transparent.
 * - The foreground checks only the first stop, so half the screen becomes unreadable.
 * - The generated second stop leaves its lightness family, for example near-black to white.
 */

const DARK = "#10131a";
const LIGHT = "#f4f1ea";

describe("angle vocabulary", () => {
	it("accepts integers in `[0, 359]` only", () => {
		for (const ok of [0, 1, 135, 359])
			expect(isThemeGradientAngle(ok)).toBe(true);
		for (const bad of [
			-1,
			360,
			361,
			45.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
		])
			expect(isThemeGradientAngle(bad), String(bad)).toBe(false);
	});

	/**
	 * `360` is the same direction as `0`. If both were storable, a user who drags the slider to the
	 * end and back would see the save button enabled with no real change.
	 */
	it("the input boundary folds 360 to 0", () => {
		expect(normalizeThemeGradientAngle(360)).toBe(0);
		expect(normalizeThemeGradientAngle(720)).toBe(0);
		expect(normalizeThemeGradientAngle(-45)).toBe(315);
		expect(normalizeThemeGradientAngle(135.4)).toBe(135);
		expect(normalizeThemeGradientAngle(Number.NaN)).toBe(0);
	});
});

describe("resolution: invalid values fold quietly", () => {
	it("drawable when all three are valid", () => {
		expect(
			resolveThemeGradient({
				background: DARK,
				gradient: { to: "#4a1f5e", angle: 135 },
			}),
		).toEqual({ from: DARK, to: "#4a1f5e", angle: 135 });
	});

	/**
	 * Without a first stop there is nothing to draw, so a gradient without a background resolves to
	 * null. This is the most important branch in this file.
	 */
	it("a gradient without a background is null", () => {
		expect(
			resolveThemeGradient({ gradient: { to: "#4a1f5e", angle: 135 } }),
		).toBeNull();
		expect(
			resolveThemeGradient({
				background: "not-a-color",
				gradient: { to: "#4a1f5e", angle: 135 },
			}),
		).toBeNull();
	});

	it("a malformed stop color or out-of-range angle is null", () => {
		for (const to of ["", "#fff", "red", "linear-gradient(1deg,#000,#fff)"])
			expect(
				resolveThemeGradient({ background: DARK, gradient: { to, angle: 90 } }),
				to,
			).toBeNull();

		for (const angle of [-1, 360, 12.5])
			expect(
				resolveThemeGradient({
					background: DARK,
					gradient: { to: "#4a1f5e", angle },
				}),
				String(angle),
			).toBeNull();
	});

	/**
	 * Angles are not clamped. Leniency would let out-of-range rows look valid, and they would never be
	 * fixed.
	 */
	it("does not wrap an out-of-range angle", () => {
		expect(
			resolveThemeGradient({
				background: DARK,
				gradient: { to: "#4a1f5e", angle: 370 },
			}),
		).toBeNull();
	});

	it("null without a gradient", () => {
		expect(resolveThemeGradient({ background: DARK })).toBeNull();
		expect(resolveThemeGradient(null)).toBeNull();
		expect(resolveThemeGradient(undefined)).toBeNull();
	});

	/**
	 * Uppercase and whitespace fold the same way the color resolver folds them, so the stored value
	 * has one canonical form.
	 */
	it("folds uppercase to lowercase", () => {
		expect(
			resolveThemeGradient({
				background: " #10131A ",
				gradient: { to: "#4A1F5E", angle: 0 },
			}),
		).toEqual({ from: DARK, to: "#4a1f5e", angle: 0 });
	});
});

describe("text color over both stops", () => {
	/**
	 * Only two candidates. Inventing a third color would make the foreground unlike the one used
	 * elsewhere.
	 */
	it("does not add candidates", () => {
		for (const surfaces of [[DARK, "#4a1f5e"], [LIGHT, "#ffe9c7"], []])
			expect([THEME_FOREGROUND_ON_DARK, THEME_FOREGROUND_ON_LIGHT]).toContain(
				readableForegroundAcross(surfaces),
			);
	});

	/**
	 * The foreground must be chosen against the worst end, not the first. If only the first end is
	 * checked, white text vanishes on the other half of the screen.
	 */
	it("switches to dark text when a light stop is mixed in", () => {
		expect(readableForegroundAcross([DARK])).toBe(THEME_FOREGROUND_ON_DARK);
		expect(readableForegroundAcross([DARK, "#ffffff"])).toBe(
			THEME_FOREGROUND_ON_LIGHT,
		);
	});

	it("the gradient's text color passes the same rule", () => {
		const gradient = { from: DARK, to: "#4a1f5e", angle: 135 };
		expect(themeGradientForeground(gradient)).toBe(
			readableForegroundAcross([gradient.from, gradient.to]),
		);
		expect(themeGradientContrast(gradient)).toBeGreaterThan(4.5);
		expect(isThemeGradientReadable(gradient)).toBe(true);
	});

	/**
	 * An extreme pair such as black to white is flagged as unreadable, not rejected as invalid. The
	 * value itself reports the readability problem.
	 */
	it("says a black-to-white gradient is unreadable", () => {
		expect(
			isThemeGradientReadable({ from: "#000000", to: "#ffffff", angle: 90 }),
		).toBe(false);
	});
});

describe("making the second stop: stays in the same lightness family", () => {
	it("keeps the family on dark and light floors", () => {
		for (const from of [DARK, LIGHT, "#000000", "#ffffff", "#7f7f7f"]) {
			const to = themeGradientStop(from, {
				hueShift: 40,
				lightnessShift: 0.05,
				chromaBoost: 0.04,
			});
			expect(to, from).not.toBeNull();
			expect(themeSurfaceScheme(to as string), from).toBe(
				themeSurfaceScheme(from),
			);
		}
	});

	it("invents nothing for a malformed first stop", () => {
		expect(
			themeGradientStop("nope", {
				hueShift: 1,
				lightnessShift: 0,
				chromaBoost: 0,
			}),
		).toBeNull();
		expect(defaultThemeGradient("nope")).toBeNull();
	});

	/**
	 * The default is deterministic. A random default would change on every toggle, so the user could
	 * not tell what they were reverting.
	 */
	it("the initial value is always the same for the same background", () => {
		const first = defaultThemeGradient(DARK);
		expect(first).toEqual(defaultThemeGradient(DARK));
		expect(first?.angle).toBe(DEFAULT_THEME_GRADIENT_ANGLE);
		expect(first?.to).not.toBe(DARK);

		expect(
			resolveThemeGradient({ background: DARK, gradient: first ?? undefined }),
		).not.toBeNull();
	});
});

describe("effective: gradient and color table", () => {
	const selection = () => ({
		preset: "default" as const,
		customization: {
			background: DARK,
			gradient: { to: "#4a1f5e", angle: 135 },
		},
	});

	it("the stored gradient is drawn", () => {
		expect(resolveEffectiveThemeGradient(selection())).toEqual({
			from: DARK,
			to: "#4a1f5e",
			angle: 135,
		});
	});

	/**
	 * Checks that every color-table value is an opaque hex by shape rather than by a list of names, so
	 * a newly added token is covered automatically.
	 */
	it("every value in the color table is opaque hex", () => {
		const overrides = resolveEffectiveThemeOverrides(selection());
		expect(Object.keys(overrides).length).toBeGreaterThan(0);
		for (const [name, value] of Object.entries(overrides))
			expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
	});

	/**
	 * `background` stays a single color as the reference, because platform chrome and mobile read it.
	 */
	it("the background token is still the first stop's solid color", () => {
		expect(resolveEffectiveThemeOverrides(selection()).background).toBe(DARK);
	});

	/**
	 * Only the foreground looks at both stops. When a light stop is present, the value must differ
	 * from the one computed from the first stop alone. That difference is the evidence that the rule
	 * runs.
	 */
	it("the foreground looks at both stops", () => {
		const split = resolveEffectiveThemeOverrides({
			preset: "default",
			customization: {
				background: DARK,
				gradient: { to: "#ffffff", angle: 90 },
			},
		});
		expect(split.background).toBe(DARK);
		expect(split.foreground).toBe(THEME_FOREGROUND_ON_LIGHT);

		const solid = resolveEffectiveThemeOverrides({
			preset: "default",
			customization: { background: DARK },
		});
		expect(solid.foreground).toBe(THEME_FOREGROUND_ON_DARK);
	});

	/**
	 * A gradient that cannot be drawn leaves the foreground unchanged too. It stays the value computed
	 * from the first stop alone.
	 */
	it("a gradient without a background does not change the foreground", () => {
		const overrides = resolveEffectiveThemeOverrides({
			preset: "black",
			customization: { gradient: { to: "#ffffff", angle: 90 } },
		});
		expect(overrides.foreground).toBe(
			resolveEffectiveThemeOverrides({
				preset: "black",
				customization: {},
			}).foreground,
		);
	});
});
