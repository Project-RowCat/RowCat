import { onlineManager, useQueryClient } from "@tanstack/react-query";

/**
 * - On a paused query, refetch() does nothing: TanStack Query keeps an unfinished retryer
 *   attached, and refetch() only lowers its cancel flag (retryer.continueRetry).
 * - The `Try again` action first re-syncs the browser's online state, because a missed online event
 *   leaves onlineManager stuck offline. It then restarts a paused query that has no data, using
 *   resetQueries.
 * - Data already on screen is never discarded, so a paused query with data gets a plain refetch.
 * - networkMode stays 'online' on purpose: 'always' would hide the paused-versus-failed
 *   distinction the UI relies on.
 * - Lives in lib/query, not @rowcat/query or features/create: the stall is a TanStack Query issue
 *   for every online-mode query, but the browser wiring (onlineManager, navigator.onLine) would
 *   make a shared package web-only. The Expo build would supply NetInfo instead.
 */

export interface PanelRetryPort {
	/** True when TanStack's fetchStatus is 'paused'. */
	isPaused: boolean;
	/**
	 * Whether data is already on screen. If so, it must not be discarded, so the restart is skipped.
	 */
	hasData: boolean;
	syncOnline: () => void;
	/**
	 * Restarts the query from scratch, discarding the stalled retryer. Unlike refetch(), which cannot
	 * reach a stalled retryer.
	 */
	restart: () => Promise<unknown>;
	refetch: () => Promise<unknown>;
}

/**
 * Order matters: re-sync the connection state first, then restart only a paused query with no data.
 * A restart would re-pause immediately if the cache still believed it was offline.
 */
export async function runPanelRetry(port: PanelRetryPort): Promise<void> {
	port.syncOnline();
	if (port.isPaused && !port.hasData) {
		await port.restart();
		return;
	}
	await port.refetch();
}

/**
 * onlineManager changes only on online and offline events and notifies only when the value changes,
 * so a tab that missed an event keeps believing it is offline, and every restart re-pauses at once.
 * Pressing `Try again` is the moment to ask the browser again.
 *
 * It copies navigator.onLine as-is rather than forcing true, so it claims no more than the browser
 * knows. It is exported because route error screens' retry (router.invalidate()) needs the same
 * recovery, and it must run before that retry.
 */
export function syncBrowserOnline(): void {
	if (typeof navigator === "undefined") return;
	onlineManager.setOnline(navigator.onLine);
}

interface RetryableQuery {
	isPaused: boolean;
	data: unknown;
	refetch: () => Promise<unknown>;
}

/**
 * Shared by all panels because the stall is a property of the query, not of the wording. Separate
 * copies would be fixed in one place only, and the gap shows only for offline users.
 */
export function usePanelRetry(
	queryKey: readonly unknown[],
	query: RetryableQuery,
): () => void {
	const queryClient = useQueryClient();

	return () => {
		void runPanelRetry({
			isPaused: query.isPaused,
			hasData: query.data !== undefined,
			syncOnline: syncBrowserOnline,
			/**
			 * resetQueries cancels the stalled retryer (query.reset() then destroy()), resets the state, and
			 * refetches active observers. That refetch has fetchStatus idle, so it skips the early return in
			 * query.fetch() described in panel-retry.ts. This is what makes restart() differ from refetch().
			 */
			restart: () => queryClient.resetQueries({ queryKey }),
			refetch: () => query.refetch(),
		});
	};
}
