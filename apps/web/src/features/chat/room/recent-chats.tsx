import { recentSidebarRooms } from "@rowcat/chat";
import { activeConversationEntryId } from "@rowcat/domain";
import { runtimeConversationIdFor } from "@rowcat/runtime-persistence";
import { Button } from "@rowcat/ui-web/components/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@rowcat/ui-web/components/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import {
	SIDEBAR_ROW_INDICATOR_CLASS,
	SidebarEmpty,
	SidebarList,
	SidebarRecentSkeleton,
	sidebarRowClass,
} from "#/components/app-shell/app-sidebar.tsx";
import { RecentRuntimeRow } from "#/features/conversation-library/runtime-conversation-rows.tsx";
import { useConversationLibrary } from "#/features/conversation-library/use-conversation-library.ts";
import { useRuntimeConversationRemoval } from "#/features/conversation-library/use-runtime-conversation-removal.ts";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { roomActionsLabel } from "./actions.ts";
import { RoomContextActionsContent } from "./context-actions.tsx";
import {
	type ManagedRoom,
	type RoomActionRequests,
	useRoomManagement,
} from "./management.tsx";

/**
 * Data comes only from this device's IndexedDB for the current account. The server has no room-list
 * endpoint and the query cache keeps no copy, so the list renders offline.
 *
 * - Sync writes to the same local database and liveQuery observes it, so this file must not
 *   change for sync. If the sidebar must know about sync, the boundary is drawn wrong.
 * - The desktop sidebar and the mobile drawer share this component, so sorting, limits and the
 *   active marker cannot diverge.
 * - Scope is transitional: a title per row, plus rename, settings and delete (the same operations
 *   as the list screen). Previews, models, token counts, pinning, archiving, search and sorting
 *   belong to the full list (`All conversations`), not here.
 * - Actions open from right-click and a focus-revealed overflow button on desktop, and from an
 *   always-visible overflow button on touch. Long-press is not the only path.
 * - Room rows and runtime playthrough rows share one list ordered by activity. Runtime rows link
 *   to /chat/runtime/:storyId and only support `Remove from list`. Do not split by kind.
 * - Never nest a button inside a link. The overflow button is the link's sibling; nesting is
 *   invalid markup, checked by room-row-markup.test.ts.
 */
