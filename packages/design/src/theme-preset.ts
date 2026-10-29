/**
 * Four fixed presets an account can pick: neutral palettes owned by RowCat.
 *
 * - Presets are trusted product code. The member sends one name, so the palettes can spell out
 *   semantic tokens by hand, including border, muted and secondary. Leaving those slots empty would
 *   mix light borders and muted surfaces into a black preset.
 * - Custom colors are untrusted input. They accept only the three slots in
 *   THEME_CUSTOMIZATION_SLOTS, and the other slots are derived from one surface color
 *   (surfaceFamily). Presets do not use that path. The two layers having the same breadth is not a
 *   reason to widen this table. No general semantic-token editor is built.
 * - `default` is an empty table. Copying the default palette here would pin `default` to old
 *   colors when tokens.ts changes, and only default users would see the drift.
 * - Semantic colors are not part of presets. `destructive` signals irreversibility rather than
 *   taste, and `chart-*` series colors are not implied by a background choice.
 * - Values are #rrggbb, not oklch(). Presets reach CSS custom properties and React Native's color
 *   parser, which turns unknown strings into null and silently drops the style. The values come
 *   from the zinc neutrals in tokens.native.ts.
 */

import type { ColorName } from "./tokens.ts";

/**
 * The four presets are a closed set, and all of them are free. Adding colors such as blue, red or
 * purple is out of scope. The neutral character is what makes custom colors the paid tier. Once a
 * free preset carries a chosen color, the paid tier can no longer say what it sells.
 */
export const THEME_PRESETS = ["default", "white", "gray", "black"] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

/**
 * Default for an account that has chosen nothing. It is both the storage default and the target of
 * a reset.
 */
export const DEFAULT_THEME_PRESET: ThemePreset = "default";

/**
 * Colors a preset overrides. Keys are always a subset of MANAGED_THEME_COLOR_NAMES in
 * theme-customization.ts, which tells consumers exactly which colors to clear.
 */
export type ThemePresetOverrides = Partial<Record<ColorName, string>>;

/**
 * Storage, URLs, and stale responses all pass through this guard. An unknown string must never be
 * treated as a preset.
 */
export const isThemePreset = (value: unknown): value is ThemePreset =>
	typeof value === "string" &&
	(THEME_PRESETS as readonly string[]).includes(value);

/**
 * Neutral family: the names here are taken directly from the values tokens.native.ts emits.
 *
 * The constants make the three palettes below share one scale. If each palette had its own
 * literals, near-identical hex values such as #27272a and #28282b could both pass as 'slightly
 * lighter black', and no one could tell which one is meant. This repo has already hit that with
 * mobile color literals.
 */
const ZINC = {
	50: "#fafafa",
	100: "#f4f4f5",
	200: "#e4e4e7",
	300: "#d4d4d8",
	400: "#9f9fa9",
	500: "#71717b",
	600: "#52525c",
	700: "#3f3f46",
	800: "#27272a",
	900: "#18181b",
	950: "#09090b",
	white: "#ffffff",
} as const;

/**
 * White: a nearly white floor with a fully white surface.
 *
 * It differs from the default light theme in two ways. The floor is one step below pure white
 * (#fafafa), so cards visibly float above it. The accent is neutral near-black, not brand purple.
 * That neutrality is the preset's defining trait: keeping purple would erase the reason to choose
 * it over the default, which is meant for people who want the color removed.
 */
const WHITE: ThemePresetOverrides = {
	background: ZINC[50],
	foreground: ZINC[950],

	card: ZINC.white,
	"card-foreground": ZINC[950],
	popover: ZINC.white,
	"popover-foreground": ZINC[950],

	secondary: ZINC[100],
	"secondary-foreground": ZINC[900],
	muted: ZINC[100],
	/*
	 * Darker by one step than the default light palette's `muted-foreground` (zinc-500). That value
	 * measures 4.39:1 on this surface, just short of AA. This preset writes the pair fresh, so there
	 * is no reason to copy the off value. ZINC[600] gives 7.02:1 for secondary text. The hue family is
	 * unchanged.
	 */
	"muted-foreground": ZINC[600],
	accent: ZINC[100],
	"accent-foreground": ZINC[900],

	border: ZINC[200],
	input: ZINC[200],

	primary: ZINC[900],
	"primary-foreground": ZINC[50],
	ring: ZINC[500],

	sidebar: ZINC.white,
	"sidebar-foreground": ZINC[950],
	"sidebar-primary": ZINC[900],
	"sidebar-primary-foreground": ZINC[50],
	"sidebar-accent": ZINC[100],
	"sidebar-accent-foreground": ZINC[900],
	"sidebar-border": ZINC[200],
	"sidebar-ring": ZINC[500],
};

