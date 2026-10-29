import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import type { MobileAppPhase } from "../../lib/session-state.ts";

/**
 * What the persona library draws right now: a **pure decision**.
 *
 * It sits in the same place and for the same reason as the conversation list
 * (`chat-library-state.ts`). Stacking conditions inside a component makes the order impossible to
 * check without rendering, and a mistake here always fails silently:
 *
 * ```text
 * storage still opening, yet "no saved personas"   the user reads their role as gone
 * a read failure counted as zero                    the same, with no way to retry
 * a session-check failure treated as guest          sign-in is pushed on someone who never signed out
 * ```
 *
 * What this screen draws lives **only in the per-member database**, so its rules are the opposite
 * of the public screens: it **waits** for the identity and SQLite.
 */

export type PersonaLibraryState =
	/** Not known yet: the session is being checked or the storage is opening. Neutral wait. */
	| { kind: "booting" }
	| { kind: "guest" }
	/** The session **cannot be checked**: this is not a sign-out. */
	| { kind: "unavailable" }
	/** The member is confirmed but the device storage will not open. Offers a way to reopen the scope. */
	| { kind: "storage-error" }
	/** Storage opened but reading the list failed. */
	| { kind: "read-error" }
	/** Storage opened and the list is being read. */
	| { kind: "loading" }
	/** This account has no roles saved on this device. */
	| { kind: "empty" }
	/** There are rows to draw. */
	| { kind: "list" };

export interface PersonaLibraryInput {
	phase: MobileAppPhase;
	personas: { status: LocalLiveStatus; total: number };
}

export function resolvePersonaLibraryState({
	phase,
	personas,
}: PersonaLibraryInput): PersonaLibraryState {
	/**
	 * Identity and storage come **first**, even when list results are already present. There is a real
	 * render where the account has just changed and the previous member's roles are still in state,
	 * and that render would draw another person's persona names.
	 */
	if (phase === "guest") return { kind: "guest" };
	if (phase === "unavailable") return { kind: "unavailable" };
	if (phase === "local-error") return { kind: "storage-error" };
	if (phase !== "ready") return { kind: "booting" };

	/**
	 * The read failed. **If a value is held, draw it**: a failed background refresh that empties the
	 * list already received would show the user their roles gone even though the storage is fine.
	 */
	if (personas.status === "error" && personas.total === 0)
		return { kind: "read-error" };

	/** Still reading: **this is different from zero rows.** */
	if (personas.status === "loading") return { kind: "loading" };

	if (personas.total === 0) return { kind: "empty" };
	return { kind: "list" };
}
