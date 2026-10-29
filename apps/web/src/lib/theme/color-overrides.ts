import {
	MANAGED_THEME_COLOR_NAMES,
	type ThemeColorOverrides,
} from "@rowcat/design";

/**
 * Applies the effective theme colors to the document. This is the only place that does so, using a
 * few inline custom properties.
 * - The stylesheet defaults (:root and .dark in tokens.css) are left untouched. Inline styles win
 *   over them, so clearing the overrides restores the exact product defaults. No default values are
 *   stored here.
 * - No CSS text is built from user input. Only known property names are written with setProperty,
 *   taken from MANAGED_THEME_COLOR_NAMES in the design package. Values are #rrggbb strings already
 *   resolved by that package's resolver.
 * - Clearing walks the whole managed list, not just what was applied last. Otherwise colors from
 *   an earlier apply survive. The same applies to account switches, so one user's colors never show
 *   for the next user.
 */

/**
 * Idempotent: safe to call when nothing is applied, so callers do not need to track whether
 * overrides are set.
 */
export function clearThemeColorOverrides(root: HTMLElement): void {
	for (const name of MANAGED_THEME_COLOR_NAMES)
		root.style.removeProperty(`--${name}`);
}

/**
 * Clears first, then applies. The order is required. Applying over the previous state would leave
 * properties that were set only by an earlier apply, for example a point color that was reverted,
 * or switching from an account that set colors to one that did not.
 */
export function applyThemeColorOverrides(
	root: HTMLElement,
	overrides: ThemeColorOverrides,
): void {
	clearThemeColorOverrides(root);
	for (const [name, value] of Object.entries(overrides))
		root.style.setProperty(`--${name}`, value);
}
