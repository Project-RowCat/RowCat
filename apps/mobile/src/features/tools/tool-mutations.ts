import type {
	ChatStore,
	ChatToolImportWrites,
	ChatUserTool,
	CreateUserToolInput,
	UpdateUserToolPatch,
} from "@rowcat/chat";

/**
 * Tool library mutations: ownership-checked combinations over the store port, the persona
 * library's shape (`features/persona/persona-mutations.ts`) for its reasons.
 *
 * - Each write re-asks ownership immediately before the store call and never swaps in the store of
 *   the currently open scope: a mutation started on one account must not end in another account's
 *   database. Membership is checked by store instance, not member id, because sign-out and sign-in
 *   of the same member reopen a different connection.
 * - `foreign` means nothing happened because the viewer changed; callers close quietly on it.
 * - Turning a tool on or off **in one room** is a room write and stays with the other room writes
 *   (`setManagedRoomToolOverride` in `features/chat/room/mutations.ts`).
 */

export interface ToolMutationScope {
	store: ChatStore;
	owns: (store: ChatStore) => boolean;
}

export type ToolMutationOutcome =
	| { status: "done"; tool: ChatUserTool }
	| { status: "foreign" };

export type ToolWriteOutcome = "done" | "foreign";

export async function createManagedTool(
	scope: ToolMutationScope,
	input: CreateUserToolInput,
): Promise<ToolMutationOutcome> {
	if (!scope.owns(scope.store)) return { status: "foreign" };
	return { status: "done", tool: await scope.store.createUserTool(input) };
}

export async function updateManagedTool(
	scope: ToolMutationScope,
	id: string,
	patch: UpdateUserToolPatch,
): Promise<ToolWriteOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	await scope.store.updateUserTool(id, patch);
	return "done";
}

export async function deleteManagedTool(
	scope: ToolMutationScope,
	id: string,
): Promise<ToolWriteOutcome> {
	if (!scope.owns(scope.store)) return "foreign";
	// Rooms are not touched: an override naming this tool stays and is inert, because generation
	// reads only live tools (`activeUserTools`).
	await scope.store.deleteUserTool(id);
	return "done";
}

export type ToolImportOutcome =
	| { status: "done"; written: number }
	| { status: "foreign" };

/**
 * Applies an import (`chatToolImportWrites`). Each write is its own store call, so this is **not
 * atomic**: a failure halfway leaves the tools before it written. That is accepted because every
 * write is complete on its own (a whole tool, created or replaced), and the importer can read the
 * library to see what arrived; a half-written tool cannot exist.
 *
 * Ownership is re-asked before **each** write, not once: an account switch in the middle of a long
 * import must stop the rest from landing in the next member's library.
 */
export async function applyManagedToolImport(
	scope: ToolMutationScope,
	writes: ChatToolImportWrites,
): Promise<ToolImportOutcome> {
	let written = 0;
	for (const input of writes.create) {
		if (!scope.owns(scope.store)) return { status: "foreign" };
		await scope.store.createUserTool(input);
		written += 1;
	}
	for (const { id, tool } of writes.replace) {
		if (!scope.owns(scope.store)) return { status: "foreign" };
		// The definition only: the importer's own on/off choice for that tool stays theirs.
		await scope.store.updateUserTool(id, { tool });
		written += 1;
	}
	return { status: "done", written };
}
