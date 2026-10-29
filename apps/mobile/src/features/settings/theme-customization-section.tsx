import type { ThemeCustomizationSlot } from "@rowcat/design";
import {
	borderWidth,
	radiusScale,
	space,
	THEME_CUSTOMIZATION_SLOTS,
} from "@rowcat/design";
import {
	clearThemeColorsMutationOptions,
	resetThemeMutationOptions,
	saveThemeColorsMutationOptions,
	saveThemePresetMutationOptions,
	themeCustomizationQueryOptions,
} from "@rowcat/query";
import {
	Button,
	DropdownMenu,
	Icon,
	MenuItem,
	Notice,
	Spinner,
	Text,
	touchTarget,
	useBaseTheme,
	useTheme,
} from "@rowcat/ui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { SettingsSection } from "./settings-parts.tsx";
import { ThemeColorDialog } from "./theme-color-dialog.tsx";
import {
	syncThemeDraftFromServer,
	THEME_CLEAR_COLORS_LABEL,
	THEME_CUSTOM_GROUP_DESCRIPTION,
	THEME_CUSTOM_GROUP_TITLE,
	THEME_FOREGROUND_NOTE,
	THEME_LOAD_FAILURE_MESSAGE,
	THEME_OFFLINE_MESSAGE,
	THEME_PRESET_GROUP_DESCRIPTION,
	THEME_PRESET_GROUP_TITLE,
	THEME_PRESET_LABEL,
	THEME_PRESET_ORDER,
	THEME_PREVIEW_ACTION_LABEL,
	THEME_PREVIEW_NOTE,
	THEME_PREVIEW_TITLE,
	THEME_RESET_ALL_LABEL,
	THEME_RESET_MENU_LABEL,
	THEME_RESETTING_LABEL,
	THEME_SAVE_FAILURE_MESSAGE,
	THEME_SAVE_LABEL,
	THEME_SAVE_NOTE,
	THEME_SECTION_DESCRIPTION,
	THEME_SECTION_TITLE,
	THEME_SLOT_DESCRIPTION,
	THEME_SLOT_LABEL,
	THEME_SLOT_UNSET_LABEL,
	type ThemeDraft,
	type ThemePreviewBaseColors,
	themeCustomizationView,
	themeDraftEquals,
	themeDraftFrom,
	themeDraftHasValue,
	themeDraftSyncKey,
	themePresetSwatch,
	themePreviewColors,
	themeRequestFrom,
	themeSlotFallbackColors,
} from "./theme-customization-state.ts";

/**
 * Theme: **colors the account owns.** Its ownership is the exact opposite of the section above
 * (brightness).
 *
 * ```text
 * Display (brightness)   the device's value    independent of sign-in, persists across account changes
 * Theme (here)           the account's value   follows other signed-in devices
 * ```
 *
 * ## This screen is an **editor, not the application layer**
 *
 * When a save succeeds, `@rowcat/query` seeds the confirmed value into the cache, and the root's
 * `ViewerThemeOverride` reads it to change the colors across the whole app. This file contains not
 * a single line that applies colors, which is how that boundary is expressed. A second apply effect
 * would either leave the colors stuck when the settings screen is left, or let two layers paint
 * different values.
 *
 * ## No optimistic update
 *
 * The lie drawn here for a moment would be "this color was saved", and the server can reject it. So
 * until the save is confirmed, the app's colors do not change by a single pixel, and the draft
 * lives **only inside the preview box**.
 */
export function ThemeCustomizationSection() {
	const query = useQuery({
		...themeCustomizationQueryOptions(getRowCatClient()),
		/** This section looks only at the value and status; there is no reason to re-render when another axis changes. */
		notifyOnChangeProps: ["data", "isError", "fetchStatus"],
	});

	const view = themeCustomizationView({
		state: query.data,
		isError: query.isError,
		/** **Paused comes before failed.** A pause is still `pending`, so it would otherwise become a loading state that never ends. */
		isPaused: query.fetchStatus === "paused",
	});

	return (
		<SettingsSection
			title={THEME_SECTION_TITLE}
			description={THEME_SECTION_DESCRIPTION}
		>
			{view.kind === "loading" ? (
				<View style={theme.center}>
					<Spinner />
				</View>
			) : view.kind === "offline" ? (
				/** This is waiting, not failure; the copy says so. */
				<Notice
					message={THEME_OFFLINE_MESSAGE}
					actionLabel="Try again"
					onAction={() => void query.refetch()}
				/>
			) : view.kind === "error" ? (
				<Notice
					tone="destructive"
					message={THEME_LOAD_FAILURE_MESSAGE}
					actionLabel="Try again"
					onAction={() => void query.refetch()}
				/>
			) : (
				<ThemeEditor preset={view.preset} customization={view.customization} />
			)}
		</SettingsSection>
	);
}

