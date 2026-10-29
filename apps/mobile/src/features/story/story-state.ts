import type { Story } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";
import type { PublicSurfaceContext } from "../discover/discover-state.ts";

/**
 * What the work detail draws right now.
 *
 * The discovery screen's **same rule** applies here: identity and device storage are inputs but are
 * not used in the decision (the header of `discover-state.ts` gives the reason). This slice's
 * detail screen draws only public metadata and performs no local action, so it must be viewable on
 * a device whose SQLite has not opened.
 *
 * ## A 404 does **not** say why
 *
 * The server returns **the same 404** for a missing work and for one the viewer cannot see
 * (private, blocked, adult gate, operator-hidden). Distinguishing them would make the response
 * itself an answer to "does this work exist?", and anyone walking through ids could check other
 * people's private lists. If the screen guessed the reason, it would undo the boundary the server
 * keeps — all we know is "not a work available to this person right now".
 *
 * So this type has no field such as `private`, `adult`, `blocked` or `hidden`. Careful wording is
 * not enough: once a field exists, someone eventually fills it.
 */

export interface StoryQuerySnapshot {
	status: "pending" | "success" | "error";
	/** `fetchStatus === "paused"` — offline, so retries have stopped (`status` is still pending). */
	paused: boolean;
	error: unknown;
	/** The work we have. A successful response with no data never occurs, but the type does not know that (see below). */
	data: Story | undefined;
}

export interface StoryStateInputs {
	/** Identity and device storage. **Not read** (see above). */
	context: PublicSurfaceContext;
	story: StoryQuerySnapshot;
}

/**
 * ```text
 * loading   the first fetch is still running
 * offline   there is no network, so retries have stopped
 * missing   the server answered 404 — **we do not know why**
 * failed    any other failure. The request id, if present, is the only clue the user can bring along
 * story     draw the work
 * ```
 *
 * The point of this type is that the `story` branch **carries the work**. If the screen pulled it
 * back out of the query result, it would need an assertion like `as Story` (the type cannot express
 * "success means a value exists"), and an assertion stays silent when that invariant later breaks.
 * Narrowing once here means the screen only ever receives the narrowed value.
 */
export type StoryState =
	| { kind: "loading" }
	| { kind: "offline" }
	| { kind: "missing" }
	| { kind: "failed"; requestId: string | null }
	| { kind: "story"; story: Story };

export function resolveStoryState(inputs: StoryStateInputs): StoryState {
	const { status, paused, error, data } = inputs.story;

	// Success comes first — if a background refresh fails, the work we already have is still drawn.
	if (status === "success" && data) return { kind: "story", story: data };

	if (status === "error") {
		const apiError = isRowCatApiError(error) ? error : null;
		if (apiError?.status === 404) return { kind: "missing" };
		/**
		 * Carries neither the response body nor the stack (the server does not put them in the response
		 * either). Only the request id is kept, because it is the one clue the user can bring along in a
		 * screenshot.
		 */
		return { kind: "failed", requestId: apiError?.requestId ?? null };
	}

	return paused ? { kind: "offline" } : { kind: "loading" };
}
