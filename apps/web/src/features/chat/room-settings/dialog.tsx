import type { ChatRoom } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RoomActionRequests } from "../room/management.tsx";
import { RoomSettingsCharacters } from "./characters.tsx";
import { RoomSettingsGeneration } from "./generation.tsx";
import { RoomSettingsHome } from "./home.tsx";
import { RoomSettingsInfo } from "./info.tsx";
import { RoomSettingsIntensity } from "./intensity.tsx";
import { RoomSettingsNarration } from "./narration.tsx";
import { RoomSettingsPersona } from "./persona.tsx";
import { RoomSettingsUserNote } from "./user-note.tsx";
import {
	type RoomSettingsView,
	roomSettingsBackLabel,
	roomSettingsViewTitle,
} from "./view.ts";

/**
 * Composition surface for room settings. This dialog owns none of the values it edits:
 * - Generation length and model: GenerationPreferenceStore (device-local, per member)
 * - Persona: ChatPersonaStore and ChatStore.setRoomPersona (library copy and room copy)
 * - Rename: ChatStore.renameRoom. Delete: ChatStore.deleteRoom (synced tombstone)
 * - Memory: ChatMemoryStore, opened as a sibling dialog
 * - User note: ChatStore.setRoomUserNote (synced room record). Info: read-only copy
 *
 * There is no single save button. No transaction spans these stores, so one commit could report
 * success after only some writes succeeded. Each action completes under its owner's rules.
 *
 * The dialog shows one surface at a time (home, generation, persona, narration, intensity,
 * characters, user note, info). Tabs and accordions are not used: tabs show every section at once,
 * and accordions recreate one long document. Nested dialogs are never opened, so Escape and the
 * focus trap have one target. Memory is the exception: its form and list would nest inside the
 * scroll area, and closing the outer dialog first would discard typed text. The persona creation
 * form stays here because a new persona is meant to become this room's role immediately. Full
 * library management lives at /settings/personas.
 */

