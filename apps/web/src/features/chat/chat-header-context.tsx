import { Button } from "@rowcat/ui-web/components/button";
import { useNavigate } from "@tanstack/react-router";
import { Search, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocalRoom } from "#/lib/local-chat/hooks.ts";
import { useRoomManagement } from "./room/management.tsx";
import { requestChatSearch } from "./search/request.ts";

/**
 * Conversation context for the header: **which conversation this is**, and the actions on it.
 *
 * This used to be a row inside the canvas (a back arrow and the title). It moved to the header for
 * more than space. That row was drawn separately by the conversation, the placeholder and the "not
 * found" state, so it shifted slightly with each state change. And on a screen confined to viewport
 * height, 40px is about one mobile message line.
 *
 * The trigger that opens the list was removed. Recent conversations are now always held by the app
 * sidebar, and on narrow screens the only trigger for them is the leftmost item in the header. A
 * second button opening the same list 20px away would blur what each one is. Going back out is also
 * the sidebar's `Conversations` item.
 *
 * **There is exactly one settings trigger.** The row menu in the list (`RoomActionsMenu`) is not
 * repeated here: two doors to the same room, one labelled as a manage menu and one as settings,
 * 20px apart, and nobody would remember which held what. Rename and delete are opened from the `Manage`
 * section inside settings, through the same operation (`useRoomManagement`).
 *
 * **It stays distinct from the global settings at the far right of the header.** Position and name
 * separate them: this trigger sits next to the title and speaks about this conversation (`Conversation settings`),
 * while the other is always at the far right and speaks about the whole app (`Settings`). The icons
 * differ too: a slider here, a gear there. Two gears side by side is exactly the pattern to avoid.
 *
 * With no room there is no trigger. Leaving a path to the settings of a deleted room, or of a room
 * not in this account, would make the header speak as though the room has settings while the canvas
 * draws "not found".
 *
 * **The owner of the open dialogs is `useRoomManagement`.** This file used to hold the open state
 * of the settings and memory dialogs itself. When the recent-conversation row in the sidebar began
 * opening the same dialogs, that state existed in two places, and every new place opening them
 * would carry its own copy, so "which room's settings is open right now" would get a different
 * answer on each screen. Now, wherever a dialog is opened, the target room lives inside that hook.
 *
 * Both the title and the settings value come from the local record. No request for the room goes to
 * the server here either. It only subscribes to the same record of the already-open scope, and when
 * a name changes, `liveQuery` updates this line and the sidebar line at the same moment.
 */
export function ChatHeaderContext({ roomId }: { roomId: string }) {
	const { t } = useTranslation(["chat", "common"]);
	const { room } = useLocalRoom(roomId);
	const navigate = useNavigate();

	/**
	 * Rename, settings and delete are owned here; the triggers below only send requests.
	 *
	 * After a deletion this screen has no room left to point at, so it leaves for the list. `replace`
	 * is for history: otherwise Back would return to the address of the room just deleted, and the
	 * user would see "conversation not found".
	 */
	const management = useRoomManagement({
		onDeleted: () => void navigate({ to: "/chats", replace: true }),
	});

	return (
		<>
			{/*
			 * Not the document's main title; that belongs to the canvas. This is a short label saying "where I am", so it does
			 * not turn the fixed header into one that changes its heading per route. Until the room title is known (while the
			 * scope is opening), a fixed label (`Conversations`) holds the space.
			 */}
			<span
				/*
				 * The room name is the only identity on this screen. No cover, avatar or story info is fetched
				 * (that would mean asking the server for the room, which this screen does not do). Instead the
				 * name carries weight: larger and bolder than the icons beside it, so when scanning the header,
				 * the first thing read is "which conversation this is", not a control.
				 *
				 * **It does not take leftover width** (no `flex-1`). If the title filled the row, this room's
				 * controls would be pushed to the far right, next to the global utilities, and the difference
				 * between the two would shrink to the shape of an icon. Now the title and its controls form one
				 * group on the left, and the far right always belongs to the global set. Position states
				 * ownership. When space runs out, the title is what shrinks (`min-w-0` + `truncate`).
				 */
				className="min-w-0 truncate text-[0.9375rem] font-semibold tracking-tight"
				title={room?.title}
			>
				{room?.title ?? t("chatHeaderContext.conversation")}
			</span>

			{/*
			 * One group of secondary controls.
			 *
			 * They differ in character (one edits this room's **values**, the other searches this room's **content**), but in rank
			 * they are equal: both follow the title, and both speak about this conversation. So a faint pill wraps the two. The
			 * global utilities at the far right of the header and this group separate at a glance, and the pair reads as one quiet
			 * cluster rather than two loose icons. This does **not merge their meanings**: the triggers and their labels stay two,
			 * and only the placement and hover vocabulary are shared.
			 *
			 * Search is not folded into the settings as a row. Search is not a feature to be reached in two steps, and there should be
			 * a visible place that opens the same thing as the shortcut (`Cmd/Ctrl+F`).
			 *
			 * With no room there is no group, for the same reason as the trigger above.
			 */}
			{room && (
				<div className="flex shrink-0 items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
					<Button
						variant="ghost"
						size="icon-sm"
						// Does not say which conversation: the title is right beside it, and there is only one
						// trigger.
						aria-label={t("chatHeaderContext.findInConversation")}
						// One step larger on narrow screens, the same rule as the other icon buttons in the header.
						className="size-9 rounded-full sm:size-8"
						// No window or state lives here. This button only asks for this room's search to open
						// (`search-request.ts`), so if the header's shape changes, moving it costs one line.
						onClick={() => requestChatSearch(roomId)}
					>
						<Search aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						/*
						 * Does not say which conversation these settings belong to. The header has only this trigger,
						 * and the title sits right beside it. Unlike the list's row menu, putting the title in the
						 * label would make a screen-reader user hear the same thing twice.
						 */
						aria-label={t("chatHeaderContext.conversationSettings")}
						className="size-9 rounded-full sm:size-8"
						onClick={() => management.requestSettings(room)}
					>
						<SlidersHorizontal aria-hidden="true" />
					</Button>
				</div>
			)}

			{/*
			 * If the room disappears (deleted in another tab, or an account switch), the open dialog closes with it. Re-subscribing
			 * to the target room in the store is the rule of `useRoomManagement`.
			 */}
			{management.dialogs}
		</>
	);
}
