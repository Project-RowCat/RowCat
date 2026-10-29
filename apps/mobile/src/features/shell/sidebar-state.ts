import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";

/**
 * What the drawer's **recent chats section** draws right now — a pure judgment.
 *
 * The conditions are not stacked inside the component, because this app's tests do not render React
 * (`chat-library-state.ts` sits in the same place). When this is wrong, the symptoms are all
 * silent:
 *
 * ```text
 * store still opening, shows "No conversations yet"     → the user reads their chats as deleted
 * read failure folded into an empty list              → same, and there is no way to retry
 * guest sees a placeholder forever                     → there is no store to open, so it never finishes
 * store not opened, drawer shown as an error           → the route to discover disappears too
 * ```
 *
 * ## The last line is the most important judgment in this slice
 *
 * **The drawer must stay usable even if this section fails.** The global navigation (`Discover`, `Conversations`)
 * needs only the server and the router, not this device's SQLite. The chat list screen is
 * different: it draws only that store, so a store failure is its whole screen. That is why the
 * vocabulary below has no "drawer unusable" cell.
 */

export type SidebarRecentState =
	/**
	 * The section itself is not drawn — the user is a guest, or the session cannot be confirmed.
	 *
	 * Not a placeholder, because a placeholder would **never finish**: with no store to open, loading
	 * stays loading. The route to conversations is already the `Conversations` in the global navigation above,
	 * and the reason the list cannot be opened is said by that screen (`/chats`). The drawer does not
	 * repeat that explanation.
	 */
	| { kind: "hidden" }
	/** The session or the store is not confirmed yet. **Not the same as empty.** */
	| { kind: "loading" }
	/**
	 * The store failed to open or the list read failed — **conversations have not disappeared.**
	 *
	 * Not drawn as an empty list: "No conversations yet" asserts a fact, and saying it about something we could
	 * not confirm would make the user read that their chats are gone.
	 */
	| { kind: "error" }
	/** This account has no conversations on this device. */
	| { kind: "empty" }
	/** There are rows to draw. */
	| { kind: "rooms" };

export interface SidebarRecentInput {
	phase: MobileAppPhase;
	rooms: {
		status: LocalLiveStatus;
		/** This account's live conversation count, **before** the cut to recent rows. */
		total: number;
	};
}

export function resolveSidebarRecentState({
	phase,
	rooms,
}: SidebarRecentInput): SidebarRecentState {
	/**
	 * Identity and store come **first**, even if a list result is already in. When the account
	 * changes, the previous member's rooms can still be in state for a render, and that render would
	 * draw another person's conversation titles in the drawer.
	 */
	if (phase === "guest" || phase === "unavailable") return { kind: "hidden" };
	if (phase === "local-error") return { kind: "error" };
	if (phase !== "ready") return { kind: "loading" };

	/**
	 * **Keep the held value.** When a background refresh fails, emptying the list already fetched
	 * would make the user see their conversations vanish even though the store is fine (the same axis
	 * as `live.ts` not clearing a value). Report the failure only when nothing is held.
	 */
	if (rooms.status === "error" && rooms.total === 0) return { kind: "error" };

	if (rooms.status === "loading") return { kind: "loading" };
	if (rooms.total === 0) return { kind: "empty" };
	return { kind: "rooms" };
}
