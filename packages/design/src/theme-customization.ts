/**
 * Override table that maps the account's chosen colors onto semantic tokens. Color and contrast
 * math only. It does not know who picked a color, whether they may apply it, or where it is stored.
 * Those are consumer concerns, and importing them would make color logic depend on billing.
 *
 * - One palette, with no light/dark argument. Device appearance only fills the tokens the account
 *   did not choose.
 * - Generated tokens (tokens.css, tokens.native.ts) are product defaults, not per-account copies.
 *   The output is one runtime override on top, so clearing it restores the defaults with nothing
 *   stored.
 * - Only background, surface and primary are selectable. Foreground is always derived, because a
 *   user-set foreground could make white text on a white background a valid setting.
 * - surface drives the whole neutral family (layers and borders derive from it), not just the
 *   card.
 * - destructive and the chart tokens are excluded on purpose. accent is a surface-family token
 *   (menu hover, selected row), not a highlight color.
 * - `@rowcat/contracts` is not imported: wire shape and color rules evolve on separate axes.
 * - Presets live in theme-preset.ts. theme-effective.ts merges them, and custom colors win.
 */

import { mixOklab, shiftLightness } from "./oklab.ts";
/**
 * Type-only imports. The sole runtime dependency runs the other way: theme-gradient.ts calls this
 * file's contrast helpers. `import type` is erased, so no cycle forms and gradient rules stay out
 * of this file.
 */
import type { ThemeGradient } from "./theme-gradient.ts";
import type { ColorName } from "./tokens.ts";

/**
 * Closed set of slots, on purpose. A Record<string, string> would let arbitrary semantic token
 * names reach runtime colors, turning this feature into arbitrary style injection.
 */
export const THEME_CUSTOMIZATION_SLOTS = [
	"background",
	"surface",
	"primary",
] as const;

export type ThemeCustomizationSlot = (typeof THEME_CUSTOMIZATION_SLOTS)[number];

/**
 * The account's choice: a single palette. Missing slots fall back to the RowCat default. It is not
 * split into light and dark palettes, since that would make the same decision twice. Foreground is
 * derived from the chosen color, so readability holds in either appearance. Appearance only affects
 * the tokens the account did not choose.
 */
export interface ThemeCustomization {
	background?: string;
	surface?: string;
	primary?: string;
	/**
	 * Two-color background gradient. This is a presentation layer, not a semantic color. The first
	 * stop is `background` above; this field holds only the second stop and the angle. A gradient
	 * without a background is meaningless and is silently dropped by resolveThemeGradient. It is kept
	 * out of resolveThemeColorOverrides because semantic tokens must stay opaque colors. Otherwise
	 * cards, popovers and the status bar would receive CSS image strings.
	 */
	gradient?: ThemeGradient;
}

/**
 * Overrides applied on top of the effective color table. Keys are always a subset of
 * MANAGED_THEME_COLOR_NAMES below.
 */
export type ThemeColorOverrides = Partial<Record<ColorName, string>>;

/**
 * Every color name this layer can paint. Consumers must clear this full list, not only the keys
 * currently applied. Otherwise colors painted earlier survive: an account reduced from three slots
 * to one, or a browser where the account changed. The list covers the outputs of both resolvers, so
 * it is wider than any one member's choice. Clearing against a narrower set would leave inline
 * colors from the black preset behind after switching from `Black` back to `Default`. destructive and the
 * chart tokens are absent because no resolver emits them; listing names that are never painted
 * would make them look paintable. Being wider does not widen the selectable slots
 * (THEME_CUSTOMIZATION_SLOTS stays at three).
 */
export const MANAGED_THEME_COLOR_NAMES: readonly ColorName[] = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"border",
	"input",
	"primary",
	"primary-foreground",
	"ring",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
];

/**
 * Accepted color shape: an opaque sRGB hex only, #rrggbb. #fff, 8-digit hex, rgb(), oklch() and
 * var() are rejected. The contract enforces the same rule, and the server is the final authority,
 * but the check is repeated here because this function also receives unsaved draft values.
 */
const HEX = /^#[0-9a-f]{6}$/;

/**
 * Whether the value is already normalized. Uppercase fails here; normalization is the contract's
 * job.
 */
export const isThemeColorHex = (value: string): boolean => HEX.test(value);

/**
 * Parses #rrggbb into 0 to 1 channels. Returns null for any other shape instead of throwing; see
 * the no-throw rule on normalized().
 */
function channels(hex: string): [number, number, number] | null {
	const value = hex.trim().toLowerCase();
	if (!HEX.test(value)) return null;
	return [1, 3, 5].map(
		(i) => Number.parseInt(value.slice(i, i + 2), 16) / 255,
	) as [number, number, number];
}

/**
 * WCAG relative luminance, not a channel sum. A heuristic such as `r + g + b > 384` fails on hue.
 * Pure blue and pure green have the same channel sum, but their luminances differ roughly tenfold,
 * so the heuristic would put black text on blue backgrounds.
 */
