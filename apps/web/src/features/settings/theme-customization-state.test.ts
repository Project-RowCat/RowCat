import type { ThemeCustomizationStateDto } from "@rowcat/contracts";
import {
	DEFAULT_THEME_GRADIENT_ANGLE,
	isThemeGradientReadable,
	readableForegroundOn,
	resolveThemePresetOverrides,
	THEME_CUSTOMIZATION_SLOTS,
} from "@rowcat/design";
import { describe, expect, it } from "vitest";
import {
	EMPTY_THEME_DRAFT,
	EMPTY_THEME_GRADIENT_DRAFT,
	normalizedThemeDraftValue,
	THEME_PRESET_ORDER,
	type ThemeDraft,
	themeClearColorsLabel,
	themeCustomGroupDescription,
	themeCustomGroupTitle,
	themeCustomizationView,
	themeDraftEquals,
	themeDraftFrom,
	themeDraftHasValue,
	themeDraftIsValid,
	themeDraftValidation,
	themeDraftWithColor,
	themeDraftWithGradientAngle,
	themeDraftWithGradientEnabled,
	themeDraftWithGradientStop,
	themeDraftWithRandomGradient,
	themeDraftWithRandomPalette,
	themeForegroundNote,
	themeGradientAngleLabel,
	themeGradientContrastWarning,
	themeGradientFromNote,
	themeGradientNeedsWarning,
	themeGradientRequestFrom,
	themeGradientToControlName,
	themeGradientToggleDescription,
	themeGradientToggleLabel,
	themeGradientToLabel,
	themePresetGroupDescription,
	themePresetGroupTitle,
	themePresetLabel,
	themePresetSwatch,
	themePreviewColors,
	themePreviewNote,
	themeRandomGradientLabel,
	themeRandomPaletteLabel,
	themeRequestFrom,
	themeResetAllLabel,
	themeSaveLabel,
	themeSaveNote,
	themeSectionDescription,
	themeSectionTitle,
	themeSlotFallbackColors,
	themeSlotLabel,
	themeSlotPresetLabel,
	themeSlotUnsetLabel,
} from "./theme-customization-state.ts";

/**
 * Screen state and copy for the theme section. Three silent failures are guarded:
 * - A failed load shown as an empty form. Saving from that state would actually erase saved
 *   values.
 * - A hand-typed typo silently becoming a save of the preset color. Under replace semantics, that
 *   save would erase the stored color.
 * - Copy that promises effects the product cannot deliver.
 */

const state = (
	over: Partial<ThemeCustomizationStateDto> = {},
): ThemeCustomizationStateDto => ({
	preset: "default",
	customization: { background: "#10131a" },
	...over,
});

/**
 * Stands in for the current appearance's base palette. It is not a copy of the generated tokens.
 * The real screen passes nativeColorsFor(scheme). Here the value is arbitrary, since the test only
 * checks what a slot shows when neither a preset nor a draft overrides it. Passing the generated
 * palette would break this test on unrelated commits whenever the palette changes.
 */
const BASE = {
	background: "#ffffff",
	foreground: "#09090b",
	card: "#f7f7f8",
	"card-foreground": "#09090b",
	primary: "#7452f5",
	"primary-foreground": "#fafafa",
};

const view = (input: Partial<Parameters<typeof themeCustomizationView>[0]>) =>
	themeCustomizationView({
		state: undefined,
		isError: false,
		isPaused: false,
		...input,
	});

describe("the order is the whole of this function", () => {
	it("draws held values even when a background refresh failed", () => {
		expect(view({ state: state(), isError: true }).kind).toBe("ready");
	});

	it("separates paused from failed; paused is not an endless load", () => {
		expect(view({ isPaused: true }).kind).toBe("offline");
		expect(view({ isError: true }).kind).toBe("error");
		expect(view({}).kind).toBe("loading");
	});

	/**
	 * A failed state must not collapse into 'not yet picked'. If it did, someone who had saved colors
	 * would see an empty form, and saving from there would actually erase them through replace
	 * semantics.
	 */
	it("a failure does not fold into an empty value", () => {
		const failed = view({ isError: true });
		expect(failed.kind).not.toBe("ready");
		expect("customization" in failed).toBe(false);
		expect("preset" in failed).toBe(false);
	});
});

