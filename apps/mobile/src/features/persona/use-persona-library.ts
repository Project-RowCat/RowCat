import type { ChatPersona, ChatStore } from "@rowcat/chat";
import { useCallback, useMemo, useState } from "react";
import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import { useChatScope } from "../../lib/local-data/scope.tsx";
import { useLocalPersonas } from "../../lib/local-data/use-personas.ts";
import {
	createManagedPersona,
	deleteManagedPersona,
	type PersonaWriteOutcome,
	updateManagedPersona,
} from "./persona-mutations.ts";

/**
 * Owner of the persona library's writes: one list plus three write operations.
 *
 * Screens never hold `ChatStore` directly. If each row touched the store, ownership checks would
 * multiply per row and one missed check would land a write from Alice's screen in Bob's database.
 *
 * Ownership is re-asked right before each write. The store instance captured when the operation
 * starts goes into the pure combinator (`persona-mutations.ts`), which asks whether it still
 * belongs to the current scope. The open scope is never swapped in. Identity is the instance, not
 * the member id, because sign-out and sign-in of the same member reopen a different connection.
 *
 * `foreign` is not a failure. Mapping it to an error would show a retry prompt that gets the same
 * answer; callers close silently instead, since the viewer has already changed.
 *
 * Local writes emit the write signal that automatic sync listens to (`lib/local-data/stores.ts`).
 * There is no direct sync call here; a second run path beside the coordinator would be a second
 * source of truth for when sync happens. A static scan guards that.
 */

export interface PersonaLibrary {
	personas: ChatPersona[];
	status: LocalLiveStatus;
	/** The owner of this list: the store instance, not the member id. */
	store: ChatStore | null;
	/** Whether a write is in flight. A second submit in the same tick is rejected by the hook's lock. */
	pending: boolean;
	create: (input: {
		name: string;
		description: string;
	}) => Promise<PersonaWriteOutcome>;
	update: (
		id: string,
		patch: { name: string; description: string },
	) => Promise<PersonaWriteOutcome>;
	remove: (id: string) => Promise<PersonaWriteOutcome>;
}

export function usePersonaLibrary(): PersonaLibrary {
	const { value: personas, status, store } = useLocalPersonas();
	const { ownsStore } = useChatScope();
	const [pending, setPending] = useState(false);

	// The store and ownership predicate captured when the write starts, passed to the pure combinator
	// as-is. With no store (guest or still opening) no write starts at all.
	const run = useCallback(
		async (
			task: (scope: {
				store: ChatStore;
				owns: (s: ChatStore) => boolean;
			}) => Promise<PersonaWriteOutcome>,
		): Promise<PersonaWriteOutcome> => {
			if (!store) return "foreign";
			setPending(true);
			try {
				return await task({ store, owns: ownsStore });
			} finally {
				setPending(false);
			}
		},
		[store, ownsStore],
	);

	return useMemo(
		() => ({
			personas,
			status,
			store,
			pending,
			create: (input) =>
				run(async (scope) => {
					const outcome = await createManagedPersona(scope, input);
					return outcome.status === "done" ? "done" : "foreign";
				}),
			update: (id, patch) =>
				run((scope) => updateManagedPersona(scope, id, patch)),
			// Rooms are not scanned: they hold a copy of the values, not a reference to the library row, so
			// deletion cannot change the speaker of a conversation already in progress.
			remove: (id) => run((scope) => deleteManagedPersona(scope, id)),
		}),
		[personas, status, store, pending, run],
	);
}
