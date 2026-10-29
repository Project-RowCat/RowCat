import type {
	ChatRoom,
	ChatStore,
	GenerationPreferenceStore,
} from "@rowcat/chat";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocalRoom } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useGenerationScope } from "#/lib/local-generation/scope.ts";
import { MemoryDialog } from "../memory/dialog.tsx";
import { RoomSettingsDialog } from "../room-settings/dialog.tsx";
import { DeleteRoomDialog } from "./delete-dialog.tsx";
import { RenameRoomDialog } from "./rename-dialog.tsx";

/**
 * Owner of room management (rename, settings, delete). Conversation features own it and screens
 * borrow it, because the actions open from three places (the list row menu, the open conversation's
 * header, and the sidebar row). Rules in one screen would force others to import it, and separate
 * copies would let confirmation wording, error handling and account switching drift apart.
 *
 * It holds one thing: which room is targeted and by which action. It lives here so rows draw only
 * triggers; a dialog tree per row would mount hundreds of dialogs for a 500-room list. Only one
 * dialog is ever open.
 *
 * The target is a room id, not a list position, so a re-sorted list (liveQuery, sync) does not
 * redirect the action. The dialog re-subscribes to the stored room by that id (RoomTarget), so it
 * shows the saved value rather than a stale captured title, and it closes quietly if the room
 * disappears. This is not a shadow of the active room: which conversation is open is still answered
 * by the route parameter.
 */

/**
 * The fields management actions read: identity and name. The full room record is not carried
 * around.
 */
export interface ManagedRoom {
	id: string;
	title: string;
}

/**
 * Only one opens at a time. Moving from `settings` to `rename`, `delete`, or `memory` also changes
 * this value, so stacked dialogs cannot be represented; otherwise it would be unpredictable which
 * one Escape closes.
 */
type TargetAction = "rename" | "settings" | "delete" | "memory";

interface Target {
	room: ManagedRoom;
	action: TargetAction;
	/**
	 * The store instance at the moment the menu was opened. The account id is not used for this check:
	 * in Alice → logout → Alice, the id is the same, but the database connection was closed and
	 * reopened in between, and writes to the old instance go to a closed connection. This is the same
	 * ownership rule as generation turns (features/conversation/generation-owner.ts).
	 */
	store: ChatStore;
	/**
	 * The preference store from the same moment. It is needed to clear the room's generation overrides
	 * when the room is deleted. Both stores come from one activation group (local-data/activation.ts),
	 * so their lifetimes match, and the chat store alone is enough to decide ownership.
	 */
	preferences: GenerationPreferenceStore | null;
}

/**
 * The narrow view for places that only need triggers. Menu items and the settings window's
 * management section only request an operation and do not draw dialogs. Passing `dialogs` to them
 * as well would eventually lead one to render it in its own tree, and the same window would then
 * appear twice.
 */
export interface RoomActionRequests {
	requestRename: (room: ManagedRoom) => void;
	requestSettings: (room: ManagedRoom) => void;
	requestDelete: (room: ManagedRoom) => void;
}

export interface RoomManagement extends RoomActionRequests {
	/** The one open dialog. The caller renders it once in its own tree. */
	dialogs: ReactNode;
}

