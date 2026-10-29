import { describe, expect, it } from "vitest";
import {
	contrastRatio,
	hasThemeColorOverrides,
	MANAGED_THEME_COLOR_NAMES,
	readableForegroundOn,
	relativeLuminance,
	resolveThemeColorOverrides,
	subduedForegroundOn,
	surfaceFamily,
	THEME_CUSTOMIZATION_SLOTS,
	THEME_FOREGROUND_ON_DARK,
	THEME_FOREGROUND_ON_LIGHT,
	themeSurfaceScheme,
	WCAG_AA_CONTRAST,
} from "./theme-customization.ts";
import { resolveThemePresetOverrides } from "./theme-preset.ts";
import { nativeDarkColors, nativeLightColors } from "./tokens.native.ts";

/**
 * Rules for resolving account colors: text must stay readable, and the output must not overflow the
 * managed list. The failures are silent. A wrong foreground makes text disappear on that account's
 * screen only. If the override table overflows the managed list, a color the user never chose is
 * painted onto the destructive button. Neither the type system nor rendering catches either case.
 */

describe("the vocabulary is closed", () => {
	it("there are three choosable cells", () => {
		expect([...THEME_CUSTOMIZATION_SLOTS]).toEqual([
			"background",
			"surface",
			"primary",
		]);
	});

	/**
	 * No layer paints semantic colors. Destructive, warning and chart colors belong to the product. If
	 * any of them entered, a red that means 'cannot be undone' would be painted as a matter of taste.
	 *
	 * muted, border, secondary and similar tokens are now painted by presets and also derived for
	 * custom surfaces. The derived colors are produced by our rules, not sent by the member, so that
	 * is allowed. Without it, a black preset border would remain beside a blue card. These tokens are
	 * on the managed list as things to clear, not as things members can choose. The 'arbitrary colors
	 * do not widen' block below enforces that distinction.
	 */
	it("the managed set has no semantic or chart colors", () => {
		for (const forbidden of [
			"destructive",
			"destructive-foreground",
			"chart-1",
			"chart-2",
			"chart-3",
			"chart-4",
			"chart-5",
		])
			expect(MANAGED_THEME_COLOR_NAMES, forbidden).not.toContain(forbidden);
	});

	/**
	 * No duplicate names in the managed list. Clearing twice would be harmless, but a duplicate
	 * signals a mistake.
	 */
	it("the managed list has no duplicates", () => {
		expect(new Set(MANAGED_THEME_COLOR_NAMES).size).toBe(
			MANAGED_THEME_COLOR_NAMES.length,
		);
	});

	/**
	 * The managed list is a subset of the real token vocabulary, so no nonexistent name is painted.
	 */
	it("the managed list is all real color names", () => {
		for (const name of MANAGED_THEME_COLOR_NAMES)
			expect(nativeLightColors, name).toHaveProperty(name);
	});
});

describe("appearance is not an argument of resolution", () => {
	/**
	 * The single-palette rule is encoded in the signature. A scheme argument would make 'custom colors
	 * vary by appearance' expressible, and consumers would start imagining two palettes. Appearance
	 * changes only the tokens the user did not pick.
	 */
	it("the resolver takes one argument", () => {
		expect(resolveThemeColorOverrides.length).toBe(1);
	});

	it("the same selection is always the same override", () => {
		const customization = { background: "#171923" };
		expect(resolveThemeColorOverrides(customization)).toEqual(
			resolveThemeColorOverrides({ ...customization }),
		);
	});
});

describe("foreground candidates do not drift from the product tokens", () => {
	/**
	 * If these two literals drift from the generated values, only text on a custom background becomes
	 * a color RowCat does not normally use. That difference only shows when two screens are compared
	 * side by side.
	 */
	it("matches both versions of the semantic foreground token", () => {
		expect(THEME_FOREGROUND_ON_LIGHT).toBe(nativeLightColors.foreground);
		expect(THEME_FOREGROUND_ON_DARK).toBe(nativeDarkColors.foreground);
	});
});