describe("draft", () => {
	it("a missing slot is an empty string, so no input becomes uncontrolled", () => {
		const draft = themeDraftFrom({ primary: "#7957ff" });
		expect(draft.primary).toBe("#7957ff");
		expect(draft.background).toBe("");
		expect(draft.surface).toBe("");
	});

	it("round-trips to the same value", () => {
		const customization = {
			background: "#fffaf2",
			surface: "#ffffff",
			primary: "#9a83ff",
		};
		expect(themeRequestFrom(themeDraftFrom(customization))).toEqual(
			customization,
		);
	});

	it("an empty draft is an empty document, which is the reset request", () => {
		expect(themeRequestFrom(EMPTY_THEME_DRAFT)).toEqual({});
	});

	it("uppercase, whitespace and six digits without # are normalized", () => {
		expect(normalizedThemeDraftValue(" #FFFAF2 ")).toBe("#fffaf2");
		expect(normalizedThemeDraftValue("9A83FF")).toBe("#9a83ff");
		expect(normalizedThemeDraftValue("")).toBe("");

		const draft = { ...EMPTY_THEME_DRAFT, background: "#FFFAF2" };
		expect(themeRequestFrom(draft)).toEqual({ background: "#fffaf2" });
	});

	it("the same draft has nothing to send, including the same color written differently", () => {
		const draft = themeDraftFrom({ background: "#fffaf2" });
		expect(themeDraftEquals(draft, { ...draft, background: "#FFFAF2" })).toBe(
			true,
		);
		expect(themeDraftEquals(draft, EMPTY_THEME_DRAFT)).toBe(false);
		expect(themeDraftHasValue(EMPTY_THEME_DRAFT)).toBe(false);
		expect(themeDraftHasValue(draft)).toBe(true);
	});
});

describe("a typo does not silently become the default", () => {
	/**
	 * The core of this file. The old rule dropped invalid syntax from the request. Under replace
	 * semantics that meant saving the slot as default, so one typo in the hex field could erase a
	 * stored color. Now no request is built at all for an invalid draft (null).
	 */
	it("the request is null when a value is not valid syntax", () => {
		for (const bad of ["#12ZZ00", "red", "#fff", "rgb(1,2,3)", "var(--x)"]) {
			const draft = {
				...EMPTY_THEME_DRAFT,
				background: "#101010",
				primary: bad,
			};
			expect(themeRequestFrom(draft), bad).toBeNull();
		}
	});

	it("the validation table says which slot is the problem", () => {
		const draft: ThemeDraft = {
			...EMPTY_THEME_DRAFT,
			background: "#101010",
			surface: "#12ZZ00",
		};
		expect(themeDraftValidation(draft)).toEqual({
			background: true,
			surface: false,
			primary: true,
			gradient: true,
		});
		expect(themeDraftIsValid(draft)).toBe(false);
	});

	/**
	 * An empty value means 'use the default' and is always valid. The `Use default` action takes this path.
	 */
	it("an empty value is valid", () => {
		expect(themeDraftIsValid(EMPTY_THEME_DRAFT)).toBe(true);
	});
});

