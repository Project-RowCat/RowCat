import type {
	ThemeCustomizationDto,
	ThemeCustomizationStateDto,
	ThemeGradientDto,
	ThemePreset,
} from "@rowcat/contracts";
import {
	isThemeColorHex,
	readableForegroundOn,
	resolveThemePresetOverrides,
	THEME_CUSTOMIZATION_SLOTS,
	THEME_PRESETS,
	type ThemeCustomizationSlot,
} from "@rowcat/design";

/**
 * Screen state for the theme section, as pure functions split out of rendering.
 *
 * Same rules as `apps/web/src/features/settings/theme-customization-state.ts`; each app keeps its
 * own copy because the strings are locale-bound (section names, lock notes, slot descriptions). The
 * color math is not here at all: presets, contrast, and grammar checks all call `@rowcat/design`,
 * so the preview's foreground and the applied foreground cannot diverge (a copy would show the
 * difference only after saving).
 *
 * The section's decisions stay out of JSX for two failure modes that are easy to hit:
 *
 * 1. Drawing a failed load as "nothing chosen yet". An empty form makes someone with saved
 *    colors read them as gone, and saving from that state really clears them (writes replace the
 *    whole set).
 * 2. Silently folding invalid hand input into a default. Under replace semantics that fold means
 *    one typo clears the stored color, so the request builder returns `null` for an invalid draft
 *    and the screen locks saving meanwhile.
 *
 * Custom colors were once a Cattower subscriber benefit, and the list had three more entitlement
 * axes. They went away with billing in the public build (`docs/oss/PLAN.md` §3).
 *
 * ## Two axes, two operations
 *
 * ```text
 * preset        default · white · gray · black    applied on press (a discrete choice)
 * custom color  background · surface · primary    drafted, then committed with `Save colors`
 * ```
 *
 * Presets have no draft on purpose. There are four values, each a complete choice, so there is no
 * "half-chosen" state to represent.
 */

/** Render order; follows the vocabulary order. */
export const THEME_PRESET_ORDER: readonly ThemePreset[] = THEME_PRESETS;

/** A Record, so growing the preset vocabulary breaks compilation instead of rendering an unnamed card. */
export const THEME_PRESET_LABEL: Record<ThemePreset, string> = {
	default: "default",
	white: "White",
	gray: "Gray",
	black: "Black",
};

/** Draft values. An empty string means "not chosen" (the form never handles `null`). */
export interface ThemeDraft extends Record<ThemeCustomizationSlot, string> {
	/**
	 * The background gradient saved on the web. This app carries it through unchanged and never edits
	 * it.
	 *
	 * Pass-through, not editor. Without this field, saving one color here would erase the gradient:
	 * color writes replace the whole set, so an omitted key is applied as a deletion. The server does
	 * exactly what it receives, and the user only notices next time they open the web app.
	 *
	 * Nothing on this screen shows the loss either: the app does not draw gradients (it uses the solid
	 * reference color only). There is still no control that edits the value; the only reads and writes
	 * are the two conversions below, which `features/theme/theme-boundaries.test.ts` pins by name.
	 */
	gradient?: ThemeGradientDto;
}

export const EMPTY_THEME_DRAFT: ThemeDraft = {
	background: "",
	surface: "",
	primary: "",
};

/**
 * Normalizes one hand-typed value into the contract shape, and only what can be normalized safely:
 * trims, lowercases, and prepends `#` to a bare six-digit hex. Anything else is returned as-is.
 * Fixing more (truncating, resolving color names) would make the saved value differ from what the
 * user typed, and the screen could no longer explain what was stored.
 */
