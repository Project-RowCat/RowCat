import type {
	ChatCharacter,
	ChatIntensity,
	ChatMessage,
	ChatNarrationSettings,
	ChatPersona,
	ChatPersonaSnapshot,
	ChatRoom,
	RoomSettingsRowId,
} from "@rowcat/chat";
import { Dialog } from "@rowcat/ui-native";
import { useState } from "react";
import { RoomInfoContent } from "../room/info-content.tsx";
import { RoomSettingsCharacters } from "./characters.tsx";
import { RoomSettingsGeneration } from "./generation.tsx";
import { RoomSettingsHome } from "./home.tsx";
import { RoomSettingsIntensity } from "./intensity.tsx";
import { RoomSettingsNarration } from "./narration.tsx";
import { PersonaEditor, RoomSettingsPersona } from "./persona.tsx";
import { RoomSettingsUserNote } from "./user-note.tsx";
import {
	backLabelFor,
	ROOM_SETTINGS_VIEW_PARENT,
	ROOM_SETTINGS_VIEW_TITLE,
	type RoomSettingsView,
} from "./view.ts";

/**
 * Room settings: a composition surface that owns no value. Same place, name and container as the
 * web's `apps/web/src/features/chat/room-settings/dialog.tsx`. Ownership of what it opens is all
 * outside:
 *
 * ```text
 * response length, model -> GenerationPreferenceStore (device-local, member scope, not synced)
 * rename                 -> ChatStore.renameRoom      (synced room record)
 * delete                 -> ChatStore.deleteRoom      (synced tombstone)
 * memory                 -> ChatMemoryStore           (opened by a sibling window)
 * conversation info      -> read-only copy of the room record
 * ```
 *
 * There is no "save settings" button committing these together: a transaction across different
 * stores does not exist, so such a button would report a partial success as success.
 *
 * This file holds the shell and which pane is current:
 *
 * ```text
 * home         RoomSettingsHome        six rows; what can be done reads in seconds
 * generation   RoomSettingsGeneration  response length, target, reasoning effort, cost
 * persona      RoomSettingsPersona     pick the role I play here + the library
 * narration    RoomSettingsNarration   who writes this conversation + attribution notice
 * intensity    RoomSettingsIntensity   how much the description shows (rating is the ceiling)
 * characters   RoomSettingsCharacters  add, edit and delete characters in this room
 * personaForm  PersonaEditor           create or edit that role
 * info         RoomInfoContent         read-only facts + recent usage
 * ```
 *
 * With more than four panes, "back" no longer has one destination: cancelling persona creation
 * returns to the picker, not home (`ROOM_SETTINGS_VIEW_PARENT`, `room-settings-view.ts`).
 *
 * Persona create, edit and delete finish inside this window's two panes even though the library
 * screen now exists (`/settings/personas`, same address on web): editing one role mid-setup should
 * not send the user to another part of the app. The web pane does the same (see the sibling
 * `room-settings-persona.tsx`), and the rules are identical (`@rowcat/chat` answers both).
 *
 * No nested windows: switching panes changes the content of one window, so Android back and the
 * accessibility escape each have one target. Tabs would show every field at all times and lose the
 * list's brevity; accordions return to one long scrolling document.
 *
 * Memory, rename and delete go out to sibling windows, each with its own form and confirmation
 * (inside this scroll area they would be a window in a window). `useRoomManagement` owns that
 * transition; this file only lifts the request.
 */