describe("preview", () => {
	/**
	 * A filled slot uses the draft value. An empty slot uses the selected preset's color, or the
	 * current appearance's default when there is no preset.
	 *
	 * The preview is a complete mini theme, but these fallback colors are not promoted to the draft or
	 * the request (§25).
	 */
	it("chosen slots are custom, empty slots are the preset color", () => {
		const preview = themePreviewColors(
			"default",
			{ ...EMPTY_THEME_DRAFT, background: "#10131a", primary: "#9a83ff" },
			BASE,
		);
		expect(preview.background).toBe("#10131a");
		expect(preview.surface).toBe(BASE.card);
		expect(preview.surfaceForeground).toBe(BASE["card-foreground"]);
		expect(preview.primary).toBe("#9a83ff");
	});

	/**
	 * Checks the §39 decision by value. When someone picks `Black` and empties the surface slot, they
	 * should get the black preset's card color, not the RowCat default white card. If this rule were
	 * wrong, a user who pressed `Use preset colors` would see a different color.
	 */
	it("empty slots fill with the chosen preset's color", () => {
		const black = resolveThemePresetOverrides("black");
		const preview = themePreviewColors("black", EMPTY_THEME_DRAFT, BASE);

		expect(preview.background).toBe(black.background);
		expect(preview.foreground).toBe(black.foreground);
		expect(preview.surface).toBe(black.card);
		expect(preview.surfaceForeground).toBe(black["card-foreground"]);
		expect(preview.primary).toBe(black.primary);
		expect(preview.primaryForeground).toBe(black["primary-foreground"]);
	});

	/**
	 * The fallback that swatches and the picker read must equal the preview's value. Otherwise the
	 * picture and the result differ.
	 */
	it("per-slot fallbacks match the preview's colors", () => {
		const fallback = themeSlotFallbackColors("gray", BASE);
		const preview = themePreviewColors("gray", EMPTY_THEME_DRAFT, BASE);
		expect(fallback.background).toBe(preview.background);
		expect(fallback.surface).toBe(preview.surface);
		expect(fallback.primary).toBe(preview.primary);
	});

	/** When the preset is default, the fallback is the current appearance's default palette. */
	it("the default preset's fallback is the default palette", () => {
		expect(themeSlotFallbackColors("default", BASE)).toEqual({
			background: BASE.background,
			surface: BASE.card,
			primary: BASE.primary,
		});
	});

	/**
	 * The foreground color is picked by the shared contrast computation. Recomputing it here would
	 * drift from the actual apply.
	 */
	it("a custom slot's foreground matches the shared derivation", () => {
		const preview = themePreviewColors(
			"default",
			{
				...EMPTY_THEME_DRAFT,
				background: "#10131a",
				surface: "#181c26",
				primary: "#9a83ff",
			},
			BASE,
		);
		expect(preview.foreground).toBe(readableForegroundOn("#10131a"));
		expect(preview.surfaceForeground).toBe(readableForegroundOn("#181c26"));
		expect(preview.primaryForeground).toBe(readableForegroundOn("#9a83ff"));
	});

	it("an empty draft with the default preset previews exactly the default palette", () => {
		expect(themePreviewColors("default", EMPTY_THEME_DRAFT, BASE)).toEqual({
			background: BASE.background,
			foreground: BASE.foreground,
			gradient: null,
			surface: BASE.card,
			surfaceForeground: BASE["card-foreground"],
			primary: BASE.primary,
			primaryForeground: BASE["primary-foreground"],
		});
	});

	/**
	 * A value that cannot be parsed is drawn in the preset color. The validation table is responsible
	 * for the message.
	 */
	it("an invalid value draws with the preset color", () => {
		const preview = themePreviewColors(
			"default",
			{ ...EMPTY_THEME_DRAFT, background: "#12ZZ00" },
			BASE,
		);
		expect(preview.background).toBe(BASE.background);
	});
});

describe("preset cards draw the real colors", () => {
	/**
	 * Card colors must come from the shared resolver. If the screen wrote its own preview colors, only
	 * the cards would go stale when the palette is tuned, and they would advertise colors that differ
	 * from the real ones.
	 */
	it("swatches match the preset resolver", () => {
		for (const preset of THEME_PRESET_ORDER) {
			const overrides = resolveThemePresetOverrides(preset);
			expect(themePresetSwatch(preset, BASE), preset).toEqual({
				background: overrides.background ?? BASE.background,
				surface: overrides.card ?? BASE.card,
				primary: overrides.primary ?? BASE.primary,
			});
		}
	});

	/** `Default` draws the current appearance's palette as-is, so selecting it shows exactly that. */
	it("the default preset's swatches are the default palette", () => {
		expect(themePresetSwatch("default", BASE)).toEqual({
			background: BASE.background,
			surface: BASE.card,
			primary: BASE.primary,
		});
	});

	/**
	 * The four swatch backgrounds must differ from one another. If two looked the same, choosing
	 * between them would mean nothing.
	 */
	it("the four swatches all have different backgrounds", () => {
		const backgrounds = THEME_PRESET_ORDER.map(
			(preset) => themePresetSwatch(preset, BASE).background,
		);
		expect(new Set(backgrounds).size).toBe(THEME_PRESET_ORDER.length);
	});
});

describe("preset vocabulary", () => {
	it("there are four, in a fixed order", () => {
		expect([...THEME_PRESET_ORDER]).toEqual([
			"default",
			"white",
			"gray",
			"black",
		]);
	});

	/** The names are the user's own words. Internal token names or English slugs must never appear. */
	it("four names, in the user's words", () => {
		expect(
			THEME_PRESET_ORDER.map((preset) => themePresetLabel(preset)),
		).toEqual(["Default", "White", "Gray", "Black"]);
	});
});

