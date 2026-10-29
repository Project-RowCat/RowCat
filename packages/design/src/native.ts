/**
 * Native consumption point: the native color projection and the opacity helper.
 *
 * - Spacing, type, radius and motion are platform-neutral and used as they are. Only colors
 *   change shape, and the generator already produces that shape (tokens.native.ts). This file only
 *   picks a theme and applies opacity.
 * - A separate entry point (@rowcat/design/native), not part of index.ts. Web has no reason to
 *   read the native palette, and merging would ship an extra color table in the web bundle.
 *   Tree-shaking could remove it, but not including it at all is different.
 * - No components or React here. Providers and hooks live in @rowcat/ui-native.
 */

import { nativeDarkColors, nativeLightColors } from "./tokens.native.ts";
import type { ColorName } from "./tokens.ts";

export { nativeDarkColors, nativeLightColors };

/** The resolved appearance. 'system' never reaches here: it is a preference, not an appearance. */
export type ColorSchemeName = "light" | "dark";

export type NativeColors = Record<ColorName, string>;

/**
 * Exists so that screens do not each write the scheme ternary. If that ternary spread, adding
 * another appearance (for example high contrast) would mean finding every copy.
 */
export const nativeColorsFor = (scheme: ColorSchemeName): NativeColors =>
	scheme === "dark" ? nativeDarkColors : nativeLightColors;

/**
 * Applies opacity to a color: the native counterpart of web's slash syntax (bg-destructive/10).
 * Using the style opacity instead would fade children too, which is a different result. Crisp red
 * text on a faint red surface is the point of this.
 *
 * Output is rgba() because RN 0.86 reads 8-digit hex, but rgba() works on every supported runtime.
 * Input is always the #rrggbb our generator writes, so an unknown shape throws. Returning it
 * silently would paint an opaque surface and hide the text on it.
 */
export function withAlpha(hex: string, alpha: number): string {
	const match = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!match) throw new Error(`not a #rrggbb color: ${hex}`);
	const value = Number.parseInt(match[1], 16);
	const red = (value >> 16) & 0xff;
	const green = (value >> 8) & 0xff;
	const blue = value & 0xff;
	const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
	return `rgba(${red}, ${green}, ${blue}, ${clamped})`;
}
