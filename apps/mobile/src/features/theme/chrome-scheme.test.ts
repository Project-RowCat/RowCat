import {
	type EffectiveThemeSelection,
	resolveEffectiveThemeOverrides,
	resolveThemePresetOverrides,
} from "@rowcat/design";
import { nativeColorsFor } from "@rowcat/design/native";
import { describe, expect, it } from "vitest";
import { statusBarStyleForBackground } from "./chrome-scheme.ts";

/**
 * Status bar: **follows the effective background, not the device appearance.**
 *
 * The failure this file guards against lies outside the screen, which makes it silent: a black icon
 * on a black background raises no error, it is simply invisible. The old wiring read `scheme`
 * (device appearance), and the two diverged the moment an account preset covered the background.
 *
 * This app's tests do not render screens, so what is checked here is the **value path** that
 * `ThemedChrome` actually passes through:
 *
 * ```text
 * device appearance → base palette         nativeColorsFor(scheme)
 * account selection → effective override   resolveEffectiveThemeOverrides(selection)
 *                ↓ merge (overrides on top of the base palette)
 *          colors.background
 *                ↓
 *          statusBarStyleForBackground
 * ```
 */

/**
 * The **same value** that `ThemeColorOverrideProvider` passes down as `colors.background`.
 *
 * The merge is `{ ...base, ...overrides }`, so for the background slot this one line is the result.
 * The point is not to write preset color literals here (if the palette is refined, only this file
 * would go stale). Device appearance enters **only as an argument**: that the value does not decide
 * the answer is this group's claim.
 */
function effectiveBackground(
	scheme: "light" | "dark",
	selection: EffectiveThemeSelection,
): string {
	return (
		resolveEffectiveThemeOverrides(selection).background ??
		nativeColorsFor(scheme).background
	);
}

const preset = (
	name: "default" | "white" | "gray" | "black",
): EffectiveThemeSelection => ({
	preset: name,
	customization: null,
});

const withCustom = (
	name: "default" | "white" | "gray" | "black",
	background: string,
): EffectiveThemeSelection => ({
	preset: name,
	customization: { background },
});

describe("when the account doesn't override the background it follows the device appearance", () => {
	it("default preset · device light → dark icons", () => {
		expect(
			statusBarStyleForBackground(
				effectiveBackground("light", preset("default")),
			),
		).toBe("dark");
	});

	it("default preset · device dark → light icons", () => {
		expect(
			statusBarStyleForBackground(
				effectiveBackground("dark", preset("default")),
			),
		).toBe("light");
	});
});

describe("the preset beats the device appearance — icons follow the background", () => {
	/**
	 * This is the bug's original form. While the decision read `scheme`, this combination produced **a
	 * black icon on a black background**.
	 */
	it("device light + black preset → light icons", () => {
		expect(
			statusBarStyleForBackground(
				effectiveBackground("light", preset("black")),
			),
		).toBe("light");
	});

	it("device dark + white preset → dark icons", () => {
		expect(
			statusBarStyleForBackground(effectiveBackground("dark", preset("white"))),
		).toBe("dark");
	});

	/** The gray preset must give **the same answer** regardless of device appearance. */
	it("the gray preset's answer doesn't waver with the device appearance", () => {
		expect(
			statusBarStyleForBackground(effectiveBackground("light", preset("gray"))),
		).toBe(
			statusBarStyleForBackground(effectiveBackground("dark", preset("gray"))),
		);
	});
});

describe("arbitrary backgrounds follow the same rule", () => {
	it("dark arbitrary background → light icons", () => {
		for (const scheme of ["light", "dark"] as const)
			expect(
				statusBarStyleForBackground(
					effectiveBackground(scheme, withCustom("default", "#101014")),
				),
				scheme,
			).toBe("light");
	});

	it("very light arbitrary background → dark icons", () => {
		for (const scheme of ["light", "dark"] as const)
			expect(
				statusBarStyleForBackground(
					effectiveBackground(scheme, withCustom("default", "#fffaf2")),
				),
				scheme,
			).toBe("dark");
	});

	/**
	 * **Follows the composition order, not the preset name.** An arbitrary color overrides the preset,
	 * so the answer for `black preset + white background` is a dark icon.
	 */
	it("black preset + white background → dark icons", () => {
		expect(
			statusBarStyleForBackground(
				effectiveBackground("light", withCustom("black", "#ffffff")),
			),
		).toBe("dark");
	});
});

describe("doesn't copy the preset palette", () => {
	it("the decision's inputs come from the design package", () => {
		expect(effectiveBackground("light", preset("black"))).toBe(
			resolveThemePresetOverrides("black").background,
		);
		expect(effectiveBackground("dark", preset("white"))).toBe(
			resolveThemePresetOverrides("white").background,
		);
	});
});