export function relativeLuminance(hex: string): number {
	const rgb = channels(hex);
	if (!rgb) return 0;
	const [r, g, b] = rgb.map((v) =>
		v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
	const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
	const [hi, lo] = x > y ? [x, y] : [y, x];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Visual lightness of a surface, light or dark. Same shape as ColorSchemeName but a different
 * meaning: it is derived from the background actually painted, not the device appearance. The two
 * diverge once an account theme overrides the background (see themeSurfaceScheme).
 */
export type ThemeSurfaceScheme = "light" | "dark";

/**
 * The two foreground candidates are copies of the `foreground` token values, not new colors, so
 * custom backgrounds read the same as the rest of RowCat. The literals are repeated because this
 * file must not import tokens.native.ts (generated, native entry only). A drift check in
 * theme-customization.test.ts keeps the copies equal.
 */
export const THEME_FOREGROUND_ON_LIGHT = "#09090b";
export const THEME_FOREGROUND_ON_DARK = "#fafafa";

/** WCAG AA threshold for normal-size text. Not used on screen; tests and docs read it. */
export const WCAG_AA_CONTRAST = 4.5;

/**
 * Picks the foreground with the higher contrast. Users cannot choose the foreground, and that
 * absence is the feature's safety. If it were editable, `background #ffffff` with `foreground
 * #ffffff` would be a valid setting, and the screen used to undo it would be unreadable. When
 * neither candidate reaches AA (possible for mid-gray), the better one is still chosen rather than
 * rejecting the color. Rejection would leave the user unable to tell why, and silently lightening
 * the color would change a value they did not pick.
 */
export function readableForegroundOn(surface: string): string {
	return contrastRatio(surface, THEME_FOREGROUND_ON_DARK) >=
		contrastRatio(surface, THEME_FOREGROUND_ON_LIGHT)
		? THEME_FOREGROUND_ON_DARK
		: THEME_FOREGROUND_ON_LIGHT;
}

/**
 * Foreground for a surface with several stops, such as a gradient. It maximizes the worst contrast
 * across all stops. Choosing from the first stop alone fails when the stops differ in lightness;
 * the symptom appears on only half the screen, so a single screenshot can miss it. Candidates are
 * not increased (no middle gray): a third color would be a foreground used nowhere else. An empty
 * list returns the light candidate, assuming a dark base, which matches relativeLuminance folding
 * unknown values to 0.
 */
export function readableForegroundAcross(surfaces: readonly string[]): string {
	const worst = (foreground: string): number =>
		surfaces.reduce(
			(lowest, surface) => Math.min(lowest, contrastRatio(surface, foreground)),
			Number.POSITIVE_INFINITY,
		);

	return worst(THEME_FOREGROUND_ON_DARK) >= worst(THEME_FOREGROUND_ON_LIGHT)
		? THEME_FOREGROUND_ON_DARK
		: THEME_FOREGROUND_ON_LIGHT;
}

/**
 * Platform chrome appearance (status bar, scrollbars, native form controls), derived from the
 * surface actually painted. It is not the device `scheme`: once an account covers the background
 * the two can diverge, for example a dark preset on a light device leaves the status bar light. The
 * name stays distinct so that nobody passes this value where `scheme` belongs, which would revive a
 * model where the account preset overrides device appearance.
 *
 * It uses exactly the foreground rule. A second luminance threshold here would let the text and the
 * status bar disagree. The function is pure: no React, RN, DOM, member or preset knowledge. Non-hex
 * input folds to dark via relativeLuminance; it never throws.
 */
export function themeSurfaceScheme(background: string): ThemeSurfaceScheme {
	return readableForegroundOn(background) === THEME_FOREGROUND_ON_DARK
		? "dark"
		: "light";
}

/**
 * Two lightness steps for the surface family, as absolute OKLab L shifts. Dark surfaces step up and
 * light surfaces step down. Reversing the direction makes dark-theme cards look like holes and
 * makes light-theme borders vanish. The values come from RowCat's own preset steps: the black
 * preset's card and secondary differ by L 0.064, and the white preset's card and secondary differ
 * by 0.033 with its border at 0.080. No new visual language is introduced. The light step is
 * smaller because equal L differences look larger on light surfaces; a symmetric value would make
 * hover states on white backgrounds look like a gray band.
 */
const SURFACE_TONE_STEPS = {
	dark: { raised: 0.06, edge: 0.115 },
	light: { raised: -0.035, edge: -0.085 },
} as const;

/**
 * Start point and step for muted text, which must not match body text. Using readableForegroundOn
 * directly on muted would make secondary copy as strong as body text, flattening the hierarchy
 * silently. A fixed dimming, on the other hand, can miss AA on some surfaces, so
 * subduedForegroundOn searches for the most muted value that still passes.
 */
const SUBDUED_FOREGROUND_START = 0.55;
const SUBDUED_FOREGROUND_STEP = 0.05;

/**
 * Secondary text color on this surface: the most muted value that still passes AA. It interpolates
 * from the surface toward the body foreground in OKLab and stops at the first passing point.
 * Interpolating in gamma space would push midpoints darker and make muted text look more muted than
 * intended. If no point passes AA (a mid-lightness, highly saturated surface), the body foreground
 * is returned unchanged. The cost there is hierarchy, not legibility.
 */
export function subduedForegroundOn(surface: string): string {
	const full = readableForegroundOn(surface);
	for (let t = SUBDUED_FOREGROUND_START; t < 1; t += SUBDUED_FOREGROUND_STEP) {
		const candidate = mixOklab(surface, full, t);
		if (contrastRatio(surface, candidate) >= WCAG_AA_CONTRAST) return candidate;
	}
	return full;
}

export interface ThemeSurfaceFamily {
	/** The chosen color, unchanged. Primary surfaces that carry text sit on it. */
	base: string;
	baseForeground: string;
	/** Layer over the surface for hover, selection and secondary areas. One lightness step away. */
	raised: string;
	raisedForeground: string;
	/** Secondary text on the raised layer: readable, but dimmer than body text. */
	subduedForeground: string;
	/** Edge color for borders and inputs. Two lightness steps away so it stays visible. */
	edge: string;
}

/**
 * Maps one surface color to its family. The direction is not chosen by the platform or device
 * appearance. It uses the same judgment as foreground selection (themeSurfaceScheme), since a
 * second threshold here would allow text that reads light on a surface whose edge gets darker.
 * Invariant: the three steps stay distinct even at the extremes (pure white or black), and their
 * ordering survives clamping.
 */
export function surfaceFamily(surface: string): ThemeSurfaceFamily {
	const steps = SURFACE_TONE_STEPS[themeSurfaceScheme(surface)];
	const raised = shiftLightness(surface, steps.raised);

	return {
		base: surface,
		baseForeground: readableForegroundOn(surface),
		raised,
		raisedForeground: readableForegroundOn(raised),
		subduedForeground: subduedForegroundOn(raised),
		edge: shiftLightness(surface, steps.edge),
	};
}

/**
 * Values of the wrong shape are treated as absent, not thrown. This runs right after first paint,
 * and throwing on a stale or corrupt stored value would show the app as broken instead of the
 * default color. The worst outcome must be 'shown in the default color'. The device-preference
 * store makes the same choice.
 */
const normalized = (value: string | undefined): string | null => {
	if (typeof value !== "string") return null;
	const hex = value.trim().toLowerCase();
	return HEX.test(hex) ? hex : null;
};

/**
 * Maps the account's selection to override entries. `background` covers only the page bottom.
 * `surface` covers the whole neutral family and deliberately not `background`, so the three slots
 * stay independent. `primary` also covers `ring`, because the default palette groups them
 * (tokens.ts). The function takes no scheme and no base colors: custom color resolution is
 * independent of appearance, and nothing here mixes base colors. The input is never mutated, since
 * it comes from a query-cache response and an in-place change would make the next render re-resolve
 * an already changed value.
 */
export function resolveThemeColorOverrides(
	customization: ThemeCustomization | undefined | null,
): ThemeColorOverrides {
	if (!customization) return {};

	const overrides: ThemeColorOverrides = {};

	const background = normalized(customization.background);
	if (background) {
		overrides.background = background;
		overrides.foreground = readableForegroundOn(background);
	}

	const surface = normalized(customization.surface);
	if (surface) {
		const family = surfaceFamily(surface);

		overrides.card = family.base;
		overrides["card-foreground"] = family.baseForeground;
		overrides.popover = family.base;
		overrides["popover-foreground"] = family.baseForeground;
		overrides.sidebar = family.base;
		overrides["sidebar-foreground"] = family.baseForeground;

		overrides.secondary = family.raised;
		overrides["secondary-foreground"] = family.raisedForeground;
		overrides.muted = family.raised;
		overrides["muted-foreground"] = family.subduedForeground;
		overrides.accent = family.raised;
		overrides["accent-foreground"] = family.raisedForeground;
		overrides["sidebar-accent"] = family.raised;
		overrides["sidebar-accent-foreground"] = family.raisedForeground;

		overrides.border = family.edge;
		overrides.input = family.edge;
		overrides["sidebar-border"] = family.edge;
	}

	const primary = normalized(customization.primary);
	if (primary) {
		const on = readableForegroundOn(primary);
		overrides.primary = primary;
		overrides["primary-foreground"] = on;
		overrides["sidebar-primary"] = primary;
		overrides["sidebar-primary-foreground"] = on;
		overrides.ring = primary;
		overrides["sidebar-ring"] = primary;
	}

	return overrides;
}

export const hasThemeColorOverrides = (
	overrides: ThemeColorOverrides,
): boolean => Object.keys(overrides).length > 0;
