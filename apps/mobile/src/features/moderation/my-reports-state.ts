import type { MyReportDto } from "@rowcat/contracts";

/**
 * The rule deciding what the my-reports section draws. It is a pure function with the same meaning
 * as the web `my-reports-state.ts`. Render code is not shared; each side keeps its own decision
 * ahead of rendering, the same shape as `security-state.ts` and `notifications-state.ts`.
 *
 * This screen is where people check the result after filing, so a wrong order is especially bad:
 * - A stall placed after loading leaves an offline user with a placeholder that never ends.
 * - A failure placed after empty shows `You haven't filed any reports` for a failed query.
 *
 * The later position is the decisive one. Someone who just filed a report would read 'not received'
 * after one network error as us having lost it.
 *
 * A held value is never erased. Stall and failure take over the screen only when no value is held.
 * If a list exists, draw it and attach a retry (`retryable`).
 *
 * Not here: status filters, sorting, search or tabs. With two values, each axis would get its own
 * cache cell and empty state, and the only gain is splitting twenty rows into two pieces. Nor
 * anything about dispositions: `MyReportDto` has no slot for it, so it cannot be drawn by mistake.
 */

/** What the section draws now. */
export type MyReportsPanelState =
	/** No connection and no held value: a wait rather than an error, and the section says so. */
	| "offline"
	/** The query failed and no value is held. */
	| "error"
	/** The first query is running: the section takes no space, so the account screen does not jump. */
	| "loading"
	/** This member has filed no reports. Must be distinguished from failure. */
	| "empty"
	/** There are rows to draw. */
	| "ready";

/**
 * Reads only the axes the query exposes. Not taking the whole `UseInfiniteQueryResult` keeps this
 * rule testable without the library.
 */
export interface MyReportsQueryView {
	/** TanStack Query paused retries, judging there is no network (`fetchStatus: "paused"`). */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	/** Whether at least one page is held. */
	hasData: boolean;
	/** Accumulated row count. */
	reportCount: number;
}

export interface MyReportsPanelView {
	state: MyReportsPanelState;
	/** Whether the last refresh failed or stalled while values are drawn. Instead of erasing rows, only a retry is attached. */
	retryable: boolean;
}

/**
 * Query state → what to draw. The order is the whole of this function: **held value → stall →
 * failure → loading → empty.**
 */
export function myReportsPanelView(q: MyReportsQueryView): MyReportsPanelView {
	if (q.hasData)
		return {
			state: q.reportCount === 0 ? "empty" : "ready",
			retryable: q.isError || q.isPaused,
		};
	/**
	 * A stall comes **before** a failure. The two call for different actions (wait versus press
	 * again), and a stall is still `isPending`, so placed after, it would read as loading: a
	 * placeholder that never ends.
	 */
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	return { state: "empty", retryable: false };
}

/**
 * One row's title, in the shape `Target · Reason`. The source of the labels is the contract
 * (`REPORT_TARGET_LABEL`, `REPORT_REASON_LABEL`). Re-typing Korean here would leave only this app
 * on the old labels when the vocabulary grows, and the symptom is an unknown reason code showing up
 * verbatim on screen. Callers pass the tables as arguments, so this function keeps the contract's
 * authority without importing it.
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
