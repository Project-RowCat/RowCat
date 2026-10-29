import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withAlpha } from "./native.ts";
import { oklchToHex } from "./oklch.ts";
import { nativeDarkColors, nativeLightColors } from "./tokens.native.ts";
import {
	colorNames,
	darkColors,
	lightColors,
	radius,
	radiusBasePx,
	radiusScale,
} from "./tokens.ts";

/**
 * Checks that guard the tokens as a single source.
 *
 * The main risk here is divergence rather than wrong values. Editing tokens.ts without running the
 * generator makes web and native draw different colors. That shows up only as stale colors on the
 * phone, not as a compile error, and the person who sees it is usually not the one who changed the
 * color.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("generated output does not drift from source", () => {
	/**
	 * Re-runs the generator and compares its output with the committed files. This verifies that the
	 * output comes from the current source, not that the values look plausible, and it does not depend
	 * on anyone remembering to regenerate. The web terms generator uses the same kind of check.
	 */
	it("rerunning gen leaves tokens.css and tokens.native.ts unchanged", () => {
		const before = {
			css: readFileSync(`${HERE}tokens.css`, "utf8"),
			native: readFileSync(`${HERE}tokens.native.ts`, "utf8"),
		};

		execFileSync(process.execPath, ["scripts/gen-tokens.mjs"], { cwd: ROOT });

		expect(readFileSync(`${HERE}tokens.css`, "utf8")).toBe(before.css);
		expect(readFileSync(`${HERE}tokens.native.ts`, "utf8")).toBe(before.native);
	});

	/**
	 * The native values must be the result of the conversion, not colors typed by hand. The check
	 * above alone would still pass if someone replaced the conversion with a hardcoded table.
	 */
	it("every native color derives from the oklch source", () => {
		for (const name of colorNames) {
			expect(nativeLightColors[name], name).toBe(oklchToHex(lightColors[name]));
			expect(nativeDarkColors[name], name).toBe(oklchToHex(darkColors[name]));
		}
	});
});

/**
 * Transitions without an explicit timing also follow the tokens. Without these two lines, hover,
 * focus ring and input border transitions, which receive no rhythm of their own, silently fall back
 * to Tailwind's defaults (150ms and a curve that is not in any token). No error is raised. A switch
 * and an input on the same row just respond to the same press with different timing.
 */
describe("default transition rhythm", () => {
	const css = () => readFileSync(`${HERE}tokens.css`, "utf8");

	it("the duration points at the primitive scale", () => {
		expect(css()).toContain(
			"--default-transition-duration: var(--motion-duration-primitive);",
		);
	});

	it("the curve points at standard", () => {
		expect(css()).toContain(
			"--default-transition-timing-function: var(--motion-easing-standard);",
		);
	});

	/**
	 * Do not write the value as a number in place. A literal becomes a second source that does not
	 * follow when the token changes.
	 */
	it("points at a variable rather than writing a number", () => {
		expect(css()).not.toMatch(/--default-transition-duration:\s*\d/);
		expect(css()).not.toMatch(/--default-transition-timing-function:\s*cubic/);
	});
});