export function RecentChats({
	activeRoomId,
	activeRuntimeStoryId,
	onNavigate,
}: {
	/**
	 * Currently open room. The route parameter is the source of truth; the sidebar keeps no selection
	 * state of its own.
	 */
	activeRoomId: string | null;
	/**
	 * Runtime story currently being played. The second value on the same active axis as the room id.
	 */
	activeRuntimeStoryId: string | null;
	/**
	 * Called when a row is pressed in the mobile drawer, to close it. The fixed desktop sidebar does
	 * nothing.
	 */
	onNavigate?: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const { entries, loading } = useConversationLibrary();
	const navigate = useNavigate();
	/**
	 * Identity of the row to highlight: a room id or a runtime library row id. The rule that maps both
	 * onto one axis lives in the domain; mobile calls the same function.
	 */
	const activeEntryId = activeConversationEntryId({
		activeRoomId,
		activeRuntimeConversationId:
			activeRuntimeStoryId === null
				? null
				: runtimeConversationIdFor(activeRuntimeStoryId),
	});

	/**
	 * Owner of management actions, shared with the list screen and header.
	 *
	 * After a delete, navigate only if the deleted room is the one open. Deleting another room must
	 * not bounce the user, since that would interrupt whatever they are doing, including an
	 * in-progress generation. For the open room, leave the same way the header does; `replace` keeps
	 * back navigation from returning to the deleted room's URL.
	 */
	const management = useRoomManagement({
		onDeleted: (room) => {
			if (room.id !== activeRoomId) return;
			onNavigate?.();
			void navigate({ to: "/chats", replace: true });
		},
	});
	/**
	 * Runtime row actions. This is a different hook from room management, but the leaving rule is the
	 * same: navigate only when that story is the one currently open.
	 */
	const runtimeRemoval = useRuntimeConversationRemoval({
		onRemoved: (storyId) => {
			if (storyId !== activeRuntimeStoryId) return;
			onNavigate?.();
			void navigate({ to: "/chats", replace: true });
		},
	});

	if (loading) return <SidebarRecentSkeleton />;
	/*
	 * Shown only when there is truly nothing: no story started, or a room URL opened from another
	 * account's link.
	 *
	 * Deleting the last room removes the list without an exit animation, because the presence wrapper
	 * unmounts with it. Animating it would need the empty sentence inside the presence as a row, which
	 * would make the switch to the sentence look like a row exit. Those are separate events.
	 */
	if (entries.length === 0)
		return <SidebarEmpty>{t("recentChats.noConversations")}</SidebarEmpty>;

	return (
		<>
			<SidebarList>
				{/*
				 * Rows have identity. Deleting one room keeps the same conversations, and the screen must
				 * show that; otherwise the whole sidebar looks replaced and the user has to re-read it before
				 * an irreversible delete.
				 *
				 * `initial={false}` means rows present when the list opens do not animate in. Only rows that
				 * appear later do, e.g. the eleventh room pushed into the window of ten after a delete.
				 *
				 * `mode="popLayout"` is deliberately not used. It needs a DOM element to position an exiting
				 * child absolutely, but this list's root is a ContextMenu that renders nothing, so the setting
				 * would do nothing and mislead readers into thinking it is active. Exits and reflow therefore
				 * run in sequence: opacity `fast` (120ms), then position `normal` (180ms).
				 * See the list section of docs/motion/ARCHITECTURE.md.
				 */}
				<AnimatePresence initial={false}>
					{recentSidebarRooms(entries, activeEntryId).map((entry) =>
						entry.kind === "chat" ? (
							<RecentChatRow
								key={entry.id}
								room={entry.room}
								active={entry.id === activeEntryId}
								management={management}
								onNavigate={onNavigate}
							/>
						) : (
							<RecentRuntimeRow
								key={entry.id}
								conversation={entry.conversation}
								active={entry.id === activeEntryId}
								/*
								 * The layout-id namespace belongs to this list. If the runtime rows used the same name in
								 * their own file, one name would sit in two files, and that is what would make the
								 * indicator fly across the screen (active-indicator.test.ts).
								 */
								activeIndicator={
									<MotionActiveIndicator
										group="app-sidebar-recent-chat"
										className={SIDEBAR_ROW_INDICATOR_CLASS}
									/>
								}
								onNavigate={onNavigate}
								onRemove={runtimeRemoval.remove}
							/>
						),
					)}
				</AnimatePresence>
			</SidebarList>
			{/*
			 * The management dialog is rendered once outside the list, not once per row. Per-row dialogs
			 * would mount ten dialog instances inside the list, all living at the app shell across
			 * screens.
			 */}
			{management.dialogs}
		</>
	);
}

/**
 * A row: the link and its sibling button. The context menu wraps the whole li, not only the link.
 * Wrapping only the link would open the browser's default menu on right-click in the right margin
 * (where the overflow button sits), so one row would react differently at two points.
 */
function RecentChatRow({
	room,
	active,
	management,
	onNavigate,
}: {
	room: ManagedRoom;
	active: boolean;
	management: RoomActionRequests;
	onNavigate?: () => void;
}) {
	return (
		<ContextMenu>
			{/*
			 * The li is the trigger. An extra inner div would add a second element per row under the list
			 * and make the ul > li relation depend on markup rather than styles. The li is also the motion
			 * target.
			 *
			 * useExitGuard() is a hook, so each row must be a component; that is why it is not inlined
			 * in map.
			 *
			 * layout="position" is deliberate: row size does not change, only position. Interpolating
			 * size would stretch titles for no reason. Position changes happen beyond deletion too: remote
			 * changes from sync and messages from other tabs re-rank rows by recent activity.
			 *
			 * Press protection is not carried on the exit target; see exit-guard.ts. That value applies
			 * when the animation starts, and in background tabs no animation starts, which is when a
			 * deleted row lingers longest.
			 */}
			<ContextMenuTrigger
				render={
					<m.li
						layout="position"
						initial={rowEnter.initial}
						animate={rowEnter.animate}
						exit={rowExit}
						transition={rowEnter.transition}
						style={useExitGuard()}
						className="group/room relative min-w-0"
					/>
				}
			>
				<Link
					to="/chat/$roomId"
					params={{ roomId: room.id }}
					// The current location is signalled by this attribute, not by color.
					aria-current={active ? "page" : undefined}
					onClick={onNavigate}
					/*
					 * The right margin is reserved for the overflow button. Reserving it always keeps titles from
					 * shifting when the button appears; rows whose width changes make the whole list jump.
					 */
					className={`${sidebarRowClass(active)} pr-9`}
				>
					{/*
					 * The active-row indicator moves between rows, because that is what the list is saying: the
					 * user switched conversations in place. If one background turned off and another turned on,
					 * the relation would disappear and read as two separate changes.
					 *
					 * This is a different namespace from the global moving indicator. Sharing one name would fly
					 * the indicator from the `Conversations` item into this list on open, but both are legitimately on at
					 * once. The prefix comes from the shell (the LayoutGroup in AppSidebar and AppSidebarSheet),
					 * because this component lives in the fixed sidebar and the drawer at the same time.
					 */}
					{active && (
						<MotionActiveIndicator
							group="app-sidebar-recent-chat"
							className={SIDEBAR_ROW_INDICATOR_CLASS}
						/>
					)}
					{/*
					 * Truncate to one line. Two lines would let one long title break the sidebar rhythm; the full
					 * title is in `title`. `relative` is needed so the background can sit behind the text: only
					 * the background moves, the text stays in place.
					 */}
					<span className="relative truncate" title={room.title}>
						{room.title}
					</span>
				</Link>

				<RecentChatMenuButton room={room} management={management} />
			</ContextMenuTrigger>

			<ContextMenuContent>
				<RoomContextActionsContent room={room} management={management} />
			</ContextMenuContent>
		</ContextMenu>
	);
}

/**
 * Overflow trigger for each row: the route for people who cannot right-click.
 *
 * Hidden by default, because the list must stay quiet: ten rows each with three dots would read as
 * a management screen. It appears under three conditions:
 * - pointer hover (group-hover)
 * - focus inside the row (group-focus-within), i.e. keyboard focus reaches the link
 * - this menu is open (data-popup-open), which persists when focus moves into the popup
 *
 * Always visible on coarse pointers, since touch has no hover and long-press is only usable by
 * people who already know it.
 *
 * While hidden, pointer-events is also off. An invisible button would otherwise take clicks on the
 * right edge of the row meant to open the room.
 *
 * No CSS transition on reveal. Timing and easing come from motion.ts in @rowcat/design through
 * Motion; a CSS transition here would be a second motion system.
 */
function RecentChatMenuButton({
	room,
	management,
}: {
	room: ManagedRoom;
	management: RoomActionRequests;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={roomActionsLabel(room.title)}
						className="pointer-events-none absolute top-1/2 right-0.5 size-7 -translate-y-1/2 opacity-0 group-hover/room:pointer-events-auto group-hover/room:opacity-100 group-focus-within/room:pointer-events-auto group-focus-within/room:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 data-popup-open:pointer-events-auto data-popup-open:opacity-100"
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
