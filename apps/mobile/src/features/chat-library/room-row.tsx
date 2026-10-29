import type { ChatRoom } from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Text, touchTarget, useTheme } from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";
import { relativeTime } from "../../lib/format.ts";
import { RoomActionsMenu } from "../chat/room/actions-menu.tsx";
import type { RoomActionRequests } from "../chat/room/use-management.tsx";

/**
 * One list row; the open target and the management target are siblings. The management trigger is
 * not nested inside the opening `Pressable`: nested controls make it unpredictable what was pressed
 * (the outer one may open the room on a menu tap) and read as a button inside a button. Web avoids
 * a button inside a link for the same reason (`room-row-markup.test.ts`).
 *
 * Only title, relative activity time and the management trigger are drawn. There is no message
 * preview (it would add a message lookup per row, and body text over the shoulder says far more
 * than a title); model, tokens and memory counts are absent too. This is a management list, not a
 * gallery.
 *
 * The title is one line so an 80-character title does not set the list rhythm. Truncation is a
 * display matter; the rename dialog opens the stored original by re-subscribing to the store
 * (`RoomTarget` in `use-room-management.tsx`).
 */

export function RoomRow({
	room,
	management,
	onOpen,
}: {
	room: ChatRoom;
	management: RoomActionRequests;
	onOpen: () => void;
}) {
	const { colors } = useTheme();
	const at = relativeTime(room.updatedAt);

	return (
		<View style={row.root}>
			<Pressable
				accessibilityRole="button"
				// The title is in the name; otherwise a list of identically named buttons is unusable without
				// sight.
				accessibilityLabel={room.title}
				accessibilityHint="Opens the conversation"
				onPress={onOpen}
				style={({ pressed }) => [
					row.open,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Text variant="body" weight="medium" numberOfLines={1}>
					{room.title}
				</Text>
				{/* Unreadable time leaves the slot empty rather than inventing a fact (`relativeTime` returns ""). */}
				{at ? (
					<Text variant="caption" tone="muted-foreground">
						{at}
					</Text>
				) : null}
			</Pressable>

			<RoomActionsMenu room={room} management={management} />
		</View>
	);
}

const row = StyleSheet.create({
	// A list line, not a card: web's list is `ul.divide-y.border-y` with no border, radius or surface
	// per line (`chat-library-page.tsx`). This row was once a `Card` with 8pt gaps, which read as a
	// different object than web's continuous list; the difference was character, not density.
	root: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.xs,
		// Narrower on the right because the trigger already has its own 44pt target; equal padding would
		// float it away from the row's edge.
		paddingLeft: space.md,
		paddingRight: space.xs,
	},
	// The press target is the whole row content; a title-only target would leave dead space beside the
	// time that fingers read as part of the row.
	open: {
		flex: 1,
		gap: 2,
		justifyContent: "center",
		minHeight: touchTarget,
		// Equals web's `py-3`. At 8 the row was 57 vs web's 62; 5pt is invisible per row but scroll
		// positions diverge as the list grows.
		paddingVertical: space.md,
	},
});
