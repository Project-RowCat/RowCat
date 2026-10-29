import type {
	ThemeCustomizationDto,
	ThemeCustomizationStateDto,
	ThemePreset,
} from "@rowcat/contracts";
import {
	DEFAULT_THEME_GRADIENT_ANGLE,
	defaultThemeGradient,
	generateRandomTheme,
	generateRandomThemeGradient,
	isThemeColorHex,
	isThemeGradientAngle,
	isThemeGradientReadable,
	normalizeThemeGradientAngle,
	type ResolvedThemeGradient,
	readableForegroundAcross,
	readableForegroundOn,
	resolveThemeGradient,
	resolveThemePresetOverrides,
	THEME_CUSTOMIZATION_SLOTS,
	THEME_PRESETS,
	type ThemeCustomizationSlot,
	type ThemeGradient,
	type ThemeRandomSource,
} from "@rowcat/design";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Screen state for the theme section, kept as pure functions outside JSX, for two reasons:
 * - A failed lookup must not render as an empty form. That reads as lost settings, and saving
 *   would then really clear them, because saves replace the stored value.
 * - An invalid hand-typed draft must not silently fall back to a default. Under replace semantics
 *   that would erase a saved color, so the request builder returns null and saving locks.
 *
 * Presets save on click, so they have no draft. Custom colors use a draft committed by an explicit
 * save button, because the picker changes the value continuously while dragging.
 *
 * This file neither creates nor persists drafts. The section's preview shows pending changes.
 * Global application reads only saved values, via features/theme/account-theme-bridge.tsx. Custom
 * colors were once subscriber-only. Those entitlement items were removed with payments in the
 * public build (docs/oss/PLAN.md section 3).
 */

/** Preset order follows the vocabulary order, from least to most neutral. */
export const THEME_PRESET_ORDER: readonly ThemePreset[] = THEME_PRESETS;

/**
 * A Record type, so adding a preset without a label fails to compile. This keeps unlabeled cards
 * from appearing.
 */
export const themePresetLabel = (key: ThemePreset): string =>
	translator("settings")(`theme.preset.${key}`);

/**
 * Each card draws its preset as color swatches instead of a word like `Black`, because swatches show
 * what the preset actually looks like. The colors come from one shared resolver
 * (resolveThemePresetOverrides). They must not be copied here: copies would go stale when the
 * palette changes and advertise colors the preset does not use.
 */
export interface ThemePresetSwatch {
	background: string;
	surface: string;
	primary: string;
}

/**
 * The default preset has no overrides, so its swatch is the current default palette. That is what
 * selecting it actually shows, so the swatch stays honest.
 */
export function themePresetSwatch(
	preset: ThemePreset,
	base: ThemePreviewBaseColors,
): ThemePresetSwatch {
	const overrides = resolveThemePresetOverrides(preset);
	return {
		background: overrides.background ?? base.background,
		surface: overrides.card ?? base.card,
		primary: overrides.primary ?? base.primary,
	};
}

/**
 * The gradient draft keeps its values when disabled. `enabled` is a flag, and `to` and `angle` are
 * not cleared. Turning the switch off and on again restores the colors just picked. The saved
 * document has no such distinction (a disabled gradient omits the field), so this state lives only
 * in the form. For that reason themeDraftEquals does not compare `to` or `angle` of a disabled
 * gradient.
 */
export interface ThemeGradientDraft {
	enabled: boolean;
	/**
	 * The second stop is kept exactly as typed, like the other color fields, because it can be
	 * hand-entered.
	 */
	to: string;
	angle: number;
}

/** Draft values. An empty string means not chosen; the form never handles null. */
export interface ThemeDraft extends Record<ThemeCustomizationSlot, string> {
	gradient: ThemeGradientDraft;
}

export const EMPTY_THEME_GRADIENT_DRAFT: ThemeGradientDraft = {
	enabled: false,
	to: "",
	angle: DEFAULT_THEME_GRADIENT_ANGLE,
};

