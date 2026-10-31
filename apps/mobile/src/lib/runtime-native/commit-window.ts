/**
 * How many commits the harness may have in flight before Hermes acknowledges them. Pure; the harness
 * (`runtime-vm-harness/entry.ts`) holds one per session and its scheduler clock waits on it.
 *
 * ```text
 * harness  commit(r) ─▶ committed(r)          unacknowledged = last posted − last acknowledged
 * Hermes   tree.apply(r) ─▶ commit-ack(r) ─▶ acknowledged(r)
 * clock    yield() waits while unacknowledged > limit
 * ```
 *
 * ## Why
 *
 * The VM budget charges VM time, not the time Hermes spends applying a batch. A commit can be cheap
 * to produce and expensive to apply (many `move`s in one wide parent), and nothing slowed the harness
 * down: batches queued on the Hermes side while trusted chrome (back, reset) waited behind them. The
 * scheduler yields between slices, so making that yield wait is the one place backpressure can
 * stand without touching the reconciler or the host contract.
 *
 * The check sits between slices, so what is in flight can exceed the limit by one slice's worth of
 * commits (at most `maxTurnsPerSlice`, inside 16 ms of VM time). Measured in Chromium with a
 * dep-less `useEffect` loop and no acknowledgements: 16 commits went out, then the harness waited
 * for as long as Hermes stayed silent, and a stop still went through.
 *
 * ## It must never hold a session hostage
 *
 * `release()` opens the window for good, and stop, restart and session replacement call it the
 * moment their message arrives — not when their turn on the start/stop chain comes. A stop that
 * waited for acknowledgements Hermes will never send (its renderer failed, the screen left) would
 * stall the unmount, and the chain behind it.
 */

/** Commits that may be posted without an acknowledgement. Enough to keep one interaction pipelined. */
export const NATIVE_RUNTIME_COMMIT_WINDOW = 4;

export interface NativeRuntimeCommitWindow {
	/** A commit with this revision was posted to Hermes. */
	committed(revision: number): void;
	/** Hermes applied up to this revision. */
	acknowledged(revision: number): void;
	/** Resolves once at most `limit` commits are unacknowledged, or the window was released. */
	wait(): Promise<void>;
	/** Opens the window for good and settles every waiter. */
	release(): void;
	readonly unacknowledged: number;
	readonly released: boolean;
}

export function createNativeRuntimeCommitWindow(
	limit: number = NATIVE_RUNTIME_COMMIT_WINDOW,
): NativeRuntimeCommitWindow {
	let posted = 0;
	let acknowledged = 0;
	let released = false;
	let waiters: (() => void)[] = [];

	const open = (): boolean => released || posted - acknowledged <= limit;

	const settle = (): void => {
		if (!open()) return;
		const current = waiters;
		waiters = [];
		for (const waiter of current) waiter();
	};

	return {
		committed(revision) {
			if (Number.isInteger(revision) && revision > posted) posted = revision;
		},
		acknowledged(revision) {
			/** Acknowledgements only move forward, and never past what was posted. */
			if (!Number.isInteger(revision)) return;
			const next = Math.min(revision, posted);
			if (next <= acknowledged) return;
			acknowledged = next;
			settle();
		},
		wait() {
			if (open()) return Promise.resolve();
			return new Promise((resolve) => {
				waiters.push(resolve);
			});
		},
		release() {
			released = true;
			settle();
		},
		get unacknowledged() {
			return posted - acknowledged;
		},
		get released() {
			return released;
		},
	};
}