describe("the foreground is chosen by luminance", () => {
	/**
	 * Choosing by channel sum fails for this pair. #0000ff and #00ff00 have the same sum, but their
	 * luminance differs by more than ten times, and a sum-based rule would put black text on a blue
	 * background.
	 */
	it("equal channel sums can differ in luminance", () => {
		expect(relativeLuminance("#00ff00")).toBeGreaterThan(
			relativeLuminance("#0000ff") * 5,
		);
		expect(readableForegroundOn("#0000ff")).toBe(THEME_FOREGROUND_ON_DARK);
		expect(readableForegroundOn("#00ff00")).toBe(THEME_FOREGROUND_ON_LIGHT);
	});

	it("very light surfaces get dark text", () => {
		for (const surface of ["#ffffff", "#fffaf2", "#f4f4f5"]) {
			expect(readableForegroundOn(surface), surface).toBe(
				THEME_FOREGROUND_ON_LIGHT,
			);
			expect(
				contrastRatio(surface, readableForegroundOn(surface)),
				surface,
			).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
		}
	});

	it("very dark surfaces get light text", () => {
		for (const surface of ["#000000", "#10131a", "#181c26"]) {
			expect(readableForegroundOn(surface), surface).toBe(
				THEME_FOREGROUND_ON_DARK,
			);
			expect(
				contrastRatio(surface, readableForegroundOn(surface)),
				surface,
			).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
		}
	});

	it("text on the accent color is readable", () => {
		for (const primary of ["#ffd400", "#0b3d2e", "#7452f5", "#4f46e5"])
			expect(
				contrastRatio(primary, readableForegroundOn(primary)),
				primary,
			).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
	});

	/**
	 * Some colors reach WCAG AA with neither candidate, for example the mid-lightness, high-chroma
	 * #7957ff
	 * (4.35 with light text, 4.38 with dark text). Such a color is not rejected: rejection would leave
	 * the user without an explanation, and silently lightening it would paint a color they did not
	 * pick. The rule stays single: pick whichever candidate is better.
	 */
	it("picks the better one even when neither reaches AA", () => {
		const primary = "#7957ff";
		const chosen = readableForegroundOn(primary);
		const other =
			chosen === THEME_FOREGROUND_ON_DARK
				? THEME_FOREGROUND_ON_LIGHT
				: THEME_FOREGROUND_ON_DARK;
		expect(contrastRatio(primary, chosen)).toBeGreaterThanOrEqual(
			contrastRatio(primary, other),
		);
		expect(contrastRatio(primary, chosen)).toBeLessThan(WCAG_AA_CONTRAST);
	});

	/**
	 * Also checked as a property: a grid sweep confirms that the chosen side is always the better one,
	 * not just for a random sample.
	 */
	it("picks the higher contrast on any color", () => {
		for (let r = 0; r < 256; r += 51)
			for (let g = 0; g < 256; g += 51)
				for (let b = 0; b < 256; b += 51) {
					const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
					const chosen = readableForegroundOn(hex);
					const other =
						chosen === THEME_FOREGROUND_ON_DARK
							? THEME_FOREGROUND_ON_LIGHT
							: THEME_FOREGROUND_ON_DARK;
					expect(contrastRatio(hex, chosen), hex).toBeGreaterThanOrEqual(
						contrastRatio(hex, other),
					);
				}
	});
});