describe("themes share one vocabulary", () => {
	/**
	 * A color defined in only one theme is `undefined` in the other, and React Native silently drops
	 * that style. The result is text that disappears only in dark mode. The type `darkColors:
	 * Record<ColorName, string>` checks this, but generated output is produced outside the type
	 * system.
	 */
	it("light, dark and native share one key set", () => {
		const expected = [...colorNames].sort();
		for (const [label, table] of [
			["light", lightColors],
			["dark", darkColors],
			["native light", nativeLightColors],
			["native dark", nativeDarkColors],
		] as const)
			expect(Object.keys(table).sort(), label).toEqual(expected);
	});

	it("every native value is #rrggbb", () => {
		for (const name of colorNames) {
			expect(nativeLightColors[name], name).toMatch(/^#[0-9a-f]{6}$/);
			expect(nativeDarkColors[name], name).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});

describe("both radius versions say the same value", () => {
	/**
	 * Web reads `0.625rem` and native reads `10`. With the browser's default root font size (16px)
	 * they are the same value. If that equality breaks, the corner radii of the two apps diverge.
	 */
	it("radiusBasePx equals the rem value in pixels", () => {
		expect(radiusBasePx).toBe(Number.parseFloat(radius) * 16);
	});

	/** Same arithmetic as the `@theme inline` block in the web CSS. */
	it("derived radii match the CSS calc", () => {
		expect(radiusScale.sm).toBe(radiusBasePx - 4);
		expect(radiusScale.md).toBe(radiusBasePx - 2);
		expect(radiusScale.lg).toBe(radiusBasePx);
		expect(radiusScale.xl).toBe(radiusBasePx + 4);
	});
});

describe("alpha dims the color, not the children", () => {
	it("applies opacity to #rrggbb", () => {
		expect(withAlpha("#fb2c36", 0.1)).toBe("rgba(251, 44, 54, 0.1)");
	});

	/** Silently accepting an unknown shape would draw an opaque surface and hide the text on it. */
	it("unknown shapes throw", () => {
		expect(() => withAlpha("oklch(0.5 0 0)", 0.1)).toThrow();
	});
});

/**
 * Checks that the brand purple is readable.
 *
 * The value checks above confirm that colors do not diverge, but they cannot catch a case where
 * both sides are unreadable in the same way. This repo has hit that failure twice: primary-surface
 * icons drawn in the same black in light mode (see the header of ui-native/semantics.test.ts), and
 * dark-mode `destructive` falling to 1.98:1, which hid the autosave failure message. Neither type
 * checks nor rendering caught either case.
 *
 * So contrast is locked by value. A commit that brightens a token by one step should fail this
 * check first.
 */

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5]
		.map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast between two oklch tokens, measured on the sRGB values native actually draws. */
function contrast(a: string, b: string): number {
	const [x, y] = [luminance(oklchToHex(a)), luminance(oklchToHex(b))];
	const [hi, lo] = x > y ? [x, y] : [y, x];
	return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
	["light", lightColors],
	["dark", darkColors],
] as const;

describe("the brand purple reads in both themes", () => {
	/**
	 * Everything drawn on this surface is normal-size text: button labels, badges, user message
	 * bubbles and checkmarks. A loose threshold for large text (3:1) would make all four depend on
	 * that exception.
	 */
	const AA_TEXT = 4.5;
	/** A focus indicator is not text. It falls under WCAG 1.4.11 non-text contrast. */
	const AA_NON_TEXT = 3;

	it.each(
		THEMES,
	)("%s: the foreground on the primary surface passes AA", (_theme, c) => {
		expect(contrast(c.primary, c["primary-foreground"])).toBeGreaterThanOrEqual(
			AA_TEXT,
		);
		expect(
			contrast(c["sidebar-primary"], c["sidebar-primary-foreground"]),
		).toBeGreaterThanOrEqual(AA_TEXT);
	});

	/**
	 * `text-primary` also serves as text on the page background, not only as a surface. In light theme
	 * it passes AA (4.92:1). In dark theme it cannot pass. The same value must also be the text on the
	 * primary surface, and the two requirements pull brightness in opposite directions with no
	 * overlapping range. The reasoning for choosing the surface role is in the header of tokens.ts.
	 *
	 * So the dark theme is locked at the large-text and non-text threshold (3:1). That is the maximum
	 * reachable value, not a relaxation. Any change that goes lower fails here.
	 */
	it("light: the primary color reads as text on the background", () => {
		expect(
			contrast(lightColors.primary, lightColors.background),
		).toBeGreaterThanOrEqual(AA_TEXT);
		expect(
			contrast(lightColors["sidebar-primary"], lightColors.sidebar),
		).toBeGreaterThanOrEqual(AA_TEXT);
	});

	it("dark: the primary color at least stands out on the background", () => {
		expect(
			contrast(darkColors.primary, darkColors.background),
		).toBeGreaterThanOrEqual(AA_NON_TEXT);
		expect(
			contrast(darkColors["sidebar-primary"], darkColors.sidebar),
		).toBeGreaterThanOrEqual(AA_NON_TEXT);
	});

	/**
	 * That tradeoff is arithmetic, not taste.
	 *
	 * Without this check, the next person would read dark `text-primary` as a value nobody cared about
	 * and brighten it, which breaks button labels instead. The check records as values that the
	 * luminance ranges the two requirements need really do not overlap. That fact is independent of
	 * hue and chroma.
	 */
	it("in the dark theme the two requirements conflict", () => {
		const y = (token: string) => luminance(oklchToHex(token));
		const surfaceCeiling =
			(y(darkColors["primary-foreground"]) + 0.05) / AA_TEXT - 0.05;
		const textFloor = AA_TEXT * (y(darkColors.background) + 0.05) - 0.05;

		expect(surfaceCeiling).toBeLessThan(textFloor);
		expect(y(darkColors.primary)).toBeLessThanOrEqual(surfaceCeiling);
	});

	it.each(
		THEMES,
	)("%s: the focus ring stands out on the background", (_theme, c) => {
		expect(contrast(c.ring, c.background)).toBeGreaterThanOrEqual(AA_NON_TEXT);
		expect(contrast(c["sidebar-ring"], c.sidebar)).toBeGreaterThanOrEqual(
			AA_NON_TEXT,
		);
	});

	/**
	 * The focus indicator must be less vivid than the primary surface, and the axis for that is
	 * chroma, not lightness.
	 *
	 * An earlier version described this as 'less separated from the background.' That comparison only
	 * made sense in light theme, where the primary surface differs strongly from the background. In
	 * dark theme the primary surface is mid-brightness, so the two end up close, and the check breaks
	 * whenever a lightness step moves for no real reason.
	 *
	 * What creates the hierarchy is chroma and area. The focus indicator is a 1px border with a
	 * translucent halo, while the primary surface is a filled area.
	 */
	it.each(
		THEMES,
	)("%s: the focus ring is less vivid than the primary surface", (_theme, c) => {
		const chroma = (token: string) =>
			Number(/^oklch\([\d.]+ ([\d.]+)/.exec(token)?.[1]);
		expect(chroma(c.ring)).toBeLessThan(chroma(c.primary));
		expect(chroma(c["sidebar-ring"])).toBeLessThan(
			chroma(c["sidebar-primary"]),
		);
	});
});

describe("the brand purple comes from one hue", () => {
	/**
	 * The canonical brand color is `oklch(0.599 0.23 286.2)`. Its identity is the hue (`BRAND_HUE`),
	 * not the literal value.
	 */
	const BRAND_HUE = 286.2;

	const BRAND_TOKENS = [
		"primary",
		"sidebar-primary",
		"ring",
		"sidebar-ring",
	] as const;

	const parse = (value: string) => {
		const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
		if (!match) throw new Error(`color token is not oklch(): ${value}`);
		return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
	};

	/**
	 * Lightness and chroma differ per theme, but the hue is shared. If hues diverge, the same
	 * product's buttons and focus rings end up in subtly different purples. The difference only shows
	 * when they are compared side by side.
	 */
	it.each(THEMES)("%s: the purple family shares one hue", (_theme, c) => {
		for (const name of BRAND_TOKENS)
			expect(parse(c[name]).h, name).toBe(BRAND_HUE);
	});

	/**
	 * Stays inside the sRGB gamut.
	 *
	 * `oklch.ts` clips values that fall outside sRGB, and browsers apply their own gamut mapping.
	 * Clipped values therefore differ between web and native. The drift check above cannot catch this,
	 * because both sides come from the same source and both are 'correct'. The symptom appears only on
	 * phones.
	 *
	 * The check lowers chroma slightly and looks at whether blue still moves. Inside the gamut, blue
	 * drops by that amount. If the value was already clipped, the overflow is consumed first and blue
	 * stays pinned at 255. The point is to call the existing converter twice rather than implement a
	 * second one.
	 */
	it.each(THEMES)("%s: the purple family is inside sRGB", (_theme, c) => {
		const blue = (value: string) => oklchToHex(value).slice(5, 7);
		for (const name of BRAND_TOKENS) {
			const { l, c: chroma, h } = parse(c[name]);
			expect(blue(`oklch(${l} ${chroma - 0.02} ${h})`), name).not.toBe(
				blue(c[name]),
			);
		}
	});
});
