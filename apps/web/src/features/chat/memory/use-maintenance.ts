import type {
	ChatMaintenancePlan,
	ChatRoom,
	ChatStore,
	MemoryMaintenancePort,
} from "@rowcat/chat";
import { MemoryMaintenanceScheduler, runMemoryMaintenance } from "@rowcat/chat";
import { useCallback, useRef } from "react";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useUtilityGeneration } from "../utility-generation.ts";

/**
 * Wiring for automatic maintenance. The rules live in `@rowcat/chat`.
 *
 * This file does three things only: fills the port (four store methods and one transport), fixes
 * the ownership axis, and calls the runner past the per-room gate. Ordering, failure handling,
 * validation and frontier advancement are not written here. Mobile must follow the same rules, and
 * per-app copies would diverge in ways that reproduce on one side only (`maintenance-runner.ts`).
 *
 * ## The transport is not this file's
 *
 * Target resolution, connection checks and credentials belong to `useUtilityGeneration`. This
 * wiring used to live here, and once reply suggestions arrived the **same rule** would exist twice.
 * If one copy forgets the connection list, only that room's BYO request silently goes out as
 * managed, and what then reaches the server is a conversation the person chose not to send. The
 * rule has one home.
 *
 * ## Why a hook
 *
 * Every value it needs is in the scope: store, viewer and transport. A pure function taking them as
 * arguments would make each caller re-wire them, and once that wiring exists in two places one of
 * them omits something.
 *
 * ## Not here
 *
 * - **Screen state.** Maintenance is not something the user started, and it has no progress
 *   indicator or failure copy. The absence of any `useState` is the expression of that.
 * - **Scheduling.** "When it runs" is the moment an assistant response is saved, and that trigger
 *   lives on the conversation port (`ConversationSession.maintain`). A timer here would fire
 *   requests from an idle tab.
 * - **`syncNow()`.** The commit creates dirty records, and the write signal wrapped at the
 *   assembly point wakes automatic sync. This hook does not know about sync.
 */

/**
 * The per-room gate is **module-global.**
 *
 * With a `useRef` inside the hook, the gate would be per component instance, so when the same room
 * is opened by **two components in one tab** (the conversation screen and some preview), two
 * maintenance runs would go side by side. Rooms are keyed by id, so a global gate still does not
 * block one room from another.
 *
 * The map is not cleared on a viewer change. It holds only the promises still running, and each of
 * those is rejected at its own ownership check (`isValid`). A clearing step would only tidy entries
 * that are already harmless, and it would add a race where an entry is removed while in use during
 * an account switch.
 */
const scheduler = new MemoryMaintenanceScheduler();

/**
 * Wakes this room's maintenance. Does nothing if the room or the store is missing.
 *
 * Returning `void` is half of the contract (`ConversationSession.maintain`). Give it an awaitable
 * value and someone eventually adds `await`, and that one word inserts a paid call between the
 * assistant's response and the next input.
 */
export function useMemoryMaintenance(room: ChatRoom | null): () => void {
	const { store, viewerId } = useChatScope();
	const requestUtility = useUtilityGeneration();

	/**
	 * The ownership axis is **fixed in a ref.**
	 *
	 * Maintenance takes seconds from start to finish, and the account can change in that window.
	 * Capturing the start-time value in the closure and reading the current value from the ref lets
	 * the two be compared. Comparing with render state would not work: that value is frozen into the
	 * render in which the callback was created, so it always equals itself.
	 */
	const currentRef = useRef<{
		store: ChatStore | null;
		viewerId: string | null;
	}>({ store, viewerId });
	currentRef.current = { store, viewerId };

	return useCallback(() => {
		const roomId = room?.id;
		if (!roomId || !store) return;

		/** The identity at start. It is compared with the current value just before commit. */
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
					/**
					 * Collects the whole stream into one string. The transport is the shared channel's job
					 * (`utility-generation.ts`). A blocked target throws there, and the runner folds that into a
					 * best-effort failure.
					 */
					requestMaintenance: (request, signal) =>
						requestUtility(roomId, request, signal),
					commit: (plan: ChatMaintenancePlan) =>
						store.applyMemoryMaintenance({ ...plan, roomId }),
					isValid,
				};

				return runMemoryMaintenance(port);
			})
			/**
			 * Swallowed. The runner does not throw, but the gate itself can (the same room's run was
			 * rejected), and an exception leaking out here would surface above a conversation turn that
			 * already succeeded.
			 */
			.catch(() => undefined);
	}, [room?.id, store, viewerId, requestUtility]);
}
