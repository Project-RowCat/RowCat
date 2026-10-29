import { storyQueryOptions } from "@rowcat/query";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { ResetPlaythroughDialog } from "./reset-playthrough-dialog.tsx";
import {
	requestPlaythroughReset,
	useRuntimeChatControls,
} from "./runtime-chat-controls.ts";
import { RuntimeGenerationSettingsDialog } from "./runtime-generation-settings-dialog.tsx";
import { RUNTIME_PLAYER_COPY } from "./runtime-player-copy.ts";

/**
 * The header context for runtime play. It names the work being played and holds the trusted actions
 * for it.
 * - Same geometry as the chat header (`features/chat/chat-header-context.tsx`), with a different
 *   vocabulary: a title on the left, and a faint pill grouping the actions. - Chat room: `Find in conversation`
 *   and `Conversation settings`. It browses the room and edits its values. - Runtime play: `Story info`, `Generation settings`, and
 *   `Reset play`. A playthrough is not a room.
 * - Find, rename, memory, and persona are absent on purpose. They are all `ChatRoom` vocabulary.
 *   A playthrough has no message history, memory, or persona, so listing them would create buttons
 *   that do nothing.
 * - The model override left the chat list and came in as its own capability, `Generation settings`. Runtime
 *   generation builds requests from the user's AI settings, and those settings have a per-work
 *   override layer, as chat rooms do (`runtime-generation-settings-dialog.tsx`). This is not the
 *   room's `Conversation settings`, which takes a room record, and none exists here. The button appears only for
 *   works that use generation.
 * - The title comes from the server, since the work title is a catalog value
 *   (`storyQueryOptions`). A room is not created to obtain a title; having the play screen create
 *   one was the first thing this slice blocked (§3). Until the title is known, a skeleton bar
 *   shows. It is neither `Conversations` (this is not a chat) nor blank, which would move once after
 *   hydration.
 * - Reset is owned by the canvas. This file owns the trigger and the confirmation dialog, and the
 *   actual reset runs in the canvas's playback lifecycle. A narrow bridge connects them
 *   (`runtime-chat-controls.ts`). The trigger shows only while a session is running, and only after
 *   confirmation does a request cross. Creator code can define neither the operation's existence
 *   nor its wording (§20).
 */
export function RuntimeChatHeaderContext({ storyId }: { storyId: string }) {
	const story = useQuery(storyQueryOptions(getRowCatClient(), storyId));
	const controls = useRuntimeChatControls(storyId);
	const [confirming, setConfirming] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const title = story.data?.title;

	return (
		<>
			{title === undefined ? (
				/*
				 * The title is not known yet. The bar is about six Korean characters wide. The width changes
				 * when the real title arrives, but something occupies the space from the first frame. A failed
				 * lookup looks the same, so a player is not blocked by a missing title, and the header never
				 * invents one.
				 */
				<Skeleton className="h-4 w-24 rounded" aria-hidden="true" />
			) : (
				<span
					className="min-w-0 truncate text-[0.9375rem] font-semibold tracking-tight"
					title={title}
				>
					{title}
				</span>
			)}

			<div className="flex shrink-0 items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
				{/*
				 * The link is styled as a button. The action is navigation, and that must stay in the element type
				 * so that
				 * open-in-new-tab, copy, and middle-click keep working. It is not a back navigation: this screen's
				 * product
				 * parent is the sidebar's `Conversations` (`/chats`). The work detail is a sibling screen the player visits
				 * briefly to
				 * see the work's current state.
				 */}
				<Link
					to="/stories/$storyId"
					params={{ storyId }}
					aria-label={RUNTIME_PLAYER_COPY.storyDetail}
					className={buttonVariants({
						variant: "ghost",
						size: "icon-sm",
						className: "size-9 rounded-full sm:size-8",
					})}
				>
					<BookOpen aria-hidden="true" />
				</Link>
				{/*
				 * Reset is placed after the other actions, at the end of the pill. Order runs from frequent actions
				 * to
				 * irreversible ones, the same axis as the chat settings home. Keeping the irreversible action at
				 * one end
				 * means an accidental tap has only one place to land.
				 */}
				{controls.generationSettingsAvailable && (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={RUNTIME_PLAYER_COPY.generationSettings}
						className="size-9 rounded-full sm:size-8"
						onClick={() => setSettingsOpen(true)}
					>
						<SlidersHorizontal aria-hidden="true" />
					</Button>
				)}
				{controls.resetAvailable && (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={RUNTIME_PLAYER_COPY.resetPlaythrough}
						className="size-9 rounded-full sm:size-8"
						onClick={() => setConfirming(true)}
					>
						<RotateCcw aria-hidden="true" />
					</Button>
				)}
			</div>

			{settingsOpen && (
				<RuntimeGenerationSettingsDialog
					storyId={storyId}
					onClose={() => setSettingsOpen(false)}
				/>
			)}

			{confirming && (
				<ResetPlaythroughDialog
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						requestPlaythroughReset(storyId);
					}}
				/>
			)}
		</>
	);
}
