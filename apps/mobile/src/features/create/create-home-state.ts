import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";

/**
 * What the drafts tab draws now: a pure decision, outside components for the same reason as
 * `chat-library-state.ts`. Mistakes here are silent:
 *
 * ```text
 * "no works yet" while storage opens   → someone with a pile of manuscripts thinks they lost everything
 * read failure as zero rows            → same, with no way to retry
 * session check failure as guest       → pushes sign-in on someone who never signed out
 * ```
 *
 * Same rules as the conversation list with different vocabulary; no search, since this list is a
 * few hand-written manuscripts and a lookup axis would add chrome, not capability.
 *
 * Opposite of public screens: discovery and work detail do not wait for identity or SQLite, but
 * drafts live only in the per-member database, so this waits. Hence this folder is not in the
 * `publicSurface` list of `lib/boundaries.test.ts`.
 */

export type DraftListState =
	// Not known yet: checking the session or opening storage. Neutral wait.
	| { kind: "booting" }
	// Guest (the server answered so). Offer the way to sign in.
	| { kind: "guest" }
	// Session cannot be checked; this is not a sign-out. The task is to ask again.
	| { kind: "unavailable" }
	// Member confirmed but device storage did not open. Offer reopening the scope.
	| { kind: "storage-error" }
	// Storage opened but the list read failed. Offer retrying only that read.
	| { kind: "read-error" }
	// Storage opened and the list is being read.
	| { kind: "loading" }
	// This account has no drafts on this device.
	| { kind: "empty" }
	// There are rows to draw.
	| { kind: "list" };

export interface DraftListInput {
	phase: MobileAppPhase;
	drafts: {
		status: LocalLiveStatus;
		// Live drafts of this account.
		total: number;
	};
}

export function resolveDraftListState({
	phase,
	drafts,
}: DraftListInput): DraftListState {
	/**
	 * Identity and storage come first even if list results are already in: on an account switch there
	 * are renders where the previous member's drafts still sit in state, and that render would draw
	 * someone else's manuscript titles.
	 */
	if (phase === "guest") return { kind: "guest" };
	if (phase === "unavailable") return { kind: "unavailable" };
	if (phase === "local-error") return { kind: "storage-error" };
	if (phase !== "ready") return { kind: "booting" };

	/**
	 * Read failed. Draw held values if any: emptying an already-received list on a background refresh
	 * failure makes the user see their manuscripts vanish while storage is fine.
	 */
	if (drafts.status === "error" && drafts.total === 0)
		return { kind: "read-error" };
	// Still reading; not the same as zero rows.
	if (drafts.status === "loading") return { kind: "loading" };
	if (drafts.total === 0) return { kind: "empty" };
	return { kind: "list" };
}

/**
 * What the editor draws now. `missing` is separate from failure on purpose: a missing draft is not
 * an error (deleted, made on another device and not yet synced, or a hand-edited deep link), so the
 * screen says so and offers the way out to `/create`. Never create the missing draft: a wrong
 * address would mint a document the user never wrote.
 */
export type DraftEditorState =
	| { kind: "booting" }
	| { kind: "guest" }
	| { kind: "unavailable" }
	| { kind: "storage-error" }
	| { kind: "read-error" }
	| { kind: "loading" }
	// No such draft in this scope; not a failure.
	| { kind: "missing" }
	| { kind: "ready" };

export interface DraftEditorInput {
	phase: MobileAppPhase;
	draft: {
		status: LocalLiveStatus;
		// Whether a draft is currently held.
		found: boolean;
	};
}

export function resolveDraftEditorState({
	phase,
	draft,
}: DraftEditorInput): DraftEditorState {
	if (phase === "guest") return { kind: "guest" };
	if (phase === "unavailable") return { kind: "unavailable" };
	if (phase === "local-error") return { kind: "storage-error" };
	if (phase !== "ready") return { kind: "booting" };

	// With a held draft, a background refresh failure does not blank the screen.
	if (draft.found) return { kind: "ready" };
	if (draft.status === "error") return { kind: "read-error" };
	if (draft.status === "loading") return { kind: "loading" };
	return { kind: "missing" };
}
