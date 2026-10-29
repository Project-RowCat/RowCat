import type { MyReportDto } from "@rowcat/contracts";

/**
 * Decides what the `My reports` section draws. Pure, like features/create/analytics/state.ts, and for one
 * more reason: this screen is where users check the result of something they just reported, so a
 * wrong order does the most harm.
 * - Pause checked after loading: an offline user sees a placeholder that never ends.
 * - Failure checked after empty: a failed fetch shows "no reports submitted", which the reporter
 *   reads as the report being lost. Held data is never cleared. When rows exist they stay, and only
 *   a retry path is added (retryable). Not here: status filters, sorting or search (a two-value
 *   list gains nothing from them, and each would need its own cache slot and empty state), and any
 *   disposition. The function never receives those values, so it cannot draw them by mistake.
 */

export type MyReportsPanelState =
	/** Offline with no held data. This is a wait, not an error, and the section says so. */
	| "offline"
	| "error"
	| "loading"
	/** No reports filed. This must stay distinct from the failure state. */
	| "empty"
	| "ready";

/**
 * Takes only the query fields this rule reads, not the whole UseInfiniteQueryResult. That lets the
 * rule be tested without the library, and the fields it uses are visible in the type.
 */
export interface MyReportsQueryView {
	/**
	 * TanStack Query's paused state: it stopped retrying because there is no network (fetchStatus
	 * "paused").
	 */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	hasData: boolean;
	reportCount: number;
}

export interface MyReportsPanelView {
	state: MyReportsPanelState;
	/**
	 * Set when rows are shown but the last refresh failed or was interrupted. The rows stay; only a
	 * `Try again` control is added.
	 */
	retryable: boolean;
}

/**
 * Maps query state to what to draw. The order is the whole function: held data, then pause, then
 * failure, then loading, then empty.
 */
export function myReportsPanelView(q: MyReportsQueryView): MyReportsPanelView {
	if (q.hasData)
		return {
			state: q.reportCount === 0 ? "empty" : "ready",
			retryable: q.isError || q.isPaused,
		};
	/**
	 * Pause comes before failure: the two need different user actions (wait vs. press again). A paused
	 * query still reports isPending, so placing pause after loading would read as loading, a
	 * placeholder that never finishes.
	 */
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	return { state: "empty", retryable: false };
}

/**
 * Row title in the form `Story · Spam or flooding` (target kind · reason). Target and reason share one line
 * because neither alone says what the row is about; the time sits on the next line. Labels are keyed by the
 * contract's codes in the `moderation` dictionary, whose type grows with the vocabulary. Retyping
 * them here would leave this screen on old wording whenever the vocabulary grows, and the symptom
 * would be raw reason codes on screen.
 */
export interface MyReportLabels {
	target: Record<MyReportDto["targetType"], string>;
	reason: Record<MyReportDto["reason"], string>;
}

export function myReportTitle(
	report: MyReportDto,
	labels: MyReportLabels,
): string {
	return `${labels.target[report.targetType]} · ${labels.reason[report.reason]}`;
}
