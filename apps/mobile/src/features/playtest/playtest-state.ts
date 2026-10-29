import type { ConversationAuthoringMode } from "@rowcat/authoring";
import type { MobileAppPhase } from "../../lib/session-state.ts";

/**
 * What the playtest screen draws right now — **a pure decision.**
 *
 * It sits on the same axis as `create-home-state.ts` and `chat-state.ts`, and it is kept out of the
 * component for the same reason. This app's tests do not render screens (`vitest.config.ts`), so a
 * decision inside a component could only be checked by trying it by hand. The symptoms of getting
 * it wrong are all silent:
 *
 * ```text
 * store still opening, yet "this draft is not in this account"  → the creator thinks their manuscript is gone
 * session check failed, shown as guest                          → shows a login prompt to someone who never signed out
 * still reading, shown as missing                               → someone arriving by deep link sees an empty screen every time
 * ```
 *
 * ## The opposite of the public screens
 *
 * Discover and story detail do not wait for identity or SQLite, but drafts exist **only in the
 * per-member database**, so this screen waits. That is why this folder is not in the
 * `publicSurface` list of `lib/boundaries.test.ts` (same as the conversation screen).
 */

/** Current state of reading one draft — answered by the hook (`use-playtest-bootstrap.ts`). */
export type PlaytestSourceStatus =
	/** Scope still opening, or the draft still being read. Differs from `missing`. */
	| "loading"
	/** This device's account has no such draft. Not a failure. */
	| "missing"
	| "ready";

export type PlaytestScreenState =
	/** Not known yet: checking the session or opening storage. Neutral wait. */
	| { kind: "booting" }
	/** Guest — the server answered so. Gives a path to log in. */
	| { kind: "guest" }
	/** The session could not be checked. This is not a sign-out; the job is to ask again. */
	| { kind: "unavailable" }
	/** Identity is confirmed but device storage did not open. Gives a path to reopen the scope. */
	| { kind: "storage-error" }
	/** Storage is open and the draft is being read. */
	| { kind: "loading" }
	/** This scope has no such draft. Gives a way out — it does **not** create one. */
	| { kind: "missing" }
	/**
	 * The draft has the runtime turned on — **there is nothing to test in a conversation in this
	 * app.**
	 *
	 * Not a failure. With the runtime on, the four conversation-material sections lock
	 * (`resolveConversationAuthoringMode`), so a conversation started from that draft has no opening
	 * and no prompt, and the screen is an **empty conversation**. That screen was drawn once, and
	 * nothing on screen said why — the fact that there is nothing to test raises no error.
	 *
	 * The web runs code here (`features/playtest/runtime-playtest.tsx`). This app cannot: it is the
	 * play side, with no compiler and no studio (`lib/boundaries.test.ts` pins that absence), so there
	 * is no way to build an artifact from the draft's source. What this screen does is state that
	 * fact.
	 */
	| { kind: "runtime" }
	| { kind: "ready" };

export function resolvePlaytestScreenState({
	phase,
	source,
	authoring,
}: {
	phase: MobileAppPhase;
	source: PlaytestSourceStatus;
	/**
	 * The draft's execution model. It takes the **same decision** that locks the conversation-material
	 * sections (`resolveConversationAuthoringMode`) rather than reading `project.enabled` again: a
	 * state where the locked sections and this screen give different answers must not be
	 * representable.
	 */
	authoring: ConversationAuthoringMode;
}): PlaytestScreenState {
	/**
	 * Identity and storage come **first**, even when a read result is already present. At the moment
	 * an account changes there is a real render where the previous member's draft is still in state,
	 * and that render would show someone else's manuscript.
	 */
	if (phase === "guest") return { kind: "guest" };
	if (phase === "unavailable") return { kind: "unavailable" };
	if (phase === "local-error") return { kind: "storage-error" };
	if (phase !== "ready") return { kind: "booting" };

	if (source === "loading") return { kind: "loading" };
	if (source === "missing") return { kind: "missing" };
	/**
	 * A missing draft comes **first**. Describing the execution model of a draft not read yet would
	 * describe a document that does not exist, and that screen would have no way out.
	 *
	 * Conversely, while it is still unknown (`pending`) neither branch is drawn. Folding into
	 * conversation would draw an empty conversation for one frame on a runtime draft, and that frame
	 * is exactly the screen this branch exists to remove.
	 */
	if (authoring === "pending") return { kind: "loading" };
	if (authoring === "locked") return { kind: "runtime" };
	return { kind: "ready" };
}