export function RoomSettingsDialog({
	room,
	management,
	onOpenMemory,
	onClose,
}: {
	/**
	 * The room record as of the moment the dialog opened. The source of truth for title and info
	 * remains IndexedDB.
	 */
	room: ChatRoom;
	/** Owner of rename and delete. This dialog holds only the triggers. */
	management: RoomActionRequests;
	/**
	 * Trigger for the memory window. This dialog does not own memory. As with rename and delete, it
	 * holds only the trigger; the memory window opens as a sibling.
	 */
	onOpenMemory: () => void;
	onClose: () => void;
}) {
	/**
	 * The surface currently shown. UI state only, never persisted; room-settings-view.ts explains why.
	 * Opening the dialog always starts at home.
	 */
	const [view, setView] = useState<RoomSettingsView>("home");
	/**
	 * Set only when the dialog returns to home. It stays null on first mount so the initial focus the
	 * primitive chooses is not overridden.
	 */
	const [returnedFrom, setReturnedFrom] = useState<RoomSettingsView | null>(
		null,
	);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	const open = (next: RoomSettingsView): void => {
		setReturnedFrom(null);
		setView(next);
	};
	const back = (): void => {
		setReturnedFrom(view);
		setView("home");
	};

	/**
	 * On a surface change, scroll to the top, and in detail views move focus to the title. The scroll
	 * area is shared, so returning home without a reset would render it partway down. Without moving
	 * focus, the browser resets focus to body, which keyboard and screen reader users experience as
	 * nothing happening. The title is focused because it is what changed (`Generation settings`). Home restores
	 * focus to its own row on return. The effect runs only on surface changes, so it does not steal
	 * focus during form edits or on first mount.
	 */
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
		if (view !== "home") titleRef.current?.focus();
	}, [view]);

	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			{/*
			 * On narrow screens the dialog is a bottom sheet; from the `sm` breakpoint up it is centered.
			 * Keep the primitive's entrance animation and change only the anchor and geometry. Surface
			 * changes get no motion either: content swapping inside one window needs nothing to explain it.
			 *
			 * `max-h` and inner scrolling must be used together. At 390px wide with the keyboard open, the
			 * content can exceed the screen and push the danger zone out of reach. The explicit `flex` matters:
			 * the primitive defaults to `grid`, where `flex-col` sets direction without changing display. Then
			 * the inner `flex-1` and `min-h-0` do nothing and `max-h` overflows instead of clipping. At
			 * 375×667,
			 * `Rename` and `Delete conversation` were pushed off-screen and could not be reached.
			 */}
			<DialogContent
				placement="adaptive"
				className="top-auto bottom-0 flex max-h-[85dvh] w-full max-w-full flex-col gap-0 rounded-t-xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:max-w-md sm:rounded-xl"
			>
				{/*
				 * `min-w-0` is the key here. DialogContent is a grid, so children default to a min-width of auto.
				 * The description line uses `truncate` (nowrap), so its min-content is the full title. The grid
				 * column then grows to fit the title instead of truncating, pushing every row off-screen (seen at
				 * 390px). The right padding reserves room for the close button, which the primitive positions
				 * absolutely.
				 */}
				<DialogHeader className="min-w-0 border-b py-4 pr-14 pl-5 text-left">
					<div className="flex min-w-0 items-center gap-2">
						{/*
						 * Back is a labeled button. Without a name, an arrow would be indistinguishable from the other icon
						 * button in this dialog (close). It is not rendered on home: a disabled arrow that goes nowhere is
						 * worse than no arrow.
						 */}
						{view !== "home" && (
							<Button
								variant="ghost"
								size="icon-sm"
								className="-ml-2 shrink-0"
								aria-label={roomSettingsBackLabel()}
								onClick={back}
							>
								<ChevronLeft aria-hidden="true" />
							</Button>
						)}
						<div className="min-w-0 flex-1">
							{/*
							 * The title states which surface is showing. It is focusable so it can receive focus on a surface
							 * change, but it is kept out of the tab order (tabIndex={-1}): it marks where navigation landed,
							 * not a control to tab through.
							 */}
							<DialogTitle
								ref={titleRef}
								tabIndex={-1}
								className="outline-none"
							>
								{roomSettingsViewTitle(view)}
							</DialogTitle>
							{/*
							 * The conversation's name stays visible on every surface, since it is this dialog's context.
							 * Long titles are truncated so they do not push the layout.
							 */}
							<DialogDescription className="mt-1 truncate" title={room.title}>
								{room.title}
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				{/*
				 * Only the inside scrolls. Without `overscroll-contain`, dragging past the end of the list would
				 * move the conversation log behind the dialog. This container owns the horizontal padding. Inner
				 * surfaces draw no boxes and align to this padding line; home rows step slightly outside it for
				 * their pressed background (RoomSettingsGroup).
				 */}
				<div
					ref={scrollRef}
					className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-4"
				>
					{view === "home" ? (
						<RoomSettingsHome
							room={room}
							autoFocusRow={returnedFrom}
							onOpenView={open}
							onOpenMemory={() => {
								// Close settings first so two dialogs are never stacked.
								onClose();
								onOpenMemory();
							}}
							onRename={() => {
								onClose();
								management.requestRename(room);
							}}
							onDelete={() => {
								// Deletion is not performed here. The confirmation dialog is the real boundary.
								onClose();
								management.requestDelete(room);
							}}
						/>
					) : view === "generation" ? (
						<RoomSettingsGeneration roomId={room.id} onLeave={onClose} />
					) : view === "persona" ? (
						<RoomSettingsPersona room={room} onLeave={onClose} />
					) : view === "narration" ? (
						<RoomSettingsNarration room={room} />
					) : view === "intensity" ? (
						<RoomSettingsIntensity room={room} />
					) : view === "characters" ? (
						<RoomSettingsCharacters room={room} />
					) : view === "userNote" ? (
						<RoomSettingsUserNote room={room} />
					) : (
						<RoomSettingsInfo room={room} />
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
