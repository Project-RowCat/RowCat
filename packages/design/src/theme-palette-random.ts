/**
 * Generates one plausible random color combination for the editor's local draft. Pure color math.
 * - Stores nothing and knows nothing about members, entitlements, the server or drafts. Saving
 *   goes through the normal paid write path. There is no POST /random-theme endpoint, no history,
 *   and no seed storage.
 * - Channels are not rolled independently. Random RGB regularly yields unusable results:
 *   background and surface nearly equal (card disappears), primary at the background's lightness
 *   (invisible button), all channels maxed (neon), or mid-lightness gray (no AA foreground). RGB
 *   has no lightness axis, so the coordinates are chosen in OKLCh and converted to sRGB once at the
 *   end.
 * - Randomness versus rules. Random: family (light or dark), base hue, hue relation, and each
 *   axis value. Rules: a surface is lighter than the background, the primary has real chroma, and
 *   text is always readable. The rules are the feature's value: a fixed list would not be random,
 *   and unconstrained randomness would not be usable.
 * - The random source is injected rather than calling Math.random, so the readability claim can
 *   be verified across hundreds of seeds. No security role is involved.
 */

import { hexToOklch, type OklchColor, oklchToHex } from "./oklab.ts";
import {
	contrastRatio,
	readableForegroundOn,
	WCAG_AA_CONTRAST,
} from "./theme-customization.ts";
import { type ThemeGradient, themeGradientStop } from "./theme-gradient.ts";

/** A `[0, 1)` source. Math.random fits this shape directly. */
export type ThemeRandomSource = () => number;

/**
 * The random source is not trusted. Out-of-range and NaN values fold to 0. A test may pass a short
 * fake array; once it runs out, undefined makes every coordinate NaN and the result comes out as
 * #000000 throughout. In that case the test should fail, not this function. The same defense also
 * helps hand-written seeds.
 */
function unitOf(random: ThemeRandomSource): number {
	const value = random();
	if (!Number.isFinite(value)) return 0;
	return value < 0 ? 0 : value >= 1 ? 0.999_999 : value;
}

const between = (random: ThemeRandomSource, min: number, max: number): number =>
	min + unitOf(random) * (max - min);

/**
 * Picks one item from a list. Callers never pass an empty list; all lists are literal constants.
 */
const pick = <T>(random: ThemeRandomSource, values: readonly T[]): T =>
	values[
		Math.min(values.length - 1, Math.floor(unitOf(random) * values.length))
	];

/**
 * The light or dark character of the palette, meaning how the account's screen reads. This is not
 * the device appearance (system, light, dark). The account has one palette that applies regardless
 * of appearance, so this choice only decides which way that palette reads.
 */
export type RandomPaletteFamily = "light" | "dark";

/**
 * Ranges per axis, taken from the real steps of RowCat presets. The dark background band (L 0.145
 * to 0.225) is centered on the black preset's zinc-950 (0.178). The light band (0.905 to 0.945)
 * sits a little below the white preset's zinc-50 (0.985): pinned to pure white, the surface has no
 * room to lift and the card disappears. surfaceLift is positive in both families, so surfaces float
 * above the background on light palettes too.
 */
const FAMILY = {
	dark: {
		background: { L: [0.145, 0.225], C: [0.012, 0.045] },
		surfaceLift: [0.055, 0.095],
		primary: { L: [0.64, 0.78], C: [0.13, 0.21] },
	},
	light: {
		background: { L: [0.905, 0.945], C: [0.008, 0.03] },
		surfaceLift: [0.035, 0.055],
		primary: { L: [0.45, 0.58], C: [0.14, 0.22] },
	},
} as const satisfies Record<
	RandomPaletteFamily,
	{
		background: { L: readonly [number, number]; C: readonly [number, number] };
		surfaceLift: readonly [number, number];
		primary: { L: readonly [number, number]; C: readonly [number, number] };
	}
>;

