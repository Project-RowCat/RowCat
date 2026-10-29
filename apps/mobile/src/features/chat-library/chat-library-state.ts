import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";

/**
 * What the conversation list draws now. This is a pure decision, kept out of the component because
 * this app's tests do not render React. Every wrong answer here is silent:
 * - Showing 'no conversations yet' while storage is still opening makes the user read it as
 *   conversations having vanished.
 * - Treating a read failure as zero rows gives no way to retry.
 * - Treating zero search hits as the first-visit empty state shows `Discover stories` after one typo.
 * - Treating a session-check failure as guest pushes sign-in on someone who never signed out.
 *
 * Same axis as the conversation screen's state file (`features/chat/chat-state.ts`), but the
 * opposite of the public screens: the data lives only in the per-member database, so these files
 * are not in `lib/boundaries.test.ts`'s `publicSurface` list.
 */

export type ChatLibraryState =
	/** Not known yet: checking the session or opening storage. Neutral wait. */
	| { kind: "booting" }
	/** A guest (the server answered so); conversations are a member's, so offer sign-in. */
	| { kind: "guest" }
	/** The session cannot be confirmed; not signed out. */
	| { kind: "unavailable" }
	/** Member confirmed but device storage did not open; offer reopening the scope. */
	| { kind: "storage-error" }
	/** Storage opened but the list read failed; offer retrying that read only. */
	| { kind: "read-error" }
	/** Storage opened and the list is being read. */
	| { kind: "loading" }
	/** No conversation at all for this account on this device. */
	| { kind: "empty" }
	/** Conversations exist but search matched none; a different screen from the above. */
	| { kind: "search-empty" }
	/** There are rows to draw. */
	| { kind: "list" };

export interface ChatLibraryInput {
	phase: MobileAppPhase;
	rooms: {
		status: LocalLiveStatus;
		/** Live conversations of this account, before search. */
		total: number;
		/** Count passing search. */
		matched: number;
		/** Whether a query is actually applied (after normalization). */
		searching: boolean;
	};
}

export function resolveChatLibraryState({
	phase,
	rooms,
}: ChatLibraryInput): ChatLibraryState {
	/**
	 * Identity and storage come first even if list results already arrived: on an account switch there
	 * is a real render where the previous member's rooms are still in state, and it would draw someone
	 * else's titles (the one frame before the new scope's subscription answers).
	 */
	if (phase === "guest") return { kind: "guest" };
	if (phase === "unavailable") return { kind: "unavailable" };
	if (phase === "local-error") return { kind: "storage-error" };
	if (phase !== "ready") return { kind: "booting" };

	/**
	 * Read failed. If a value is held, draw it: emptying an already-received list on a failed
	 * background refresh makes conversations look gone while storage is fine (same as `live.ts`
	 * keeping values). Only with nothing held do we state the failure.
	 */
	if (rooms.status === "error" && rooms.total === 0)
		return { kind: "read-error" };

	/** Still reading, which is not 0 rows; merged, people with conversations flash "no conversations yet" on every open. */
	if (rooms.status === "loading") return { kind: "loading" };

	/** No conversations at all wins even with a query: "no search results" explains nothing to someone with no rooms (same order as the web). */
	if (rooms.total === 0) return { kind: "empty" };

	if (rooms.searching && rooms.matched === 0) return { kind: "search-empty" };
	return { kind: "list" };
}