export function useRoomManagement(
	options: {
		/**
		 * Runs after deletion completes. This is where a screen showing the deleted room navigates away.
		 */
		onDeleted?: (room: ManagedRoom) => void;
	} = {},
): RoomManagement {
	const { store, ownsStore } = useChatScope();
	const { store: preferences } = useGenerationScope();
	const [target, setTarget] = useState<Target | null>(null);
	const { onDeleted } = options;

	/**
	 * When the scope owner changes, an open dialog is closed. Suppose Alice opens a rename dialog and
	 * logs out, and Bob logs in: that dialog would show Alice's conversation title on Bob's screen.
	 * Closing is not enough once an action has already been submitted, so ownership is checked again
	 * just before each write.
	 */
	useEffect(() => {
		setTarget((current) =>
			current && current.store !== store ? null : current,
		);
	}, [store]);

	const close = useCallback(() => setTarget(null), []);

	const request = useCallback(
		(action: TargetAction) => (room: ManagedRoom) => {
			// No database to manage: the scope is not open yet, or the user is a guest.
			if (!store) return;
			setTarget({ room, action, store, preferences });
		},
		[store, preferences],
	);

	/**
	 * Ownership is checked again immediately before any irreversible action. While the dialog is open
	 * the account can change, and this closure would then hold a reference to a closed (or someone
	 * else's) database. It must not swap in the storage of the scope that is currently open, or an
	 * operation started on Alice's screen would finish on Bob's database.
	 */
	const run = useCallback(
		async (perform: (target: Target, room: ManagedRoom) => Promise<void>) => {
			if (!target) return;
			if (!ownsStore(target.store)) {
				setTarget(null);
				return;
			}
			await perform(target, target.room);
		},
		[target, ownsStore],
	);

	const requests: RoomActionRequests = {
		requestRename: request("rename"),
		requestSettings: request("settings"),
		requestDelete: request("delete"),
	};

	/**
	 * There is one dialog. The `Target` above picks the window; `RoomTarget` looks up the currently
	 * stored room by that id and passes it in, rather than using the copy captured when the menu
	 * opened.
	 */
	const dialogs =
		target === null ? null : (
			<RoomTarget roomId={target.room.id} onMissing={close}>
				{(room) =>
					target.action === "rename" ? (
						<RenameRoomDialog
							room={room}
							onClose={close}
							onRename={(title) =>
								run(async ({ store: chat }) => {
									await chat.renameRoom(room.id, title);
									setTarget(null);
								})
							}
						/>
					) : target.action === "settings" ? (
						/**
						 * Settings opens for any room, not just the one currently open. It reads the room record
						 * resolved above, not the route, so opening another room's settings from the sidebar leaves
						 * the conversation in progress where it is.
						 */
						<RoomSettingsDialog
							room={room}
							management={requests}
							onOpenMemory={() => setTarget({ ...target, action: "memory" })}
							onClose={close}
						/>
					) : target.action === "memory" ? (
						/**
						 * Memory is a sibling of settings, not nested inside it, because of Escape. With two stacked
						 * layers, which one closes is unpredictable, and if the outer one closes first, anything
						 * typed in the inner one is lost.
						 */
						<MemoryDialog room={room} onClose={close} />
					) : (
						<DeleteRoomDialog
							room={room}
							onClose={close}
							onDelete={() =>
								run(async ({ store: chat, preferences: prefs }) => {
									await chat.deleteRoom(room.id);
									/**
									 * Also clears that room's generation overrides. The cleanup belongs in this composition
									 * layer. It is not inside `deleteRoom`, which is a port in @rowcat/chat that an Expo
									 * implementation would also implement; putting the web preference table there would make
									 * the domain store aware of this app's settings schema.
									 *
									 * A failure does not undo the deletion. At most one unread row remains (preferences are
									 * looked up only by live room ids), and a deleted conversation coming back would be much
									 * worse. The tombstone transaction has already committed; if this threw, the cleanup and
									 * navigation below would be skipped.
									 */
									try {
										await prefs?.clearRoom(room.id);
									} catch (failure) {
										console.warn(
											"[chat] couldn't tidy up the conversation settings",
											failure,
										);
									}
									/**
									 * Close the dialog first, then notify. Notifying triggers navigation away from the deleted
									 * room's screen, so reversing the order would write state into a tree that has already
									 * gone.
									 */
									setTarget(null);
									onDeleted?.(room);
								})
							}
						/>
					)
				}
			</RoomTarget>
		);

	return { ...requests, dialogs };
}

/**
 * Resolves the target room to its currently saved value, rather than the title captured by the
 * menu, for two reasons.
 *
 * First, the rename dialog's initial value. If another tab or sync renamed the room after the menu
 * opened, a dialog opened with the old string would revert the new name on Save even if the user
 * changed nothing: a revert the user did not perform.
 *
 * Second, the room may have disappeared (deleted in another tab, a tombstone from sync, an account
 * switch). The store does not revive a missing room, but if the screen does not know, an open
 * dialog does nothing. Nothing is rendered before the first lookup returns. The scope is already
 * open, so the point lookup completes within a frame; showing a copy in the meantime would
 * reintroduce the first problem.
 *
 * The whole record is passed rather than only identity and name because of the settings window
 * alone, which reads trigger level, prompt protection and the source work. Resolving once here is
 * better than subscribing to the same record twice.
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
	const { status, room } = useLocalRoom(roomId);

	// biome-ignore lint/correctness/useExhaustiveDependencies: close only at the moment the room disappears.
	useEffect(() => {
		if (status === "missing") onMissing();
	}, [status]);

	if (!room) return null;
	return <>{children(room)}</>;
}
