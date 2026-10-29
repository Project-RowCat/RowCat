import type { RuntimeConversationRecord } from "@rowcat/runtime-persistence";
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
import { Link } from "@tanstack/react-router";
import { Gamepad2, MoreHorizontal } from "lucide-react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { sidebarRowClass } from "#/components/app-shell/app-sidebar.tsx";
import {
	ROOM_ROW_CLASS,
	ROOM_ROW_MENU_CLASS,
	ROOM_ROW_TIME_CLASS,
} from "#/features/chat-library/room-row-layout.ts";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { relativeTime } from "#/lib/format/relative-time.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";
import { RuntimeConversationActionsContent } from "./runtime-conversation-actions.tsx";
import {
	runtimeConversationActionsLabel,
	runtimeConversationKindLabel,
	runtimeConversationTitle,
} from "./runtime-conversation-copy.ts";

/**
 * Runtime library row, used in both the sidebar and the list. It has the same geometry as a room
 * row but a different destination and different actions.
 *
 * - The link goes to `/chat/runtime/:storyId`. The menu has only `Remove from list`.
 * - It does not reuse the room row. That row requires a ManagedRoom, and shaping a runtime row to
 *   fit would make the room management hook re-read storage for that id and open dialogs for rooms
 *   that do not exist.
 * - Actions are siblings of the link, as in room rows (room-row-markup.test.ts scans this file
 *   too). A button inside an anchor is invalid markup, and keyboard and screen readers would
 *   disagree about what is pressed.
 * - The layoutId namespace of the moving active indicator belongs to the list and must be defined
 *   in one file (active-indicator.test.ts). The sidebar creates the indicator and passes it in.
 *   This row only places it when active.
 * - Since it sits among room rows, a small icon marks it as a work. Screen reader users get the
 *   same fact from the name suffix. The library is one list, so rows are not split into sections.
 */
export function RecentRuntimeRow({
	conversation,
	active,
	activeIndicator,
	onNavigate,
	onRemove,
}: {
	conversation: RuntimeConversationRecord;
	active: boolean;
	activeIndicator?: ReactNode;
	onNavigate?: () => void;
	onRemove: (storyId: string) => void;
}) {
	const title = runtimeConversationTitle(conversation.title);
	return (
		<ContextMenu>
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
					to="/chat/runtime/$storyId"
					params={{ storyId: conversation.storyId }}
					aria-current={active ? "page" : undefined}
					onClick={onNavigate}
					className={`${sidebarRowClass(active)} pr-9`}
				>
					{active ? activeIndicator : null}
					<Gamepad2
						aria-hidden="true"
						className="relative size-3.5 shrink-0 text-muted-foreground"
					/>
					<span className="relative truncate" title={title}>
						{title}
					</span>
					<span className="sr-only">{runtimeConversationKindLabel()}</span>
				</Link>

				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={runtimeConversationActionsLabel(title)}
								className="pointer-events-none absolute top-1/2 right-0.5 size-7 -translate-y-1/2 opacity-0 group-hover/room:pointer-events-auto group-hover/room:opacity-100 group-focus-within/room:pointer-events-auto group-focus-within/room:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 data-popup-open:pointer-events-auto data-popup-open:opacity-100"
							/>
						}
					>
						<MoreHorizontal aria-hidden="true" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-40">
						<RuntimeConversationActionsContent
							onRemove={() => onRemove(conversation.storyId)}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			</ContextMenuTrigger>

			<ContextMenuContent>
				<RuntimeConversationActionsContent
					onRemove={() => onRemove(conversation.storyId)}
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}

export function RuntimeLibraryRow({
	conversation,
	onRemove,
}: {
	conversation: RuntimeConversationRecord;
	onRemove: (storyId: string) => void;
}) {
	const title = runtimeConversationTitle(conversation.title);
	return (
		<>
			<Link
				to="/chat/runtime/$storyId"
				params={{ storyId: conversation.storyId }}
				className={`${ROOM_ROW_CLASS} outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset`}
			>
				<span className="flex min-w-0 items-center gap-1.5">
					<Gamepad2
						aria-hidden="true"
						className="size-3.5 shrink-0 text-muted-foreground"
					/>
					<span className="truncate text-sm font-medium" title={title}>
						{title}
					</span>
					<span className="sr-only">{runtimeConversationKindLabel()}</span>
				</span>
				<time
					dateTime={conversation.updatedAt}
					title={formatDateTime(conversation.updatedAt)}
					className={ROOM_ROW_TIME_CLASS}
				>
					{relativeTime(conversation.updatedAt)}
				</time>
			</Link>

			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={runtimeConversationActionsLabel(title)}
							className={`size-9 shrink-0 sm:size-8 ${ROOM_ROW_MENU_CLASS}`}
						/>
					}
				>
					<MoreHorizontal aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-40">
					<RuntimeConversationActionsContent
						onRemove={() => onRemove(conversation.storyId)}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
