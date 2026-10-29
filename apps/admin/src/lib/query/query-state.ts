import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Decides what one query draws, as a pure function so the ordering is testable without rendering.
 * Getting the order wrong is silent and expensive in an operations console: a failure behind the
 * empty state shows "no open reports" on a failed lookup, a pause behind loading spins a skeleton
 * forever, and an unreachable server folded into a generic failure makes the operator read "Failed
 * to fetch" and suspect the server.
 *
 * `loading` means the request can still progress. Unreachable and paused are not loading, or the
 * screen is indistinguishable from "the server is slow".
 *
 * A held value is never replaced by an error (same rule as creator analytics and `My reports`), but
 * operators act on these values (open reports, sanction state) as current, so `staleness` says when
 * it is only the last confirmed value. No copy or screen knowledge lives here.
 */

export type AdminQueryState =
	| "loading"
	| "offline"
	| "error"
	/** Asked and genuinely nothing — must stay distinct from the three above. */
	| "empty"
	| "ready";

/**
 * Not `fresh` does not mean the value is wrong, only that the last refresh did not finish; so this
 * axis brings a notice line and `Try again`, never erasure.
 */
export type AdminQueryStaleness = "fresh" | "failed" | "offline";

/**
 * Only the axes this rule reads, rather than `UseQueryResult`, so it is testable without the
 * library and the dependency is explicit in the type.
 */
export interface AdminQueryStatus {
	hasData: boolean;
	/** Meaningless when `hasData` is false. */
	isEmpty: boolean;
	/** TanStack Query paused retries because it judged there is no network (`fetchStatus: "paused"`). */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	/** See `unreachableFailure`. */
	unreachable: boolean;
}

export interface AdminQueryView {
	state: AdminQueryState;
	staleness: AdminQueryStaleness;
}

/** The order is the whole function: held value → paused → unreachable → failed → loading. */
export function adminQueryView(q: AdminQueryStatus): AdminQueryView {
	if (q.hasData) {
		const state: AdminQueryState = q.isEmpty ? "empty" : "ready";
		/**
		 * Paused before failed: neither erases the value, but the operator's next step differs — the
		 * connection versus the server.
		 */
		if (q.isPaused || (q.isError && q.unreachable))
			return { state, staleness: "offline" };
		if (q.isError) return { state, staleness: "failed" };
		return { state, staleness: "fresh" };
	}
	/**
	 * A paused query is still `isPending`, so this must precede loading or it becomes a skeleton that
	 * never ends.
	 */
	if (q.isPaused) return { state: "offline", staleness: "fresh" };
	if (q.isError)
		return { state: q.unreachable ? "offline" : "error", staleness: "fresh" };
	if (q.isPending) return { state: "loading", staleness: "fresh" };
	/**
	 * A query that ended with no value (e.g. cancelled). Failures are already handled above, and an
	 * observer will query again.
	 */
	return { state: "loading", staleness: "fresh" };
}

/**
 * Whether the failure never reached the server. A `RowCatApiError` proves the server answered;
 * anything else was thrown by `fetch` (offline, DNS, CORS, server down), so all we know is that no
 * response came. Hence the copy says "could not connect to the server", not "you are offline" —
 * otherwise on the day the server dies every operator checks their own Wi-Fi.
 *
 * `navigator.onLine` is not consulted: it only says a link is up (true behind captive portals or a
 * dropped VPN). `status: 0` (`invalid_request`) never lands here — that is a request we never sent,
 * an assembly bug rather than a connection problem.
 */
export function unreachableFailure(error: unknown): boolean {
	if (error === null || error === undefined) return false;
	return !isRowCatApiError(error);
}
