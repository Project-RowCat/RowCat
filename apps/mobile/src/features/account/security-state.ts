import type { AccountSession } from "@rowcat/domain";
import { needsRecentLogin } from "./security-error.ts";

/**
 * Rules for what the security section draws, kept pure so the ordering is testable without
 * rendering. Wrong order fails silently:
 * - pause after loading: offline users see a placeholder that never ends
 * - failure drawn as an empty list: asserts "no other device ever signed in"
 * - fresh-session requirement drawn as failure: a `Try again` button that gets the same answer
 *
 * The last matters most: Better Auth requires a fresh session for session listing and method
 * unlinking, and our sessions last 30 days, so for long-signed-in users it is the normal path.
 */

/** Only the query axes read here, so tests need no library. */
export interface SecurityListQueryView {
	/** Retries paused for no network (`fetchStatus: "paused"`). */
	isPaused: boolean;
	isError: boolean;
	error: unknown;
	hasData: boolean;
}

/**
 * `recent_login` is separate from `error`: same place and shape, but a different sentence and no
 * retry button.
 */
export type SecurityListState =
	| "offline"
	| "recent_login"
	| "error"
	| "loading"
	| "ready";

export interface SecurityListView {
	state: SecurityListState;
	/**
	 * A held value is drawn but the last refresh failed or paused: keep the value and add only a
	 * staleness line and retry; never draw a stale value as current.
	 */
	retryable: boolean;
}

/**
 * Order is the whole function: held value -> paused -> recent login -> error -> loading. A held
 * value comes first so a failed background refresh does not erase the list (the user would read it
 * as sessions or passkeys having vanished).
 */
export function securityListView(q: SecurityListQueryView): SecurityListView {
	if (q.hasData) return { state: "ready", retryable: q.isError || q.isPaused };
	// Paused is still `isPending`, so placing it after failure/loading makes an endless load.
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError)
		return needsRecentLogin(q.error)
			? // Nothing to retry: asking again with the same session gets the same answer.
				{ state: "recent_login", retryable: false }
			: { state: "error", retryable: true };
	return { state: "loading", retryable: false };
}

/**
 * Other devices drawn initially. The current device is always visible regardless of this cap;
 * showing all would push the rest of the account screen off-screen.
 */
export const VISIBLE_OTHER_SESSIONS = 4;

export interface SessionListView {
	/** Rows to draw; always includes the current device if present. */
	rows: AccountSession[];
	/** Other devices hidden by folding; 0 means no `Show more`. */
	hidden: number;
	/** Total other devices; the count `Sign out all other devices` uses. */
	others: number;
}

/**
 * Always keeps the current device and trims only other devices (trimming from the front could cut
 * the current device if server ordering changes, leaving the user revoking others' rows without
 * finding their own). No server pagination: the revoke-all count must be the total, and a cursor
 * cannot give it. Expansion is pure display state.
 */
export function sessionListView(input: {
	sessions: readonly AccountSession[];
	expanded: boolean;
}): SessionListView {
	const others = input.sessions.filter((session) => !session.current);
	if (input.expanded)
		return { rows: [...input.sessions], hidden: 0, others: others.length };

	const shown = new Set(others.slice(0, VISIBLE_OTHER_SESSIONS));
	return {
		rows: input.sessions.filter(
			(session) => session.current || shown.has(session),
		),
		hidden: Math.max(0, others.length - VISIBLE_OTHER_SESSIONS),
		others: others.length,
	};
}
