/**
 * Color conversion: pure arithmetic that lives only inside the editor.
 *
 * - The picker shows hue, saturation, and value, but the stored value is `#rrggbb`. The rules
 *   that connect them live here, not in the component, so they can be tested without rendering (the
 *   web tests in this repo have no React rendering).
 * - HSV does not leave this folder. Storage, the contract, the query cache, and the server only
 *   see `#rrggbb`. The contract gets no hue, saturation, alpha, or colorSpace fields: two
 *   representations of one color would round differently, and the server would store whichever one
 *   diverged.
 * - No transparency. 8-digit hex and rgba() are rejected. A translucent background would make the
 *   text-color choice (`readableForegroundOn`) unanswerable, and the failure would look like text
 *   that is unreadable on some screens.
 * - Contrast is not computed here. Choosing the foreground color belongs to `@rowcat/design`. A
 *   second luminance formula would make the preview text color differ from the applied one, and the
 *   difference would only show after saving.
 * - Hue range is closed at [0, 360]. On the wheel 0 and 360 are the same color, but on a slider
 *   they are different positions: folding 360 to 0 would make the handle jump to the left end while
 *   the color stays the same. Stored values keep the closed range; only color creation folds hue
 *   into a half-open range (`normalizeHue`). Tests check that both give the same color.
 */

/** Integer channels, 0-255, already rounded. Fractional values are never carried. */
export interface RgbColor {
	r: number;
	g: number;
	b: number;
}

/**
 * Hue in degrees, [0, 360]. Saturation and value are ratios, [0, 1], not 0-100: coordinate
 * conversion produces ratios (pointer position divided by width). Mixing units would eventually
 * miss a division by 100. A missed division leaves the color unchanged (visible); a missed
 * multiplication pins saturation at 1% (silent).
 */
export interface HsvColor {
	h: number;
	s: number;
	v: number;
}

/**
 * Matches only the contract shape: `#` followed by six lowercase hex digits. Input is lowercased
 * before this check (see hexToRgb).
 */
const HEX = /^#[0-9a-f]{6}$/;

/**
 * Range for saturation and value. Values from the pointer and from the keyboard both pass through
 * here.
 */
export const clampUnit = (value: number): number =>
	Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * Folds any hue into [0, 360). Used only when creating colors. `%` returns negative results for
 * negative input, so the modulo is applied twice. Without the second step, pressing the left arrow
 * past 0 would make the color vanish.
 */
export const normalizeHue = (hue: number): number => {
	if (!Number.isFinite(hue)) return 0;
	return ((hue % 360) + 360) % 360;
};

/** Clamps to the slider's range without folding, so 360 stays 360 (see the file header). */
export const clampHue = (hue: number): number =>
	Number.isFinite(hue) ? Math.min(360, Math.max(0, hue)) : 0;

export function hexToRgb(hex: string): RgbColor | null {
	const value = hex.trim().toLowerCase();
	if (!HEX.test(value)) return null;
	return {
		r: Number.parseInt(value.slice(1, 3), 16),
		g: Number.parseInt(value.slice(3, 5), 16),
		b: Number.parseInt(value.slice(5, 7), 16),
	};
}

const channel = (value: number): string => {
	const rounded = Math.min(255, Math.max(0, Math.round(value)));
	return rounded.toString(16).padStart(2, "0");
};

/** Normalized lowercase `#rrggbb` from channels. This is the only shape the contract accepts. */
export const rgbToHex = ({ r, g, b }: RgbColor): string =>
	`#${channel(r)}${channel(g)}${channel(b)}`;

/**
 * Channels to picker axes. For gray (saturation 0) and black (value 0), hue is not represented. The
 * 0 returned there means 'this color has no hue', not 'red', so it must not be written straight
 * into picker state (the picker-state module owns that rule).
 */
export function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
	const [red, green, blue] = [r / 255, g / 255, b / 255];
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;

	let hue = 0;
	if (delta !== 0) {
		if (max === red) hue = ((green - blue) / delta) % 6;
		else if (max === green) hue = (blue - red) / delta + 2;
		else hue = (red - green) / delta + 4;
		hue = normalizeHue(hue * 60);
	}

	return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}

/** Picker axes to channels. Hue is folded once here, since 360 and 0 are the same color. */
export function hsvToRgb({ h, s, v }: HsvColor): RgbColor {
	const hue = normalizeHue(h) / 60;
	const sat = clampUnit(s);
	const val = clampUnit(v);

	const sector = Math.floor(hue) % 6;
	const fraction = hue - Math.floor(hue);
	const p = val * (1 - sat);
	const q = val * (1 - sat * fraction);
	const t = val * (1 - sat * (1 - fraction));

	const [r, g, b] = (
		[
			[val, t, p],
			[q, val, p],
			[p, val, t],
			[p, q, val],
			[t, p, val],
			[val, p, q],
		] as const
	)[sector];

	return { r: r * 255, g: g * 255, b: b * 255 };
}

export function hexToHsv(hex: string): HsvColor | null {
	const rgb = hexToRgb(hex);
	return rgb ? rgbToHsv(rgb) : null;
}

/** Picker axes to normalized `#rrggbb`. Only this output leaves as the draft value. */
export const hsvToHex = (hsv: HsvColor): string => rgbToHex(hsvToRgb(hsv));

/**
 * Keeps the previous hue when moving to a color that has no hue. A user who picks purple and drags
 * saturation to 0 gets gray, which has no purple left in its channels. Recomputing hue from that
 * gray would yield red (0 degrees), and raising saturation again would hand back a color the user
 * never chose. Value 0 (black) is the same case.
 */
export function preserveHue(previous: HsvColor, next: HsvColor): HsvColor {
	if (next.s > 0 && next.v > 0) return next;
	return { ...next, h: previous.h };
}
