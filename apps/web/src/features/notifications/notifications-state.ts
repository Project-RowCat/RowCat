/**
 * The rule for what the notification surface draws, extracted as a pure function.
 *
 * If `if` branches stack up inside the component, the order cannot be checked without rendering,
 * and an order mistake in the inbox produces only quiet symptoms. Two actually occurred:
 * - Pause placed after loading: offline users saw a placeholder that never ended, because a
 *   paused query is still `isPending`.
 * - Failure placed after empty: a failed query showed `No notifications yet`.
 *
 * The second is the worse one here. A failure means unknown, not zero notifications. Someone
 * waiting for a moderation notice or an appeal result would see an empty inbox after one network
 * error, and read it as proof that nothing was sent.
 *
 * Held data is never erased. Pause and failure take over the screen only when no data is held. If
 * rows are held, they are drawn, and only a retry path is attached (`retryable`). Letting one
 * failed background refresh cover twenty confirmed rows with an error box gains nothing and loses
 * information. `creator-analytics-state.ts` writes the same rule in the same shape.
 *
 * Both surfaces follow this rule. The popover and the full list differ in copy and size, but their
 * accuracy rules must match. Each had its own `isPending → isError → empty` order, so both drew a
 * paused query as loading while offline.
 */

export type NotificationPanelState =
	/** No connection and no held data. It means waiting, not an error. */
	| "offline"
	| "error"
	| "loading"
	/** The server answered successfully with an empty list. This must stay distinct from failure. */
	| "empty"
	| "ready";

/**
 * Accepts only the query axes this rule reads. The whole `UseInfiniteQueryResult` is not passed, so
 * the rule can be tested without the library, and the axes it uses are visible in the type itself.
 */
export interface NotificationQueryView {
	/**
	 * TanStack Query has paused retries because it considers the network unavailable (`fetchStatus` is
	 * `paused`).
	 */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	hasData: boolean;
	itemCount: number;
}

export interface NotificationPanelView {
	state: NotificationPanelState;
	/**
	 * Rows are drawn, but the last refresh failed or was aborted. This axis exists so that a retry can
	 * be offered without clearing the list. Rows on screen are still server-confirmed notifications,
	 * though possibly not the latest. That fact is neither hidden nor a reason to discard them.
	 */
	retryable: boolean;
}

/**
 * Maps query state to what to draw. The order is the whole function: held data, then pause, then
 * failure, then loading, then empty.
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
	 * Pause comes before failure. The two call for different user actions. A pause waits, since it
	 * resumes when the connection returns. A failure requires pressing retry. Also, a paused query is
	 * still `isPending`, so placing it after the loading check would read as loading and become a
	 * placeholder that never ends.
	 */
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	/**
	 * Reaching here means the query finished with no accumulated rows, for example a cancelled query.
	 * It is drawn as empty. The three branches above have already handled failure, so this is not a
	 * path where a failure is shown as an empty list.
	 */
	return { state: "empty", retryable: false };
}