/**
 * Hue relations between the primary and the background. Not exposed to users: there is one button.
 * Several relations are kept so results look genuinely different. Analogous hues alone look
 * monochrome, and complementary hues alone all read as the same kind of contrast.
 */
const HUE_RELATIONS = [
	/** Analogous: neighbors of the background hue. Calm. */
	[-34, -26, 26, 34],
	/** Complementary: the opposite hue. The primary is most distinct here. */
	[172, 180, 188],
	/** Split complementary: either side of the complement. Distinct but less harsh. */
	[148, 152, 208, 212],
	/** Triadic: one of three evenly spaced hues. */
	[118, 122, 238, 242],
] as const;

/** All values are canonical #rrggbb, ready to fill the editor's draft. */
export interface RandomThemePalette {
	background: string;
	surface: string;
	primary: string;
}

/**
 * Minimum perceptual lightness gap for the background and surface to read as different. The white
 * preset's background (zinc-50) and card (pure white) differ by only 0.015 in L, which relies on
 * white being unable to get lighter. Generated colors have no such ceiling, so the threshold is set
 * wider. Generation always produces at least 0.035.
 */
export const THEME_PALETTE_MIN_SURFACE_SEPARATION = 0.02;

/** Returns 0 for malformed colors, so checks built on it fail rather than pass. */
export function themePaletteLightnessGap(a: string, b: string): number {
	const [x, y] = [hexToOklch(a), hexToOklch(b)];
	return x && y ? Math.abs(x.L - y.L) : 0;
}

/**
 * The gate a palette passes before it leaves generation, and the predicate the test uses. Both
 * sides share one function on purpose. A check that lived only in tests would describe what the
 * code does now and protect nothing once someone retunes an axis range and forgets the check value.
 * The generator runs this as its last step and repairs deterministically on failure.
 */
export function isCoherentThemePalette(palette: RandomThemePalette): boolean {
	const { background, surface, primary } = palette;

	if (background === surface || primary === background || primary === surface)
		return false;

	if (
		themePaletteLightnessGap(background, surface) <
		THEME_PALETTE_MIN_SURFACE_SEPARATION
	)
		return false;

	return [background, surface, primary].every(
		(color) =>
			contrastRatio(color, readableForegroundOn(color)) >= WCAG_AA_CONTRAST,
	);
}

const clampL = (value: number): number =>
	Math.min(0.995, Math.max(0.02, value));

/**
 * Pushes the primary toward a readable lightness. Mid-lightness (about L 0.5 to 0.6) can fail AA
 * for both white and black text. Instead of rejecting the color, only its lightness is stepped
 * toward the family edge, one notch at a time. Hue and chroma stay, so the user sees a slightly
 * deeper or lighter version of the same color. It moves in one direction only (dark families
 * lighter, light families darker); alternating could yield two results from one seed.
 */
function readablePrimary(
	color: OklchColor,
	family: RandomPaletteFamily,
): string {
	const step = family === "dark" ? 0.03 : -0.03;

	let candidate = { ...color };
	for (let i = 0; i < 10; i += 1) {
		const hex = oklchToHex(candidate);
		if (contrastRatio(hex, readableForegroundOn(hex)) >= WCAG_AA_CONTRAST)
			return hex;
		candidate = { ...candidate, L: clampL(candidate.L + step) };
	}
	return oklchToHex(candidate);
}

/**
 * Generates background, surface and primary together. The value of this feature is the consistency
 * of the combination, so the palette is not built one slot at a time. Rolling only the background
 * would leave an old surface and primary with no relation to it.
 */
