import type { ChatRoom, ChatStore, RoomSettingsRowId } from "@rowcat/chat";
import { AlertDialog } from "@rowcat/ui-native";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useLocalLive } from "../../../lib/local-data/live.ts";
import {
	useChatScope,
	useGenerationScope,
} from "../../../lib/local-data/scope.tsx";
import { useLocalCharacters } from "../../../lib/local-data/use-characters.ts";
import { useRoomMessages } from "../../../lib/local-data/use-room-messages.ts";
import {
	createManagedPersona,
	deleteManagedPersona,
	updateManagedPersona,
} from "../../persona/persona-mutations.ts";
import { MemoryPanel } from "../memory/panel.tsx";
import { RoomSettingsDialog } from "../room-settings/dialog.tsx";
import { DELETE_FAILURE_MESSAGE, DELETE_ROOM_CONFIRM } from "./actions.ts";
import {
	createManagedCharacter,
	deleteManagedCharacter,
	deleteManagedRoom,
	type ManagedRoom,
	renameManagedRoom,
	setManagedRoomIntensity,
	setManagedRoomNarration,
	setManagedRoomPersona,
	setManagedRoomUserNote,
	updateManagedCharacter,
} from "./mutations.ts";
import { RenameRoomDialog } from "./rename-dialog.tsx";

/**
 * Owner of room management, the same shape as web's `useRoomManagement`. The target is any room the
 * user acts on, not only the open one (the chat list acts on closed rooms too). A single hook owns
 * the confirmation copy, validation, failure handling, ownership checks and preference cleanup for
 * every trigger, so they cannot drift apart.
 *
 * The target is a room id, not a list position: a re-sort while a menu is open must not move the
 * action to a neighbouring room. The window re-subscribes by id (`RoomTarget`) and closes quietly
 * if the room vanished in between.
 *
 * Only one window is open at a time; the state is a single value.
 */

export type { ManagedRoom } from "./mutations.ts";

type Surface = "settings" | "rename" | "memory" | "delete";

interface Target {
	/** Room identity and name at request time; the window re-resolves the stored value. */
	room: ManagedRoom;
	surface: Surface;
	/**
	 * The store instance at open time. Member ids are not compared: sign-out and sign-in as the same
	 * member reuse the id, but the old instance's connection is closed.
	 */
	store: ChatStore;
}

/**
 * Narrow view for triggers only. List rows and the settings `Manage` section request operations and
 * draw no window; handing them `surfaces` would draw the window once per row.
 */
export interface RoomActionRequests {
	requestRename: (room: ManagedRoom) => void;
	requestSettings: (room: ManagedRoom) => void;
	requestDelete: (room: ManagedRoom) => void;
}

export interface RoomManagement extends RoomActionRequests {
	/** The open window; callers draw it once in their own tree. */
	surfaces: ReactNode;
}

