/**
 * OKLCH to sRGB hex. A build-time converter, not runtime code.
 *
 * Why it exists: React Native cannot read oklch(). Its color parser
 * (@react-native/normalize-colors) knows hex, rgb(a), hsl(a), hwb and named colors. An unknown
 * string becomes null rather than an error, so the style silently disappears. The symptom is text
 * that renders black.
 *
 * - Colors are written once and generated for both targets: scripts/gen-tokens.mjs builds
 *   tokens.css for web and tokens.native.ts for native from the same tokens.ts.
 * - The conversion does not run at app start. It would repeat the same work on every boot, and
 *   the code would ship in the bundle, making colors into code that drift checks cannot compare.
 *   Baked values are plain files that can be diffed.
 * - Out-of-gamut values are clipped in linear sRGB. Some wide-gamut OKLCH values have no sRGB
 *   equivalent (destructive sits at that edge in this palette). CSS Color 4 reduces chroma to fit
 *   instead. Browsers differ slightly, and what is needed is a value that reads as the same color,
 *   not identical pixels. The difference is invisible in this palette, since most colors are
 *   low-chroma and already in gamut.
 */

import { oklabToHex } from "./oklab.ts";

/**
 * The three numbers pulled from one oklch(L C H) string. Alpha (/ a) does not appear in this
 * palette, so it is not matched.
 */
const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

/**
 * Unknown shapes throw. Silently folding them to black would turn the whole app black the day the
 * palette adds new syntax, and the failure would show up on devices rather than at build time.
 */
export function oklchToHex(value: string): string {
	const match = OKLCH.exec(value.trim());
	if (!match) throw new Error(`color token is not oklch(): ${value}`);

	const lightness = Number(match[1]);
	const chroma = Number(match[2]);
	const hue = (Number(match[3]) * Math.PI) / 180;

	// Polar to Cartesian. The rest of the conversion lives in oklab.ts; writing the matrix here again
	// would split the build and runtime colors.
	return oklabToHex({
		L: lightness,
		a: chroma * Math.cos(hue),
		b: chroma * Math.sin(hue),
	});
}
