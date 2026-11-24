import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";

/**
 * What the tool library draws right now: a pure decision, the persona library's
 * (`features/persona/persona-library-state.ts`) with the same order and for the same reasons.
 *
 * Identity and storage come first, even with a list in hand: right after an account switch the
 * previous member's tools can still be in state, and drawing them would show another person's tools
 * (and their endpoints). A read still in flight is not zero tools, and a failed refresh with a list
 * already held keeps drawing that list.
 */

export type ToolLibraryState =
	| { kind: "booting" }
	| { kind: "guest" }
	/** The session cannot be checked: this is not a sign-out. */
	| { kind: "unavailable" }
	| { kind: "storage-error" }
	| { kind: "read-error" }
	| { kind: "loading" }
	| { kind: "empty" }
	| { kind: "list" };

export interface ToolLibraryInput {
	phase: MobileAppPhase;
	tools: { status: LocalLiveStatus; total: number };
}

export function resolveToolLibraryState({
	phase,
	tools,
}: ToolLibraryInput): ToolLibraryState {
	if (phase === "guest") return { kind: "guest" };
	if (phase === "unavailable") return { kind: "unavailable" };
	if (phase === "local-error") return { kind: "storage-error" };
	if (phase !== "ready") return { kind: "booting" };
	if (tools.status === "error" && tools.total === 0)
		return { kind: "read-error" };
	if (tools.status === "loading") return { kind: "loading" };
	if (tools.total === 0) return { kind: "empty" };
	return { kind: "list" };
}