function ThemeEditor({
	preset,
	customization,
}: {
	preset: ThemeCustomizationView["preset"];
	customization: ThemeCustomizationView["customization"];
}) {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	/**
	 * **The color table before overrides are applied.** If the merged table (`useTheme()`) were the
	 * base, the previews of empty slots would draw the currently saved colors, and the user would read
	 * a cleared slot as not having been cleared.
	 */
	const base = useBaseTheme().colors as ThemePreviewBaseColors;

	const saved = themeDraftFrom(customization);
	const [draft, setDraft] = useState<ThemeDraft>(saved);
	const [failure, setFailure] = useState<string | null>(null);
	const [editing, setEditing] = useState<ThemeCustomizationSlot | null>(null);

	/**
	 * The server snapshot last **processed by sync**. This value is needed to ask "what did the server
	 * change?" Comparing against the current draft (`draft`) would make the user's unsaved edits read
	 * as "changed by the server".
	 */
	const previousSavedRef = useRef(saved);

	/**
	 * Reconcile the draft when the server value changes: another device saved, or a save or reset
	 * finished here.
	 *
	 * **This file decides neither what "changed" nor what to change.** The first is answered by
	 * `themeDraftSyncKey`, the second by `syncThemeDraftFromServer`. This app's tests do not render
	 * screens, so if the rule lived inside the effect, the only way to check it would be "try it on
	 * two devices", and every symptom of getting it wrong is silent.
	 *
	 * ```text
	 * a visible slot changed        reset the draft to that snapshot    the server is the source of truth
	 * only the gradient changed     keep the color being edited        this app receives only the slots it cannot edit
	 *                               replace only the hidden slots
	 * ```
	 *
	 * This spot used to be a single `setDraft(saved)`. That line did stop the carried gradient from
	 * going stale, but every time a change that **only changed the gradient** arrived from the web, it
	 * also wiped the color edit not yet saved on this screen.
	 *
	 * **This is not a general conflict-resolution scheme.** The only reason the gradient is special is
	 * that this app can neither draw nor edit it.
	 *
	 * **Presets are not in this list.** If changing a preset reset the color draft, merely tapping a
	 * preset while picking a color would lose that draft.
	 *
	 * **`dirty` still looks only at the visible slot set (`themeDraftEquals`).** Keeping the two
	 * decisions apart is intentional: merging them would turn on this screen's `Save colors` the moment the
	 * web changed only the gradient, showing the user an edit they never made.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: only re-sync when the value actually changes.
	useEffect(() => {
		const previousSaved = previousSavedRef.current;
		previousSavedRef.current = saved;
		setDraft((current) =>
			syncThemeDraftFromServer(current, previousSaved, saved),
		);
		setFailure(null);
	}, [themeDraftSyncKey(saved)]);

	const onFailure = () => setFailure(THEME_SAVE_FAILURE_MESSAGE);

	const savePreset = useMutation({
		...saveThemePresetMutationOptions(client, queryClient),
		onError: onFailure,
	});
	/** The draft is not cleared: these are the colors the user chose. */
	const saveColors = useMutation({
		...saveThemeColorsMutationOptions(client, queryClient),
		onError: onFailure,
	});
	const clearColors = useMutation({
		...clearThemeColorsMutationOptions(client, queryClient),
		onError: onFailure,
	});
	const resetAll = useMutation({
		...resetThemeMutationOptions(client, queryClient),
		onError: onFailure,
	});

	const busy =
		savePreset.isPending ||
		saveColors.isPending ||
		clearColors.isPending ||
		resetAll.isPending;

	/**
	 * **The color table with overrides applied.** The preset card's **frame** reads it (the card's
	 * border and name label). Only the inner swatch paints preset colors from `base`: that box says
	 * what picking this preset would produce, not what the screen shows right now.
	 */
	const { colors, alpha } = useTheme();

	const request = themeRequestFrom(draft);
	const dirty = !themeDraftEquals(draft, saved);
	const fallbacks = themeSlotFallbackColors(preset, base);
	const preview = themePreviewColors(preset, draft, base);

	return (
		<View style={theme.root}>
			{/* ── ① Base colors and their result ──────────────────────────── */}
			<View style={theme.group}>
				<Text variant="body" weight="medium">
					{THEME_PRESET_GROUP_TITLE}
				</Text>
				<Text variant="label" tone="muted-foreground">
					{THEME_PRESET_GROUP_DESCRIPTION}
				</Text>
				<View
					accessibilityRole="radiogroup"
					accessibilityLabel={THEME_PRESET_GROUP_TITLE}
					style={theme.presets}
				>
					{THEME_PRESET_ORDER.map((value) => {
						const swatch = themePresetSwatch(value, base);
						const selected = value === preset;
						return (
							<Pressable
								key={value}
								accessibilityRole="radio"
								accessibilityState={{ checked: selected, disabled: busy }}
								accessibilityLabel={THEME_PRESET_LABEL[value]}
								disabled={busy}
								onPress={() => {
									if (selected) return;
									setFailure(null);
									savePreset.mutate(value);
								}}
								/**
								 * **The border width does not change with state.** Giving only the selected cell 2pt would
								 * shake the whole grid by 1pt on every preset change. The web uses `ring` (a shadow) here,
								 * so layout does not move; RN has no such axis, so only **the color** changes and the
								 * emphasis is drawn by the ring below (the settings navigation row records the same
								 * decision).
								 */
								style={[
									theme.preset,
									{
										borderColor: selected ? colors.primary : colors.border,
									},
								]}
							>
								{/**
								 * The swatch is **a box inside the card**: the web's `h-12 rounded-md border p-1.5`.
								 * The preset background is painted only inside this box, so the name label does not
								 * sit on top of it (the card's surface is the screen's own surface).
								 */}
								<View
									style={[
										theme.presetSwatch,
										{
											backgroundColor: swatch.background,
											borderColor: colors.border,
										},
									]}
								>
									<View
										style={[
											theme.presetSurface,
											{ backgroundColor: swatch.surface },
										]}
									/>
									<View
										style={[
											theme.presetPrimary,
											{ backgroundColor: swatch.primary },
										]}
									/>
								</View>
								{/**
								 * The name is **inside the card**. The earlier reason for placing it outside, "it is
								 * unreadable on a white preset background", went away when the swatch moved into the
								 * inner box: the surface this label sits on is the screen's surface, not the preset's
								 * background. The web has the same structure.
								 */}
								<Text
									variant="caption"
									weight="medium"
									tone={selected ? "foreground" : "muted-foreground"}
								>
									{THEME_PRESET_LABEL[value]}
								</Text>
								{/**
								 * The web's `ring-2 ring-primary/30`. It stands outside the flow, so it does not move
								 * layout by a pixel. The selected cell is indicated not by this ring but by
								 * `accessibilityState.checked` and the border color; this is emphasis layered on top.
								 */}
								{selected ? (
									<View
										pointerEvents="none"
										style={[
											theme.presetRing,
											{ borderColor: alpha("primary", 0.3) },
										]}
									/>
								) : null}
							</Pressable>
						);
					})}
				</View>
				{/**
				 * **The preview sits directly below the presets, inside the same section.**
				 *
				 * The next question for someone who taps a card is "how does this look?". If the answer sat **after**
				 * the three color rows, that question would force scrolling. For a while this box was its own section
				 * after the direct-settings section, so seeing the result of a background choice meant passing every control.
				 *
				 * The title (`Theme preview`) was removed as a result. The card inside the box already draws that wording,
				 * so placing it again above would print the same word twice in a column. The line below says what this is.
				 */}
				<View
					/**
					 * It is a picture, not a control: do not expose it to assistive technology as a fake control.
					 * The pill inside is a `View` that cannot be pressed.
					 */
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					/**
					 * The box's border is **the screen's rule**, not the preset's surface color. The default
					 * preset's surface equals its background, so a border in the surface color would melt the box
					 * and the card inside into the screen, leaving only the text floating. (The web's
					 * `ThemePreview` also uses the screen's `border` on the box.)
					 */
					style={[
						theme.preview,
						{
							backgroundColor: preview.background,
							borderColor: colors.border,
						},
					]}
				>
					{/**
					 * The card is the surface and the pill is the accent: the three elements stand in **one scene**.
					 * The card also gets the screen's rule, for the same reason as above (the web uses a faint ring
					 * in the same place).
					 */}
					<View
						style={[
							theme.previewCard,
							{ backgroundColor: preview.surface, borderColor: colors.border },
						]}
					>
						<Text
							variant="label"
							weight="semibold"
							style={{ color: preview.surfaceForeground }}
						>
							RowCat
						</Text>
						<Text
							variant="caption"
							style={{ color: preview.surfaceForeground, opacity: 0.8 }}
						>
							{THEME_PREVIEW_TITLE}
						</Text>
						<View
							style={[theme.previewPill, { backgroundColor: preview.primary }]}
						>
							<Text
								variant="caption"
								weight="medium"
								style={{ color: preview.primaryForeground }}
							>
								{THEME_PREVIEW_ACTION_LABEL}
							</Text>
						</View>
					</View>
				</View>
				<Text variant="caption" tone="muted-foreground">
					{THEME_PREVIEW_NOTE}
				</Text>
			</View>

			{/* ── ② Direct color editing — **one editing surface** ─────────── */}
			<View style={theme.group}>
				<Text variant="body" weight="medium">
					{THEME_CUSTOM_GROUP_TITLE}
				</Text>
				<Text variant="label" tone="muted-foreground">
					{THEME_CUSTOM_GROUP_DESCRIPTION}
				</Text>

				{/**
				 * The three color rows are **one property list**, so there is no section per row. The gap between
				 * them is narrower than the section gap (`space.sm`), which is the picture of that fact.
				 */}
				<View style={theme.slots}>
					{THEME_CUSTOMIZATION_SLOTS.map((slot) => (
						<ThemeSlotRow
							key={slot}
							slot={slot}
							value={draft[slot]}
							fallback={fallbacks[slot]}
							onPress={() => setEditing(slot)}
						/>
					))}
				</View>

				{/** Describes an axis the three rows above do not set, so it sits directly below them. */}
				<Text variant="caption" tone="muted-foreground">
					{THEME_FOREGROUND_NOTE}
				</Text>

				{/**
				 * Failure **ends inside this section**. If it were sent to a global notice, a message shown after
				 * leaving the screen could not say what was not saved. It sits directly above the action row because
				 * that is where the retry button is.
				 */}
				{failure ? <Notice tone="destructive" message={failure} /> : null}

				{/** States that the chosen colors are a **draft**. It sits right beside the commit button. */}
				<Text variant="caption" tone="muted-foreground">
					{THEME_SAVE_NOTE}
				</Text>
				<Button
					label={THEME_SAVE_LABEL}
					fullWidth
					/**
					 * Locked when there is no document to send (a slot is not valid syntax) or nothing changed.
					 * Sending an invalid draft would, under replace semantics, erase the stored color with that
					 * typo (the reason `themeRequestFrom` returns `null`).
					 */
					disabled={!dirty || request === null || busy}
					busy={saveColors.isPending}
					onPress={() => {
						if (!request) return;
						setFailure(null);
						saveColors.mutate(request);
					}}
				/>

				{/**
				 * The two reset actions are **folded behind one trigger**.
				 *
				 * For a while two full-width buttons sat here (one inside this section, one at the bottom of the
				 * screen), each the same size as `Save colors`. The person who has finished editing needs only save,
				 * yet the screen gave all three the same weight, and the action with the highest cost to undo was
				 * taking full width at the very bottom.
				 *
				 * **The vocabulary was not folded.** There are still two items, and each states its scope.
				 */}
				<ThemeResetMenu
					busy={busy}
					resetting={clearColors.isPending || resetAll.isPending}
					canClearColors={themeDraftHasValue(saved)}
					canResetAll={themeDraftHasValue(saved) || preset !== "default"}
					onClearColors={() => {
						setFailure(null);
						clearColors.mutate();
					}}
					onResetAll={() => {
						setFailure(null);
						resetAll.mutate();
					}}
				/>
			</View>

			{editing ? (
				<ThemeColorDialog
					slot={editing}
					value={draft[editing]}
					fallback={fallbacks[editing]}
					onCancel={() => setEditing(null)}
					onApply={(next) => {
						setDraft((current) => ({ ...current, [editing]: next }));
						setEditing(null);
					}}
				/>
			) : null}
		</View>
	);
}

