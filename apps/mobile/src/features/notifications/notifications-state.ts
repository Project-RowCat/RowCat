import type { SessionPhase } from "../../lib/session-state.ts";

/**
 * Decides what the notifications screen draws, as pure functions. The order and reasons match the
 * web's `notifications-state.ts`. A chain of `if`s inside a component cannot be checked without
 * rendering, and a wrong order fails silently:
 *
 * ```text
 * pause checked after loading   an offline user sees a placeholder that never ends
 *                               (a paused query still reports `isPending`)
 * failure checked after empty   a failed query shows "no notifications yet"
 * ```
 *
 * The failure ordering is the more dangerous one. A failure means "unknown", not "zero". Someone
 * waiting for a sanction or appeal result would see an empty inbox after one network error, which
 * reads as if we never sent it.
 *
 * ## Held values are kept
 *
 * Pause and failure take over the screen only when nothing is held. If rows are already loaded,
 * they stay on screen, with a retry path (`retryable`). An empty inbox is also a held value: a
 * refresh that fails after the server returned 0 is `empty + retryable`, not `error`.
 *
 * ## Identity is an input; device storage is not
 *
 * Notifications are server-owned private state, so the request is sent only once the member is
 * confirmed. A guest request returns 401, which would show "failed to load" and hide the fact that
 * login is required. Device storage has nothing to do with this screen. Gating on
 * `useMobileAppPhase` (session plus SQLite) would kill the inbox on any device where storage fails
 * to open, which is why the input is `SessionPhase`.
 */

/** What the member's inbox draws right now. */
export type NotificationPanelState =
	/** No connection and nothing held. Stated as waiting, not as an error. */
	| "offline"
	/** The query failed and nothing is held. */
	| "error"
	/** The first fetch is still running. */
	| "loading"
	/** The server answered with a successful empty list. It must be distinguished from a failure. */
	| "empty"
	/** There are rows to draw. */
	| "ready";

/**
 * Reads only the query axes the rules need. The whole `UseInfiniteQueryResult` is not passed in:
 * this keeps the rules testable without the library, and the axes actually used show up in the
 * type.
 */
export interface NotificationQueryView {
	/** TanStack Query has stopped retrying because it judged there is no network (`fetchStatus: "paused"`). */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	/** Whether any page holds data. */
	hasData: boolean;
	/** Number of rows accumulated. */
	itemCount: number;
}

export interface NotificationPanelView {
	state: NotificationPanelState;
	/**
	 * Whether the last refresh failed or was interrupted while data is still shown. It lets the screen
	 * keep the list and add only a retry action, instead of replacing the list.
	 */
	retryable: boolean;
}

/**
 * Query state → what to draw. The order is the whole function: held value → pause → failure →
 * loading → empty.
 */
export function notificationPanelView(
	q: NotificationQueryView,
): NotificationPanelView {
	if (q.hasData)
		return {
			state: q.itemCount === 0 ? "empty" : "ready",
			retryable: q.isError || q.isPaused,
		};
	/**
	 * Pause is checked before failure. The two need different actions: a pause waits, while a failure
	 * needs a press. A paused query still reports `isPending`, so checking it after loading would read
	 * as loading forever.
	 */
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	/** The query finished with nothing accumulated (for example, a cancelled query). Folded to empty. */
	return { state: "empty", retryable: false };
}

/** What the whole screen draws: three identity branches, with the member's inbox on top of them. */
export type NotificationsScreenState =
	/** Identity is not known yet. A neutral wait; no guest prompt is drawn, even for one frame. */
	| { kind: "booting" }
	| { kind: "guest" }
	/** The session cannot be verified. Not a guest, and no login button is drawn. */
	| { kind: "unavailable" }
	| { kind: "panel"; panel: NotificationPanelView };

export function resolveNotificationsScreenState(
	phase: SessionPhase,
	query: NotificationQueryView,
): NotificationsScreenState {
	if (phase === "booting") return { kind: "booting" };
	if (phase === "guest") return { kind: "guest" };
	/**
	 * `unavailable` is not folded into guest. The stored session still exists; we simply could not ask
	 * the server. Recommending login here would tell someone who is already signed in that they had
	 * been logged out.
	 */
	if (phase === "unavailable") return { kind: "unavailable" };
	return { kind: "panel", panel: notificationPanelView(query) };
}
