import { type ThemeColorOverrides, themeSurfaceScheme } from "@rowcat/design";

/**
 * - style.colorScheme is the single owner of documentElement.style.colorScheme. The root
 *   .light/.dark class answers 'which token palette applies' and the account theme does not touch
 *   it; style.colorScheme answers 'is the page floor light or dark', which drives scrollbars,
 *   default form controls, and the caret.
 * - Before presets the two always matched, so ThemeProvider set both in one line. A preset that
 *   covers the background breaks that: a light device with a black preset gives a near-black page
 *   with light scrollbars.
 * - The class is not changed to fix this. Adding 'dark' to classList would also swap the other
 *   semantic tokens the preset does not cover (muted, border, destructive, charts), merging two
 *   independent axes.
 * - Writes are centralized because two callers want to write (ThemeProvider for the default,
 *   AccountThemeBridge for the account). Whichever effect runs last wins: the bridge runs first on
 *   mount, but on an OS appearance change only the provider re-renders and would overwrite the
 *   account background. Each caller reports only its own axis, and one line computes the final
 *   value.
 * - Device appearance is not stored as module state. The record already lives in the root class
 *   (set by the pre-hydration script, maintained by the provider, untouched by the account theme).
 *   A copy would need an initial value, and its initial 'light' would flash a dark browser's first
 *   frame to light on the mount where the account bridge runs first.
 */

export type ThemeChromeScheme = "light" | "dark";

/**
 * Final judgment, and pure. An account that covers the background derives the chrome from it,
 * whatever the preset or custom color; otherwise the chrome follows device appearance, including
 * the 'default' preset, accent-only accounts, and guests. It deliberately ignores the preset name
 * and takes the already-composed override table, so 'black preset plus an active white background'
 * comes out light without a second precedence rule that could diverge.
 */
export function resolveThemeChromeScheme(
	base: ThemeChromeScheme,
	overrides: ThemeColorOverrides,
): ThemeChromeScheme {
	const background = overrides.background;
	return background === undefined ? base : themeSurfaceScheme(background);
}

/**
 * Reads the device and default appearance from the root class, not from style.colorScheme. The
 * latter is the value this module writes, so reading it back would treat the account background as
 * the default, and the chrome would not return once the account color was removed.
 */
export function baseThemeChromeScheme(root: HTMLElement): ThemeChromeScheme {
	return root.classList.contains("dark") ? "dark" : "light";
}

/**
 * Module-level state, used only in the browser; every writer takes root as an argument. It must
 * exist because a device appearance change reruns only the provider, which has no account
 * information, and the account background would otherwise be lost.
 */
let accountOverrides: ThemeColorOverrides = {};

const commit = (root: HTMLElement): void => {
	root.style.colorScheme = resolveThemeChromeScheme(
		baseThemeChromeScheme(root),
		accountOverrides,
	);
};

/**
 * Called when the device or default appearance changes, after the class is set. The order is the
 * rule: called earlier, this reads the old class and the toggle lands one frame late.
 */
export function syncThemeChromeScheme(root: HTMLElement): void {
	commit(root);
}

/**
 * Takes the same table as applyThemeColorOverrides on purpose. Extracting the background separately
 * would create a second composition rule, and combinations like 'black preset plus an active white
 * background' could then paint colors and chrome that disagree.
 */
export function applyAccountChromeScheme(
	root: HTMLElement,
	overrides: ThemeColorOverrides,
): void {
	accountOverrides = overrides;
	commit(root);
}

/**
 * Clears the account axis, so the chrome returns to device appearance. The colorScheme property
 * itself is never removed (no removeProperty), since that would also erase the value set by the
 * pre-hydration script and leave a logged-out dark browser with a light scrollbar.
 */
export function clearAccountChromeScheme(root: HTMLElement): void {
	accountOverrides = {};
	commit(root);
}
