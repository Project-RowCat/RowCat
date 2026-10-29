import {
	ROOM_ACTIONS,
	type RoomActionId,
	type RoomActionSpec,
} from "@rowcat/chat";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { Fragment } from "react";
import { roomActionLabel } from "./actions.ts";
import type { ManagedRoom, RoomActionRequests } from "./management.tsx";

/**
 * The menu items, without the container: the caller picks the surface. The same set opens in three
 * surfaces (right-click on a sidebar row, the sidebar row's overflow button, and the conversation
 * list row menu). The surface is not chosen here, because a per-surface copy of these items would
 * drift.
 *
 * The items are the same component in both containers: Base UI's `ContextMenu` re-exports the
 * `Menu` parts (`ContextMenu.Item === Menu.Item`), so `DropdownMenuItem` keeps the same role and
 * keyboard behavior inside a context menu. Two copies would silently diverge on focus styling and
 * `data-variant` handling.
 *
 * Nothing is executed here. Each item only tells `useRoomManagement` that the user wants an action
 * on this room. Confirmation, validation, ownership checks and failure copy all live there, so the
 * same operation started from the header, the list or the sidebar ends identically.
 */

/** Maps an action to its request. A table, so adding an action does not require editing two branches. */
const REQUEST: Record<
	RoomActionId,
	(management: RoomActionRequests, room: ManagedRoom) => void
> = {
	rename: (management, room) => management.requestRename(room),
	settings: (management, room) => management.requestSettings(room),
	delete: (management, room) => management.requestDelete(room),
};

/**
 * Icons are markup, so they stay out of the shared vocabulary (`ROOM_ACTIONS` in `@rowcat/chat`).
 * `Conversation settings` uses the sliders icon to match the header's settings trigger: two controls that open the
 * same dialog with different icons would not read as the same action.
 */
const ICON: Record<RoomActionId, typeof Pencil> = {
	rename: Pencil,
	settings: SlidersHorizontal,
	delete: Trash2,
};

export function RoomContextActionsContent({
	room,
	management,
}: {
	/** The target: identity and current title, not list position or order. */
	room: ManagedRoom;
	management: RoomActionRequests;
}) {
	return (
		<>
			{ROOM_ACTIONS.map((action) => (
				<Fragment key={action.id}>
					{action.separatorBefore && <DropdownMenuSeparator />}
					<RoomActionItem
						action={action}
						onSelect={() => REQUEST[action.id](management, room)}
					/>
				</Fragment>
			))}
		</>
	);
}

function RoomActionItem({
	action,
	onSelect,
}: {
	action: RoomActionSpec;
	onSelect: () => void;
}) {
	const Icon = ICON[action.id];
	return (
		<DropdownMenuItem
			variant={action.destructive ? "destructive" : "default"}
			onClick={onSelect}
		>
			<Icon aria-hidden="true" />
			{roomActionLabel(action.id)}
		</DropdownMenuItem>
	);
}
