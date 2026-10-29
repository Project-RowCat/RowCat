import {
	ROOM_ACTIONS,
	type RoomActionId,
	type RoomActionSpec,
} from "@rowcat/chat";
import {
	DropdownMenu,
	type IconName,
	MenuItem,
	MenuSeparator,
} from "@rowcat/ui-native";
import { Fragment } from "react";
import { ROOM_ACTION_LABEL, roomActionsLabel } from "./actions.ts";
import type { ManagedRoom, RoomActionRequests } from "./use-management.tsx";

/**
 * Management menu for one room; it belongs to the conversation-list row. Same place, items and
 * container as web's `room-actions-menu.tsx`; `ROOM_ACTIONS` in `@rowcat/chat` owns item vocabulary
 * and order, since per-app lists could drift (delete moving up in one app) without breaking
 * anything.
 *
 * This is not the header overflow. The app's room actions once all went through one `⋯` in the chat
 * header, which was removed (`chat-screen.tsx`). It is not revived: "manage" and "settings" for the
 * same room 20pt apart would leave nobody remembering which holds what. This menu answers a
 * different problem: list rows each need their own actions, or deleting a room means entering and
 * leaving it. A static scan locks that split on both sides (`lib/presentation-policy.test.ts`).
 *
 * The trigger lives inside the row: an anchored menu measures its own control, so one screen owning
 * it while rows only call `open()` does not work. It is cheap, since only the trigger draws while
 * closed and portal and content mount on open.
 *
 * Nothing is written here. Items only tell `useRoomManagement` what is wanted; confirmation,
 * validation, ownership and failure copy live there, so an action started from the list and one
 * started inside the room end identically.
 *
 * Unlike desktop the trigger is always visible: touch has no hover, and a hidden action is no
 * action. Long press or swipe is not the only path for the same reason.
 */

/** Table instead of branches so a new action does not mean fixing two places. */
const REQUEST: Record<
	RoomActionId,
	(management: RoomActionRequests, room: ManagedRoom) => void
> = {
	rename: (management, room) => management.requestRename(room),
	settings: (management, room) => management.requestSettings(room),
	delete: (management, room) => management.requestDelete(room),
};

/**
 * Icons are markup, not vocabulary. All three match web's (`Pencil`, `SlidersHorizontal`, `Trash2`
 * in `room-context-actions.tsx`); `Conversation settings` is a slider to match the header trigger, since two places
 * opening the same window with different icons do not read as the same thing.
 */
const ICON: Record<RoomActionId, IconName> = {
	rename: "edit",
	settings: "room-settings",
	delete: "delete",
};

export function RoomActionsMenu({
	room,
	management,
}: {
	/** The action target: identity and current name, not a list position. */
	room: ManagedRoom;
	management: RoomActionRequests;
}) {
	return (
		<DropdownMenu label={roomActionsLabel(room.title)}>
			{ROOM_ACTIONS.map((action: RoomActionSpec) => (
				<Fragment key={action.id}>
					{action.separatorBefore ? <MenuSeparator /> : null}
					<MenuItem
						icon={ICON[action.id]}
						label={ROOM_ACTION_LABEL[action.id]}
						destructive={action.destructive}
						onSelect={() => REQUEST[action.id](management, room)}
					/>
				</Fragment>
			))}
		</DropdownMenu>
	);
}
