import { describe, expect, it } from "vitest";
import {
	contrastRatio,
	isThemeColorHex,
	MANAGED_THEME_COLOR_NAMES,
	readableForegroundOn,
	resolveThemeColorOverrides,
	WCAG_AA_CONTRAST,
} from "./theme-customization.ts";
import { resolveEffectiveThemeOverrides } from "./theme-effective.ts";
import {
	DEFAULT_THEME_PRESET,
	isThemePreset,
	resolveThemePresetOverrides,
	THEME_PRESETS,
	type ThemePreset,
} from "./theme-preset.ts";
import { nativeLightColors } from "./tokens.native.ts";

/**
 * Rules for presets and their composition: the text stays readable, the presets stay distinct, and
 * precedence stays correct.
 *
 * Four failures this file guards against. Neither the type checker nor rendering catches any of
 * them:
 * - A preset paints only half the palette, e.g. a dark background with light borders. It
 *   compiles, but the light theme looks broken.
 * - Text is hand-paired with its surfaces. One wrong row makes text disappear only for users who
 *   chose that preset.
 * - A preset overrides custom colors. Paid features then get blocked by a free choice, and users
 *   cannot tell why their color is not showing.
 * - Semantic colors leak in. A black preset that paints `destructive` neutral gray makes `Delete account`
 *   look like an ordinary button.
 */

const EXPLICIT: ThemePreset[] = ["white", "gray", "black"];

describe("the vocabulary is closed", () => {
	it("there are four presets", () => {
		expect([...THEME_PRESETS]).toEqual(["default", "white", "gray", "black"]);
	});

	it("the default is default", () => {
		expect(DEFAULT_THEME_PRESET).toBe("default");
	});

	/**
	 * Storage, URLs, and stale responses all pass through this check. An unknown value must never
	 * resolve to a preset.
	 */
	it("unknown values are not presets", () => {
		for (const good of THEME_PRESETS)
			expect(isThemePreset(good), good).toBe(true);
		for (const bad of [
			"dark",
			"light",
			"custom",
			"purple",
			"WHITE",
			"Black",
			"",
			null,
			undefined,
			42,
			{},
		])
			expect(isThemePreset(bad), String(bad)).toBe(false);
	});
});

describe("default is an empty table", () => {
	/**
	 * Not duplicating the default palette is the point. If it were copied, changing tokens.ts would
	 * leave `default` stuck on the old colors, and only people using the default preset would see the
	 * mismatch.
	 */
	it("overrides nothing", () => {
		expect(resolveThemePresetOverrides("default")).toEqual({});
	});

	/** Unknown and empty values land in the same result. Throwing would show the user a broken app. */
	it("unknown and empty give the same answer", () => {
		expect(resolveThemePresetOverrides(undefined)).toEqual({});
		expect(resolveThemePresetOverrides(null)).toEqual({});
		expect(
			resolveThemePresetOverrides("neon" as unknown as ThemePreset),
		).toEqual({});
	});
});

describe("the three presets really make a theme", () => {
	/**
	 * Never paint only the background. A half-painted preset still compiles and renders. The result is
	 * a white card and black text on a gray floor, a screen no one chose.
	 */
	it("covers surfaces, text, borders and emphasis together", () => {
		for (const preset of EXPLICIT) {
			const overrides = resolveThemePresetOverrides(preset);
			for (const required of [
				"background",
				"foreground",
				"card",
				"card-foreground",
				"popover",
				"popover-foreground",
				"secondary",
				"muted",
				"muted-foreground",
				"accent",
				"border",
				"input",
				"primary",
				"primary-foreground",
				"ring",
				"sidebar",
				"sidebar-foreground",
				"sidebar-primary",
				"sidebar-border",
			])
				expect(overrides, `${preset} — ${required}`).toHaveProperty(required);
		}
	});

	/** All values must be `#rrggbb`. React Native's color parser silently maps `oklch()` to `null`. */
	it("every value is opaque hex", () => {
		for (const preset of THEME_PRESETS)
			for (const [name, value] of Object.entries(
				resolveThemePresetOverrides(preset),
			))
				expect(isThemeColorHex(value), `${preset}.${name} = ${value}`).toBe(
					true,
				);
	});

	/**
	 * Do not paint names outside the managed list. Painting them would leave consumers unable to
	 * remove them.
	 */
	it("stays within the managed list", () => {
		for (const preset of THEME_PRESETS)
			for (const name of Object.keys(resolveThemePresetOverrides(preset)))
				expect(MANAGED_THEME_COLOR_NAMES, `${preset}.${name}`).toContain(name);
	});

	it("all are real color names", () => {
		for (const preset of THEME_PRESETS)
			for (const name of Object.keys(resolveThemePresetOverrides(preset)))
				expect(nativeLightColors, `${preset}.${name}`).toHaveProperty(name);
	});
});