/**
 * One menu holding the two reset actions. The same decision as the web's counterpart of the same
 * name.
 *
 * ## Why not two full-width buttons?
 *
 * This section had three actions (`Save colors`, `Reset custom colors`, `Reset entire theme`), all full width. That layout
 * says "choose one of these three", which in practice is not the case: the person who has finished
 * editing needs only save, and the other two belong to **someone who came back to undo**. With
 * equal weight that fact is absent from the screen.
 *
 * ## Yet reset remains **two** items
 *
 * Folding them into one would leave `Reset to default` unclear before pressing: does it clear only the
 * chosen colors, or revert the preset too? The two have different costs to undo. What was folded is
 * **the placement**, not the vocabulary.
 *
 * ## Nothing to do means nothing is drawn
 *
 * An item that does nothing when pressed is not put in the menu, and if neither applies the trigger
 * itself disappears.
 *
 * ## No new confirmation dialog
 *
 * These actions still run immediately, without confirmation. Adding confirmation while rearranging
 * the layout is a separate decision (whether the cost of undoing actually calls for it), and it is
 * not a question this slice answers.
 */
function ThemeResetMenu({
	busy,
	resetting,
	canClearColors,
	canResetAll,
	onClearColors,
	onResetAll,
}: {
	/** Any action in this section is running; the items lock together. */
	busy: boolean;
	/** A **reset** is running; the trigger's label says so (the menu is closed). */
	resetting: boolean;
	canClearColors: boolean;
	canResetAll: boolean;
	onClearColors: () => void;
	onResetAll: () => void;
}) {
	if (!canClearColors && !canResetAll) return null;

	return (
		<View style={theme.resetRow}>
			<DropdownMenu
				label={THEME_RESET_MENU_LABEL}
				triggerLabel={
					resetting ? THEME_RESETTING_LABEL : THEME_RESET_MENU_LABEL
				}
				/**
				 * Only the chevron stands. Adding one more icon in front would make the trigger start naming
				 * the kind of action, but this trigger opens **two** actions, so it cannot name just one of
				 * them.
				 */
				icon="chevron-down"
				align="start"
			>
				{canClearColors ? (
					<MenuItem
						icon="delete"
						label={THEME_CLEAR_COLORS_LABEL}
						disabled={busy}
						onSelect={onClearColors}
					/>
				) : null}
				{canResetAll ? (
					<MenuItem
						icon="retry"
						label={THEME_RESET_ALL_LABEL}
						disabled={busy}
						onSelect={onResetAll}
					/>
				) : null}
			</DropdownMenu>
		</View>
	);
}

