import { radiusScale, space } from "@rowcat/design";
import { useTheme } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { useUpdateNotes } from "./update-notes-provider.tsx";

/** Diameter of one dot. It shows no count, so it is an indicator, not a badge. */
const DOT = 6;

/**
 * Whether the `Updates` tab has something new — **one boolean.**
 *
 * It is exported as a hook because native has no `sr-only`. The web adds an invisible word inside
 * the tab to extend its name; here the fact must be written **into the tab's
 * `accessibilityLabel`**, because a dot alone conveys nothing to assistive technology.
 */
export function useUpdateNotesUnseen(): boolean {
	return useUpdateNotes().unseenId !== null;
}

/**
 * The dot on the `Updates` tab — **says one thing: something new is here.**
 *
 * ## It does not count
 *
 * Not `Updates (3)`, not `NEW`, not `New update`. The unread **count** is the inbox's vocabulary, and this
 * spot can say only one thing:
 *
 * ```text
 * something new here      ≠      N unread releases
 * ```
 *
 * ## The dot is not in the accessibility tree
 *
 * The fact is carried as text in the tab's name (`useUpdateNotesUnseen`); conveying it only through
 * color and shape would tell assistive technology nothing. The dot is not made separately pressable
 * either: the target is the tab.
 */
export function UpdateNotesUnseenDot() {
	const { colors } = useTheme();
	const unseen = useUpdateNotesUnseen();
	if (!unseen) return null;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[dot.root, { backgroundColor: colors.primary }]}
		/>
	);
}

const dot = StyleSheet.create({
	root: {
		borderRadius: radiusScale.full,
		height: DOT,
		marginLeft: space.xs,
		width: DOT,
	},
});