export function normalizedThemeDraftValue(value: string): string {
	const trimmed = value.trim().toLowerCase();
	return /^[0-9a-f]{6}$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

/** Whether one slot can be saved. An empty value is always valid: it means "use the preset color". */
export const isThemeDraftValueValid = (value: string): boolean => {
	const normalized = normalizedThemeDraftValue(value);
	return normalized === "" || isThemeColorHex(normalized);
};

/** Per-slot validity; the screen uses this table to decide which slot gets the hint. */
export type ThemeDraftValidation = Record<ThemeCustomizationSlot, boolean>;

export function themeDraftValidation(draft: ThemeDraft): ThemeDraftValidation {
	return {
		background: isThemeDraftValueValid(draft.background),
		surface: isThemeDraftValueValid(draft.surface),
		primary: isThemeDraftValueValid(draft.primary),
	};
}

/** Whether the whole draft is saveable; one invalid slot locks save. */
export const themeDraftIsValid = (draft: ThemeDraft): boolean =>
	THEME_CUSTOMIZATION_SLOTS.every((slot) =>
		isThemeDraftValueValid(draft[slot]),
	);

/** Server state to form draft. Absent slots become empty strings, since inputs cannot hold `undefined`. */
export function themeDraftFrom(
	customization: ThemeCustomizationDto,
): ThemeDraft {
	return {
		background: customization.background ?? "",
		surface: customization.surface ?? "",
		primary: customization.primary ?? "",
		/** Keep the gradient as-is so the next save sends it back unchanged. */
		...(customization.gradient ? { gradient: customization.gradient } : {}),
	};
}

/**
 * Form draft to save request. An invalid draft produces no request (`null`). It is not folded to
 * valid values: writes replace the whole set, so the server would carry out a request missing a
 * typo'd slot and clear the stored color. `null` tells the screen there is nothing safe to send,
 * and save stays locked.
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
	 * Re-send the web-saved gradient. Dropping it would make a save from this app erase it (replace
	 * semantics).
	 *
	 * Gated on the background: the background is the first stop, so a gradient sent with an empty
	 * background is rejected by the contract (400). Losing the gradient in that case is the
	 * consequence of the user clearing the background.
	 */
	if (draft.gradient && out.background) out.gradient = draft.gradient;

	return out;
}

/**
 * Whether two drafts are equal, which decides whether save is enabled (equal means there is nothing
 * to send). Compares normalized values: the same color retyped in uppercase must not read as
 * changed, or save enables and the user gets a response that changes nothing.
 */
export function themeDraftEquals(a: ThemeDraft, b: ThemeDraft): boolean {
	for (const slot of THEME_CUSTOMIZATION_SLOTS)
		if (
			normalizedThemeDraftValue(a[slot]) !== normalizedThemeDraftValue(b[slot])
		)
			return false;
	return true;
}

/**
 * The value that answers whether the server snapshot changed. It is the dependency of the
 * draft-sync effect.
 *
 * The two functions answer different questions, and mixing them up is the subtle part of this file:
 *
 * ```text
 * themeDraftEquals    did the user-editable value change?    decides whether `Save colors` is enabled
 * themeDraftSyncKey   did the server snapshot change?        decides whether to re-align the draft
 * ```
 *
 * The first compares only the visible slots. The gradient cannot be edited here, so if its change
 * enabled save, the user would see an edit they never made. The second also compares the carried
 * values. Without that, this sequence silently loses data:
 *
 * ```text
 * 1. Screen opens                                  draft carries gradient G1
 * 2. Web changes only the gradient to G2            server is now G2
 * 3. Refetch returns G2                             visible slots are unchanged
 * 4. An effect comparing only visible slots        does not run; the draft is still G1
 * 5. User edits primary here and saves             replace semantics send G1
 * 6. The web's G2 reverts to G1                    an undo the user never asked for
 * ```
 *
 * The key is a string so it can be checked: this app's tests do not render, so a rule that lives
 * only in a dependency array can be verified only by hand on two devices, and the loss above leaves
 * no trace on this screen.
 *
 * Normalization is intentionally skipped. The source is the server, which already normalized;
 * folding again here would make the comparison answer "did our folding change" rather than "did the
 * server value change".
 */