/** One row for a slot: the swatch, the current value, and the way into the editor. */
function ThemeSlotRow({
	slot,
	value,
	fallback,
	onPress,
}: {
	slot: ThemeCustomizationSlot;
	value: string;
	/** Color shown when this slot is cleared: the value of the chosen preset. */
	fallback: string;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	const label = THEME_SLOT_LABEL[slot];
	const shown = value.trim();
	return (
		<Pressable
			accessibilityRole="button"
			/**
			 * The label states **both the slot and its current value**. The swatch speaks only through
			 * color, so it means nothing to someone who cannot see the screen. An empty slot reads as
			 * "preset color" (that is the meaning of the empty string, not a blank).
			 */
			accessibilityLabel={`${label}: ${shown || THEME_SLOT_UNSET_LABEL}`}
			accessibilityHint={THEME_SLOT_DESCRIPTION[slot]}
			onPress={onPress}
			style={theme.slot}
		>
			{/**
			 * A **screen rule** goes around the swatch. When the slot is cleared the preset color is painted, but the
			 * default preset's background and surface are the same color as this screen's backdrop. Without a border
			 * the swatch vanished entirely, and only the accent looked like it had a swatch among the three rows.
			 * (The web's swatch also has a `border`.)
			 */}
			<View
				style={[
					theme.swatch,
					{ backgroundColor: shown || fallback, borderColor: colors.border },
				]}
			/>
			<View style={theme.slotText}>
				<Text variant="body">{label}</Text>
				<Text variant="caption" tone="muted-foreground">
					{shown || THEME_SLOT_UNSET_LABEL}
				</Text>
			</View>
			<Icon name="chevron-right" size="sm" tone="muted-foreground" />
		</Pressable>
	);
}

type ThemeCustomizationView = Extract<
	ReturnType<typeof themeCustomizationView>,
	{ kind: "ready" }
>;

const theme = StyleSheet.create({
	root: { gap: space.lg },
	center: { alignItems: "center", paddingVertical: space.xl },
	group: { gap: space.sm },
	/**
	 * **Two cells per row.** Same as the web's `grid-cols-2` (narrow screens). While four sat in one
	 * row, each cell was 84pt wide and the swatch inside was too small to say what the preset was
	 * (`sm:grid-cols-4` starts at 640px and never reaches this app).
	 *
	 * `flexBasis: "47%"` plus `flexGrow: 1` produce that: a third cannot rise into the row, and the
	 * leftover width is shared by the two.
	 */
	presets: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
	/** Same values as the web's card (`rounded-lg border p-2 gap-2`). */
	preset: {
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		flexBasis: "47%",
		flexGrow: 1,
		gap: space.sm,
		padding: space.sm,
	},
	/** The web's swatch box (`h-12 w-full rounded-md border p-1.5`). */
	presetSwatch: {
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		height: 48,
		justifyContent: "space-between",
		padding: 6,
		width: "100%",
	},
	/** The web's `h-3.5 w-3/4 rounded-sm`. */
	presetSurface: { borderRadius: radiusScale.sm, height: 14, width: "75%" },
	/** The web's `h-2.5 w-1/3 self-end rounded-sm`. */
	presetPrimary: {
		alignSelf: "flex-end",
		borderRadius: radiusScale.sm,
		height: 10,
		width: "33%",
	},
	/** The web's `ring-2`: it overlaps the inside of the card's border and does not change the layout. */
	presetRing: {
		borderRadius: radiusScale.lg,
		borderWidth: 2,
		bottom: 0,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	/**
	 * Spacing between the three color rows is **narrower than the section gap (`space.sm`).**
	 *
	 * The three are not separate settings but three cells of one list. If the spacing matched, the
	 * screen would read them as three sections. The spacing above and below (to the description and
	 * notice) stays as `group`'s.
	 */
	slots: { gap: space.xs },
	/**
	 * The reset trigger is **not full width.** Anchoring it to the left is the picture of that fact,
	 * and its weight differs from the full-width `Save colors`.
	 */
	resetRow: { alignItems: "flex-start" },
	slot: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.sm,
		minHeight: touchTarget,
	},
	/** Dimming is **one opacity value**. A separately mixed faded color would have to be tuned for light and dark separately. */
	slotText: { flex: 1, gap: space.px },
	swatch: {
		borderRadius: radiusScale.sm,
		borderWidth: borderWidth,
		height: 28,
		width: 28,
	},
	preview: {
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		gap: space.sm,
		padding: space.md,
	},
	previewCard: {
		borderRadius: radiusScale.sm,
		borderWidth: borderWidth,
		gap: space.xs,
		padding: space.md,
	},
	previewPill: {
		alignSelf: "flex-end",
		borderRadius: radiusScale.sm,
		marginTop: space.sm,
		paddingHorizontal: space.md,
		paddingVertical: space.xs,
	},
});
