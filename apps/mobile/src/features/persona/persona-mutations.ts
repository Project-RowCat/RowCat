import type { ChatPersona, ChatStore } from "@rowcat/chat";

/**
 * Persona library mutations: ownership-checked combinations over the store port.
 *
 * These lived in the chat folder while the room picker was their only consumer. The library is an
 * account asset (`@rowcat/chat`'s `persona.ts`), not a child of a conversation, so the settings
 * screen imports from here and the chat folder imports from here too. Two copies would let the
 * ownership check drift on one side and land a write in the wrong member's database.
 *
 * Room operations (rename, delete, apply persona) stay in the chat folder; moving them here would
 * make this file the home of every local write.
 *
 * Each write re-asks ownership immediately before the store call and never swaps in the store of
 * the currently open scope: a mutation started on one account must not end in another account's
 * database. Membership is checked by store instance, not member id, because sign-out and sign-in of
 * the same member reopen a different connection.
 */

/** The store a mutation started on, and a predicate answering whether it still belongs to the current scope. */
export interface PersonaMutationScope {
	store: ChatStore;
	owns: (store: ChatStore) => boolean;
}

/**
 * `foreign` means the write did not happen because the scope changed, not that it failed. Reporting
 * it as an error would show a retry prompt that can never succeed; callers close silently on it.
 */
export type PersonaMutationOutcome =
	| { status: "done"; persona: ChatPersona }
	| { status: "foreign" };

export type PersonaWriteOutcome = "done" | "foreign";

export async function createManagedPersona(
	scope: PersonaMutationScope,
	input: { name: string; description: string },
): Promise<PersonaMutationOutcome> {
	if (!scope.owns(scope.store)) return { status: "foreign" };
	return { status: "done", persona: await scope.store.createPersona(input) };
}

export async function updateManagedPersona(
	scope: PersonaMutationScope,
	id: string,
	patch: { name: string; description: string },
): Promise<PersonaWriteOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.updatePersona(id, patch);
	return "done";
}

export async function deleteManagedPersona(
	scope: PersonaMutationScope,
	id: string,
): Promise<PersonaWriteOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	// Conversations are not touched. A room holds a copy of the persona's values
	// (`personaSnapshotOf`), not a reference to the library row, so there is nothing to walk and
	// nothing that should change when a library entry disappears.
	await scope.store.deletePersona(id);
	return "done";
}