export function themeDraftSyncKey(draft: ThemeDraft): string {
	/**
	 * Presence and absence are encoded separately. `to` is currently required, so `undefined` already
	 * means absent, but relying on that would silently lose the absence observation if the draft shape
	 * loosened.
	 */
	const gradient = draft.gradient
		? `on:${draft.gradient.to}:${draft.gradient.angle}`
		: "off";
	return `${draft.background}|${draft.surface}|${draft.primary}|${gradient}`;
}

/**
 * Reflects a new server snapshot into the draft. `themeDraftSyncKey` answers whether the snapshot
 * changed; this function answers what to change. Replacing the whole draft with `nextSaved` would
 * lose edits:
 *
 * ```text
 * 1. Server: background A · surface B · primary P1 · gradient G1
 * 2. Here, primary is changed to P2 (not yet saved)
 * 3. The web changes only the gradient G1 → G2
 * 4. Refetch brings the new snapshot; visible slots are unchanged
 * 5. Replacing the whole draft reverts P2 to P1        an undo the user never asked for
 * ```
 *
 * Three branches:
 *
 * ```text
 * snapshot unchanged           keep the current draft     no needless reassignment
 * visible slots changed        realign to nextSaved       a save or reset finished, or another device edited
 * only the gradient changed    keep visible slots,        only values this app cannot edit are taken
 *                              swap in the hidden ones
 * ```
 *
 * This is not general conflict resolution. The gradient is special for one reason: this app can
 * neither draw nor edit it, and color writes replace the whole set, so it is erased unless carried
 * along. Visible slots are editable here, so the server is authoritative for them: if another
 * device changed them, that value wins. There is no merge UI and no per-field indication.
 *
 * The classification uses the two server snapshots, not the current draft. `current` holds unsaved
 * edits, so comparing it with `nextSaved` would read the user's edit as a server change, and step 4
 * above would always fall into the "visible slots changed" branch.
 */
export function syncThemeDraftFromServer(
	current: ThemeDraft,
	previousSaved: ThemeDraft,
	nextSaved: ThemeDraft,
): ThemeDraft {
	/** Snapshot unchanged: return the same reference so re-renders also collapse. */
	if (themeDraftSyncKey(previousSaved) === themeDraftSyncKey(nextSaved))
		return current;

	/**
	 * Only when both arguments come from the server does this comparison answer "did the server change
	 * a visible slot?" (`themeDraftEquals` looks only at the editable slots, which is the axis this
	 * function asks about).
	 */
	if (!themeDraftEquals(previousSaved, nextSaved)) return nextSaved;

	/**
	 * Only the gradient changed: keep the color being edited and swap in only the hidden slot.
	 *
	 * The three slots are written out by hand into a new object, not spread from `current`: if the
	 * server dropped the gradient, its key must be absent here too. That absence is what keeps the
	 * next save from restoring it.
	 */
	const merged: ThemeDraft = {
		background: current.background,
		surface: current.surface,
		primary: current.primary,
	};
	if (nextSaved.gradient) merged.gradient = nextSaved.gradient;
	return merged;
}

/** Whether any slot is chosen; decides whether `Reset custom colors` is drawn. */
export const themeDraftHasValue = (draft: ThemeDraft): boolean =>
	!themeDraftEquals(draft, EMPTY_THEME_DRAFT);

/**
 * The default semantic colors for the current appearance, used by the preview to fill empty slots.
 *
 * The source is `useBaseTheme()`: it must be the palette before overrides, so "what shows if I
 * clear a slot" is answered honestly. Using the merged `useTheme()` as the floor would draw the
 * currently saved color in empty slots, and the user would read a cleared slot as not having been
 * cleared.
 */
export interface ThemePreviewBaseColors {
	background: string;
	foreground: string;
	card: string;
	"card-foreground": string;
	primary: string;
	"primary-foreground": string;
}

/** The colors one preview card draws: three surfaces and the foreground on each. */
export interface ThemePreviewColors {
	background: string;
	foreground: string;
	surface: string;
	surfaceForeground: string;
	primary: string;
	primaryForeground: string;
}

