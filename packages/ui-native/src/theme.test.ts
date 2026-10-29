import {
	nativeDarkColors,
	nativeLightColors,
	withAlpha,
} from "@rowcat/design/native";
import { describe, expect, it } from "vitest";
import { resolveColorScheme } from "./color-scheme.ts";
import { controlSurfacesFor, mergeThemeColors } from "./theme-colors.ts";

/**
 * Theme resolution. Pins as values that the user's preference and the actual appearance are
 * separate.
 *
 * A wrong result fails silently: a user who switched the OS to dark stays on light, or a light user
 * gets a dark screen. Either way it only shows on that person's device.
 */
describe("appearance resolution", () => {
	it("an explicit preference ignores the OS", () => {
		expect(resolveColorScheme("dark", "light")).toBe("dark");
		expect(resolveColorScheme("light", "dark")).toBe("light");
	});

	it("system follows the OS", () => {
		expect(resolveColorScheme("system", "dark")).toBe("dark");
		expect(resolveColorScheme("system", "light")).toBe("light");
	});

	/**
	 * `null` means the OS did not report an appearance; it does not mean dark. Folding it into dark
	 * would show a black screen on some light-mode devices, a case that was never checked.
	 */
	it("light when the OS says nothing, matching the web default", () => {
		expect(resolveColorScheme("system", null)).toBe("light");
		expect(resolveColorScheme("system", undefined)).toBe("light");
		/**
		 * Values React Native can actually return. The vocabulary belongs to the platform, so unknown
		 * values also arrive here (`unspecified` in this case).
		 */
		expect(resolveColorScheme("system", "unspecified")).toBe("light");
	});
});

describe("both themes share one vocabulary", () => {
	/**
	 * A color present in only one theme is undefined in the other, and React Native silently drops
	 * that style. It shows up as 'text invisible only in dark mode', not as an error. @rowcat/design
	 * checks the pairing at build time; this test checks it again where the tables are consumed.
	 */
	it("light and dark have the same key set", () => {
		expect(Object.keys(nativeLightColors).sort()).toEqual(
			Object.keys(nativeDarkColors).sort(),
		);
	});

	/** If both themes share a color, that token cannot express a theme at all. */
	it("background and text color differ between themes", () => {
		expect(nativeLightColors.background).not.toBe(nativeDarkColors.background);
		expect(nativeLightColors.foreground).not.toBe(nativeDarkColors.foreground);
	});
});

/**
 * Account override layer. The reference rule matters as much as the value rule.
 *
 * If it breaks, both symptoms are silent: users with no overrides (most users) get a new reference
 * on every render and the whole tree re-renders, or the merge mutates the parent table in place, so
 * one account's colors become the default palette for the whole app.
 */
describe("color table merging", () => {
	it("returns the parent object as is without overrides", () => {
		expect(mergeThemeColors(nativeLightColors, undefined)).toBe(
			nativeLightColors,
		);
		expect(mergeThemeColors(nativeLightColors, {})).toBe(nativeLightColors);
	});

	/**
	 * Override values borrow colors from the other theme. This package writes no color literals
	 * (boundaries.test.ts enforces that), so the test follows the same rule. Confirming an override
	 * only needs a value that differs from the parent's.
	 */
	it("overrides only what is given and keeps the rest", () => {
		const merged = mergeThemeColors(nativeDarkColors, {
			background: nativeLightColors.background,
			foreground: nativeLightColors.foreground,
		});

		expect(merged.background).toBe(nativeLightColors.background);
		expect(merged.foreground).toBe(nativeLightColors.foreground);
		/**
		 * Slots the account did not pick keep the parent's values. Semantic colors such as `destructive`
		 * belong to the product.
		 */
		expect(merged.card).toBe(nativeDarkColors.card);
		expect(merged.destructive).toBe(nativeDarkColors.destructive);
	});

	it("does not mutate the parent table in place", () => {
		const before = nativeLightColors.background;
		mergeThemeColors(nativeLightColors, {
			background: nativeDarkColors.background,
		});
		expect(nativeLightColors.background).toBe(before);
	});

	/**
	 * There is one account palette: chosen slots stay the same when the appearance changes, and only
	 * the unchosen slots vary.
	 *
	 * This is the key property of the single-palette model. When the OS switches from light to dark,
	 * the parent default table changes and the same override is layered on top unchanged. It can break
	 * in two silent ways: the override varies by appearance (a per-appearance model that was removed
	 * earlier comes back), or unchosen slots fail to follow the appearance.
	 */
	it("the same override is equal on both appearances; only unchosen cells differ", () => {
		const overrides = { background: nativeLightColors.primary };

		const onLight = mergeThemeColors(nativeLightColors, overrides);
		const onDark = mergeThemeColors(nativeDarkColors, overrides);

		expect(onLight.background).toBe(overrides.background);
		expect(onDark.background).toBe(overrides.background);

		expect(onLight.card).toBe(nativeLightColors.card);
		expect(onDark.card).toBe(nativeDarkColors.card);
		expect(onLight.card).not.toBe(onDark.card);
	});
});

/**
 * Control surfaces differ by appearance. These values were measured in the browser for each
 * appearance (docs/design/VISUAL-PARITY.md):
 * - input and SelectTrigger: light transparent, dark input/30
 * - Button outline background: light opaque (background), dark input/30
 *
 * The test guards the shape of that table. Native once used input/30 in both appearances, which
 * drew a gray box in light mode where the web has none. Reading the source does not reveal the
 * mismatch, because the token is named input in both cases.
 */
describe("control surfaces", () => {
	it("in light, fields are translucent and outlines opaque", () => {
		const light = controlSurfacesFor("light", nativeLightColors);
		expect(light.fieldSurface).toBe("transparent");
		expect(light.outlineSurface).toBe(nativeLightColors.background);
	});

	it("in dark, both lay `input` at 30%", () => {
		const dark = controlSurfacesFor("dark", nativeDarkColors);
		expect(dark.fieldSurface).toBe(dark.outlineSurface);
		/**
		 * Checks both the 30% alpha and the source token. If only one of the two holds, the color is
		 * still wrong.
		 */
		expect(dark.fieldSurface).toContain("0.3");
		expect(dark.fieldSurface).toBe(withAlpha(nativeDarkColors.input, 0.3));
	});

	/**
	 * The two appearances must actually differ. The checks above could each pass while the values end
	 * up equal (for example, if transparent were written for both). That equality is the exact
	 * mismatch this change fixed.
	 */
	it("field surfaces differ per appearance", () => {
		expect(
			controlSurfacesFor("light", nativeLightColors).fieldSurface,
		).not.toBe(controlSurfacesFor("dark", nativeDarkColors).fieldSurface);
	});

	it("built from the account-overridden color table", () => {
		const overridden = mergeThemeColors(nativeDarkColors, {
			input: nativeDarkColors.primary,
		});
		expect(controlSurfacesFor("dark", overridden).fieldSurface).toBe(
			withAlpha(nativeDarkColors.primary, 0.3),
		);
	});
});
