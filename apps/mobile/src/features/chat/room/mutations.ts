import type {
	ChatIntensity,
	ChatNarrationSettings,
	ChatPersonaSnapshot,
	ChatStore,
	GenerationPreferenceStore,
} from "@rowcat/chat";

/**
 * Room mutations layered on the store port. Kept free of React because this app's tests do not
 * render components.
 *
 * Ownership is re-asked right before each write. The store of the currently open scope is never
 * substituted: that would apply an operation started on one account's screen to another account's
 * database. Member ids are not compared, because sign-out and sign-in as the same member reopens
 * the connection.
 */

/** What a management operation reads: identity and current name, not the whole room record. */
export interface ManagedRoom {
	id: string;
	title: string;
}

/**
 * The stores as of when the operation started, plus a predicate for "is it still mine".
 *
 * Preferences ride along only for deletion. Both come from the same activation bundle, so one
 * ownership check on the chat store covers both.
 */
export interface RoomMutationScope {
	store: ChatStore;
	preferences: GenerationPreferenceStore | null;
	owns: (store: ChatStore) => boolean;
}

/**
 * `foreign` means nothing was done, not a failure. Folded into an error, the screen would offer a
 * retry that gets the same answer (the scope already changed); callers close quietly.
 */
export type RoomMutationOutcome = "done" | "foreign";

export async function renameManagedRoom(
	scope: RoomMutationScope,
	roomId: string,
	title: string,
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.renameRoom(roomId, title);
	return "done";
}

/**
 * Sets the role for this room; `null` clears the override. Same shape and rationale as
 * `renameManagedRoom`: writing to someone else's database cannot be undone even when the write
 * could.
 *
 * It takes the persona value, not a library id. With an id this composition would have to look the
 * library up, and deleting a library row would then lose the speaker of old conversations
 * (`persona.ts` header in `@rowcat/chat`).
 */
export async function setManagedRoomPersona(
	scope: RoomMutationScope,
	roomId: string,
	persona: ChatPersonaSnapshot | null,
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.setRoomPersona(roomId, persona);
	return "done";
}

// Character operations pass the same ownership gate as the room-level ones. A window holding the
// store directly would repeat that check per window, and a missed one writes to another account's
// database after a switch.

export async function createManagedCharacter(
	scope: RoomMutationScope,
	roomId: string,
	values: { name: string; prompt: string },
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.createCharacter({ roomId, ...values });
	return "done";
}

export async function updateManagedCharacter(
	scope: RoomMutationScope,
	id: string,
	values: { name: string; prompt: string },
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.updateCharacter(id, values);
	return "done";
}

export async function deleteManagedCharacter(
	scope: RoomMutationScope,
	id: string,
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.deleteCharacter(id);
	return "done";
}

export async function setManagedRoomNarration(
	scope: RoomMutationScope,
	roomId: string,
	narration: ChatNarrationSettings | null,
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.setRoomNarration(roomId, narration);
	return "done";
}

export async function setManagedRoomIntensity(
	scope: RoomMutationScope,
	roomId: string,
	intensity: ChatIntensity | null,
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.setRoomIntensity(roomId, intensity);
	return "done";
}

export async function setManagedRoomUserNote(
	scope: RoomMutationScope,
	roomId: string,
	userNote: string | null,
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.setRoomUserNote(roomId, userNote);
	return "done";
}

// The persona library mutations live in `features/persona/persona-mutations.ts`: the library is an
// account asset, not a room child. Applying a persona to a room stays here
// (`setManagedRoomPersona`).

/**
 * Deletes the room and its generation override. The store removes messages and memories in one
 * transaction (`deleteRoom`).
 *
 * The preference cleanup stays out of `deleteRoom`, which is a `@rowcat/chat` port the web also
 * implements; this app's preference table must not leak into it. A cleanup failure does not undo
 * the deletion: the leftover row is never read, and resurrecting a deleted conversation is worse.
 */
export async function deleteManagedRoom(
	scope: RoomMutationScope,
	roomId: string,
): Promise<RoomMutationOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.deleteRoom(roomId);
	await scope.preferences?.clearRoom(roomId).catch(() => undefined);
	return "done";
}