describe("the copy is factual", () => {
	const ALL_COPY = [
		themeSectionTitle(),
		themeSectionDescription(),
		themePresetGroupTitle(),
		themePresetGroupDescription(),
		themeCustomGroupTitle(),
		themeCustomGroupDescription(),
		themeForegroundNote(),
		themePreviewNote(),
	].join(" ");

	/**
	 * Makes no claims that cannot be measured. The benefit copy on the payment screen follows the same
	 * rule: someone who chose `Premium` could not say what they received.
	 */
	it("uses no puffery", () => {
		for (const forbidden of [
			/premium/i,
			/unlimited/i,
			/advanced/i,
			/\bpro\b/i,
			/special/i,
			/better/i,
			/exclusive/i,
		])
			expect(ALL_COPY, String(forbidden)).not.toMatch(forbidden);
	});

	/**
	 * The copy must contain no payment or subscription vocabulary (`cat tower`, `subscription`, `churu`, `payment`). The
	 * custom section was once for `cat tower` subscribers only. Payments were removed from the public build
	 * (docs/oss/PLAN.md, step 3), so leftover payment words would advertise a product that no longer
	 * exists.
	 */
	it("the copy does not mention subscriptions", () => {
		for (const forbidden of ["cat tower", "subscription", "churu", "payment"])
			expect(ALL_COPY.toLowerCase(), forbidden).not.toContain(forbidden);
	});

	/** The section name states its scope: colors the user picks directly. */
	it("the custom section's name states its scope", () => {
		expect(themeCustomGroupTitle()).toContain("Custom");
	});

	/**
	 * Exactly three editable slots, and no light/dark split in the copy. The single-palette product
	 * model must stay visible in the wording. Reintroducing per-appearance palette terms would bring
	 * back a model that was removed.
	 */
	it("three slot names, in the user's words", () => {
		expect(THEME_CUSTOMIZATION_SLOTS.map(themeSlotLabel)).toEqual([
			"Background",
			"Surface",
			"Accent",
		]);
		for (const label of THEME_CUSTOMIZATION_SLOTS.map(themeSlotLabel))
			expect(label).not.toMatch(/foreground|sidebar|popover|ring|token/i);
	});

	it("there is no light/dark palette vocabulary", () => {
		const copy = [
			ALL_COPY,
			themeSaveLabel(),
			themeClearColorsLabel(),
			themeResetAllLabel(),
			themeSlotPresetLabel(),
			themeSlotUnsetLabel(),
			...THEME_CUSTOMIZATION_SLOTS.map(themeSlotLabel),
			...THEME_PRESET_ORDER.map(themePresetLabel),
		].join(" ");

		for (const forbidden of [/(light|dark) (palette|theme)/i, /palette/i])
			expect(copy, String(forbidden)).not.toMatch(forbidden);
	});

	/**
	 * The two resets have distinct names that state their scope. With one shared name, a user could
	 * not tell before pressing whether it clears only the colors or also restores the preset. Those
	 * two cost different amounts to undo.
	 */
	it("the two resets have distinct names", () => {
		expect(themeClearColorsLabel()).not.toBe(themeResetAllLabel());
		expect(themeClearColorsLabel()).toContain("custom");
		expect(themeResetAllLabel()).toContain("entire");
	});

	/**
	 * §39: clearing a slot means 'the selected preset's color', not 'the RowCat default'. If the
	 * wording did not say so, someone who picked `Black` would expect a white background.
	 */
	it("the slot revert wording points at the preset", () => {
		expect(themeSlotPresetLabel()).toMatch(/preset/i);
		expect(themeSlotPresetLabel()).not.toMatch(/default/i);
		expect(themeSlotUnsetLabel()).toMatch(/preset/i);
	});

	/**
	 * The screen states that the foreground color cannot be chosen. Left unsaid, that absence would
	 * read as a defect. It is a product decision: unreadable combinations are not allowed to be saved.
	 */
	it("states that the foreground is derived", () => {
		expect(themeForegroundNote()).toMatch(/Text color/);
		expect(themeForegroundNote()).toMatch(/automatic/);
	});

	/**
	 * The copy also states that the values are saved to the account. This is where it differs from
	 * device preferences such as brightness, which are per device.
	 */
	it("states that it is saved to the account", () => {
		expect(themeSectionDescription()).toMatch(/saved to your account/);
		expect(themeSectionDescription()).toMatch(/other devices/);
	});

	/** The preview note states that changes stay inside the preview box until saved (§23). */
	it("the preview sentence says nothing applies before saving", () => {
		expect(themePreviewNote()).toMatch(/save/);
	});
});