export const EMPTY_THEME_DRAFT: ThemeDraft = {
	background: "",
	surface: "",
	primary: "",
	gradient: EMPTY_THEME_GRADIENT_DRAFT,
};

/**
 * Trims and lowercases input, and adds the leading # to a bare six-digit hex value. Any other input
 * is returned unchanged. Fixing more here (truncating, resolving color names) would make the saved
 * value differ from what the user typed, and the screen could not explain what was saved.
 */
export function normalizedThemeDraftValue(value: string): string {
	const trimmed = value.trim().toLowerCase();
	return /^[0-9a-f]{6}$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

/**
 * A slot is saveable when empty, since empty means use the preset color and is always valid.
 * Otherwise it must be a valid color after normalization.
 */
export const isThemeDraftValueValid = (value: string): boolean => {
	const normalized = normalizedThemeDraftValue(value);
	return normalized === "" || isThemeColorHex(normalized);
};

export interface ThemeDraftValidation
	extends Record<ThemeCustomizationSlot, boolean> {
	/**
	 * The gradient's second stop. When the gradient is off, it is always valid, because it is not
	 * sent.
	 */
	gradient: boolean;
}

export function themeDraftValidation(draft: ThemeDraft): ThemeDraftValidation {
	return {
		background: isThemeDraftValueValid(draft.background),
		surface: isThemeDraftValueValid(draft.surface),
		primary: isThemeDraftValueValid(draft.primary),
		gradient: isThemeGradientDraftValid(draft.gradient),
	};
}

/**
 * When the gradient is off, the draft is not checked at all. When it is on, the second stop must be
 * an actual color. An empty value is not allowed, since a first stop alone is not a gradient. The
 * angle must be within the integer range.
 */
export function isThemeGradientDraftValid(
	gradient: ThemeGradientDraft,
): boolean {
	if (!gradient.enabled) return true;
	return (
		isThemeColorHex(normalizedThemeDraftValue(gradient.to)) &&
		isThemeGradientAngle(gradient.angle)
	);
}

/**
 * The draft is saveable only if every slot passes. One invalid value locks saving. The last check
 * is a structural invariant: an enabled gradient requires a chosen background, because the first
 * stop is that value. The converters below never produce this state, but checking here keeps the
 * rule from living only in screen wiring. The server rejects the same request (the .refine on
 * ThemeCustomizationDto).
 */
export const themeDraftIsValid = (draft: ThemeDraft): boolean =>
	THEME_CUSTOMIZATION_SLOTS.every((slot) =>
		isThemeDraftValueValid(draft[slot]),
	) &&
	isThemeGradientDraftValid(draft.gradient) &&
	(!draft.gradient.enabled ||
		normalizedThemeDraftValue(draft.background) !== "");

/**
 * Converts server state to a form draft. Missing slots become empty strings. undefined would make
 * the input uncontrolled: React warns, and the cursor jumps when a value arrives.
 */
export function themeDraftFrom(
	customization: ThemeCustomizationDto,
): ThemeDraft {
	return {
		background: customization.background ?? "",
		surface: customization.surface ?? "",
		primary: customization.primary ?? "",
		/**
		 * With no saved gradient, the draft is a disabled, empty gradient. With a saved one, load it
		 * as-is. The saved angle is the source of truth, so it is not overwritten with the default.
		 */
		gradient: customization.gradient
			? {
					enabled: true,
					to: customization.gradient.to,
					angle: customization.gradient.angle,
				}
			: EMPTY_THEME_GRADIENT_DRAFT,
	};
}

/**
 * Converts the draft gradient to the saved document's shape. Returns null if disabled or invalid.
 * The comparison and the request builder must share this one function. If they split, a disabled
 * gradient's to and angle would count on one side only. Toggling off and on would then enable the
 * save button with no real change, or real changes would not save.
 */
export function themeGradientRequestFrom(
	gradient: ThemeGradientDraft,
): ThemeGradient | null {
	if (!gradient.enabled) return null;
	const to = normalizedThemeDraftValue(gradient.to);
	if (!isThemeColorHex(to) || !isThemeGradientAngle(gradient.angle))
		return null;
	return { to, angle: gradient.angle };
}

/**
 * Converts a form draft to a save request. An invalid draft produces no request (null). The earlier
 * rule that omitted non-grammatical values was dropped on purpose. That fold was harmless while
 * only a color picker existed, since the picker always gives #rrggbb. With a hand-typed hex field,
 * one typo would reset that slot to the preset color on save. Replace semantics means the server
 * would faithfully apply that, and the user would lose a color they never removed. null tells the
 * screen there is no document to send, so the save button stays locked.
 */
export function themeRequestFrom(
	draft: ThemeDraft,
): ThemeCustomizationDto | null {
	if (!themeDraftIsValid(draft)) return null;

	const out: ThemeCustomizationDto = {};
	for (const slot of THEME_CUSTOMIZATION_SLOTS) {
		const value = normalizedThemeDraftValue(draft[slot]);
		if (value) out[slot] = value;
	}

	/**
	 * A disabled gradient omits the field. Given replace semantics, that is the only way to clear a
	 * saved gradient. There is no separate clear-gradient request. Adding one would turn a single save
	 * into two requests, and a half-successful state could then occur.
	 */
	const gradient = themeGradientRequestFrom(draft.gradient);
	if (gradient) out.gradient = gradient;

	return out;
}

/**
 * Decides whether the save button can be pressed, i.e. whether anything would be sent. Comparison
 * is done on normalized values. Re-typing the same color in uppercase (#FFFAF2) must not read as
 * changed, or save would enable and the response would change nothing.
 */
export function themeDraftEquals(a: ThemeDraft, b: ThemeDraft): boolean {
	for (const slot of THEME_CUSTOMIZATION_SLOTS)
		if (
			normalizedThemeDraftValue(a[slot]) !== normalizedThemeDraftValue(b[slot])
		)
			return false;

	/**
	 * The gradient is compared in its saved form. The to and angle of a disabled gradient live only in
	 * the form. Counting them would enable save when the switch is toggled off and on with no real
	 * change.
	 */
	const [x, y] = [
		themeGradientRequestFrom(a.gradient),
		themeGradientRequestFrom(b.gradient),
	];
	if (x === null || y === null) return x === y;
	return x.to === y.to && x.angle === y.angle;
}

/** Whether any slot has a value. Decides whether the `Reset custom colors` action is shown. */
export const themeDraftHasValue = (draft: ThemeDraft): boolean =>
	!themeDraftEquals(draft, EMPTY_THEME_DRAFT);

/**
 * Clearing the background also turns the gradient off. Without a first stop there is no drawable
 * gradient, and both the contract and the server reject that request. Leaving that state in the
 * form would lock saving with no visible reason. Partially typed input does not trigger this. A
 * value like #1 is still being typed, not cleared. Turning the gradient off on each keystroke would
 * make it flicker. The only test is whether the normalized value is empty.
 */
export function themeDraftWithColor(
	draft: ThemeDraft,
	slot: ThemeCustomizationSlot,
	value: string,
): ThemeDraft {
	const next: ThemeDraft = { ...draft, [slot]: value };
	if (slot !== "background") return next;
	if (normalizedThemeDraftValue(value) !== "") return next;
	return { ...next, gradient: { ...next.gradient, enabled: false } };
}

/**
 * Enabling the gradient does three things:
 * 1. If the background is empty, freeze the currently visible color into the draft. It becomes
 *    the first stop.
 * 2. If there is no second stop, create one from the first (defaultThemeGradient).
 * 3. Turn the switch on. The rules live on the enable path only. Promotion happens only here;
 *    opening the picker or viewing the switch does not change the draft. Nothing goes to the server
 *    here. Saving is still an explicit press. Disabling does not clear values. Re-enabling restores
 *    the last colors, since the saved document omits that slot anyway.
 */
export function themeDraftWithGradientEnabled(
	draft: ThemeDraft,
	enabled: boolean,
	fallbackBackground: string,
): ThemeDraft {
	if (!enabled)
		return { ...draft, gradient: { ...draft.gradient, enabled: false } };

	const background =
		normalizedThemeDraftValue(draft.background) === ""
			? fallbackBackground
			: draft.background;

	const from = normalizedThemeDraftValue(background);
	const existing = normalizedThemeDraftValue(draft.gradient.to);
	const derived = isThemeColorHex(from) ? defaultThemeGradient(from) : null;

	return {
		...draft,
		background,
		gradient: {
			enabled: true,
			to: isThemeColorHex(existing) ? existing : (derived?.to ?? ""),
			angle: draft.gradient.angle,
		},
	};
}

/**
 * Replaces only the second stop. It is stored literally, so partially typed input is not reverted.
 */
export const themeDraftWithGradientStop = (
	draft: ThemeDraft,
	to: string,
): ThemeDraft => ({ ...draft, gradient: { ...draft.gradient, to } });

/**
 * Replaces only the angle, folded to an integer. The slider and arrow keys can produce 360, which
 * is the same direction as 0. Folding right before saving would make the displayed angle differ
 * from the saved one, so it is folded at the input boundary.
 */
export const themeDraftWithGradientAngle = (
	draft: ThemeDraft,
	angle: number,
): ThemeDraft => ({
	...draft,
	gradient: {
		...draft.gradient,
		angle: normalizeThemeGradientAngle(angle),
	},
});

/**
 * Rerolls the palette once, setting all color slots together. It does not call the server. Saving
 * still happens only when the user presses save, so repeated rolls leave the account untouched. If
 * the gradient is off, it stays off. Turning it on would be an unrequested second change. If it is
 * on, the second stop and angle are regenerated together. Otherwise a new background would sit
 * against an old end color and the preview would mismatch. The random source is an argument rather
 * than Math.random, so the rule can be checked by value in tests.
 */
export function themeDraftWithRandomPalette(
	draft: ThemeDraft,
	random: ThemeRandomSource,
): ThemeDraft {
	const enabled = draft.gradient.enabled;
	const generated = generateRandomTheme(random, { gradient: enabled });

	return {
		background: generated.background,
		surface: generated.surface,
		primary: generated.primary,
		gradient: generated.gradient
			? { enabled: true, ...generated.gradient }
			: { ...draft.gradient, enabled },
	};
}

/**
 * Rerolls only the gradient. The color slots are kept. This is for cases where the background is
 * liked but the direction or end color should change. When the gradient is off, this does nothing,
 * so it cannot become a second way to enable the feature.
 */
export function themeDraftWithRandomGradient(
	draft: ThemeDraft,
	random: ThemeRandomSource,
): ThemeDraft {
	if (!draft.gradient.enabled) return draft;

	const from = normalizedThemeDraftValue(draft.background);
	if (!isThemeColorHex(from)) return draft;

	const rerolled = generateRandomThemeGradient(from, random);
	return rerolled
		? { ...draft, gradient: { enabled: true, ...rerolled } }
		: draft;
}

/**
 * The current appearance's default semantic colors, used to fill empty slots in the preview. This
 * is the one place in this section that needs the default palette, because the preview must draw a
 * complete mini theme. The values come from the design tokens (nativeColorsFor in
 * @rowcat/design/native). The screen does not restate color literals.
 */
export interface ThemePreviewBaseColors {
	background: string;
	foreground: string;
	card: string;
	"card-foreground": string;
	primary: string;
	"primary-foreground": string;
}

export interface ThemePreviewColors {
	/**
	 * A solid reference color for the page background. It stays a single color even when a gradient is
	 * set.
	 */
	background: string;
	foreground: string;
	surface: string;
	surfaceForeground: string;
	primary: string;
	primaryForeground: string;
	/**
	 * A gradient to draw. Null if none is drawable; the background then uses the solid color above. No
	 * CSS string is built here. The string is assembled by the same function that applies the theme
	 * for real (lib/theme/background-gradient.ts). If the preview grew its own syntax, the preview box
	 * and the screen after saving would diverge.
	 */
	gradient: ResolvedThemeGradient | null;
}

/**
 * The color a slot will actually show when empty: the preset's value, or the RowCat default if the
 * preset does not set it. This is the core of §39. Clearing a custom slot used to mean the RowCat
 * default. It now means the chosen preset's color. Swatches, the picker, and the preview must agree
 * on this. If they differ, a user who selects `Use preset colors` sees a different color than expected.
 */
export function themeSlotFallbackColors(
	preset: ThemePreset,
	base: ThemePreviewBaseColors,
): Record<ThemeCustomizationSlot, string> {
	const overrides = resolveThemePresetOverrides(preset);
	return {
		background: overrides.background ?? base.background,
		/**
		 * For the surface slot, which covers three values, the card value is the representative. Popovers
		 * and the sidebar receive the same value.
		 */
		surface: overrides.card ?? base.card,
		primary: overrides.primary ?? base.primary,
	};
}

/**
 * Preset plus draft to preview colors. The rules:
 * 1. The preset is the floor. Empty slots take the preset's color; only slots the preset does
 *    not cover fall back to the current default. The preview therefore shows what saving would look
 *    like.
 * 2. Custom colors are layered on top, in the same order as real application.
 * 3. The foreground is chosen by the shared contrast function (readableForegroundOn), not
 *    written here. Otherwise the preview's text color would differ from the applied one, and that
 *    difference would only appear after saving. A surface from a preset uses the foreground that
 *    palette already pairs with it.
 * 4. A non-grammatical value is drawn with the preset color. The slot's notice comes from the
 *    validation table (themeDraftValidation).
 */
export function themePreviewColors(
	preset: ThemePreset,
	draft: ThemeDraft,
	base: ThemePreviewBaseColors,
): ThemePreviewColors {
	const overrides = resolveThemePresetOverrides(preset);

	const custom = (value: string): string | null => {
		const normalized = normalizedThemeDraftValue(value);
		return isThemeColorHex(normalized) ? normalized : null;
	};

	const background = custom(draft.background);
	const surface = custom(draft.surface);
	const primary = custom(draft.primary);

	/**
	 * The gradient is drawn only when the background is custom. If the first stop is a preset color,
	 * it cannot be drawn, and it cannot be saved either.
	 */
	const gradient = resolveThemeGradient({
		background: background ?? undefined,
		gradient: themeGradientRequestFrom(draft.gradient) ?? undefined,
	});

	return {
		background: background ?? overrides.background ?? base.background,
		/**
		 * When a gradient is present, the foreground considers both stops together, as real application
		 * does (resolveEffectiveThemeOverrides). Checking only the first stop leaves the right half
		 * unreadable in some light and dark combinations.
		 */
		foreground: gradient
			? readableForegroundAcross([gradient.from, gradient.to])
			: background
				? readableForegroundOn(background)
				: (overrides.foreground ?? base.foreground),
		surface: surface ?? overrides.card ?? base.card,
		surfaceForeground: surface
			? readableForegroundOn(surface)
			: (overrides["card-foreground"] ?? base["card-foreground"]),
		primary: primary ?? overrides.primary ?? base.primary,
		primaryForeground: primary
			? readableForegroundOn(primary)
			: (overrides["primary-foreground"] ?? base["primary-foreground"]),
		gradient,
	};
}

/**
 * Whether the draft gradient is readable at both ends. If not, the screen warns. The warning does
 * not block. Blocking would choose colors on the user's behalf, and it would contradict the rule
 * that low-contrast solid backgrounds are not rejected. The preview draws what was requested. The
 * function only says that this combination may be hard to read, before the user presses save. No
 * warning appears when the gradient cannot be drawn (off or invalid). The message needed then is
 * about syntax, and the slot's note already covers it.
 */
export const themeGradientNeedsWarning = (
	colors: ThemePreviewColors,
): boolean =>
	colors.gradient !== null && !isThemeGradientReadable(colors.gradient);

export type ThemeCustomizationView =
	/** No server value has ever been received yet. */
	| { kind: "loading" }
	/** The network is absent and retries are paused. This is waiting, not failure. */
	| { kind: "offline" }
	/** The query failed and there is no value to show. The failure is handled inside this section. */
	| { kind: "error" }
	/** A value has arrived. Both the preset and the custom controls are editable. */
	| {
			kind: "ready";
			preset: ThemePreset;
			customization: ThemeCustomizationDto;
	  };

export interface ThemeCustomizationViewInput {
	/** The value the server has answered with at least once. undefined means not known yet. */
	state: ThemeCustomizationStateDto | undefined;
	isError: boolean;
	/**
	 * TanStack Query has paused retries because it judged the network absent. Without this flag the
	 * query stays pending, and the screen would show loading forever.
	 */
	isPaused: boolean;
}

/**
 * Order: held value, then paused, then failed, then loading. A value already received stays true
 * even if a background refresh fails. Clearing it would make the user read their settings as lost,
 * and a save pressed in that state would really clear them. This matches the order of the failure
 * surfaces in docs/design/FAILURE-FEEDBACK.md.
 */
export function themeCustomizationView({
	state,
	isError,
	isPaused,
}: ThemeCustomizationViewInput): ThemeCustomizationView {
	if (!state) {
		if (isPaused) return { kind: "offline" };
		if (isError) return { kind: "error" };
		return { kind: "loading" };
	}
	return {
		kind: "ready",
		preset: state.preset,
		customization: state.customization,
	};
}

/**
 * Section copy is factual. Names that cannot be measured are avoided, such as `advanced theme`, `premium
 * theme`, or `pro`. A pure test checks their absence.
 */
export const themeSectionTitle = (): string =>
	translator("settings")("theme.sectionTitle");
export const themeSectionDescription = (): string =>
	translator("settings")("theme.sectionDescription");

export const themePresetGroupTitle = (): string =>
	translator("settings")("theme.presetGroupTitle");
export const themePresetGroupDescription = (): string =>
	translator("settings")("theme.presetGroupDescription");

/**
 * `Custom colors` is used instead of `Customize theme colors` on purpose. The latter reads as
 * including the preset section above, which would erase the boundary between the two sections from
 * the name.
 */
export const themeCustomGroupTitle = (): string =>
	translator("settings")("theme.customGroupTitle");
export const themeCustomGroupDescription = (): string =>
	translator("settings")("theme.customGroupDescription");

/**
 * A Record type, so adding a slot fails to compile until it has a label. No control can appear
 * unnamed.
 */
export const themeSlotLabel = (key: ThemeCustomizationSlot): string =>
	translator("settings")(`theme.slot.${key}`);

/** One line per slot describing what it paints. Internal token names never reach the user. */
export const themeSlotDescription = (key: ThemeCustomizationSlot): string =>
	translator("settings")(`theme.slotDescription.${key}`);

/**
 * States that there is no text-color control. Otherwise the absence becomes a support question. The
 * answer is a product decision: unreadable combinations cannot be saved.
 */
export const themeForegroundNote = (): string =>
	translator("settings")("theme.foregroundNote");

/**
 * Action copy lives in one table, not typed inline by the screen, because tests read these values.
 * The save label is not `Save changes`. The settings-boundaries.test.ts check blocks
 * that vocabulary for a commit-everything button. This button commits only the custom colors, and
 * its name states that scope.
 */
export const themeSaveLabel = (): string =>
	translator("settings")("theme.save");

/**
 * The commit line next to the save button states that directly chosen colors are a draft and apply
 * only once saved. It differs from the preview sentence (themePreviewNote()): that one says what
 * this box is, and this one says what happens if the user does not press save. They sit far apart
 * on screen. The preview is under the presets, and save comes after the gradient controls. This
 * fact was once written in three places. A third repetition made the section read like a manual.
 */
export const themeSaveNote = (): string =>
	translator("settings")("theme.saveNote");

/**
 * The reset trigger's label does not state a scope. The two items inside it do (`Reset custom colors`, `Reset
 * entire theme`). If the trigger borrowed one item's word, it would point to different things before and
 * after opening.
 */
export const themeResetMenuLabel = (): string =>
	translator("settings")("theme.resetMenu");

/**
 * There are two resets, each with a name that states its scope. One reset would make `Reset to default`
 * ambiguous: clear only the custom colors, or also revert the presets? The costs differ. A preset
 * is re-picked with one tap, while custom colors must be recreated.
 */
export const themeClearColorsLabel = (): string =>
	translator("settings")("theme.clearColors");
export const themeResetAllLabel = (): string =>
	translator("settings")("theme.resetAll");

/**
 * The four actions that can fail in this section. The vocabulary exists because each failure needs
 * a location. Each action keeps its own message. Folding all four into one message such as 'failed
 * to save' would show the same text to someone who pressed a preset and someone who pressed reset,
 * and it would not say what failed.
 */
export type ThemeFailureAction =
	/** A preset card was pressed. This saves immediately. */
	| "preset"
	/** Commits the custom-color draft (the `Save colors` button). */
	| "colors"
	/** `Reset custom colors`. */
	| "clearColors"
	/** `Reset entire theme`. This also reverts the preset, not just the custom colors. */
	| "resetAll";

/**
 * Where a failure message appears:
 * - preset: directly below the preset color cards
 * - custom: the action row of the custom-colors section, beside the save and reset buttons
 */
export type ThemeFailureScope = "preset" | "custom";

/**
 * Maps each action to where its failure appears. All four used to appear in the same place, at the
 * bottom of the section. That placement had a concrete defect: a failed preset save changes nothing
 * on screen, since the selection is not applied optimistically. The message, though, sat past the
 * preview box, the swatches, and the gradient controls, off screen. The user who pressed the card
 * read it as a dropped click and pressed again. `resetAll` is in the custom scope not because it
 * reverts presets, but because its button sits there. The question this table answers is not what
 * changes, but what the user just pressed. Because it is a Record, an action with no placement
 * fails to compile.
 */
export const THEME_FAILURE_SCOPE: Record<
	ThemeFailureAction,
	ThemeFailureScope
> = {
	preset: "preset",
	colors: "custom",
	clearColors: "custom",
	resetAll: "custom",
};

/**
 * Each action has its own message, because the four differ. Raw error text is never shown. The
 * user's next step is the same for all four (retry). What differs is which action failed, and the
 * message states that.
 */
export const themeFailureMessage = (key: ThemeFailureAction): string =>
	translator("settings")(`theme.failure.${key}`);

/** Given one failed action, returns what to draw: where it goes and the message. */
export function themeFailureFor(action: ThemeFailureAction): {
	scope: ThemeFailureScope;
	message: string;
} {
	return {
		scope: THEME_FAILURE_SCOPE[action],
		message: themeFailureMessage(action),
	};
}

/**
 * Reverts one slot inside the popover. It changes only the local draft and does not call the
 * server. The wording moved away from `Use default` for section 39. With presets, that phrase is
 * ambiguous: clearing the accent slot while the black preset is selected reverts to black's accent,
 * not the RowCat default purple.
 */
export const themeSlotPresetLabel = (): string =>
	translator("settings")("theme.slotPreset");
/** Display label for a slot with no custom value. It is not drawn as a black swatch (§26). */
export const themeSlotUnsetLabel = (): string =>
	translator("settings")("theme.slotUnset");

/**
 * Names of the controls inside the picker. The implementation's vocabulary (HSV, saturation/value)
 * never appears on screen. That vocabulary belongs to the person who built the feature, not the
 * person choosing a color, and assistive tech reads it aloud as-is. The names are combined with the
 * slot name, for example `Background color hue`. The popover has two sliders. If both were just 'hue', a user
 * moving between slots could not tell by voice which one they are changing.
 */
export const themePickerSurfaceLabel = (): string =>
	translator("settings")("theme.pickerSurface");
export const themePickerHueLabel = (): string =>
	translator("settings")("theme.pickerHue");
export const themePickerHexLabel = (): string =>
	translator("settings")("theme.pickerHex");
/**
 * The name of the current color swatch. Even while a partial input is being typed, it draws the
 * last valid color.
 */
export const themePickerCurrentLabel = (): string =>
	translator("settings")("theme.pickerCurrent");

/**
 * Shown when a hand-typed value is not valid. It uses the same vocabulary as the contract's
 * message.
 */
export const themeInvalidValueNote = (): string =>
	translator("settings")("theme.invalidValue");

/**
 * The gradient copy uses the word `gradient` as-is. Soft names such as `Background effect` or `Fade` do not say
 * what the control is, and people looking for it already use that word. Only the end color has a
 * name of its own. The start color does not: it is the `Background` row above. A second control here would
 * create two places editing the same value, which would soon behave differently.
 */
export const themeGradientToggleLabel = (): string =>
	translator("settings")("theme.gradientToggle");
export const themeGradientToggleDescription = (): string =>
	translator("settings")("theme.gradientToggleDescription");
export const themeGradientFromLabel = (): string =>
	translator("settings")("theme.gradientFrom");
export const themeGradientFromNote = (): string =>
	translator("settings")("theme.gradientFromNote");
export const themeGradientToLabel = (): string =>
	translator("settings")("theme.gradientTo");
/**
 * The end-color row's description does not borrow the switch's sentence. At one point they were
 * identical, so enabling the gradient showed the same paragraph twice. The switch's description
 * answers 'what is this?', while the row answers 'what does this value decide?'.
 */
export const themeGradientToDescription = (): string =>
	translator("settings")("theme.gradientToDescription");
/**
 * The name given to the control on this row. It is kept separate from the visible name. The trigger
 * and picker names are assembled as `Edit ${name} color` and `${name} color hue`. Using the visible label `End color`
 * would produce `Edit end color`, a doubled phrase that is invisible on screen but read aloud by screen
 * readers. A bare `End` would not say whose end it is inside the popover, so the control name is
 * `Gradient end`.
 */
export const themeGradientToControlName = (): string =>
	translator("settings")("theme.gradientToControl");
export const themeGradientAngleLabel = (): string =>
	translator("settings")("theme.gradientAngle");
/**
 * The unit next to the angle is a separate element from the number, so only the number rolls. If
 * the unit sat inside a rolling box, `°` would shift each time the digit count changed. Screen
 * readers read the value from the slider itself (its format function carries the degree unit).
 */
export const themeGradientAngleUnit = (): string =>
	translator("settings")("theme.gradientAngleUnit");

/**
 * Shown when neither end of the gradient is readable. This is a warning, not an error. Saving is
 * not blocked. Blocking would choose colors for the user, and it would conflict with not rejecting
 * low-contrast solid backgrounds. The warning states the consequence before the user presses save.
 */
export const themeGradientContrastWarning = (): string =>
	translator("settings")("theme.gradientContrast");

/**
 * `Random palette` is a secondary control inside the custom-colors section. The name is deliberately not
 * `Theme suggestions` or `AI palette`. The first implies a choice among curated
 * options, and the second is false: this button does color arithmetic, with no network and no model
 * involved. The explanatory paragraph was removed. The sentence `applies only after you save` is now carried by
 * themeSaveNote(), which sits right beside the save button. The button moved from the section title
 * to directly below the three color rows. Beside the title it competed for weight with the heading
 * without saying what it acted on.
 */
export const themeRandomPaletteLabel = (): string =>
	translator("settings")("theme.randomPalette");
/** Rerolls only the gradient. The color slots are kept, so the name states the scope. */
export const themeRandomGradientLabel = (): string =>
	translator("settings")("theme.randomGradient");

/** Preview copy. It states that changes made before saving exist only inside this box. */
export const themePreviewTitle = (): string =>
	translator("settings")("theme.previewTitle");
export const themePreviewNote = (): string =>
	translator("settings")("theme.previewNote");
