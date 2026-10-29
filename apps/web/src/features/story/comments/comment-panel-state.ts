/**
 * The rule for what the section draws, extracted as a pure function. An earlier version checked in
 * component `if`s in the wrong order, with two symptoms:
 * - A failure ahead of the data let one failed background refresh or 'load more' cover the whole
 *   list already on screen.
 * - With no pause branch, an offline query (still `isPending`) rendered as a placeholder that
 *   never ended.
 *
 * The failed thing is one refresh; the lines on screen are still what the server confirmed.
 * Clearing them would make users read the discussion as gone.
 *
 * Pause and failure take over the screen only when no value is held. If lines are held, they are
 * drawn and a retry path is attached (`retryable`).
 *
 * `notifications-state.ts` and `creator-analytics-state.ts` follow the same rule, and the mobile
 * `comments-state.ts` uses the same order.
 */

export type CommentPanelState =
	/** Offline with nothing held. It says the section is waiting, not that it failed. */
	| "offline"
	| "error"
	| "loading"
	/** The server answered successfully with an empty list. This must stay distinct from a failure. */
	| "empty"
	| "ready";

/**
 * Accepts only the axes this logic reads, not the whole `UseInfiniteQueryResult`. That keeps the
 * rule testable without the library and makes the axes it depends on visible in the type.
 */
export interface CommentQueryView {
	/**
	 * True when TanStack Query has paused retries because it judged there is no network (`fetchStatus`
	 * is paused).
	 */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	/** True when at least one page of data is already held. */
	hasData: boolean;
	commentCount: number;
}

export interface CommentPanelView {
	state: CommentPanelState;
	/**
	 * True when lines are shown but the latest refresh failed or was aborted. It exists so the list
	 * can keep its lines and add only a retry action. The lines are still server-confirmed, though
	 * possibly not current. That fact is neither hidden nor a reason to drop them.
	 */
	retryable: boolean;
}

/**
 * Maps query state to what to draw. The order is the whole function: held data, then pause, then
 * failure, then loading, then empty.
 */
export function commentPanelView(q: CommentQueryView): CommentPanelView {
	if (q.hasData)
		return {
			state: q.commentCount === 0 ? "empty" : "ready",
			retryable: q.isError || q.isPaused,
		};
	/**
	 * A pause comes before failure because the two need different user actions. A pause waits on its
	 * own, since the query resumes when the connection returns. A failure needs a retry tap. Also, a
	 * paused query is still `isPending`, so placed after the loading check it would read as loading
	 * forever.
	 */
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	/**
	 * Reached when the query finished but nothing accumulated (for example a cancelled query). It
	 * draws as empty. The three branches above have already caught failures, so a failure never
	 * reaches this line as empty.
	 */
	return { state: "empty", retryable: false };
}
