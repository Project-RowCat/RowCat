import { radiusScale, space } from "@rowcat/design";
import { type UpdateNote, updateNotePlainText } from "@rowcat/domain";
import { Icon, Text, touchTarget, useTheme } from "@rowcat/ui-native";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import {
	updateNoteOpenHint,
	updateNoteTitle,
	updateUnseenSuffix,
} from "./update-note-copy.ts";
import { UpdateNoteText } from "./update-note-text.tsx";

/** Diameter of one dot. It shows no count, so it is an indicator, not a badge. */
const DOT = 8;

/**
 * One history row — **a single opening action.**
 *
 * ## Not disguised as a notification row
 *
 * Reusing `NotificationRow` would require inventing `id`, `createdAt`, `readAt` and `kind`, and
 * then this value would take on the inbox's vocabulary (an unread **count** would come next). So
 * this row draws only the values the announcement actually has:
 *
 * ```text
 * title    `2026.08.30 update note` — derived from the date; it is this announcement's public identity
 * intro    one or two authored sentences; omitted when absent — the first section is not used as a summary
 * dot      only on the newest row not yet opened. Not a count, not a badge
 * arrow    signals that this row opens when pressed
 * ```
 *
 * ## The target is the whole row (44pt)
 *
 * Making the dot separately pressable would give two routes to the same place in one row, and
 * assistive technology would read an extra unnamed button. So the dot is hidden from the
 * accessibility tree (`accessibilityElementsHidden`), and the row carries the name — **including
 * the intro**, otherwise a line of text visible on screen would be missing from what assistive
 * technology hears.
 */
export function UpdateNoteRow({
	note,
	unseen,
	onOpen,
}: {
	note: UpdateNote;
	unseen: boolean;
	onOpen: () => void;
}) {
	useTranslation("updates");
	const { colors } = useTheme();
	const summary = note.intro ? `, ${updateNotePlainText(note.intro)}` : "";
	const state = unseen ? updateUnseenSuffix() : "";

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${updateNoteTitle(note)}${summary}${state}`}
			accessibilityHint={updateNoteOpenHint()}
			onPress={onOpen}
			style={({ pressed }) => [
				row.root,
				pressed && { backgroundColor: colors.muted },
			]}
		>
			{/*
			 * **The space is kept even when off.** Rendering it conditionally would drop this cell out of the flow the
			 * moment it is pressed, shifting the title left in the same frame the window opens.
			 */}
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={[
					row.dot,
					{ backgroundColor: colors.primary, opacity: unseen ? 1 : 0 },
				]}
			/>
			<View style={row.body}>
				<Text variant="body" weight="medium" numberOfLines={1}>
					{updateNoteTitle(note)}
				</Text>
				{note.intro ? (
					<Text variant="label" tone="muted-foreground" leading="reading">
						<UpdateNoteText text={note.intro} variant="label" />
					</Text>
				) : null}
			</View>
			<Icon name="chevron-right" size="sm" tone="muted-foreground" />
		</Pressable>
	);
}

const row = StyleSheet.create({
	root: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		flexDirection: "row",
		gap: space.sm,
		minHeight: touchTarget,
		paddingHorizontal: space.sm,
		paddingVertical: space.sm,
	},
	dot: { borderRadius: radiusScale.full, height: DOT, width: DOT },
	/** Text takes the remaining width; the dot and arrow keep only their own width. */
	body: { flex: 1, gap: space.px, minWidth: 0 },
});
