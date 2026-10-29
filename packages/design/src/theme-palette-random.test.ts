import { describe, expect, it } from "vitest";
import {
	contrastRatio,
	generateRandomTheme,
	generateRandomThemeGradient,
	generateRandomThemePalette,
	isCoherentThemePalette,
	isThemeGradientReadable,
	readableForegroundOn,
	relativeLuminance,
	resolveThemeGradient,
	THEME_PALETTE_MIN_SURFACE_SEPARATION,
	themePaletteLightnessGap,
	themeSurfaceScheme,
	WCAG_AA_CONTRAST,
} from "./index.ts";

/**
 * Asserts by value that random palettes are always usable. The failure being hunted is a
 * distribution, not a specific input: mid-lightness grays, two surfaces of the same color, an
 * unreadable primary. Hand-picked examples do not reach those combinations, and an axis-range tweak
 * can bring them back at any time, so iterating over many seeds is what keeps such a tweak from
 * passing unnoticed.
 *
 * The random source is injected, so the test stays deterministic: a failing seed reproduces the
 * same value. Math.random would make a test that fails only sometimes in CI, and such tests get
 * disabled.
 *
 * Exact hex values are not asserted. Writing expected colors would make every lightness tweak
 * rewrite the list without verifying anything, so the test counts invariants instead.
 */

/** Deterministic PRNG (mulberry32): one seed always yields the same sequence. */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i);
const HEX = /^#[0-9a-f]{6}$/;

describe("the palette is always usable", () => {
	it("all 200 seeds keep the invariants", () => {
		for (const seed of SEEDS) {
			const palette = generateRandomThemePalette(seeded(seed));
			const label = `seed ${seed} · ${JSON.stringify(palette)}`;

			/** Canonical notation: no uppercase letters and no #rgb shorthand. */
			for (const value of Object.values(palette))
				expect(value, label).toMatch(HEX);

			/**
			 * The three colors must differ. If they match, the card sinks into the page or the buttons
			 * disappear.
			 */
			expect(palette.background, label).not.toBe(palette.surface);
			expect(palette.primary, label).not.toBe(palette.background);
			expect(palette.primary, label).not.toBe(palette.surface);

			/**
			 * The surface must visibly separate from the background. The gap is measured with the same
			 * constant the generator uses.
			 */
			expect(
				themePaletteLightnessGap(palette.background, palette.surface),
				label,
			).toBeGreaterThanOrEqual(THEME_PALETTE_MIN_SURFACE_SEPARATION);

			for (const color of Object.values(palette))
				expect(
					contrastRatio(color, readableForegroundOn(color)),
					`${label} · ${color}`,
				).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);

			/** Uses the generator's own predicate, so the check cannot drift outside the code. */
			expect(isCoherentThemePalette(palette), label).toBe(true);
		}
	});

	/**
	 * A surface is always lighter than the background, in both families. That is easy to accept for
	 * dark themes, but it must hold for light ones too: the white preset's card is pure white over a
	 * zinc-50 background. Reversing the direction would make cards look like holes.
	 */
	it("the surface always floats above the background", () => {
		for (const seed of SEEDS) {
			const { background, surface } = generateRandomThemePalette(seeded(seed));
			expect(
				relativeLuminance(surface),
				`seed ${seed} · ${background}`,
			).toBeGreaterThan(relativeLuminance(background));
		}
	});

	/** The same seed yields the same palette, so a failing case can always be reproduced. */
	it("is deterministic", () => {
		for (const seed of [0, 7, 42, 199])
			expect(generateRandomThemePalette(seeded(seed))).toEqual(
				generateRandomThemePalette(seeded(seed)),
			);
	});

	/**
	 * Checks that results really vary across seeds rather than cycling through a fixed list. If
	 * repeated presses show a visible cycle, the feature has lost its value.
	 */
	it("different seeds almost always give different results", () => {
		const seen = new Set(
			SEEDS.map((seed) => generateRandomThemePalette(seeded(seed)).background),
		);
		expect(seen.size).toBeGreaterThan(SEEDS.length * 0.9);
	});

	/** Both light and dark palettes must appear. The generator must not get stuck in one family. */
	it("both families appear", () => {
		const schemes = new Set(
			SEEDS.map((seed) =>
				themeSurfaceScheme(generateRandomThemePalette(seeded(seed)).background),
			),
		);
		expect([...schemes].sort()).toEqual(["dark", "light"]);
	});

	/** A broken random source must not throw. The worst result should be a poorer palette. */
	it("produces valid colors even from a broken random source", () => {
		for (const broken of [
			() => Number.NaN,
			() => -5,
			() => 12,
			() => Number.POSITIVE_INFINITY,
		]) {
			const palette = generateRandomThemePalette(broken);
			for (const value of Object.values(palette)) expect(value).toMatch(HEX);
		}
	});
});