describe("one cell covers only its own share", () => {
	it("an empty selection makes nothing", () => {
		expect(resolveThemeColorOverrides({})).toEqual({});
		expect(resolveThemeColorOverrides(undefined)).toEqual({});
		expect(resolveThemeColorOverrides(null)).toEqual({});
		expect(hasThemeColorOverrides(resolveThemeColorOverrides({}))).toBe(false);
	});

	it("background covers only the background and its foreground", () => {
		const overrides = resolveThemeColorOverrides({ background: "#10131a" });
		expect(overrides).toEqual({
			background: "#10131a",
			foreground: THEME_FOREGROUND_ON_DARK,
		});
	});

	/**
	 * One surface color now covers the whole neutral UI family. Earlier only three surfaces were
	 * covered, and the screen was left with a black preset border beside a blue card, a mixed screen
	 * no one had chosen.
	 */
	it("surface covers surfaces, layers, borders and their foregrounds", () => {
		const overrides = resolveThemeColorOverrides({ surface: "#ffffff" });
		expect(Object.keys(overrides).sort()).toEqual(
			[
				"card",
				"card-foreground",
				"popover",
				"popover-foreground",
				"sidebar",
				"sidebar-foreground",
				"secondary",
				"secondary-foreground",
				"muted",
				"muted-foreground",
				"accent",
				"accent-foreground",
				"sidebar-accent",
				"sidebar-accent-foreground",
				"border",
				"input",
				"sidebar-border",
			].sort(),
		);
		/**
		 * The chosen color stands unchanged on the main surfaces. Derivation starts at the layers above
		 * them.
		 */
		expect(overrides.card).toBe("#ffffff");
		expect(overrides.popover).toBe("#ffffff");
		expect(overrides.sidebar).toBe("#ffffff");
		expect(overrides["card-foreground"]).toBe(THEME_FOREGROUND_ON_LIGHT);
	});

	/**
	 * The surface family is not derived from the background. The three slots are independent by
	 * design.
	 */
	it("choosing only the background makes no neutral family", () => {
		const overrides = resolveThemeColorOverrides({ background: "#fffaf2" });
		for (const name of ["card", "muted", "secondary", "border", "input"])
			expect(Object.keys(overrides), name).not.toContain(name);
	});

	it("accent covers emphasis and the focus ring", () => {
		const overrides = resolveThemeColorOverrides({ primary: "#7957ff" });
		expect(Object.keys(overrides).sort()).toEqual(
			[
				"primary",
				"primary-foreground",
				"ring",
				"sidebar-primary",
				"sidebar-primary-foreground",
				"sidebar-ring",
			].sort(),
		);
		expect(overrides.primary).toBe("#7957ff");
		expect(overrides["sidebar-primary"]).toBe("#7957ff");
	});

	it("no combination exceeds the managed list", () => {
		const overrides = resolveThemeColorOverrides({
			background: "#10131a",
			surface: "#181c26",
			primary: "#9a83ff",
		});
		for (const name of Object.keys(overrides))
			expect(MANAGED_THEME_COLOR_NAMES, name).toContain(name);
	});
});

describe("custom colors do not widen", () => {
	/**
	 * Members still send exactly three slots. A wider surface family is not a reason to widen the
	 * table: that would let members paint arbitrary semantic tokens. The extra colors are derived, and
	 * the rule that produces them is code in this file, not member input.
	 */
	it("there are still three choosable cells", () => {
		expect(THEME_CUSTOMIZATION_SLOTS.length).toBe(3);
	});

	it("user input cannot paint semantic or chart colors", () => {
		const overrides = resolveThemeColorOverrides({
			background: "#10131a",
			surface: "#181c26",
			primary: "#9a83ff",
		});
		for (const forbidden of [
			"destructive",
			"destructive-foreground",
			"chart-1",
			"chart-2",
			"chart-3",
			"chart-4",
			"chart-5",
		])
			expect(Object.keys(overrides), forbidden).not.toContain(forbidden);
	});

	/**
	 * The reset path must know every derived color. Painting beyond the managed list would leave those
	 * colors inline on an account that was reset, and they would persist until a reload.
	 */
	it("every derived color is in the managed list", () => {
		const overrides = resolveThemeColorOverrides({
			background: "#10131a",
			surface: "#181c26",
			primary: "#9a83ff",
		});
		for (const name of Object.keys(overrides))
			expect(MANAGED_THEME_COLOR_NAMES, name).toContain(name);
	});
});

/**
 * Surface family: checks that the relationships promised by the preview hold on the real screen.
 * Each failure is silent. A layer that matches its surface erases hover feedback. A border that
 * matches its surface erases input outlines. Subdued text that matches body text erases the
 * hierarchy. None raises an error, and each shows only to the person who chose that color.
 */
