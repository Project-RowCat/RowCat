import type {
	ChatStore,
	ChatToolImportWrites,
	ChatUserTool,
	CreateUserToolInput,
	UpdateUserToolPatch,
} from "@rowcat/chat";
import { useCallback } from "react";
import { useChatScope } from "#/lib/local-chat/scope.ts";

/**
 * The write path for the tool library and for a room's tool switches, for usePersonaLibrary's
 * reason: every write re-checks that the store is still the open scope's, so a save started on one
 * account's screen can never land in another account's database after a switch. Two screens call
 * these (the settings library and the room settings' tools view); one hook keeps that check in one
 * place.
 *
 * Returning null or nothing when the scope is gone is "did not happen", not a failure, the same
 * axis as the persona hook.
 */
export interface ToolLibraryMutations {
	/** Scope not open yet, or a guest. The forms are disabled. */
	ready: boolean;
	create: (input: CreateUserToolInput) => Promise<ChatUserTool | null>;
	update: (id: string, patch: UpdateUserToolPatch) => Promise<void>;
	remove: (id: string) => Promise<void>;
	/**
	 * Applies an import plan's writes (`chatToolImportWrites`). One store call per tool: the store has
	 * no batch write, and a partial import is recoverable (the screen says so and the library shows
	 * what arrived), while inventing a transaction here would bypass the store's own checks.
	 */
	applyImport: (writes: ChatToolImportWrites) => Promise<void>;
	/** Turns a tool on or off in one room; null returns it to the tool's default. */
	setRoomOverride: (
		roomId: string,
		toolId: string,
		enabled: boolean | null,
	) => Promise<void>;
}

export function useToolLibrary(): ToolLibraryMutations {
	const { store, ownsStore } = useChatScope();

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
			(input) => run((owner) => owner.createUserTool(input), null),
			[run],
		),
		update: useCallback(
			async (id, patch) => {
				await run((owner) => owner.updateUserTool(id, patch), undefined);
			},
			[run],
		),
		remove: useCallback(
			async (id) => {
				await run((owner) => owner.deleteUserTool(id), undefined);
			},
			[run],
		),
		applyImport: useCallback(
			async (writes) => {
				await run(async (owner) => {
					for (const input of writes.create) await owner.createUserTool(input);
					for (const { id, tool } of writes.replace)
						await owner.updateUserTool(id, { tool });
				}, undefined);
			},
			[run],
		),
		setRoomOverride: useCallback(
			async (roomId, toolId, enabled) => {
				await run(
					(owner) => owner.setRoomToolOverride(roomId, toolId, enabled),
					undefined,
				);
			},
			[run],
		),
	};
}
