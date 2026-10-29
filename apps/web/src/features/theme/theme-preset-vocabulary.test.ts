import {
	DEFAULT_THEME_PRESET,
	ThemeCustomizationDto,
	ThemeGradientDto,
	ThemePreset,
} from "@rowcat/contracts";
import {
	DEFAULT_THEME_PRESET as DESIGN_DEFAULT,
	isThemeGradientAngle,
	isThemePreset,
	resolveThemeColorOverrides,
	resolveThemeGradient,
	resolveThemePresetOverrides,
	THEME_CUSTOMIZATION_SLOTS,
	THEME_GRADIENT_ANGLE_MAX,
	THEME_GRADIENT_ANGLE_MIN,
	THEME_PRESETS,
	type ThemeGradient,
} from "@rowcat/design";
import { describe, expect, it } from "vitest";
import { themePresetLabel } from "#/features/settings/theme-customization-state.ts";
import { settings } from "#/lib/i18n/messages/en/settings.ts";

/**
 * The preset vocabulary lives in two places. This test checks that the two never diverge.
 *
 * Why two copies: package direction. @rowcat/design depends on nothing (it is pure values), and
 * @rowcat/contracts depends only on zod. If either imported the other, the direction this repo has
 * maintained would break:
 * - design -> contracts: color rules learn the wire shape (the design package header records its
 *   absence).
 * - contracts -> design: the contract learns color values, and tuning the palette becomes a
 *   contract change.
 *
 * So there are two vocabularies, and the test enforces their equivalence. This is the same axis as
 * the three copies of compareRev. The check lives at the assembly point (apps/web) because only
 * there can both packages be imported together.
 *
 * When they diverge, the symptom is silent. A value added to the contract but not to the design
 * palette is stored and returned in responses, yet it creates no colors, so the user sees the
 * default theme. The reverse direction produces a palette the screen cannot draw.
 */

describe("contracts and design share one vocabulary", () => {
	/**
	 * The list must match in the same order, because the screen draws cards in the design package's
	 * order.
	 */
	it("the preset lists match", () => {
		expect([...THEME_PRESETS]).toEqual(ThemePreset.options);
	});

	it("the defaults match", () => {
		expect(DESIGN_DEFAULT).toBe(DEFAULT_THEME_PRESET);
		expect(DEFAULT_THEME_PRESET).toBe("default");
	});

	/**
	 * A value that passes the contract must always have a palette, including `default` whose table is
	 * empty. If this pairing breaks, saving works but the preset produces no color.
	 */
	it("design knows every value the contract accepts", () => {
		for (const preset of ThemePreset.options) {
			expect(isThemePreset(preset), preset).toBe(true);
			expect(() => resolveThemePresetOverrides(preset), preset).not.toThrow();
		}
	});

	/** The reverse: every value the design package knows must pass the contract. */
	it("every value design knows passes the contract", () => {
		for (const preset of THEME_PRESETS)
			expect(ThemePreset.safeParse(preset).success, preset).toBe(true);
	});

	/**
	 * The screen's label table must also cover the whole vocabulary. `Record<ThemePreset, string>`
	 * already enforces this at compile time, but if that type loosens (to Partial or string keys),
	 * this check remains. A card without a name would draw as an empty chip and raise no error.
	 */
	it("the screen copy covers the whole vocabulary", () => {
		expect(Object.keys(settings.theme.preset).sort()).toEqual(
			[...ThemePreset.options].sort(),
		);
		for (const preset of ThemePreset.options)
			expect(themePresetLabel(preset), preset).toBeTruthy();
	});
});

describe("the vocabulary really is closed", () => {
	/**
	 * Unknown values must be rejected on both sides. If only one side is lenient, that side becomes
	 * the source of truth, and storage then holds values the other side cannot parse.
	 */
	it("both reject unknown values", () => {
		for (const bad of ["dark", "light", "custom", "WHITE", "Black", ""]) {
			expect(ThemePreset.safeParse(bad).success, bad).toBe(false);
			expect(isThemePreset(bad), bad).toBe(false);
		}
	});

	/**
	 * The contract does not fold case. Unlike color strings, this is a vocabulary. Folding it would
	 * create two canonical stored values (`white` and `WHITE`). The design side must make the same
	 * decision; if only one side folds, `WHITE` is saved but cannot produce a color.
	 */
	it("case is not folded", () => {
		expect(ThemePreset.safeParse("WHITE").success).toBe(false);
		expect(isThemePreset("WHITE")).toBe(false);
	});
});

/**
 * Vocabulary of custom colors: the accepted slots stay at three even as derived outputs widen.
 *
 * One surface now generates the whole neutral UI family, so the resolver's output has grown to
 * twenty-five. The most natural next step is dangerous: 'since muted is painted anyway, let members
 * pick it directly.' That would turn the feature from choosing three colors into injecting
 * arbitrary semantic tokens, and widen the server's attack surface.
 *
 * This test compares two axes: the accepted slots (three) and the generated colors (many). Both sit
 * in the same file because the asymmetry is deliberate, and nothing in the code states that in one
 * line.
 */