describe("the surface is the neutral family's reference point", () => {
	const SURFACES = [
		"#181c26",
		"#10131a",
		"#000000",
		"#ffffff",
		"#fffaf2",
		"#16324f",
		"#f4f4f5",
		"#52525c",
		"#0b3d2e",
		"#ffd400",
	];

	it("surface, layer and border are different colors", () => {
		for (const surface of SURFACES) {
			const family = surfaceFamily(surface);
			expect(family.base, surface).toBe(surface);
			expect(family.raised, surface).not.toBe(family.base);
			expect(family.edge, surface).not.toBe(family.raised);
			expect(family.edge, surface).not.toBe(family.base);
		}
	});

	/**
	 * The border is farther from the surface than the layer is; otherwise the border blends into the
	 * hover surface.
	 */
	it("the border is farther from the surface than the layer", () => {
		for (const surface of SURFACES) {
			const family = surfaceFamily(surface);
			const distance = (hex: string) =>
				Math.abs(relativeLuminance(hex) - relativeLuminance(surface));
			expect(distance(family.edge), surface).toBeGreaterThan(
				distance(family.raised),
			);
		}
	});

	it("dark surfaces derive lighter, light surfaces derive darker", () => {
		const dark = surfaceFamily("#10131a");
		expect(relativeLuminance(dark.raised)).toBeGreaterThan(
			relativeLuminance(dark.base),
		);
		expect(relativeLuminance(dark.edge)).toBeGreaterThan(
			relativeLuminance(dark.raised),
		);

		const light = surfaceFamily("#ffffff");
		expect(relativeLuminance(light.raised)).toBeLessThan(
			relativeLuminance(light.base),
		);
		expect(relativeLuminance(light.edge)).toBeLessThan(
			relativeLuminance(light.raised),
		);
	});

	it("derived colors stay in the same hue", () => {
		const family = surfaceFamily("#16324f");
		for (const derived of [family.raised, family.edge]) {
			const rgb = [1, 3, 5].map((i) =>
				Number.parseInt(derived.slice(i, i + 2), 16),
			) as [number, number, number];
			/** Because the surface is blue, the channel order blue > green > red must hold. */
			expect(rgb[2], derived).toBeGreaterThan(rgb[1]);
			expect(rgb[1], derived).toBeGreaterThan(rgb[0]);
		}
	});

	/** Even at the extremes (pure white and black), a step between levels remains after clipping. */
	it("the steps hold at the extremes", () => {
		for (const surface of ["#000000", "#ffffff"]) {
			const family = surfaceFamily(surface);
			expect(family.raised, surface).not.toBe(surface);
			expect(family.edge, surface).not.toBe(family.raised);
		}
	});

	it("the same surface always makes the same family", () => {
		expect(surfaceFamily("#16324f")).toEqual(surfaceFamily("#16324f"));
	});
});

describe("muted text is dimmer but readable", () => {
	const SURFACES = ["#ffffff", "#f4f4f5", "#27272a", "#181c26", "#16324f"];

	it("dimmer than the body text color", () => {
		for (const surface of SURFACES) {
			const subdued = subduedForegroundOn(surface);
			expect(subdued, surface).not.toBe(readableForegroundOn(surface));
			expect(contrastRatio(surface, subdued), surface).toBeLessThan(
				contrastRatio(surface, readableForegroundOn(surface)),
			);
		}
	});

	it("still reaches AA", () => {
		for (const surface of SURFACES)
			expect(
				contrastRatio(surface, subduedForegroundOn(surface)),
				surface,
			).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
	});

	/**
	 * Some surfaces (mid-lightness, high-chroma) cannot reach AA at any point. In that case the text
	 * is not subdued: readability takes precedence over hierarchy.
	 */
	it("on unreadable surfaces it is the body text color", () => {
		const surface = "#7957ff";
		expect(subduedForegroundOn(surface)).toBe(readableForegroundOn(surface));
	});
});

/**
 * Two real palettes: the relationships promised by the preview must hold as concrete values. These
 * two groups are the acceptance criteria for this slice. Background, surface and accent must match
 * the chosen values exactly. The remaining neutral tokens must come from the chosen surface, not
 * from the base or preset palette.
 */
describe("dark custom palette", () => {
	const CUSTOM = {
		background: "#10131a",
		surface: "#181c26",
		primary: "#9a83ff",
	};
	const overrides = resolveThemeColorOverrides(CUSTOM);

	it("the chosen colors stand as is", () => {
		expect(overrides.background).toBe("#10131a");
		expect(overrides.card).toBe("#181c26");
		expect(overrides.popover).toBe("#181c26");
		expect(overrides.sidebar).toBe("#181c26");
		expect(overrides.primary).toBe("#9a83ff");
	});

	/** No zinc neutrals from the black preset remain; all of them come from the chosen surface. */
	it("the neutral family comes from the chosen surface", () => {
		const black = resolveThemePresetOverrides("black");
		for (const name of [
			"secondary",
			"muted",
			"accent",
			"border",
			"input",
			"sidebar-accent",
			"sidebar-border",
		] as const) {
			expect(overrides[name], name).toBeDefined();
			expect(overrides[name], name).not.toBe(black[name]);
		}
		expect(relativeLuminance(overrides.muted as string)).toBeGreaterThan(
			relativeLuminance("#181c26"),
		);
		expect(relativeLuminance(overrides.border as string)).toBeGreaterThan(
			relativeLuminance(overrides.muted as string),
		);
	});
});

