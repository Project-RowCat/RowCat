/**
 * Resolves preset and custom colors into one effective override set, so web and mobile cannot
 * disagree on precedence.
 * - Precedence, lowest to highest: RowCat default tokens (device appearance), the preset, then
 *   the account's custom colors. Custom colors win on purpose: a black preset with a pink accent
 *   shows pink.
 * - Two outputs stay separate: the opaque color table, and the background gradient. The gradient
 *   is an image, so merging it into `--background` would silently break every consumer that reads
 *   the token as a color.
 * - The former third layer depended on paid-tier eligibility. That parameter was removed when
 *   billing was stripped from the public edition (docs/oss/PLAN.md §3).
 */

import {
	readableForegroundAcross,
	resolveThemeColorOverrides,
	type ThemeColorOverrides,
	type ThemeCustomization,
} from "./theme-customization.ts";
import {
	type ResolvedThemeGradient,
	resolveThemeGradient,
} from "./theme-gradient.ts";
import {
	resolveThemePresetOverrides,
	type ThemePreset,
} from "./theme-preset.ts";

export interface EffectiveThemeSelection {
	preset: ThemePreset | undefined | null;
	customization: ThemeCustomization | undefined | null;
}

/**
 * An empty result means the screen is exactly the RowCat defaults. The layer stores no previous
 * values, so reverting (expired subscription, logout, failed lookup) needs no restore step.
 */
export function resolveEffectiveThemeOverrides(
	selection: EffectiveThemeSelection,
): ThemeColorOverrides {
	const { preset, customization } = selection;

	const overrides: ThemeColorOverrides = {
		...resolveThemePresetOverrides(preset),
		...resolveThemeColorOverrides(customization),
	};

	/**
	 * When a gradient is present, only the foreground looks at both stops. `background` stays the
	 * single-color reference, because the semantic token and the platform chrome classification read
	 * it. The foreground is the only value that changes: a foreground chosen from the first stop alone
	 * vanishes on the half of the screen where the other stop is lighter, such as dark navy to light
	 * apricot.
	 */
	const gradient = resolveEffectiveThemeGradient(selection);
	if (gradient)
		overrides.foreground = readableForegroundAcross([
			gradient.from,
			gradient.to,
		]);

	return overrides;
}

/**
 * The background gradient to paint right now, or null. Kept apart from the color table because this
 * is a presentation value, not a semantic token. Merging it into `--background` would let image
 * values reach cards, popovers and the status bar.
 */
export function resolveEffectiveThemeGradient({
	customization,
}: EffectiveThemeSelection): ResolvedThemeGradient | null {
	return resolveThemeGradient(customization);
}