describe("gradient: a generated value can always be drawn", () => {
	it("the second stop of all 200 seeds is valid and in the same family", () => {
		for (const seed of SEEDS) {
			const random = seeded(seed);
			const palette = generateRandomThemePalette(random);
			const gradient = generateRandomThemeGradient(palette.background, random);
			const label = `seed ${seed} · ${palette.background} → ${JSON.stringify(gradient)}`;

			expect(gradient, label).not.toBeNull();
			if (!gradient) continue;

			expect(gradient.to, label).toMatch(HEX);
			expect(gradient.to, label).not.toBe(palette.background);
			expect(Number.isInteger(gradient.angle), label).toBe(true);
			expect(gradient.angle, label).toBeGreaterThanOrEqual(0);
			expect(gradient.angle, label).toBeLessThanOrEqual(359);

			/**
			 * Both gradient ends must be in the same lightness family, so one foreground color reads across
			 * both.
			 */
			expect(themeSurfaceScheme(gradient.to), label).toBe(
				themeSurfaceScheme(palette.background),
			);

			const resolved = resolveThemeGradient({
				background: palette.background,
				gradient,
			});
			expect(resolved, label).not.toBeNull();
			expect(isThemeGradientReadable(resolved as never), label).toBe(true);
		}
	});

	it("invents nothing for a malformed background", () => {
		expect(generateRandomThemeGradient("nope", seeded(1))).toBeNull();
	});
});

describe("all at once: does not turn on features that are off", () => {
	/**
	 * This is half of the §48 decision. A feature that appears from one button press is a second,
	 * unrequested change, and reverting it would first require finding where it was switched on.
	 */
	it("makes no gradient when it is off", () => {
		for (const seed of [0, 3, 11])
			expect(
				generateRandomTheme(seeded(seed), { gradient: false }).gradient,
			).toBeNull();
	});

	/**
	 * The other half: when the gradient is enabled, the second stop is generated together with the
	 * palette, so an old end color does not remain.
	 */
	it("when on, the second stop comes along", () => {
		for (const seed of [0, 3, 11]) {
			const selection = generateRandomTheme(seeded(seed), { gradient: true });
			expect(selection.gradient, `seed ${seed}`).not.toBeNull();
			expect(
				resolveThemeGradient({
					background: selection.background,
					gradient: selection.gradient ?? undefined,
				}),
				`seed ${seed}`,
			).not.toBeNull();
		}
	});

	/**
	 * The palette is identical for a given seed whether or not the gradient is on, because palette
	 * draws come first.
	 */
	it("the three colors do not depend on the gradient", () => {
		for (const seed of [0, 3, 11]) {
			const off = generateRandomTheme(seeded(seed), { gradient: false });
			const on = generateRandomTheme(seeded(seed), { gradient: true });
			expect({
				background: on.background,
				surface: on.surface,
				primary: on.primary,
			}).toEqual({
				background: off.background,
				surface: off.surface,
				primary: off.primary,
			});
		}
	});
});