describe("light custom palette", () => {
	const overrides = resolveThemeColorOverrides({
		background: "#fffaf2",
		surface: "#ffffff",
		primary: "#5b4bdb",
	});

	it("the chosen colors stand as is", () => {
		expect(overrides.background).toBe("#fffaf2");
		expect(overrides.card).toBe("#ffffff");
		expect(overrides.primary).toBe("#5b4bdb");
	});

	/** On a white surface, the white layer and white border must not merge into one flat area. */
	it("layers and borders are visible on white surfaces", () => {
		expect(overrides.muted).not.toBe("#ffffff");
		expect(overrides.border).not.toBe("#ffffff");
		expect(overrides.border).not.toBe(overrides.muted);
		expect(relativeLuminance(overrides.border as string)).toBeLessThan(
			relativeLuminance(overrides.muted as string),
		);
	});
});

/**
 * A custom surface must override a preset of the opposite character. This is the defect this slice
 * fixes. Composition happens in theme-effective.ts, but it only works if this file's output covers
 * the neutral slots the preset sets. If the coverage is narrower, a light custom surface on a black
 * preset keeps black borders beside it.
 */
describe("a custom surface overrides the preset's neutral family", () => {
	const NEUTRAL = [
		"card",
		"popover",
		"sidebar",
		"secondary",
		"muted",
		"accent",
		"border",
		"input",
		"sidebar-accent",
		"sidebar-border",
	] as const;

	it("black preset + light custom surface", () => {
		const effective = {
			...resolveThemePresetOverrides("black"),
			...resolveThemeColorOverrides({ surface: "#ffffff" }),
		};
		for (const name of NEUTRAL)
			expect(
				relativeLuminance(effective[name] as string),
				name,
			).toBeGreaterThan(0.5);
	});

	it("white preset + dark custom surface", () => {
		const effective = {
			...resolveThemePresetOverrides("white"),
			...resolveThemeColorOverrides({ surface: "#16324f" }),
		};
		for (const name of NEUTRAL)
			expect(relativeLuminance(effective[name] as string), name).toBeLessThan(
				0.2,
			);
	});

	it("clearing the custom surface leaves the preset values", () => {
		const black = resolveThemePresetOverrides("black");
		const effective = {
			...resolveThemePresetOverrides("black"),
			...resolveThemeColorOverrides({}),
		};
		expect(effective).toEqual(black);
	});
});

describe("choosing one cell does not touch the others", () => {
	it("background only", () => {
		expect(
			Object.keys(resolveThemeColorOverrides({ background: "#10131a" })).sort(),
		).toEqual(["background", "foreground"]);
	});

	it("accent only", () => {
		const overrides = resolveThemeColorOverrides({ primary: "#5b4bdb" });
		for (const name of ["card", "muted", "border", "background"])
			expect(Object.keys(overrides), name).not.toContain(name);
	});

	it("surface only", () => {
		const overrides = resolveThemeColorOverrides({ surface: "#16324f" });
		for (const name of ["background", "foreground", "primary", "ring"])
			expect(Object.keys(overrides), name).not.toContain(name);
	});
});

describe("every derived foreground is readable", () => {
	const PAIRS = [
		["card", "card-foreground"],
		["popover", "popover-foreground"],
		["sidebar", "sidebar-foreground"],
		["secondary", "secondary-foreground"],
		["muted", "muted-foreground"],
		["accent", "accent-foreground"],
		["sidebar-accent", "sidebar-accent-foreground"],
		["primary", "primary-foreground"],
		["background", "foreground"],
	] as const;

	for (const palette of [
		{ background: "#10131a", surface: "#181c26", primary: "#9a83ff" },
		{ background: "#fffaf2", surface: "#ffffff", primary: "#5b4bdb" },
		{ background: "#16324f", surface: "#1d3f63", primary: "#ffd400" },
	])
		it(`pairs in the ${palette.surface} palette reach AA`, () => {
			const overrides = resolveThemeColorOverrides(palette);
			for (const [surface, foreground] of PAIRS) {
				const face = overrides[surface];
				const text = overrides[foreground];
				expect(face, surface).toBeDefined();
				expect(text, foreground).toBeDefined();
				expect(
					contrastRatio(face as string, text as string),
					`${surface}/${foreground}`,
				).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
			}
		});
});

