import type { RoomActionId } from "@rowcat/chat";

/**
 * Copy for room actions; the list is not here. This file once held the five items of the header
 * overflow menu, justified because the app's only room container was that overflow. That premise is
 * gone: the header has web's two (`Find`, `Conversation settings`) and the rest are sections inside settings, whose
 * structure is `ROOM_SETTINGS_IA` in `@rowcat/chat`. The list-row menu is the same axis:
 * `ROOM_ACTIONS` owns vocabulary, order, destructiveness and separators, and a second list here
 * would let the apps diverge again. Only copy remains, since Korean stays out of the shared
 * package.
 */

/** Same words as web's `ROOM_ACTION_LABEL`; the `Record` makes a new shared action break compilation in both apps. */
export const ROOM_ACTION_LABEL: Record<RoomActionId, string> = {
	rename: "Rename",
	settings: "Conversation settings",
	delete: "Delete conversation",
};

/**
 * Accessible name of the list-row trigger; same sentence as web's `roomActionsLabel`. `More` would
 * leave one identically named trigger per row for non-visual users. The header's `Conversation settings` omits the
 * title for the opposite reason: one trigger with the title right beside it.
 */
export function roomActionsLabel(title: string): string {
	return `Manage conversation ${title}`;
}

/**
 * Delete confirmation; the copy states what disappears. "Are you sure you want to delete?" gives no information and
 * gets pressed unread. This removes the whole conversation on this device (messages and memories in
 * one transaction) and sync carries that to other devices. It says it cannot be undone because that
 * is true: tombstones have no recovery path.
 */
export const DELETE_ROOM_CONFIRM = {
	title: "Delete this conversation?",
	message:
		"This conversation's messages and memories are deleted together, and they disappear on other devices too. This can't be undone.",
	confirm: "Delete",
	cancel: "Cancel",
} as const;

/**
 * Failure as one human sentence. Raw SQLite text (`SQLITE_FULL: ...`) is not shown: it names no
 * user action and leaks internals. Causes are not split on purpose; full storage or a connection
 * closed mid account switch leave the user the same thing to do.
 */
export const RENAME_FAILURE_MESSAGE = "Couldn't rename it. Please try again.";

export const DELETE_FAILURE_MESSAGE =
	"Couldn't delete the conversation. Please try again.";
