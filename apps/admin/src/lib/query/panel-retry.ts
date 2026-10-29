import { onlineManager, useQueryClient } from "@tanstack/react-query";

/**
 * What the screen's `Try again` does when pressed.
 *
 * `query.refetch()` alone is not always enough. When TanStack Query pauses retries (`fetchStatus:
 * "paused"`), the query holds an unfinished retryer, and with no data `refetch()` returns that
 * existing promise without issuing a request: the button presses, nothing happens, and no error
 * appears. The full reasoning is in the web's same-named file
 * (`apps/web/src/lib/query/panel-retry.ts`).
 *
 * Each app keeps its own copy because the two apps do not import each other (as with
 * `lib/motion/transitions.ts`), and this is browser wiring around `onlineManager` and
 * `navigator.onLine`, which cannot move into `@rowcat/query` (a later Expo app uses that package).
 * Drift is low-risk: no values, four lines of rules, locked by the tests.
 *
 * Pausing does not currently happen in this app: `main.tsx` picks `networkMode: "always"`, so the
 * paused branch is a guard, not live code. It stays because that setting is two lines away and
 * reverting it would silently break this button.
 */

/** What `Try again` can actually do; this rule chooses, not the screen. */
export interface QueryRetryPort {
	/** `fetchStatus: "paused"`. */
	isPaused: boolean;
	/** A value already on screen is never thrown away. */
	hasData: boolean;
	/** Re-announces the browser's current connectivity to the cache layer. */
	syncOnline: () => void;
	/** Restarts the query from scratch, discarding the paused retryer. */
	restart: () => Promise<unknown>;
	refetch: () => Promise<unknown>;
}

/**
 * Regain the connectivity state first, then restart only pauses with nothing to lose. The order
 * matters because a restarted query pauses again if the cache layer still believes it is offline;
 * data is kept because `resetQueries` erases what is drawn, and erasing even a stale value gains
 * nothing.
 */
export async function runQueryRetry(port: QueryRetryPort): Promise<void> {
	port.syncOnline();
	if (port.isPaused && !port.hasData) {
		await port.restart();
		return;
	}
	await port.refetch();
}

/**
 * Recovers a missed connectivity signal. `onlineManager` notifies only on change, so a tab that
 * missed the event stays offline in its own mind. It mirrors `navigator.onLine` rather than forcing
 * `true`, to claim no more than we know.
 */
function syncBrowserOnline(): void {
	if (typeof navigator === "undefined") return;
	onlineManager.setOnline(navigator.onLine);
}

interface RetryableQuery {
	isPaused: boolean;
	data: unknown;
	refetch: () => Promise<unknown>;
}

export function useQueryRetry(
	queryKey: readonly unknown[],
	query: RetryableQuery,
): () => void {
	const queryClient = useQueryClient();

	return () => {
		void runQueryRetry({
			isPaused: query.isPaused,
			hasData: query.data !== undefined,
			syncOnline: syncBrowserOnline,
			/**
			 * `resetQueries` cancels the paused retryer, resets state and refetches active observers. That
			 * refetch starts idle, so it does not hit the early return above, which is where it differs from
			 * `refetch()`.
			 */
			restart: () => queryClient.resetQueries({ queryKey }),
			refetch: () => query.refetch(),
		});
	};
}