/**
 * Preset to the card's color set. `default` covers nothing, so it draws the current base palette;
 * that is the honest picture of the preset (selecting it really looks like that).
 */
export interface ThemePresetSwatch {
	background: string;
	surface: string;
	primary: string;
}

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
 * The color a slot shows when empty: the preset value, or the RowCat default.
 *
 * Clearing a custom slot means "use the selected preset's color", not "RowCat default". That must
 * match across the swatch, the editor, and the preview, or the user presses `Use preset color` and sees a
 * different color.
 */
export function themeSlotFallbackColors(
	preset: ThemePreset,
	base: ThemePreviewBaseColors,
): Record<ThemeCustomizationSlot, string> {
	const overrides = resolveThemePresetOverrides(preset);
	return {
		background: overrides.background ?? base.background,
		/** Of the three surface overrides, card is the representative; popover and sidebar receive the same value. */
		surface: overrides.card ?? base.card,
		primary: overrides.primary ?? base.primary,
	};
}

/**
 * Preset plus draft to preview colors. Four rules:
 *
 * 1. The preset is the floor. Empty slots take the preset color; slots the preset does not cover
 *    fall back to the current base palette.
 * 2. Custom colors layer on top, in the same order as the real application.
 * 3. The foreground is chosen by a shared contrast function (`readableForegroundOn`).
 * 4. Values that are not valid hex render with the preset color. They cannot be drawn, and the
 *    validation table states the hint for that slot.
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

	return {
		background: background ?? overrides.background ?? base.background,
		foreground: background
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
	};
}

export type ThemeCustomizationView =
	/** No server value has ever arrived. */
	| { kind: "loading" }
	/** No network; retries are paused. This is waiting, not failure. */
	| { kind: "offline" }
	/** The fetch failed and no value is held. Resolved inside this section. */
	| { kind: "error" }
	/** A value arrived; both axes are editable. */
	| {
			kind: "ready";
			preset: ThemePreset;
			customization: ThemeCustomizationDto;
	  };

export interface ThemeCustomizationViewInput {
	/** The last value the server answered with. `undefined` means "not known yet". */
	state: ThemeCustomizationStateDto | undefined;
	isError: boolean;
	/**
	 * Whether retries are paused because the network is judged unavailable. Without this axis that
	 * state stays `pending`, and the screen draws a loading state that never ends.
	 */
	isPaused: boolean;
}

/**
 * Query state plus contract to screen state. The order is the whole function: held value → paused →
 * failed → loading. A value already received stays true even when a background refresh fails;
 * clearing it would make the user read their setting as gone, and a save pressed in that state
 * really clears it.
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
 * Section name and description are statements of fact. Vague names with no measurable meaning (`Advanced
 * theme`, `Premium theme`, `Pro`) are not used. The paid-benefit copy follows the same rule, and a pure test
 * guards its absence by value.
 */
export const THEME_SECTION_TITLE = "Theme";
export const THEME_SECTION_DESCRIPTION =
	"This setting is saved to your account, applies on other devices you're signed in to, and uses the same colors in light and dark mode.";

/** The section above: choose one of the four. */
export const THEME_PRESET_GROUP_TITLE = "Preset colors";
export const THEME_PRESET_GROUP_DESCRIPTION =
	"Choose one of the color sets RowCat prepared.";

/**
 * The section below. `Custom colors` rather than `Customize theme colors`: the latter reads as covering the preset
 * section above too, and then the boundary between the two sections disappears from the name.
 */
export const THEME_CUSTOM_GROUP_TITLE = "Custom colors";
export const THEME_CUSTOM_GROUP_DESCRIPTION =
	"Set the background, surface and accent colors yourself.";

/** Slot names. A Record, so growing the vocabulary **breaks compilation**. */
export const THEME_SLOT_LABEL: Record<ThemeCustomizationSlot, string> = {
	background: "Background",
	surface: "Surface",
	primary: "Accent",
};

