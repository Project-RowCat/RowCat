/**
 * Presentation layer for the background. Semantic colors remain opaque hex values.
 * - Stored form is structure, not CSS: `{ to, angle }`, a color and an integer. The
 *   `linear-gradient(...)` string is built in a single web function, from already-validated values
 *   only, so user input can never become arbitrary CSS.
 * - `from` is deliberately absent. The first stop is the account's custom background, which also
 *   sets the foreground contrast floor, the platform chrome classification, and the mobile
 *   background (native has no gradient layer). Storing it twice would let the copies drift.
 * - Invariant: a gradient implies a background. The contract rejects requests without one. If
 *   such a row lingers in storage, resolveThemeGradient drops it silently. Reads are lenient
 *   because this code runs right after first paint; the worst result must be 'no gradient'.
 * - Only an end color and an angle. No stop lists, positions, radial or conic forms, repeats,
 *   animation, background images or alpha. Each would make readability unanswerable, since the
 *   contrast check considers two colors, and the list would never stop growing.
 */

import { hexToOklch, oklchToHex } from "./oklab.ts";
import {
	contrastRatio,
	isThemeColorHex,
	readableForegroundAcross,
	themeSurfaceScheme,
	WCAG_AA_CONTRAST,
} from "./theme-customization.ts";

/**
 * The stored gradient: only the second stop and an angle. The first stop is
 * `ThemeCustomization.background`.
 */
export interface ThemeGradient {
	to: string;
	/**
	 * Direction in degrees: 0 points up and the angle runs clockwise, as CSS deg does. It is an
	 * integer in [0, 359], not a float, so the stored value has one canonical form (135 and
	 * 135.0000001 must not differ, or 'did it change?' would depend on rounding error). 360 is
	 * rejected because it equals 0. Accepting both would store the same gradient two ways and recreate
	 * the slider-to-end save-button bug.
	 */
	angle: number;
}

export const THEME_GRADIENT_ANGLE_MIN = 0;
export const THEME_GRADIENT_ANGLE_MAX = 359;

/** Same predicate as the contract. The read side checks it again. */
export const isThemeGradientAngle = (value: number): boolean =>
	Number.isInteger(value) &&
	value >= THEME_GRADIENT_ANGLE_MIN &&
	value <= THEME_GRADIENT_ANGLE_MAX;

/**
 * Folds 360 to 0. Applied only at input boundaries: the slider end and the arrow keys. Normalizing
 * at save time would make the displayed value (360°) differ from the stored one (0°), so the editor
 * runs it when it produces control values.
 */
export const normalizeThemeGradientAngle = (value: number): number => {
	if (!Number.isFinite(value)) return THEME_GRADIENT_ANGLE_MIN;
	const wrapped = Math.round(value) % 360;
	return wrapped < 0 ? wrapped + 360 : wrapped;
};

export interface ResolvedThemeGradient {
	from: string;
	to: string;
	angle: number;
}

/** Minimal input shape: a subset of ThemeCustomization, which avoids a circular import. */
export interface ThemeGradientSource {
	background?: string;
	gradient?: ThemeGradient;
}

const normalized = (value: string | undefined): string | null => {
	if (typeof value !== "string") return null;
	const hex = value.trim().toLowerCase();
	return isThemeColorHex(hex) ? hex : null;
};

/**
 * Returns null if the background is missing or not hex syntax, if the second stop is not hex
 * syntax, or if the angle is not an integer in range.
 *
 * It does not throw. One corrupt row must not turn the whole settings screen into an error, because
 * that would also remove the user's ability to fix it. Angles are not clamped (370 is not mapped to
 * 10): leniency would let out-of-range stored values look valid, and those rows would never get
 * fixed.
 */
export function resolveThemeGradient(
	source: ThemeGradientSource | undefined | null,
): ResolvedThemeGradient | null {
	if (!source?.gradient) return null;

	const from = normalized(source.background);
	const to = normalized(source.gradient.to);
	const angle = source.gradient.angle;

	if (!from || !to || typeof angle !== "number" || !isThemeGradientAngle(angle))
		return null;

	return { from, to, angle };
}

