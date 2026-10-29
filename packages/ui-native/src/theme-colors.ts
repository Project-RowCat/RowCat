import type { ThemeColorOverrides } from "@rowcat/design";
import {
	type ColorSchemeName,
	type NativeColors,
	withAlpha,
} from "@rowcat/design/native";

/**
 * Color table merge, a pure function that knows nothing about React.
 *
 * It lives here rather than in theme.tsx so it can be tested. This package's tests do not render
 * React (theme.test.ts calls only color-scheme.ts for the same reason), so a rule inside a
 * component could only be checked by hand. The failure is silent: without overrides, the reference
 * changes on each render and the whole tree re-renders; with overrides, alpha() alone falls back to
 * the default colors.
 */

/**
 * Layers overrides on top of the parent color table.
 *
 * With no overrides, returns the parent object itself. A new object would change the reference on
 * every call, re-rendering everything below this layer, and that cost would fall on people who
 * never chose a color.
 *
 * Does not mutate its inputs. The parent table is a shared object from the generator; editing it in
 * place would make one account's colors the default palette for the whole app.
 */
export function mergeThemeColors(
	base: NativeColors,
	overrides: ThemeColorOverrides | undefined,
): NativeColors {
	if (!overrides) return base;
	const keys = Object.keys(overrides);
	if (keys.length === 0) return base;
	return { ...base, ...overrides };
}

/**
 * Maps an appearance to the control's two surfaces. The rules and reasons are in the field comments
 * above.
 *
 * It is a function on purpose: if two providers each wrote the ternary, one would go stale, and the
 * mismatch would show only for people using an account theme.
 */
export function controlSurfacesFor(
	scheme: ColorSchemeName,
	colors: NativeColors,
): { fieldSurface: string; outlineSurface: string } {
	if (scheme === "dark") {
		const sunken = withAlpha(colors.input, 0.3);
		return { fieldSurface: sunken, outlineSurface: sunken };
	}
	return { fieldSurface: "transparent", outlineSurface: colors.background };
}