export function useRoomManagement(
	options: {
		/** Runs after deletion; the screen that had the room open leaves here. */
		onDeleted?: (room: ManagedRoom) => void;
	} = {},
): RoomManagement {
	const { store, ownsStore } = useChatScope();
	const { store: preferences } = useGenerationScope();
	const [target, setTarget] = useState<Target | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const { onDeleted } = options;

	/** Closes an open window when the scope's owner changes, so another account's data never shows. */
	useEffect(() => {
		setTarget((current) =>
			current && current.store !== store ? null : current,
		);
	}, [store]);

	const close = useCallback(() => {
		setTarget(null);
		setDeleting(false);
		setDeleteError(null);
	}, []);

	const open = useCallback(
		(surface: Surface) => (room: ManagedRoom) => {
			// Scope not open yet, or guest: no database to manage.
			if (!store) return;
			setDeleting(false);
			setDeleteError(null);
			setTarget({ room, surface, store });
		},
		[store],
	);

	const requests: RoomActionRequests = useMemo(
		() => ({
			requestRename: open("rename"),
			requestSettings: open("settings"),
			requestDelete: open("delete"),
		}),
		[open],
	);

	/**
	 * A settings row requested a sibling window; settings closes first. `generation` and `info` never
	 * arrive here: they are panes inside the settings window.
	 */
	const openRow = useCallback(
		(room: ManagedRoom, row: RoomSettingsRowId) => {
			if (row === "rename") return requests.requestRename(room);
			if (row === "memory") return open("memory")(room);
			if (row === "delete") return requests.requestDelete(room);
		},
		[requests, open],
	);

	/** Stores as of the operation's start, with the ownership predicate. */
	const scopeOf = useCallback(
		(owner: ChatStore) => ({ store: owner, preferences, owns: ownsStore }),
		[preferences, ownsStore],
	);

	const confirmDelete = useCallback(
		(owner: ChatStore, room: ManagedRoom) => {
			if (deleting) return;
			setDeleting(true);
			setDeleteError(null);
			void deleteManagedRoom(scopeOf(owner), room.id)
				.then((outcome) => {
					setDeleting(false);
					setTarget(null);
					/* Ownership lost means nothing happened, so stay on the screen. */
					if (outcome === "done") onDeleted?.(room);
				})
				.catch(() => {
					setDeleting(false);
					setDeleteError(DELETE_FAILURE_MESSAGE);
				});
		},
		[deleting, scopeOf, onDeleted],
	);

	/**
	 * Characters are subscribed only while a window is open for this room. Generation reads them once
	 * at start to freeze the roster, so the chat screen does not hold a subscription.
	 */
	const characters = useLocalCharacters(target?.room.id ?? null);

	/**
	 * Recent messages for the `Conversation info` usage table, subscribed only while a window is open. The window
	 * receives them as props so ownership checks stay in one place.
	 */
	const messages = useRoomMessages(target?.room.id ?? null);

	/** One window. `RoomTarget` resolves the room by id from the store, not from the request copy. */
	const surfaces =
		target === null ? null : (
			<RoomTarget roomId={target.room.id} onMissing={close}>
				{(room) =>
					target.surface === "settings" ? (
						<RoomSettingsDialog
							room={room}
							messages={messages}
							onOpenRow={(row) => openRow(room, row)}
							/* Every room write goes through this hook for the ownership check. */
							onSetPersona={(persona) =>
								setManagedRoomPersona(scopeOf(target.store), room.id, persona)
							}
							onSetNarration={(narration) =>
								setManagedRoomNarration(
									scopeOf(target.store),
									room.id,
									narration,
								)
							}
							onSetIntensity={(intensity) =>
								setManagedRoomIntensity(
									scopeOf(target.store),
									room.id,
									intensity,
								)
							}
							onSetUserNote={(userNote) =>
								setManagedRoomUserNote(scopeOf(target.store), room.id, userNote)
							}
							/*
							 * Passed by value: a subscription owned by the window would outlive a window that closed
							 * while another device changed a character.
							 */
							characters={{
								value: characters.value,
								/* Only "first result arrived" matters to the window, not the full status. */
								loading: characters.status === "loading",
							}}
							onCreateCharacter={(values) =>
								createManagedCharacter(scopeOf(target.store), room.id, values)
							}
							onUpdateCharacter={(id, values) =>
								updateManagedCharacter(scopeOf(target.store), id, values)
							}
							onDeleteCharacter={(id) =>
								deleteManagedCharacter(scopeOf(target.store), id)
							}
							onCreatePersona={async (input) => {
								const outcome = await createManagedPersona(
									scopeOf(target.store),
									input,
								);
								/* Throw on lost ownership so the form does not draw an unsaved role as saved. */
								if (outcome.status === "foreign")
									throw new Error("scope changed");
								return outcome.persona;
							}}
							onUpdatePersona={(id, patch) =>
								updateManagedPersona(scopeOf(target.store), id, patch)
							}
							onDeletePersona={(id) =>
								deleteManagedPersona(scopeOf(target.store), id)
							}
							onClose={close}
						/>
					) : target.surface === "rename" ? (
						<RenameRoomDialog
							/* The stored title from the subscription, not the copy the menu held. */
							title={room.title}
							onClose={close}
							onRename={(title: string) =>
								renameManagedRoom(scopeOf(target.store), room.id, title)
							}
						/>
					) : target.surface === "memory" ? (
						<MemoryPanel
							roomId={room.id}
							store={target.store}
							onClose={close}
						/>
					) : (
						<AlertDialog
							open
							title={DELETE_ROOM_CONFIRM.title}
							description={DELETE_ROOM_CONFIRM.message}
							confirmLabel={DELETE_ROOM_CONFIRM.confirm}
							cancelLabel={DELETE_ROOM_CONFIRM.cancel}
							destructive
							busy={deleting}
							error={deleteError}
							onConfirm={() => confirmDelete(target.store, room)}
							onCancel={close}
						/>
					)
				}
			</RoomTarget>
		);

	return { ...requests, surfaces };
}

/**
 * Resolves the target room to its currently stored value by id, the same as web's component of the
 * same name. The store is re-subscribed rather than using the request's copy, because:
 *
 * - A rename applied by sync after the menu opened would be reverted by a window opened with the
 *   old title if `Save` is pressed without editing.
 * - A vanished room (deleted elsewhere, a sync tombstone, an account switch) must close the
 *   window; the store never resurrects it.
 *
 * Nothing is drawn before the first lookup, so a window cannot open from a stale copy in that gap.
 * The whole record is passed because the settings window reads rating, prompt protection and
 * source; resolving once here beats a second subscription for the other windows.
 */
function RoomTarget({
	roomId,
	onMissing,
	children,
}: {
	roomId: string;
	onMissing: () => void;
	children: (room: ChatRoom) => ReactNode;
}) {
	const { store } = useChatScope();
	/* Memoized: a new function per render would re-subscribe on every render. */
	const load = useMemo(
		() => (store ? () => store.getRoom(roomId) : null),
		[store, roomId],
	);
	const lookup = useLocalLive(load, null);

	/**
	 * Close only when the room is definitely gone (`ready` with `null`). A read failure (`error`) is
	 * not that, and closing on it would let a store hiccup swallow the window.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: closes only at the moment the room disappears.
	useEffect(() => {
		if (lookup.status === "ready" && lookup.value === null) onMissing();
	}, [lookup.status, lookup.value]);

	if (!lookup.value) return null;
	return <>{children(lookup.value)}</>;
}
