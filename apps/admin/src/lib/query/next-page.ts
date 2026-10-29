/**
 * The tail of an appended list: can the next page be fetched, is it loading, did it fail, is it the
 * end. Pure because this app's tests do not render React (README), and getting the order wrong is
 * silent:
 *
 * ```text
 * failure folded into end        the button vanishes and the operator reads the queue as done
 * failure folded into "Show more"   the press seems to do nothing
 * ```
 *
 * A next-page failure is not a whole-screen failure. TanStack Query sets the query's `isError` for
 * it too, which would raise a "last refresh failed" banner over rows that are fine, and that
 * banner's retry restarts from page one. So `pageAxes` separates them: the tail speaks for the
 * next-page failure and the top-level freshness sees only first-page failures.
 */

export type NextPageState =
	| "more"
	/** The button is locked so rapid presses do not fetch the same page twice. */
	| "loading"
	/** Loaded rows stay and the same page can be requested again. */
	| "failed"
	| "end";

export interface NextPageAxes {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	isFetchNextPageError: boolean;
}

export function nextPageState(q: NextPageAxes): NextPageState {
	if (q.isFetchingNextPage) return "loading";
	/**
	 * Failure comes before "more": `hasNextPage` stays true after a failure (the cursor remains), so
	 * checking it first would fold the failure into a plain `Show more`.
	 */
	if (q.isFetchNextPageError) return "failed";
	if (q.hasNextPage) return "more";
	return "end";
}

/**
 * Failure axes the top of the screen (`QueryState`) reads, excluding next-page failures (see the
 * file header). First-page and refetch failures remain.
 */
export function pageAxes(q: {
	isError: boolean;
	isFetchNextPageError: boolean;
	error: unknown;
}): { isError: boolean; error: unknown } {
	const pageError = q.isError && !q.isFetchNextPageError;
	return { isError: pageError, error: pageError ? q.error : null };
}