export function RoomSettingsDialog({
	room,
	messages,
	onOpenRow,
	onSetPersona,
	onSetNarration,
	onSetIntensity,
	onSetUserNote,
	characters,
	onCreateCharacter,
	onUpdateCharacter,
	onDeleteCharacter,
	onCreatePersona,
	onUpdatePersona,
	onDeletePersona,
	onClose,
}: {
	/** The room record at open time; SQLite remains the source of truth for title and info. */
	room: ChatRoom;
	/**
	 * Recent messages the window already subscribes to; only the usage table of the `Conversation info` pane reads
	 * this. Re-reading here would make two subscriptions to one value, drifting a frame apart while
	 * streaming.
	 */
	messages: readonly ChatMessage[];
	/**
	 * A row this window cannot handle itself was pressed. Only the three that open sibling windows
	 * (`memory`, `rename`, `delete`) come up, and they close this window first.
	 */
	onOpenRow: (row: RoomSettingsRowId) => void;
	/**
	 * Sets the role played in this conversation; `null` clears the override. The window holds no store
	 * because ownership is asked in one place, `useRoomManagement`, right before an irreversible write
	 * ("is this store still the active scope's"); re-writing that per window means one eventually
	 * misses it.
	 */
	onSetPersona: (persona: ChatPersonaSnapshot | null) => Promise<unknown>;
	/** Applies the narration style to the room, through the same ownership gate as the role. */
	onSetNarration: (narration: ChatNarrationSettings | null) => Promise<unknown>;
	/** Applies expression intensity to the room; `null` returns to the default. */
	onSetIntensity: (intensity: ChatIntensity | null) => Promise<unknown>;
	/** Writes the user note to the room, through the same ownership gate as the role. */
	onSetUserNote: (userNote: string | null) => Promise<unknown>;
	/**
	 * This room's characters, from a subscription. Not store-held for the ownership reason above;
	 * passed as an argument because the subscription outlives this window (`useRoomManagement` opens
	 * and closes it).
	 */
	characters: { value: readonly ChatCharacter[]; loading: boolean };
	/** The three character operations, through the same ownership gate as the role. */
	onCreateCharacter: (values: {
		name: string;
		prompt: string;
	}) => Promise<unknown>;
	onUpdateCharacter: (
		id: string,
		values: { name: string; prompt: string },
	) => Promise<unknown>;
	onDeleteCharacter: (id: string) => Promise<unknown>;
	/** Creates one role in the library and returns the record (applied immediately). */
	onCreatePersona: (input: {
		name: string;
		description: string;
	}) => Promise<ChatPersona>;
	onUpdatePersona: (
		id: string,
		patch: { name: string; description: string },
	) => Promise<unknown>;
	onDeletePersona: (id: string) => Promise<unknown>;
	onClose: () => void;
}) {
	/** Current pane: UI state only, persisted nowhere (`room-settings-view.ts` gives the reason). Opening always starts at `home`. */
	const [view, setView] = useState<RoomSettingsView>("home");
	/**
	 * The record the form edits; `null` means creating. It holds a copy and does not resubscribe by id
	 * because this pane is short-lived (open, then save or cancel). If another device edited the same
	 * role meanwhile, saving overwrites it, which is correct: the user edited the value they saw.
	 */
	const [editing, setEditing] = useState<ChatPersona | null>(null);

	const parent = ROOM_SETTINGS_VIEW_PARENT[view];

	return (
		<Dialog
			open
			title={ROOM_SETTINGS_VIEW_TITLE[view]}
			/** Which conversation stays across panes (it is this window's context); long titles are truncated so they do not push the window. */
			description={room.title}
			/** No back on home: a disabled arrow going nowhere is worse than none. Close is always there (`Dialog` owns it). */
			{...(parent === null
				? {}
				: {
						onBack: () => setView(parent),
						backLabel: backLabelFor(parent),
					})}
			/**
			 * Docks to the bottom on narrow screens only, the same product decision as the web window
			 * docking below `sm`; the pure `resolveDialogPlacement` in `@rowcat/ui-native` resolves it. This
			 * is not a sheet: only coordinates change, the container stays `Dialog` (role, Android back,
			 * screen-reader escape, focus ownership and pane-to-pane back are untouched). Rising from the
			 * bottom does not earn its place in this interaction, which is the sheet test. Only this window
			 * opts in; sibling windows (rename, message edit) stay centered, as a short form does on the
			 * web.
			 */
			placement="adaptive"
			/** A rule under the header, where the web window puts `border-b` on `DialogHeader`; with a scrolling body it says "top is fixed, bottom moves". */
			headerDivider
			scroll
			/** A pane change starts at the top: with one scroll area, returning from a scrolled-down generation pane would draw home midway and read as a truncated list. */
			bodyKey={view}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			{view === "home" ? (
				<RoomSettingsHome
					room={room}
					onOpenRow={(row) => {
						/** Rows with a pane finish here; no sibling window opens. */
						if (
							row === "generation" ||
							row === "info" ||
							row === "persona" ||
							row === "narration" ||
							row === "intensity" ||
							row === "characters" ||
							row === "userNote"
						)
							return setView(row);
						/** The remaining three close this window first so two windows never stack. */
						onClose();
						onOpenRow(row);
					}}
				/>
			) : view === "generation" ? (
				<RoomSettingsGeneration roomId={room.id} />
			) : view === "narration" ? (
				<RoomSettingsNarration room={room} onApply={onSetNarration} />
			) : view === "intensity" ? (
				<RoomSettingsIntensity room={room} onApply={onSetIntensity} />
			) : view === "userNote" ? (
				<RoomSettingsUserNote room={room} onApply={onSetUserNote} />
			) : view === "characters" ? (
				<RoomSettingsCharacters
					room={room}
					characters={characters.value}
					loading={characters.loading}
					onCreate={onCreateCharacter}
					onUpdate={onUpdateCharacter}
					onDelete={onDeleteCharacter}
				/>
			) : view === "persona" ? (
				<RoomSettingsPersona
					room={room}
					onApply={onSetPersona}
					onEdit={(persona) => {
						setEditing(persona);
						setView("personaForm");
					}}
					onCreate={() => {
						setEditing(null);
						setView("personaForm");
					}}
				/>
			) : view === "personaForm" ? (
				<PersonaEditor
					persona={editing}
					onSave={async (input) => {
						/*
						 * Apply the saved value to this conversation immediately; making the user pick it again
						 * repeats what they just did. What is passed is the value, not the new record's id: the room
						 * holds a copy.
						 */
						if (editing) await onUpdatePersona(editing.id, input);
						else await onCreatePersona(input);
						await onSetPersona(input);
						setView("persona");
					}}
					{...(editing
						? {
								onDelete: async () => {
									const target = editing;
									await onDeletePersona(target.id);
									/*
									 * The room's override is left alone: deleting from the library and this conversation
									 * continuing with that role are different facts, and clearing it too would be an
									 * unrequested change.
									 */
									setEditing(null);
									setView("persona");
								},
							}
						: {})}
					onCancel={() => setView("persona")}
				/>
			) : (
				<RoomInfoContent room={room} messages={messages} onLeave={onClose} />
			)}
		</Dialog>
	);
}
