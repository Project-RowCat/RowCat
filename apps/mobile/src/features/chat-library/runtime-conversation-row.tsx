import { space } from "@rowcat/design";
import type { RuntimeConversationRecord } from "@rowcat/runtime-persistence";
import {
	DropdownMenu,
	Icon,
	MenuItem,
	Text,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";
import { relativeTime } from "../../lib/format.ts";
import {
	RUNTIME_CONVERSATION_KIND_LABEL,
	RUNTIME_CONVERSATION_REMOVE_LABEL,
	runtimeConversationActionsLabel,
	runtimeConversationTitle,
} from "./runtime-conversation-copy.ts";

/**
 * Runtime row: same geometry as a room row (`room-row.tsx`), different destination and action. The
 * open and management targets stay siblings (nested controls make the press unpredictable). The
 * menu holds only `Remove from list`: rename, settings and delete are room vocabulary and would be inert
 * items, and play reset is a trusted playback-screen action. That is why `RoomActionsMenu` is not
 * reused (it walks the `ROOM_ACTIONS` table).
 *
 * A small marker keeps this row from posing as the same kind; non-visual users get the same fact as
 * a suffix on the name.
 */
export function RuntimeConversationRow({
	conversation,
	onOpen,
	onRemove,
}: {
	conversation: RuntimeConversationRecord;
	onOpen: () => void;
	onRemove: (storyId: string) => void;
}) {
	const { colors } = useTheme();
	const title = runtimeConversationTitle(conversation.title);
	const at = relativeTime(conversation.updatedAt);

	return (
		<View style={row.root}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${title}, ${RUNTIME_CONVERSATION_KIND_LABEL}`}
				accessibilityHint="Opens the story"
				onPress={onOpen}
				style={({ pressed }) => [
					row.open,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<View style={row.titleLine}>
					<Icon name="runtime-conversation" size="sm" tone="muted-foreground" />
					<Text
						variant="body"
						weight="medium"
						numberOfLines={1}
						style={row.title}
					>
						{title}
					</Text>
				</View>
				{at ? (
					<Text variant="caption" tone="muted-foreground">
						{at}
					</Text>
				) : null}
			</Pressable>

			<DropdownMenu label={runtimeConversationActionsLabel(title)}>
				<MenuItem
					icon="close"
					label={RUNTIME_CONVERSATION_REMOVE_LABEL}
					onSelect={() => onRemove(conversation.storyId)}
				/>
			</DropdownMenu>
		</View>
	);
}

const row = StyleSheet.create({
	root: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.xs,
		paddingLeft: space.md,
		paddingRight: space.xs,
	},
	open: {
		flex: 1,
		gap: 2,
		justifyContent: "center",
		minHeight: touchTarget,
		paddingVertical: space.md,
	},
	titleLine: { alignItems: "center", flexDirection: "row", gap: space.xs },
	title: { flexShrink: 1 },
});