describe("malformed values fold to absent", () => {
	it("malformed values make no override", () => {
		for (const bad of [
			"red",
			"#fff",
			"#12345678",
			"rgb(1,2,3)",
			"var(--x)",
			"url(x)",
			'"; color:red',
			"",
			"  ",
		])
			expect(resolveThemeColorOverrides({ background: bad }), bad).toEqual({});
	});

	it("uppercase input folds to lowercase", () => {
		expect(resolveThemeColorOverrides({ primary: "#7957FF" }).primary).toBe(
			"#7957ff",
		);
	});
});

describe("does not touch the input", () => {
	it("the passed object stays unchanged", () => {
		const customization = { background: "#10131a" };
		const snapshot = { ...customization };
		resolveThemeColorOverrides(customization);
		expect(customization).toEqual(snapshot);
	});
});

/**
 * Platform chrome appearance: derived from the surface, not from the device preference. The failure
 * this group guards against is outside the app's own screen: the mobile status bar icons, and the
 * browser's scrollbars and default form controls. None of them read our tokens, so when the
 * effective background flips there is no warning. The symptom is black icons on a black screen.
 */
describe("surface lightness decides the platform chrome's appearance", () => {
	it("a white surface is light", () => {
		expect(themeSurfaceScheme("#ffffff")).toBe("light");
	});

	/**
	 * RowCat's default dark background, checked against the product's real value rather than a copied
	 * literal.
	 */
	it("the default dark background is dark", () => {
		expect(themeSurfaceScheme(nativeDarkColors.background)).toBe("dark");
	});

	it("the default light background is light", () => {
		expect(themeSurfaceScheme(nativeLightColors.background)).toBe("light");
	});

	/**
	 * Preset color literals are not copied here. A copy would go stale when the palette is tuned, and
	 * the test would stay green while asserting that the old black was dark, not that the black preset
	 * is dark.
	 */
	it("the black preset's background is dark", () => {
		const background = resolveThemePresetOverrides("black").background;
		expect(background).toBeDefined();
		expect(themeSurfaceScheme(background as string)).toBe("dark");
	});

	it("the white preset's background is light", () => {
		const background = resolveThemePresetOverrides("white").background;
		expect(background).toBeDefined();
		expect(themeSurfaceScheme(background as string)).toBe("light");
	});

	/**
	 * The gray preset is the most useful case in this group. Mid-gray steps are hard to judge by eye,
	 * so the appearance decision must use the same rule as foreground selection. If they diverge here,
	 * on that preset alone the text is light while the status bar switches to the light scheme.
	 */
	it("the gray preset's background verdict matches the foreground choice", () => {
		const background = resolveThemePresetOverrides("gray").background;
		expect(background).toBeDefined();
		expect(themeSurfaceScheme(background as string)).toBe(
			readableForegroundOn(background as string) === THEME_FOREGROUND_ON_DARK
				? "dark"
				: "light",
		);
	});

	/**
	 * Claims that no second luminance formula exists: for any color the two decisions pair up. A
	 * channel-sum shortcut would diverge at once on blue/green pairs.
	 */
	it("foreground and chrome appearance always pair", () => {
		for (const color of [
			"#000000",
			"#0000ff",
			"#00ff00",
			"#71717b",
			"#9f9fa9",
			"#fafafa",
			"#ffffff",
			"#18181b",
		])
			expect(themeSurfaceScheme(color), color).toBe(
				readableForegroundOn(color) === THEME_FOREGROUND_ON_DARK
					? "dark"
					: "light",
			);
	});

	/** Non-hex input does not throw; the worst result is the dark scheme, not an exception. */
	it("does not throw on malformed values", () => {
		expect(themeSurfaceScheme("nope")).toBe("dark");
	});
});