/** What each slot paints. One line each, so internal token names never reach the user. */
export const THEME_SLOT_DESCRIPTION: Record<ThemeCustomizationSlot, string> = {
	background: "The base background of the whole screen.",
	surface: "The background of cards, popovers and the sidebar.",
	primary: "The accent used for buttons and selected items.",
};

/**
 * The screen states that there is no foreground-color slot. Leaving it unsaid makes "why can't I
 * choose text color" a support question, and the answer is a product decision: unreadable
 * combinations are not allowed to be saved.
 */
export const THEME_FOREGROUND_NOTE =
	"Text color adjusts automatically to the colors you choose.";

/**
 * Why the verb is `Save colors` rather than `Save changes`: the button commits only the custom colors, not the
 * whole screen, and the name states that scope.
 */
export const THEME_SAVE_LABEL = "Save colors";

/**
 * The note on the commit row says that a directly chosen color is a draft until saved, right beside
 * the button. It does not repeat `THEME_PREVIEW_NOTE`: that one says what this box is, and this one
 * says what happens if you do not press. They sit far apart on screen (the preview is right below
 * the presets, save comes after the color rows), and the web uses the same sentence.
 */
export const THEME_SAVE_NOTE =
	"Custom colors apply to your account only after you save.";

/**
 * The label of the trigger that opens both resets. It does not state the scope: the scope belongs
 * to the two items inside (`Reset custom colors`, `Reset entire theme`). If the trigger borrowed one item's word, the
 * label would describe something different before and after opening.
 */
export const THEME_RESET_MENU_LABEL = "Reset";
/** The trigger label while that operation runs; visible even with the menu closed. */
export const THEME_RESETTING_LABEL = "Resetting…";

/**
 * Two resets, with names that state their scope. A single "reset to defaults" would not say whether
 * it clears only custom colors or also reverts the preset, and the two have different recovery
 * costs (re-choosing a preset is cheap; re-creating colors is not).
 */
export const THEME_CLEAR_COLORS_LABEL = "Reset custom colors";
export const THEME_RESET_ALL_LABEL = "Reset entire theme";

/**
 * Reverts one slot locally: changes the draft only, no server call.
 *
 * The word is not `Use default` because of presets. Someone who chose `Black` and clears the primary slot
 * returns to the black preset's primary, not the RowCat default purple.
 */
export const THEME_SLOT_PRESET_LABEL = "Use preset color";
/** Label for a slot with no custom value. Not drawn as a black swatch. */
export const THEME_SLOT_UNSET_LABEL = "Preset color";

/** Shown when a hand-typed value is not valid. Same vocabulary as the contract's message. */
export const THEME_INVALID_VALUE_NOTE =
	"Only colors in #rrggbb format can be used.";

/** Label of the color input. Implementation terms (HSV, saturation) do not appear on screen. */
export const THEME_HEX_FIELD_LABEL = "color code";

/** Preview copy: states that unsaved changes exist only inside this box. */
export const THEME_PREVIEW_TITLE = "Theme preview";
/**
 * The pill inside the preview card: a picture that cannot be pressed. Same word as the web's
 * `ThemePreview`.
 *
 * For a while `Save colors` stood here, next to a real button of the same name in the section below. A
 * copy that cannot be pressed carrying the name of an operation invites pressing it.
 */
export const THEME_PREVIEW_ACTION_LABEL = "Get started";
export const THEME_PREVIEW_NOTE =
	"Until you save, the preview applies only inside this box.";

/** Save or reset failed. Shown inside the section; the raw server message is not drawn. */
export const THEME_SAVE_FAILURE_MESSAGE =
	"Couldn't save the theme. Please try again.";
export const THEME_LOAD_FAILURE_MESSAGE = "Couldn't load theme settings.";
export const THEME_OFFLINE_MESSAGE =
	"Checking the connection. It retries once the network is back.";