/**
 * Gray: a medium-brightness charcoal with its own place between white and black, not a midpoint.
 *
 * Painting only `background` gray and leaving the rest light would be the fastest way to build
 * this, and it is deliberately not done. That gives a white card and black text on a gray floor,
 * which reads as a broken light theme. The preset has to look intentional, and that only works when
 * surface, border and muted move together.
 *
 * The surface (#52525c) is lighter than the floor (#3f3f46) on purpose. On a dark background,
 * hierarchy comes from raising brightness. Lowering it makes cards look like holes.
 */
const GRAY: ThemePresetOverrides = {
	background: ZINC[700],
	foreground: ZINC[50],

	card: ZINC[600],
	"card-foreground": ZINC[50],
	popover: ZINC[600],
	"popover-foreground": ZINC[50],

	secondary: ZINC[600],
	"secondary-foreground": ZINC[50],
	muted: ZINC[600],
	"muted-foreground": ZINC[300],
	accent: ZINC[600],
	"accent-foreground": ZINC[50],

	border: ZINC[600],
	input: ZINC[600],

	primary: ZINC[200],
	"primary-foreground": ZINC[900],
	ring: ZINC[400],

	sidebar: ZINC[800],
	"sidebar-foreground": ZINC[50],
	"sidebar-primary": ZINC[200],
	"sidebar-primary-foreground": ZINC[900],
	"sidebar-accent": ZINC[600],
	"sidebar-accent-foreground": ZINC[50],
	"sidebar-border": ZINC[600],
	"sidebar-ring": ZINC[400],
};

/**
 * Black: a near-black floor with the surface lifted one step above it (#18181b on #09090b).
 *
 * Like white, it differs from the default dark theme on the surface axis. The accent is neutral
 * white, not brand purple.
 *
 * The preset must look dark even when the device appearance is light. That is why this table covers
 * background, surface, foreground, border and muted. Only the slots left out (`destructive` and
 * `chart-*`) follow the device's base palette. Those are axes deliberately not handed to the
 * account.
 */
const BLACK: ThemePresetOverrides = {
	background: ZINC[950],
	foreground: ZINC[50],

	card: ZINC[900],
	"card-foreground": ZINC[50],
	popover: ZINC[900],
	"popover-foreground": ZINC[50],

	secondary: ZINC[800],
	"secondary-foreground": ZINC[50],
	muted: ZINC[800],
	"muted-foreground": ZINC[400],
	accent: ZINC[800],
	"accent-foreground": ZINC[50],

	border: ZINC[800],
	input: ZINC[800],

	primary: ZINC[50],
	"primary-foreground": ZINC[950],
	ring: ZINC[500],

	sidebar: ZINC[900],
	"sidebar-foreground": ZINC[50],
	"sidebar-primary": ZINC[50],
	"sidebar-primary-foreground": ZINC[950],
	"sidebar-accent": ZINC[800],
	"sidebar-accent-foreground": ZINC[50],
	"sidebar-border": ZINC[800],
	"sidebar-ring": ZINC[500],
};

/**
 * Typed as a `Record`, so adding a preset name without a palette fails compilation. Otherwise the
 * new name would be accepted, and selecting it would do nothing.
 */
const PRESET_OVERRIDES: Record<ThemePreset, ThemePresetOverrides> = {
	default: {},
	white: WHITE,
	gray: GRAY,
	black: BLACK,
};

/**
 * Always returns a new object. Returning the module-level constants would let a consumer that calls
 * `Object.assign(overrides, custom)` corrupt that preset's palette for the whole process, and the
 * damage would persist for every account rendered afterwards. This follows the package rule that
 * shared color tables are never mutated in place.
 *
 * Unknown values fall back to `default` rather than throwing. This runs during the first render
 * after paint. When storage or a stale response holds an unknown string, the worst acceptable
 * outcome is that the account sees default colors.
 */
export function resolveThemePresetOverrides(
	preset: ThemePreset | undefined | null,
): ThemePresetOverrides {
	return { ...PRESET_OVERRIDES[isThemePreset(preset) ? preset : "default"] };
}
