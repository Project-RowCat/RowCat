/**
 * sRGB to OKLab and back: the smallest converter needed to shift lightness perceptually.
 *
 * Why it exists: the whole neutral UI family is derived from one account-chosen surface color
 * (theme-customization.ts). Those derivations are perceptual ('a bit lighter'). Shifting RGB
 * channels by a constant moves different colors by different visible amounts, and the error is
 * silent.
 *
 * - oklch.ts writes oklch(L C H) strings to hex at build time. oklab.ts converts hex to and from
 *   OKLab at runtime to derive neighboring colors. The two differ in direction and lifetime.
 * - The matrix exists once. oklch.ts calls oklabToHex here. A copy would make the same color
 *   differ subtly between generated and runtime paths.
 * - Out-of-gamut handling depends on direction. Neighbor colors are clipped in linear sRGB, since
 *   a one-step move never goes far out of gamut. Fabricated colors (oklchToHex) keep L and H and
 *   reduce chroma instead, so the value that passed a contrast check is the value that is painted.
 * - No color-manipulation package. culori or chroma-js would do the job, but this package ships
 *   to both web and native bundles. Only the conversions, one interpolation and one gamut mapping
 *   are needed.
 */

/**
 * OKLab coordinates. L is perceptual lightness from 0 to 1; a and b are chroma axes, roughly within
 * ±0.4.
 */
export interface OklabColor {
	L: number;
	a: number;
	b: number;
}

const decodeChannel = (channel: number): number =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

function encodeChannel(channel: number): number {
	const clipped = channel <= 0 ? 0 : channel >= 1 ? 1 : channel;
	const gamma =
		clipped <= 0.0031308
			? 12.92 * clipped
			: 1.055 * clipped ** (1 / 2.4) - 0.055;
	return Math.round(gamma * 255);
}

const hex2 = (value: number): string => value.toString(16).padStart(2, "0");

/**
 * Accepted shape: one opaque 6-digit sRGB hex value, the same rule as the token contract and
 * resolver.
 */
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Returns null for anything that is not #rrggbb and never invents a color. It does not throw, for
 * the same reason as its consumers: this runs during the render right after first paint, and if a
 * corrupted value sits in storage the worst outcome must be the default color.
 */
export function hexToOklab(hex: string): OklabColor | null {
	const value = hex.trim().toLowerCase();
	if (!HEX.test(value)) return null;

	const [r, g, b] = [1, 3, 5].map((i) =>
		decodeChannel(Number.parseInt(value.slice(i, i + 2), 16) / 255),
	) as [number, number, number];

	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

	return {
		L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	};
}

export function oklabToHex({ L, a, b }: OklabColor): string {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

	const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return `#${hex2(encodeChannel(red))}${hex2(encodeChannel(green))}${hex2(encodeChannel(blue))}`;
}

/**
 * Neighboring color with perceptual lightness moved by delta. Hue and chroma are preserved, which
 * is why a and b are untouched. The result must stay one step away in the same color family: a blue
 * surface whose border comes out purple would show the user a color they did not choose.
 *
 * Lightness is clamped to [0, 1]. Requests to go below black or above white do happen, and then the
 * result is the same color. The hierarchy in that case comes from the step in the opposite
 * direction; the consumer reads the surface's brightness to pick the direction.
 */
export function shiftLightness(hex: string, delta: number): string {
	const lab = hexToOklab(hex);
	if (!lab) return hex;
	return oklabToHex({
		...lab,
		L: Math.min(1, Math.max(0, lab.L + delta)),
	});
}

/**
 * Linear interpolation in OKLab: t = 0 gives from, t = 1 gives to. Not mixed in sRGB because the
 * gamma-space midpoint is pressed darker than the perceptual midpoint, which makes faint text
 * fainter than intended.
 */
export function mixOklab(from: string, to: string, t: number): string {
	const [a, b] = [hexToOklab(from), hexToOklab(to)];
	if (!a || !b) return from;
	const ratio = Math.min(1, Math.max(0, t));
	return oklabToHex({
		L: a.L + (b.L - a.L) * ratio,
		a: a.a + (b.a - a.a) * ratio,
		b: a.b + (b.b - a.b) * ratio,
	});
}

/**
 * OKLCh coordinates: L is perceptual lightness (0-1), C is chroma (roughly 0-0.37), and H is the
 * hue angle in degrees. Same space as OklabColor, kept separate by direction.
 *
 * Use a and b to derive neighbors of an existing color, since leaving the axes alone keeps the hue
 * family. Use L, C and H to invent a color: 'this lightness and this strength in this family' is
 * stated directly. Random palette generation (theme-palette-random.ts) is the main user.
 */
export interface OklchColor {
	L: number;
	C: number;
	H: number;
}

export function oklchToOklab({ L, C, H }: OklchColor): OklabColor {
	const radians = (H * Math.PI) / 180;
	return { L, a: C * Math.cos(radians), b: C * Math.sin(radians) };
}

export function oklabToOklch({ L, a, b }: OklabColor): OklchColor {
	const H = (Math.atan2(b, a) * 180) / Math.PI;
	return { L, C: Math.hypot(a, b), H: ((H % 360) + 360) % 360 };
}

/** Linear sRGB components. The gamut check reads these, and it only holds before gamma encoding. */
function linearRgb({ L, a, b }: OklabColor): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

/**
 * Whether the color is representable without clipping. One step of slack is allowed because
 * rounding can cross the boundary.
 */
const EPSILON = 1 / 512;

const inSrgbGamut = (lab: OklabColor): boolean =>
	linearRgb(lab).every(
		(channel) => channel >= -EPSILON && channel <= 1 + EPSILON,
	);

/**
 * Bisection steps for reducing chroma until the color is in gamut. Twelve steps keep the error in C
 * below 0.0001.
 */
const GAMUT_STEPS = 12;

/**
 * OKLCh to #rrggbb. Keeps lightness and hue, and gives up chroma.
 *
 * oklabToHex clips in linear sRGB. That is harmless when making neighbor colors, since a one-step
 * move never goes far out of gamut. It is wrong for fabricated colors: clipping a low-chroma yellow
 * changes its lightness, so a 'light background' comes out dark. The contrast check then passes on
 * one value while another value is painted.
 *
 * So L and H stay fixed and only C is reduced by bisection. This is the same direction as CSS Color
 * 4 gamut mapping, which also gives up chroma. The exact procedure (minimizing ΔE in OKLCh) is not
 * copied, because the goal is a color that reads at the requested lightness, not colorimetric
 * accuracy.
 */
export function oklchToHex(color: OklchColor): string {
	const lab = oklchToOklab(color);
	if (inSrgbGamut(lab)) return oklabToHex(lab);

	let low = 0;
	let high = color.C;
	for (let i = 0; i < GAMUT_STEPS; i += 1) {
		const mid = (low + high) / 2;
		if (inSrgbGamut(oklchToOklab({ ...color, C: mid }))) low = mid;
		else high = mid;
	}
	return oklabToHex(oklchToOklab({ ...color, C: low }));
}

export function hexToOklch(hex: string): OklchColor | null {
	const lab = hexToOklab(hex);
	return lab ? oklabToOklch(lab) : null;
}