export function generateRandomThemePalette(
	random: ThemeRandomSource,
): RandomThemePalette {
	const family: RandomPaletteFamily = unitOf(random) < 0.5 ? "dark" : "light";
	const spec = FAMILY[family];

	const baseHue = between(random, 0, 360);

	const backgroundColor: OklchColor = {
		L: between(random, spec.background.L[0], spec.background.L[1]),
		C: between(random, spec.background.C[0], spec.background.C[1]),
		H: baseHue,
	};
	const background = oklchToHex(backgroundColor);

	/**
	 * The surface sits one layer up in the same hue family. Hue is kept, since a shifted hue would
	 * make the card read as a different color. Only chroma is raised slightly so the surface does not
	 * look dead.
	 */
	const surface = oklchToHex({
		L: clampL(
			backgroundColor.L +
				between(random, spec.surfaceLift[0], spec.surfaceLift[1]),
		),
		C: backgroundColor.C * between(random, 1, 1.35),
		H: baseHue,
	});

	const primary = readablePrimary(
		{
			L: between(random, spec.primary.L[0], spec.primary.L[1]),
			C: between(random, spec.primary.C[0], spec.primary.C[1]),
			H: baseHue + pick(random, pick(random, HUE_RELATIONS)),
		},
		family,
	);

	return repaired({ background, surface, primary }, backgroundColor, baseHue);
}

/**
 * Final gate. It checks by value what the ranges already guarantee, and repairs on mismatch. This
 * only happens at extremes, such as gamut mapping that cuts chroma until two surfaces become the
 * same gray. The repair widens the surface gap by one step and draws no further random numbers,
 * since the same seed must give the same palette. If repair still fails, the last candidate is
 * returned. This runs on a button the user just pressed, so the worst outcome is a less contrasty
 * palette, not a button that does nothing.
 */
function repaired(
	palette: RandomThemePalette,
	background: OklchColor,
	hue: number,
): RandomThemePalette {
	let candidate = palette;
	for (let i = 1; i <= 6 && !isCoherentThemePalette(candidate); i += 1)
		candidate = {
			...candidate,
			surface: oklchToHex({
				L: clampL(background.L + 0.055 + i * 0.03),
				C: background.C,
				H: hue,
			}),
		};
	return candidate;
}

/**
 * Seven diagonal and orthogonal directions. 0 degrees (straight up) is deliberately excluded: a
 * vertical gradient looks like the whole background moves when scrolling, and its darkest end hides
 * behind a header or footer. Any angle from 0 to 359 can still be picked by hand; this list limits
 * only what random picks.
 */
const GRADIENT_ANGLES = [45, 90, 135, 180, 225, 270, 315] as const;

/**
 * Turns a background into a matching second stop and angle, or null if the background is not valid
 * syntax. Only three shifts are drawn here. The color conversion lives in themeGradientStop, so the
 * default path and random generation share one function and one safety rule. Ranges: hue 24 to 64
 * degrees on a random side (avoids both an identical hue and an opposite clash); lightness 0.015 to
 * 0.05 (stays inside the family); chroma +0.02 to 0.06 (identical ends would make the gradient
 * invisible).
 */
export function generateRandomThemeGradient(
	background: string,
	random: ThemeRandomSource,
): ThemeGradient | null {
	const to = themeGradientStop(background, {
		hueShift: between(random, 24, 64) * (unitOf(random) < 0.5 ? -1 : 1),
		lightnessShift: between(random, 0.015, 0.05),
		chromaBoost: between(random, 0.02, 0.06),
	});
	return to ? { to, angle: pick(random, GRADIENT_ANGLES) } : null;
}

/**
 * Everything one press of `Random palette` produces. A null gradient and a disabled gradient are the same
 * value, matching the editor's draft shape. When off, the field is simply not sent with a save
 * request.
 */
export interface RandomThemeSelection extends RandomThemePalette {
	gradient: ThemeGradient | null;
}

/**
 * The `gradient` option is the whole of §48: a random press never turns on a feature that is off.
 * Enabling a gradient unasked is a second unrequested change, and reverting it would mean first
 * finding where it was switched on. When it is on, the second stop is regenerated along with the
 * palette; otherwise the old end color would remain and the preview would mismatch.
 */
export function generateRandomTheme(
	random: ThemeRandomSource,
	options: { gradient: boolean },
): RandomThemeSelection {
	const palette = generateRandomThemePalette(random);
	return {
		...palette,
		gradient: options.gradient
			? generateRandomThemeGradient(palette.background, random)
			: null,
	};
}