/**
 * Foreground for the entire gradient, not the first stop alone. Both ends are considered, and the
 * candidates are still RowCat's two foregrounds.
 */
export const themeGradientForeground = (
	gradient: ResolvedThemeGradient,
): string => readableForegroundAcross([gradient.from, gradient.to]);

/**
 * Contrast of the chosen foreground at the worst end. The editor uses it to decide whether to show
 * a warning. It goes no further: the chosen color is not adjusted, the same rule
 * readableForegroundOn follows when it accepts surfaces that miss AA.
 */
export function themeGradientContrast(gradient: ResolvedThemeGradient): number {
	const foreground = themeGradientForeground(gradient);
	return Math.min(
		contrastRatio(gradient.from, foreground),
		contrastRatio(gradient.to, foreground),
	);
}

/**
 * Passes if body text meets AA at both ends. Failing makes the editor warn; it does not block
 * saving.
 */
export const isThemeGradientReadable = (
	gradient: ResolvedThemeGradient,
): boolean => themeGradientContrast(gradient) >= WCAG_AA_CONTRAST;

/**
 * Offset from the first stop to the second. hueShift is in degrees. lightnessShift and chromaBoost
 * are absolute OKLCh deltas.
 */
export interface ThemeGradientStopShift {
	hueShift: number;
	lightnessShift: number;
	chromaBoost: number;
}

/**
 * Returns a second stop for the given first stop, or null if the first stop is not valid syntax.
 * The one safety rule is that both stops stay in the same lightness family. Some pairs, such as
 * near-black to white, read with no foreground at all. Users can still pick such a pair by hand
 * (the editor warns), but this code must never create one. The check uses the same function as
 * foreground selection (themeSurfaceScheme). If the result would cross the family, the lightness
 * shift is flipped; if it still crosses, no lightness shift is applied. Random generation and the
 * default go through this one function, so the safety rule cannot be lost on one path only.
 */
export function themeGradientStop(
	from: string,
	{ hueShift, lightnessShift, chromaBoost }: ThemeGradientStopShift,
): string | null {
	const base = hexToOklch(from);
	if (!base) return null;

	const scheme = themeSurfaceScheme(from);
	const chroma = Math.min(0.24, Math.max(0, base.C + chromaBoost));
	const stopAt = (delta: number): string =>
		oklchToHex({
			L: Math.min(0.995, Math.max(0.02, base.L + delta)),
			C: chroma,
			H: base.H + hueShift,
		});

	/**
	 * Dark starting colors try the lighter direction first and light ones the darker, then the
	 * opposite direction, then no lightness change.
	 */
	const signed = scheme === "dark" ? lightnessShift : -lightnessShift;
	for (const delta of [signed, -signed, 0]) {
		const candidate = stopAt(delta);
		if (themeSurfaceScheme(candidate) === scheme) return candidate;
	}
	return stopAt(0);
}

/**
 * Deterministic on purpose. Someone turning the gradient on expects something that continues
 * naturally from the current background, not a different color each time. Random values would
 * change with each toggle, so the user could not tell what they were reverting. For new
 * combinations, the random button exists.
 */
export const DEFAULT_THEME_GRADIENT_SHIFT: ThemeGradientStopShift = {
	hueShift: 38,
	lightnessShift: 0.035,
	chromaBoost: 0.035,
};

/** Default angle when the gradient is first enabled: top-left to bottom-right. */
export const DEFAULT_THEME_GRADIENT_ANGLE = 135;

export function defaultThemeGradient(from: string): ThemeGradient | null {
	const to = themeGradientStop(from, DEFAULT_THEME_GRADIENT_SHIFT);
	return to ? { to, angle: DEFAULT_THEME_GRADIENT_ANGLE } : null;
}
