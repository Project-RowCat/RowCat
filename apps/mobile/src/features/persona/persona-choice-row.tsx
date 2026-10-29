import { space } from "@rowcat/design";
import { Icon, Text, useTheme } from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * One row of the persona picker list. **Always a button.**
 *
 * ## Why it came out of the conversation folder
 *
 * While the only consumer was the picker on room settings, the location was right. A second
 * consumer arrived when a picker opened before starting a conversation from the work detail screen.
 * Copying this row at that point would diverge in predictable ways: one copy might not carry the
 * selected state in `accessibilityState`, or one might shrink the target below 44pt. Neither
 * produces a visible symptom; they only affect people using assistive technology or with larger
 * fingers. The web app also had two copies of the row and merged them into one.
 *
 * ## Selection is not conveyed by colour alone
 *
 * A check mark is shown alongside, and `accessibilityState.selected` carries the same fact (the
 * same axis as the heart and memory pin).
 *
 * ## The edit trigger is a **sibling** of the row
 *
 * A button inside the row would make two targets that a screen reader cannot tell apart.
 */
export function PersonaChoiceRow({
	title,
	subtitle,
	selected,
	onPress,
	onEdit,
	editLabel,
}: {
	title: string;
	subtitle: string | null;
	selected: boolean;
	onPress: () => void;
	/** Only on library rows; the work's default is not something to edit. */
	onEdit?: () => void;
	/** Name of the icon-only trigger. Passed together with `onEdit`. */
	editLabel?: string;
}) {
	const { colors } = useTheme();
	return (
		<View style={styles.row}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ selected }}
				accessible
				accessibilityLabel={[title, subtitle].filter(Boolean).join(". ")}
				onPress={onPress}
				style={({ pressed }) => [
					styles.choice,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<View style={styles.choiceText}>
					<Text variant="body" weight="medium" numberOfLines={1}>
						{title}
					</Text>
					{subtitle ? (
						<Text
							variant="label"
							weight="regular"
							tone="muted-foreground"
							numberOfLines={2}
						>
							{subtitle}
						</Text>
					) : null}
				</View>
				{selected ? <Icon name="check" size="sm" tone="foreground" /> : null}
			</Pressable>
			{onEdit ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={editLabel ?? `Edit ${title}`}
					onPress={onEdit}
					style={({ pressed }) => [
						styles.edit,
						pressed && { backgroundColor: colors.muted },
					]}
				>
					<Icon name="edit" size="sm" tone="muted-foreground" />
				</Pressable>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	row: { flexDirection: "row", alignItems: "center", gap: space.xs },
	choice: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: space.sm,
		/** Minimum touch height; the row does not go below it even when the text is short. */
		minHeight: 44,
		paddingHorizontal: space.sm,
		marginHorizontal: -space.sm,
		borderRadius: 8,
	},
	choiceText: { flex: 1, gap: 2 },
	edit: {
		width: 44,
		height: 44,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 8,
	},
});
