import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { roomActionsLabel } from "./actions.ts";
import { RoomContextActionsContent } from "./context-actions.tsx";
import type { ManagedRoom, RoomActionRequests } from "./management.tsx";

/**
 * Button shell for the per-room management menu, shared by the conversation list rows and the
 * sidebar's recent-conversation rows. The menu items are not defined here
 * (room-context-actions.tsx; the vocabulary is ROOM_ACTIONS in
 * @rowcat/chat). Two places each
 * defining items drift: one keeps delete while the other drops `Conversation settings`. The dialogs and their rules
 * belong to useRoomManagement, which keeps a dialog tree from being attached to every row. The
 * sidebar row also opens this menu on right-click (recent-chats.tsx). That container differs
 * because the opening gesture differs; the items remain a single set.
 */
export function RoomActionsMenu({
	room,
	management,
	className,
}: {
	room: ManagedRoom;
	management: RoomActionRequests;
	className?: string;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						/**
						 * The label names the conversation the menu is for. A plain 'menu' label would give screen
						 * reader users the same name on every list row.
						 */
						aria-label={roomActionsLabel(room.title)}
						// One size larger on narrow screens: this is where a thumb has to tap accurately in a list.
						className={`size-9 shrink-0 sm:size-8 ${className ?? ""}`}
					/>
				}
			>
				<MoreHorizontal aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-40">
				<RoomContextActionsContent room={room} management={management} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
