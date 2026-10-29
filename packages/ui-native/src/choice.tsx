import * as RadioGroupPrimitive from "@rn-primitives/radio-group";
import { radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "./icon.tsx";
import { controlHeight } from "./metrics.ts";
import { useSelectionFeedback } from "./selection-feedback.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Picks one value from a group of rows, independent of any container. These used to live in
 * `sheet.tsx` as `SheetOptions` and `SheetOption`, and that name became a constraint. Anyone
 * choosing a value outside a sheet could not find the component, and attached
 * `accessibilityRole='radio'` to a Pressable by hand. Rows without the group's `role='radiogroup'`
 * cannot be read as 'second of five'. The presentation is kept separate for that reason. There are
 * two current uses with different containers: the discovery filter pick (`ChoiceSheet`) and the
 * report reason pick (`Dialog size='full'`). An earlier version of this comment named `Sheet`,
 * which is now stale: the general sheet is internal and feature code cannot import it. The public
 * capability in that slot is `ChoiceSheet`, which places this group inside it. The group itself
 * knows nothing about containers. `@rn-primitives/radio-group` provides `role='radiogroup'`, so
 * assistive tech reads the count and position.
 */

export function ChoiceGroup<T extends string>({
	value,
	onValueChange,
	children,
}: {
	value: T;
	onValueChange: (value: T) => void;
	children: ReactNode;
}) {
	const feedback = useSelectionFeedback();
	return (
		<RadioGroupPrimitive.Root
			value={value}
			onValueChange={(next) => {
				// Tapping the row that is already selected is not a value change, so no feedback fires (see
				// `selection-feedback.tsx`).
				if (next !== value) feedback();
				onValueChange(next as T);
			}}
		>
			{children}
		</RadioGroupPrimitive.Root>
	);
}

/**
 * A single option row. The selected value is shown by more than color: the weight changes and a
 * marker is drawn. The primitive sets `aria-checked` and `accessibilityState.checked`.
 */
export function ChoiceOption({
	label,
	note,
	value,
	selected,
	disabled = false,
}: {
	label: string;
	/**
	 * The note is a separate line instead of being appended to the label, because of width. Appended,
	 * a string like `Claude Sonnet 5 · unavailable on this device` wraps awkwardly on narrow screens and tends to
	 * cut off the reason. Without the reason, the row is just an item that does not respond.
	 */
	note?: string;
	value: string;
	/** The value used for drawing only. The selection decision lives in `ChoiceGroup`'s `value`. */
	selected: boolean;
	/**
	 * Unpickable rows are dimmed, not hidden. Hiding them leaves users unaware the option exists and
	 * unable to tell what would unlock it. The primitive sets `accessibilityState.disabled`, so the
	 * dimming also reads as a state to assistive tech.
	 */
	disabled?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<RadioGroupPrimitive.Item
			value={value}
			disabled={disabled}
			aria-labelledby={`${value}-label`}
			style={({ pressed }) => [
				choice.option,
				disabled && choice.disabled,
				pressed && !disabled && { backgroundColor: colors.muted },
			]}
		>
			<View style={choice.text}>
				<Text
					nativeID={`${value}-label`}
					variant="body"
					weight={selected ? "semibold" : "regular"}
					tone={disabled ? "muted-foreground" : "foreground"}
				>
					{label}
				</Text>
				{note ? (
					<Text variant="caption" tone="muted-foreground">
						{note}
					</Text>
				) : null}
			</View>
			{selected ? <Icon name="check" size="lg" tone="foreground" /> : null}
		</RadioGroupPrimitive.Item>
	);
}

const choice = StyleSheet.create({
	option: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		flexDirection: "row",
		justifyContent: "space-between",
		/**
		 * A row stacked against its neighbors cannot be enlarged with `hitSlop`, because the slop would
		 * overlap the adjacent row. The visible height is the target. To reduce mis-taps into neighbors,
		 * it is one step more generous than the 44pt floor used by standalone controls.
		 */
		minHeight: controlHeight.lg,
		paddingHorizontal: space.sm,
	},
	/** Text wraps when the font scale grows, so the text takes all the remaining width. */
	text: { flex: 1, gap: space.px },
	/**
	 * Dimming is a single opacity value. No separate dimmed color is chosen, because none exists in
	 * the tokens, and creating one would add another value to tune for both light and dark.
	 */
	disabled: { opacity: 0.5 },
});