describe("presets do not touch semantic colors either", () => {
	/**
	 * If `destructive` were painted by taste, `Delete account` would look like an ordinary button. Charts are
	 * on the same axis: the person who picked a background did not pick the chart series colors.
	 */
	it("no preset has destructive or chart colors", () => {
		for (const preset of THEME_PRESETS) {
			const keys = Object.keys(resolveThemePresetOverrides(preset));
			for (const forbidden of [
				"destructive",
				"destructive-foreground",
				"chart-1",
				"chart-2",
				"chart-3",
				"chart-4",
				"chart-5",
			])
				expect(keys, `${preset} — ${forbidden}`).not.toContain(forbidden);
		}
	});

	/**
	 * The same holds for custom colors: no destructive color may leak through either layer, preset or
	 * custom.
	 */
	it("the composition has no destructive colors either", () => {
		for (const preset of THEME_PRESETS) {
			const keys = Object.keys(
				resolveEffectiveThemeOverrides({
					preset,
					customization: {
						background: "#10131a",
						surface: "#181c26",
						primary: "#9a83ff",
					},
				}),
			);
			expect(keys, preset).not.toContain("destructive");
			expect(keys, preset).not.toContain("destructive-foreground");
		}
	});
});

describe("the three are distinct", () => {
	/**
	 * If two presets share a background, their cards render identically and choosing between them
	 * means nothing.
	 */
	it("the backgrounds all differ", () => {
		const backgrounds = EXPLICIT.map(
			(preset) => resolveThemePresetOverrides(preset).background,
		);
		expect(new Set(backgrounds).size).toBe(EXPLICIT.length);
	});

	/**
	 * White is light, black is dark, gray is in between. The names must match the actual brightness.
	 */
	it("lightness order matches the names", () => {
		const on = (preset: ThemePreset) =>
			contrastRatio(
				resolveThemePresetOverrides(preset).background ?? "#ffffff",
				"#000000",
			);
		expect(on("white")).toBeGreaterThan(on("gray"));
		expect(on("gray")).toBeGreaterThan(on("black"));
	});
});

describe("surfaces and the text on them are readable", () => {
	/**
	 * Presets pair foreground colors by hand, so contrast math does not enforce them automatically.
	 * One wrong row hides text only for users who picked that preset.
	 */
	const PAIRS: [string, string][] = [
		["background", "foreground"],
		["card", "card-foreground"],
		["popover", "popover-foreground"],
		["secondary", "secondary-foreground"],
		["accent", "accent-foreground"],
		["muted", "muted-foreground"],
		["primary", "primary-foreground"],
		["sidebar", "sidebar-foreground"],
		["sidebar-primary", "sidebar-primary-foreground"],
		["sidebar-accent", "sidebar-accent-foreground"],
	];

	it("every surface/foreground pair passes AA", () => {
		for (const preset of EXPLICIT) {
			const overrides = resolveThemePresetOverrides(preset) as Record<
				string,
				string
			>;
			for (const [surface, foreground] of PAIRS) {
				const a = overrides[surface];
				const b = overrides[foreground];
				if (!a || !b) continue;
				expect(
					contrastRatio(a, b),
					`${preset}: ${surface}(${a}) ↔ ${foreground}(${b})`,
				).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
			}
		}
	});

	/**
	 * Cards must actually float above the floor. With the same value, the hierarchy disappears and the
	 * screen looks no different from before picking a preset.
	 */
	it("the surface differs from the floor", () => {
		for (const preset of EXPLICIT) {
			const overrides = resolveThemePresetOverrides(preset);
			expect(overrides.card, preset).not.toBe(overrides.background);
		}
	});
});

describe("does not export shared objects", () => {
	/**
	 * If one consumer edits the result in place, that preset's palette is corrupted across the whole
	 * process, and the symptom remains for every account rendered afterwards.
	 */
	it("a new object per call", () => {
		const a = resolveThemePresetOverrides("black");
		const b = resolveThemePresetOverrides("black");
		expect(a).not.toBe(b);
		expect(a).toEqual(b);

		a.background = "#ff0000";
		expect(resolveThemePresetOverrides("black").background).not.toBe("#ff0000");
	});
});

describe("composition order is priority", () => {
	const CUSTOM = { primary: "#ff4f9a" };

	/** Custom colors override the preset. That is the intended precedence. */
	it("custom colors layer over the preset", () => {
		const overrides = resolveEffectiveThemeOverrides({
			preset: "black",
			customization: CUSTOM,
		});
		expect(overrides.primary).toBe("#ff4f9a");
		expect(overrides["primary-foreground"]).toBe(
			readableForegroundOn("#ff4f9a"),
		);
		expect(overrides.background).toBe(
			resolveThemePresetOverrides("black").background,
		);
		expect(overrides.border).toBe(resolveThemePresetOverrides("black").border);
	});

	it("default preset + custom colors = custom colors only", () => {
		expect(
			resolveEffectiveThemeOverrides({
				preset: "default",
				customization: CUSTOM,
			}),
		).toEqual(resolveThemeColorOverrides(CUSTOM));
	});

	/**
	 * With neither set, the result is an empty table, and the screen is exactly RowCat's default look.
	 */
	it("nothing gives an empty table", () => {
		expect(
			resolveEffectiveThemeOverrides({
				preset: "default",
				customization: {},
			}),
		).toEqual({});
	});

	it("the composition stays within the managed list", () => {
		for (const preset of THEME_PRESETS)
			for (const name of Object.keys(
				resolveEffectiveThemeOverrides({
					preset,
					customization: {
						background: "#10131a",
						surface: "#181c26",
						primary: "#9a83ff",
					},
				}),
			))
				expect(MANAGED_THEME_COLOR_NAMES, `${preset}.${name}`).toContain(name);
	});
});
