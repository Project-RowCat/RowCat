import { DropdownMenuItem } from "@rowcat/ui-web/components/dropdown-menu";
import { ListX } from "lucide-react";
import { runtimeConversationRemoveLabel } from "./runtime-conversation-copy.ts";

/**
 * The item inside the runtime row menu. The caller picks the container (context menu or overflow
 * menu).
 *
 * There is only one item. Rename, conversation settings, persona, model override and find are
 * ChatRoom actions. Listing them here would create buttons that do nothing.
 *
 * Playthrough reset is also left out. It is a trusted action of the playtest screen header, which
 * confirms first. A list must not open an irreversible action in one tap.
 *
 * Do not reuse RoomContextActionsContent. Its ROOM_ACTIONS table only has meaning for rooms.
 */
export function RuntimeConversationActionsContent({
	onRemove,
}: {
	onRemove: () => void;
}) {
	return (
		<DropdownMenuItem onClick={onRemove}>
			<ListX aria-hidden="true" />
			{runtimeConversationRemoveLabel()}
		</DropdownMenuItem>
	);
}