describe("three accepted slots even as derivation widens", () => {
	it("contracts and design know the same three slots", () => {
		expect([...THEME_CUSTOMIZATION_SLOTS]).toEqual([
			"background",
			"surface",
			"primary",
		]);
		for (const slot of THEME_CUSTOMIZATION_SLOTS)
			expect(
				ThemeCustomizationDto.safeParse({ [slot]: "#123456" }).success,
				slot,
			).toBe(true);
	});

	/**
	 * A derived name cannot be sent in a request. `.strict()` is the gate, and it rejects rather than
	 * silently dropping the field. A dropped field would give the sender a success response and the
	 * belief that their color was saved.
	 */
	it("derived token names are rejected in requests", () => {
		for (const name of [
			"muted",
			"muted-foreground",
			"secondary",
			"accent",
			"border",
			"input",
			"sidebar",
			"sidebar-accent",
			"foreground",
			"card",
			"popover",
			"ring",
			"destructive",
			"chart-1",
		])
			expect(
				ThemeCustomizationDto.safeParse({ [name]: "#123456" }).success,
				name,
			).toBe(false);
	});

	/** Those names are actually painted when derived, so the rejection is not a missing feature. */
	it("a rejected name is still painted when derived from the surface", () => {
		const overrides = resolveThemeColorOverrides({ surface: "#16324f" });
		for (const name of ["muted", "secondary", "accent", "border", "input"])
			expect(Object.keys(overrides), name).toContain(name);
	});
});

/**
 * Gradient vocabulary: the contract and the design package must know the same values. The
 * vocabulary lives in two places, with the same package direction as above. If they diverge, the
 * symptom is quiet. A contract-accepted angle that the resolver folds yields a gradient that is
 * saved but never painted. The reverse makes the screen paint a value that was never saved.
 */
describe("the gradient vocabulary does not split", () => {
	/** A value the contract accepts must always be painted, and the reverse holds too. */
	it("the angle predicate is the same", () => {
		for (const angle of [-1, 0, 1, 90, 359, 360, 361, 12.5, Number.NaN]) {
			const accepted = ThemeGradientDto.safeParse({
				to: "#123456",
				angle,
			}).success;
			expect(accepted, String(angle)).toBe(isThemeGradientAngle(angle));
		}
		expect(THEME_GRADIENT_ANGLE_MIN).toBe(0);
		expect(THEME_GRADIENT_ANGLE_MAX).toBe(359);
	});

	/** The contract's output is directly the design type. The assembly point checks this. */
	it("the contract's result goes into the resolver as is", () => {
		const parsed = ThemeGradientDto.parse({ to: "#4A1F5E", angle: 135 });
		const gradient: ThemeGradient = parsed;
		expect(resolveThemeGradient({ background: "#10131a", gradient })).toEqual({
			from: "#10131a",
			to: "#4a1f5e",
			angle: 135,
		});
	});

	/**
	 * CSS does not pass this grammar. The list guards the fact that no user input can become arbitrary
	 * style.
	 */
	it("rejects CSS, alpha and unknown keys", () => {
		for (const gradient of [
			{ to: "linear-gradient(135deg,#000,#fff)", angle: 135 },
			{ to: "url(evil.svg)", angle: 135 },
			{ to: "var(--background)", angle: 135 },
			{ to: "#4a1f5eaa", angle: 135 },
			{ to: "rgb(1 2 3)", angle: 135 },
			{ to: "#fff", angle: 135 },
			{ to: "#4a1f5e", angle: 135, stops: ["#000"] },
			{ to: "#4a1f5e", angle: 135, positions: [0, 100] },
			{ to: "#4a1f5e", angle: 135, type: "radial" },
			{ to: "#4a1f5e", angle: 135, repeat: true },
			{ to: "#4a1f5e", angle: 135, css: "linear-gradient(1deg,#000,#fff)" },
			{ to: "#4a1f5e", angle: 135, backgroundImage: "none" },
			{ from: "#000000", to: "#4a1f5e", angle: 135 },
		])
			expect(
				ThemeGradientDto.safeParse(gradient).success,
				JSON.stringify(gradient),
			).toBe(false);
	});

	/**
	 * Uppercase is folded to lowercase by the same rule as color fields, so the stored value has one
	 * canonical form.
	 */
	it("folds uppercase to lowercase", () => {
		expect(ThemeGradientDto.parse({ to: "#4A1F5E", angle: 0 })).toEqual({
			to: "#4a1f5e",
			angle: 0,
		});
	});

	/**
	 * A gradient without an end color is not a valid request. This is a structural invariant, so it
	 * lives in the schema. If the service folded it silently, the sender would get a success response
	 * and believe the gradient was saved, but the next read would not contain it.
	 */
	it("a gradient without a background is rejected", () => {
		expect(
			ThemeCustomizationDto.safeParse({
				gradient: { to: "#4a1f5e", angle: 135 },
			}).success,
		).toBe(false);
		expect(
			ThemeCustomizationDto.safeParse({
				surface: "#123456",
				gradient: { to: "#4a1f5e", angle: 135 },
			}).success,
		).toBe(false);
		expect(
			ThemeCustomizationDto.safeParse({
				background: "#10131a",
				gradient: { to: "#4a1f5e", angle: 135 },
			}).success,
		).toBe(true);
	});

	/**
	 * A gradient does not add a slot. Members still send three color slots, and the gradient is one
	 * expression on top of that background. Reading it as a fourth slot would lead the next person to
	 * add a name to THEME_CUSTOMIZATION_SLOTS.
	 */
	it("there are still three slots", () => {
		expect([...THEME_CUSTOMIZATION_SLOTS]).toEqual([
			"background",
			"surface",
			"primary",
		]);
		expect(THEME_CUSTOMIZATION_SLOTS as readonly string[]).not.toContain(
			"gradient",
		);
		/** A gradient object also cannot be placed in a color slot. */
		expect(
			ThemeCustomizationDto.safeParse({
				background: { to: "#4a1f5e", angle: 135 },
			}).success,
		).toBe(false);
	});
});
