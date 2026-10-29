import type { ChatPersona, ChatPersonaSnapshot, ChatStore } from "@rowcat/chat";
import { useCallback } from "react";
import { useChatScope } from "#/lib/local-chat/scope.ts";

/**
 * The write path for the persona library. It is one path because of ownership.
 * - Three screens call these operations: the library page (/personas), the room settings selector
 *   and the chat-start picker. If each read useChatScope().store itself, the check 'is this store
 *   still the active scope's?' would exist in three places, and one place that forgot it would send
 *   a save made after an account switch to another user's database. Nothing on screen would reveal
 *   that.
 * - Parallel to useRoomManagement, with the same reasoning: that hook owns a room's operations,
 *   this one owns the account library's operations.
 * - It does not render dialogs. The library's forms are rendered by the screen that opens them,
 *   which already has its own tree. Holding them here would put a dialog inside the room settings
 *   surface, a nested dialog the app avoids.
 */

export interface PersonaLibraryMutations {
	/** Scope not yet open, or the user is a guest; the forms are disabled in that case. */
	ready: boolean;
	/**
	 * Creates one persona in the library and returns the created record. The record is returned for
	 * create-while-selecting flows (chat start, room settings). Making the user create and then look
	 * for it in the list would make them repeat what they just did. Returns null if the scope was
	 * lost. This is not thrown, because it is 'did not happen', not a failure (same axis as `foreign`
	 * in room-mutations.ts). Folding it into an error would show 'try again', and retrying would get
	 * the same answer.
	 */
	create: (input: {
		name: string;
		description: string;
	}) => Promise<ChatPersona | null>;
	update: (
		id: string,
		patch: { name: string; description: string },
	) => Promise<void>;
	/**
	 * Deletes from the library and touches no room. Rooms hold a copy of the value, not a reference to
	 * this row (persona.ts), so there is nothing to clean up. This is the opposite of room deletion
	 * removing its generation override, and the reason is also opposite: there, a row nobody reads was
	 * left behind. Here, touching a room would cause an unrequested change, a conversation's speaker
	 * disappearing.
	 */
	remove: (id: string) => Promise<void>;
	/**
	 * Sets the persona this room uses; null clears the room's override. It sits in the same hook as
	 * the library operations because the ownership check is the same. The argument is the value, not
	 * the library id; that is the point of this signature (see the persona.ts header).
	 */
	applyToRoom: (
		roomId: string,
		persona: ChatPersonaSnapshot | null,
	) => Promise<void>;
}

export function usePersonaLibrary(): PersonaLibraryMutations {
	const { store, ownsStore } = useChatScope();

	/**
	 * Re-checks ownership immediately before an irreversible action. It must not swap in the store of
	 * the currently open scope: an action started on Alice's screen would finish in Bob's database
	 * (useRoomManagement uses the same rule).
	 */
	const run = useCallback(
		async <T>(
			perform: (owner: ChatStore) => Promise<T>,
			fallback: T,
		): Promise<T> => {
			if (!store || !ownsStore(store)) return fallback;
			return perform(store);
		},
		[store, ownsStore],
	);

	return {
		ready: store !== null,
		create: useCallback(
			(input) => run((owner) => owner.createPersona(input), null),
			[run],
		),
		update: useCallback(
			async (id, patch) => {
				await run((owner) => owner.updatePersona(id, patch), undefined);
			},
			[run],
		),
		remove: useCallback(
			async (id) => {
				await run((owner) => owner.deletePersona(id), undefined);
			},
			[run],
		),
		applyToRoom: useCallback(
			async (roomId, persona) => {
				await run((owner) => owner.setRoomPersona(roomId, persona), undefined);
			},
			[run],
		),
	};
}
