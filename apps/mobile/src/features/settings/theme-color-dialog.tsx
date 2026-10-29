import type { ThemeCustomizationSlot } from "@rowcat/design";
import { radiusScale, space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Input,
	Notice,
	Text,
} from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	isThemeDraftValueValid,
	normalizedThemeDraftValue,
	THEME_HEX_FIELD_LABEL,
	THEME_INVALID_VALUE_NOTE,
	THEME_SLOT_DESCRIPTION,
	THEME_SLOT_LABEL,
	THEME_SLOT_PRESET_LABEL,
	THEME_SLOT_UNSET_LABEL,
} from "./theme-customization-state.ts";

/**
 * A single-field form that sets one slot's color, so it is a `Dialog` (that slot in the
 * presentation table).
 *
 * ## The browser's picker is not ported as is
 *
 * The web builds an HSV plane on top of pointer capture and DOM geometry. That interaction assumes
 * a mouse, and porting it to native would require a gesture library
 * (`react-native-gesture-handler`). This app's primitives stand on **pure JavaScript alone**, which
 * is the reason that package is rejected (`docs/design/ARCHITECTURE.md`; today the only native
 * module is the icon's SVG). The build pipeline does not change for one color picker.
 *
 * Instead it **gives the same capability**: in this dialog the slot can be cleared (back to the
 * preset color), a value can be set, and the color is shown large before it is set. Syntax checking
 * and normalization go through the **same pure functions** as the web
 * (`theme-customization-state.ts` → `@rowcat/design`), so the same draft means the same thing in
 * both apps.
 *
 * ## Invalid input is not folded silently
 *
 * There is no `maxLength` and no automatic correction. A length cap would silently cut the tail of
 * a pasted value, and folding a typo into an empty value would, under replace semantics, erase the
 * stored color. So `OK` stays locked while the input is not valid syntax, and a line below the
 * field says why.
 *
 * ## No server call from here
 *
 * This dialog changes **one outer draft**. Saving is done by the section's `Save colors`, and until then
 * the app's colors do not change by a single pixel (only the preview swatch moves).
 */
export function ThemeColorDialog({
	slot,
	value,
	fallback,
	onApply,
	onCancel,
}: {
	slot: ThemeCustomizationSlot;
	/** Current draft value. An empty string means "not chosen". */
	value: string;
	/** Color shown when the slot is cleared: the value of the chosen preset. */
	fallback: string;
	onApply: (value: string) => void;
	onCancel: () => void;
}) {
	const [draft, setDraft] = useState(value);
	const trimmed = draft.trim();
	const valid = isThemeDraftValueValid(draft);
	/** Preview color. While the input is not valid syntax, the **preset color** is drawn instead, since the typed value cannot be drawn. */
	const shown = valid && trimmed ? normalizedThemeDraftValue(draft) : fallback;

	return (
		<Dialog
			open
			title={THEME_SLOT_LABEL[slot]}
			description={THEME_SLOT_DESCRIPTION[slot]}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<View style={dialog.root}>
				{/**
				 * The current color, shown large. The swatch is an image, so its label states the value too.
				 * When empty it is the preset color, and the text below says so.
				 */}
				<View
					accessibilityRole="image"
					accessibilityLabel={`${THEME_SLOT_LABEL[slot]} preview: ${
						trimmed || THEME_SLOT_UNSET_LABEL
					}`}
					style={[dialog.swatch, { backgroundColor: shown }]}
				/>

				<Input
					label={THEME_HEX_FIELD_LABEL}
					value={draft}
					onChangeText={setDraft}
					autoCapitalize="none"
					autoCorrect={false}
					autoFocus
					invalid={!valid}
				/>
				{valid ? null : (
					<Notice tone="destructive" message={THEME_INVALID_VALUE_NOTE} />
				)}

				<Text variant="caption" tone="muted-foreground">
					{trimmed ? "" : THEME_SLOT_UNSET_LABEL}
				</Text>

				{/**
				 * The way to clear the slot: **apply and close immediately.** An empty value is always valid, so it
				 * is independent of the lock above. The label states the meaning, "back to the preset color"
				 * (not `Use default`, since the target is the chosen preset).
				 */}
				{trimmed ? (
					<Button
						label={THEME_SLOT_PRESET_LABEL}
						variant="ghost"
						fullWidth
						onPress={() => onApply("")}
					/>
				) : null}

				<DialogActions>
					<Button
						label="Cancel"
						variant="outline"
						fullWidth
						onPress={onCancel}
						style={dialog.action}
					/>
					<Button
						label="OK"
						fullWidth
						disabled={!valid}
						onPress={() =>
							onApply(valid ? normalizedThemeDraftValue(draft) : "")
						}
						style={dialog.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const dialog = StyleSheet.create({
	root: { gap: space.md },
	swatch: {
		borderRadius: radiusScale.md,
		height: 72,
		width: "100%",
	},
	/** Fills the row in the vertically stacked action row, standing in for `flex: 1` in a horizontal row. */
	action: { alignSelf: "stretch" },
});