/**
 * Gradient draft: the boundary between form-only state and the saved document. Four things are
 * guarded:
 * - A disabled gradient making the save button enable. Toggling off and on without changes would
 *   enable save, and pressing it would do nothing.
 * - A gradient with no first stop becoming a request. The server rejects it with a 400, and the
 *   user cannot tell why.
 * - Clearing the background while the gradient stays on. Saving would be locked with no reason
 *   shown on screen.
 * - A switched-off gradient being sent in the request. Under replace semantics it would not be
 *   erased.
 */

const GRADIENT_DRAFT: ThemeDraft = {
	background: "#10131a",
	surface: "#181c26",
	primary: "#9a83ff",
	gradient: { enabled: true, to: "#4a1f5e", angle: 135 },
};

describe("gradient draft", () => {
	it("the stored value arrives as the draft", () => {
		expect(
			themeDraftFrom({
				background: "#10131a",
				gradient: { to: "#4a1f5e", angle: 45 },
			}).gradient,
		).toEqual({ enabled: true, to: "#4a1f5e", angle: 45 });
	});

	it("without a stored value it is an empty, off draft", () => {
		expect(themeDraftFrom({ background: "#10131a" }).gradient).toEqual(
			EMPTY_THEME_GRADIENT_DRAFT,
		);
		expect(EMPTY_THEME_GRADIENT_DRAFT.angle).toBe(DEFAULT_THEME_GRADIENT_ANGLE);
	});

	it("only an on, valid draft becomes a request", () => {
		expect(themeGradientRequestFrom(GRADIENT_DRAFT.gradient)).toEqual({
			to: "#4a1f5e",
			angle: 135,
		});
		expect(
			themeGradientRequestFrom({ ...GRADIENT_DRAFT.gradient, enabled: false }),
		).toBeNull();
		expect(
			themeGradientRequestFrom({ ...GRADIENT_DRAFT.gradient, to: "#4a1" }),
		).toBeNull();
		expect(
			themeGradientRequestFrom({ ...GRADIENT_DRAFT.gradient, angle: 360 }),
		).toBeNull();
	});

	it("goes into the request document", () => {
		expect(themeRequestFrom(GRADIENT_DRAFT)).toEqual({
			background: "#10131a",
			surface: "#181c26",
			primary: "#9a83ff",
			gradient: { to: "#4a1f5e", angle: 135 },
		});
	});

	/**
	 * Turning the gradient off removes the key from the request. That is the only way to clear a saved
	 * value under replace semantics.
	 */
	it("turning it off drops the slot from the request", () => {
		const off: ThemeDraft = {
			...GRADIENT_DRAFT,
			gradient: { ...GRADIENT_DRAFT.gradient, enabled: false },
		};
		expect(themeRequestFrom(off)).toEqual({
			background: "#10131a",
			surface: "#181c26",
			primary: "#9a83ff",
		});
	});

	it("an invalid end color or angle blocks the request itself", () => {
		for (const gradient of [
			{ enabled: true, to: "#4a1", angle: 135 },
			{ enabled: true, to: "", angle: 135 },
			{ enabled: true, to: "#4a1f5e", angle: 360 },
			{ enabled: true, to: "#4a1f5e", angle: 12.5 },
		])
			expect(
				themeRequestFrom({ ...GRADIENT_DRAFT, gradient }),
				JSON.stringify(gradient),
			).toBeNull();
	});

	/**
	 * A gradient without a background is not a document that can be sent. The server rejects the same
	 * request.
	 */
	it("a gradient on without a background does not become a request", () => {
		const orphan: ThemeDraft = { ...GRADIENT_DRAFT, background: "" };
		expect(themeDraftIsValid(orphan)).toBe(false);
		expect(themeRequestFrom(orphan)).toBeNull();
	});

	it("the validation table reports the end color separately", () => {
		expect(themeDraftValidation(GRADIENT_DRAFT).gradient).toBe(true);
		expect(
			themeDraftValidation({
				...GRADIENT_DRAFT,
				gradient: { ...GRADIENT_DRAFT.gradient, to: "#zz" },
			}).gradient,
		).toBe(false);
		/** A disabled gradient is not validated, because there is nothing to send. */
		expect(
			themeDraftValidation({
				...GRADIENT_DRAFT,
				gradient: { enabled: false, to: "#zz", angle: 135 },
			}).gradient,
		).toBe(true);
	});

	/**
	 * A disabled gradient's value must not count in the comparison. If it did, someone who toggled it
	 * off and on would see save enabled with no real change, and saving would do nothing. Comparison
	 * uses only the stored shape.
	 */
	it("compares only in the shape that would be stored", () => {
		const a: ThemeDraft = {
			...GRADIENT_DRAFT,
			gradient: { enabled: false, to: "#4a1f5e", angle: 135 },
		};
		const b: ThemeDraft = {
			...GRADIENT_DRAFT,
			gradient: { enabled: false, to: "#1f5e4a", angle: 45 },
		};
		expect(themeDraftEquals(a, b)).toBe(true);

		expect(
			themeDraftEquals(GRADIENT_DRAFT, {
				...GRADIENT_DRAFT,
				gradient: { ...GRADIENT_DRAFT.gradient, angle: 45 },
			}),
		).toBe(false);
		expect(themeDraftEquals(GRADIENT_DRAFT, a)).toBe(false);
	});

	/**
	 * A draft with only a gradient set still has a value to clear, so 'reset custom colors' must
	 * appear.
	 */
	it("a gradient counts as something to clear", () => {
		expect(themeDraftHasValue(GRADIENT_DRAFT)).toBe(true);
		expect(themeDraftHasValue(EMPTY_THEME_DRAFT)).toBe(false);
	});
});

