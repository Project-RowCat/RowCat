import type {
	ChatMaintenancePlan,
	ChatStore,
	MemoryMaintenancePort,
} from "@rowcat/chat";
import { MemoryMaintenanceScheduler, runMemoryMaintenance } from "@rowcat/chat";
import { useCallback, useRef } from "react";
import { useUtilityGeneration } from "../utility-generation.ts";

/**
 * Wiring for auto-maintenance. The rules live in `@rowcat/chat`; the web file of the same name
 * differs only in scope-hook name and import path. Ordering, validation, frontier advance and
 * failure handling must not appear here, or the apps diverge in one of them only.
 *
 * Transport is not this file's: target resolution, connection checks and credentials belong to
 * `useUtilityGeneration`. Duplicating that rule risks a room whose turns run on the user's own
 * Anthropic key while maintenance silently goes to RowCat managed, sending that room's conversation
 * to the server and changing who is billed.
 *
 * Not here:
 * - Screen state: maintenance is not user-initiated, so no progress indicator or failure copy.
 * - Scheduling: the trigger is the assistant response being saved, owned by the conversation
 *   port.
 * - `syncNow()`: the commit makes dirty records and the write signal wakes auto-sync (a static
 *   scan guards its absence).
 */

/**
 * Per-room gate, deliberately module-global. As a hook `useRef` there would be one gate per
 * component instance, and a remount (tab switch, deep-link return) would run two maintenances at
 * once. It is keyed by room id, so rooms do not block each other.
 */
const scheduler = new MemoryMaintenanceScheduler();

export interface MemoryMaintenanceInput {
	/** With no room, the returned function does nothing. */
	roomId: string | null;
	/** Both an axis of the ownership check and the commit target. */
	store: ChatStore | null;
	/** `null` for guests and during account switches. */
	viewerId: string | null;
}

/**
 * Returns the function that wakes this room's maintenance. It returns `void` on purpose
 * (`ConversationSession.maintain`): an awaitable value invites an `await`, which would put a paid
 * call between the assistant response and the next input.
 */
export function useMemoryMaintenance(
	input: MemoryMaintenanceInput,
): () => void {
	const { roomId, store, viewerId } = input;
	const requestUtility = useUtilityGeneration();

	/**
	 * Ownership is pinned in a ref. Maintenance takes seconds and the account can change meanwhile:
	 * the start-time value lives in the closure and is compared with the ref's current one. Render
	 * state would be frozen at the render that created the callback and always equal itself.
	 */
	const currentRef = useRef<{
		store: ChatStore | null;
		viewerId: string | null;
	}>({ store, viewerId });
	currentRef.current = { store, viewerId };

	return useCallback(() => {
		if (!roomId || !store) return;

		const owner = { store, viewerId };
		const isValid = (): boolean =>
			currentRef.current.store === owner.store &&
			currentRef.current.viewerId === owner.viewerId;

		void scheduler
			.run(roomId, async () => {
				const port: MemoryMaintenancePort = {
					loadMessages: () => store.listAllMessages(roomId),
					loadSummary: () => store.getSummary(roomId),
					loadMemories: () => store.listMemories(roomId),
					// Stream collection lives in `utility-generation.ts`; a blocked target throws there and the
					// runner folds it into a best-effort failure.
					requestMaintenance: (request, signal) =>
						requestUtility(roomId, request, signal),
					commit: (plan: ChatMaintenancePlan) =>
						store.applyMemoryMaintenance({ ...plan, roomId }),
					isValid,
				};

				return runMemoryMaintenance(port);
			})
			// The runner does not throw but the gate can; a leaked exception would surface over an
			// already-successful conversation turn.
			.catch(() => undefined);
	}, [roomId, store, viewerId, requestUtility]);
}