describe("draft transformers: where the invariants live", () => {
	/**
	 * Clearing the background also turns the gradient off. A first stop is required to draw it, and
	 * keeping the gradient on would leave saving locked with no visible reason.
	 */
	it("clearing the background turns the gradient off", () => {
		const next = themeDraftWithColor(GRADIENT_DRAFT, "background", "");
		expect(next.gradient.enabled).toBe(false);
		/**
		 * The value persists. After re-picking the background and turning the gradient on again, the
		 * color is still there.
		 */
		expect(next.gradient.to).toBe("#4a1f5e");
	});

	/**
	 * A half-typed value does not touch the switch. `#1` is still being typed, not cleared. Switching
	 * off there would make the switch flicker for someone entering hex by hand.
	 */
	it("a half-typed background leaves the switch alone", () => {
		expect(
			themeDraftWithColor(GRADIENT_DRAFT, "background", "#1").gradient.enabled,
		).toBe(true);
	});

	/** Clearing the surface or primary slot does not affect the gradient. */
	it("clearing surface or accent keeps the gradient", () => {
		for (const slot of ["surface", "primary"] as const)
			expect(
				themeDraftWithColor(GRADIENT_DRAFT, slot, "").gradient.enabled,
				slot,
			).toBe(true);
	});

	/**
	 * Turning the gradient on freezes the color currently visible as the first stop (§7). Enabling a
	 * gradient is an explicit customization, so the promotion is honest. Otherwise the form would keep
	 * a state that cannot be saved.
	 */
	it("with an empty background, turning it on makes the preset color the draft", () => {
		const next = themeDraftWithGradientEnabled(
			EMPTY_THEME_DRAFT,
			true,
			"#101010",
		);
		expect(next.background).toBe("#101010");
		expect(next.gradient.enabled).toBe(true);
		expect(next.gradient.to).toMatch(/^#[0-9a-f]{6}$/);
		expect(next.gradient.to).not.toBe("#101010");
		/** The result is a document that can be saved immediately. */
		expect(themeRequestFrom(next)).not.toBeNull();
	});

	it("an already chosen background does not change when turned on", () => {
		const next = themeDraftWithGradientEnabled(
			{ ...GRADIENT_DRAFT, gradient: EMPTY_THEME_GRADIENT_DRAFT },
			true,
			"#ffffff",
		);
		expect(next.background).toBe("#10131a");
	});

	/** Turning off keeps the values. Turning it back on restores the colors that were picked. */
	it("turning it off keeps the value and only lowers the switch", () => {
		const off = themeDraftWithGradientEnabled(GRADIENT_DRAFT, false, "#ffffff");
		expect(off.gradient).toEqual({
			enabled: false,
			to: "#4a1f5e",
			angle: 135,
		});
		expect(off.background).toBe("#10131a");
	});

	/**
	 * The angle is folded to an integer when stored, because the slider and arrow keys can produce
	 * `360`.
	 */
	it("the angle folds at the input boundary", () => {
		expect(
			themeDraftWithGradientAngle(GRADIENT_DRAFT, 360).gradient.angle,
		).toBe(0);
		expect(
			themeDraftWithGradientAngle(GRADIENT_DRAFT, -45).gradient.angle,
		).toBe(315);
		expect(
			themeDraftWithGradientAngle(GRADIENT_DRAFT, 90.6).gradient.angle,
		).toBe(91);
	});

	/** The end color is stored exactly as typed, so a half-typed value is not reverted. */
	it("the end color is held even half-typed", () => {
		expect(themeDraftWithGradientStop(GRADIENT_DRAFT, "#4a1").gradient.to).toBe(
			"#4a1",
		);
	});
});

/** Deterministic random source: the same seed yields the same draft (mulberry32). */
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

describe("random palette: changes only the draft", () => {
	it("makes all three colors anew and can be saved as is", () => {
		const next = themeDraftWithRandomPalette(EMPTY_THEME_DRAFT, seeded(1));

		for (const slot of ["background", "surface", "primary"] as const)
			expect(next[slot], slot).toMatch(/^#[0-9a-f]{6}$/);
		expect(themeDraftIsValid(next)).toBe(true);
		expect(themeRequestFrom(next)).not.toBeNull();
	});

	/**
	 * Pressing the button counts as a change. The draft differs, so the save button becomes enabled.
	 */
	it("pressing really changes the draft", () => {
		const next = themeDraftWithRandomPalette(EMPTY_THEME_DRAFT, seeded(1));
		expect(themeDraftEquals(next, EMPTY_THEME_DRAFT)).toBe(false);
	});

	/**
	 * §48: a feature that is off stays off. If one click created a gradient that was not there, that
	 * would be a second change the user never asked for.
	 */
	it("leaves the gradient off when it is off", () => {
		for (const seed of [0, 1, 2, 3, 4]) {
			const next = themeDraftWithRandomPalette(EMPTY_THEME_DRAFT, seeded(seed));
			expect(next.gradient.enabled, `seed ${seed}`).toBe(false);
			expect(themeRequestFrom(next)?.gradient, `seed ${seed}`).toBeUndefined();
		}
	});

	/** The other half: when the gradient is on, the second stop is regenerated as well. */
	it("also makes a new gradient when it is on", () => {
		for (const seed of [0, 1, 2, 3, 4]) {
			const next = themeDraftWithRandomPalette(GRADIENT_DRAFT, seeded(seed));
			const label = `seed ${seed} · ${JSON.stringify(next)}`;

			expect(next.gradient.enabled, label).toBe(true);
			expect(next.gradient.to, label).not.toBe(GRADIENT_DRAFT.gradient.to);
			expect(themeRequestFrom(next)?.gradient, label).toBeDefined();

			/**
			 * The combination is also readable. Randomness must not produce a screen that cannot be read.
			 */
			const preview = themePreviewColors("default", next, BASE);
			expect(preview.gradient, label).not.toBeNull();
			expect(isThemeGradientReadable(preview.gradient as never), label).toBe(
				true,
			);
			expect(themeGradientNeedsWarning(preview), label).toBe(false);
		}
	});

	/** Re-rolls only the gradient. The color set is unchanged. */
	it("random gradient leaves the three colors alone", () => {
		const next = themeDraftWithRandomGradient(GRADIENT_DRAFT, seeded(3));
		expect(next.background).toBe(GRADIENT_DRAFT.background);
		expect(next.surface).toBe(GRADIENT_DRAFT.surface);
		expect(next.primary).toBe(GRADIENT_DRAFT.primary);
		expect(next.gradient.to).not.toBe(GRADIENT_DRAFT.gradient.to);
	});

	/**
	 * This must not become a second path for enabling the feature. When off, the gradient random
	 * button does nothing.
	 */
	it("random gradient does nothing when off", () => {
		expect(themeDraftWithRandomGradient(EMPTY_THEME_DRAFT, seeded(3))).toEqual(
			EMPTY_THEME_DRAFT,
		);
	});

	/** The same seed yields the same draft. This is what makes the rule checkable by value. */
	it("is deterministic", () => {
		expect(themeDraftWithRandomPalette(EMPTY_THEME_DRAFT, seeded(9))).toEqual(
			themeDraftWithRandomPalette(EMPTY_THEME_DRAFT, seeded(9)),
		);
	});
});

describe("preview: gradient", () => {
	it("when on, drawable values arrive", () => {
		const preview = themePreviewColors("default", GRADIENT_DRAFT, BASE);
		expect(preview.gradient).toEqual({
			from: "#10131a",
			to: "#4a1f5e",
			angle: 135,
		});
		/** The solid background reference value is unchanged. The app shell and mobile read it. */
		expect(preview.background).toBe("#10131a");
	});

	/** A first stop that is a preset color cannot be drawn, and it could not be saved either. */
	it("draws nothing when the background is not custom", () => {
		expect(
			themePreviewColors("black", { ...GRADIENT_DRAFT, background: "" }, BASE)
				.gradient,
		).toBeNull();
	});

	/**
	 * The foreground considers both ends together, as the real apply does. Looking only at the first
	 * end would leave half the box unreadable at a light end.
	 */
	it("the foreground looks at both ends", () => {
		const split = themePreviewColors(
			"default",
			{
				...GRADIENT_DRAFT,
				gradient: { enabled: true, to: "#ffffff", angle: 90 },
			},
			BASE,
		);
		expect(split.foreground).toBe(readableForegroundOn("#ffffff"));
		expect(split.foreground).not.toBe(readableForegroundOn("#10131a"));
	});

	/** An unreadable combination turns the warning on. It neither blocks nor changes the color. */
	it("an unreadable combination shows a warning", () => {
		const warned = themePreviewColors(
			"default",
			{
				...GRADIENT_DRAFT,
				background: "#000000",
				gradient: { enabled: true, to: "#ffffff", angle: 90 },
			},
			BASE,
		);
		expect(themeGradientNeedsWarning(warned)).toBe(true);
		/** The chosen colors are drawn as given. The code does not replace them. */
		expect(warned.gradient).toEqual({
			from: "#000000",
			to: "#ffffff",
			angle: 90,
		});
	});

	/**
	 * A gradient that cannot be drawn at all gets no warning. The message at that point is about
	 * syntax, not readability.
	 */
	it("no warning when off", () => {
		expect(
			themeGradientNeedsWarning(
				themePreviewColors("default", EMPTY_THEME_DRAFT, BASE),
			),
		).toBe(false);
	});
});

describe("gradient and random copy", () => {
	/** The label uses the word 'gradient' directly. `Background effect` and `Fade` do not describe it. */
	it("uses the word gradient as is", () => {
		expect(themeGradientToggleLabel()).toMatch(/gradient/i);
		expect(themeGradientToLabel()).toBeTruthy();
		expect(themeGradientAngleLabel()).toBeTruthy();
	});

	/**
	 * Control names must differ from visible labels. Assembled names like `Edit ${label} color` would
	 * otherwise overlap, e.g. `Edit end color`. The overlap is invisible on screen and only heard by
	 * screen readers, so visual review does not catch it.
	 */
	it("assembled control names do not repeat words", () => {
		expect(`Edit ${themeGradientToControlName()} color`).toBe(
			"Edit Gradient end color",
		);
		expect(themeGradientToControlName()).not.toMatch(/color/i);
		/**
		 * The three color slot labels go through the same assembly and do not overlap, since none
		 * contains `color`.
		 */
		for (const label of THEME_CUSTOMIZATION_SLOTS.map(themeSlotLabel))
			expect(label, label).not.toMatch(/color/i);
	});

	/**
	 * The start color is the background row above. The description says so, so users are not sent
	 * looking for a second control.
	 */
	it("states that the start color is the background color", () => {
		expect(
			`${themeGradientToggleDescription()} ${themeGradientFromNote()}`,
		).toMatch(/background/i);
	});

	/**
	 * Warning copy uses warning vocabulary, not failure or prohibition. It must say that something may
	 * happen and must not use `can't be saved`, `Error`, `Failed`, or `not allowed`.
	 */
	it("the readability notice does not say it blocks", () => {
		expect(themeGradientContrastWarning()).toMatch(/may/);
		for (const forbidden of [
			"can't be saved",
			"Error",
			"Failed",
			"not allowed",
		])
			expect(themeGradientContrastWarning(), forbidden).not.toContain(
				forbidden,
			);
	});

	/**
	 * The fact that nothing applies until saved is stated on the screen. It once lived in the random
	 * palette's paragraph. It now sits on the commit row (themeSaveNote()), next to the save button,
	 * which is more precise. It covers picker edits too, not only random ones. Repeating it in more
	 * places would create three paragraphs saying the same thing: preview, random, and commit row.
	 */
	it("the commit row says it applies only after saving", () => {
		expect(themeSaveNote()).toMatch(/save/);
		expect(themeRandomGradientLabel()).toMatch(/gradient/i);
	});

	/**
	 * Makes no unmeasurable claims and no false AI claims. The button performs a local color
	 * calculation. No network request or model is involved.
	 */
	it("does not call random a suggestion or AI", () => {
		const copy = `${themeRandomPaletteLabel()} ${themeRandomGradientLabel()}`;
		for (const forbidden of [
			"AI",
			"Suggest",
			"Auto-generated",
			"artificial",
			"Smart",
		])
			expect(copy, forbidden).not.toContain(forbidden);
	});
});
