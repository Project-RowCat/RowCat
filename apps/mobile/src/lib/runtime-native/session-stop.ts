import type { NativeRuntimeSession } from "./session.ts";

/**
 * Stops the session and waits until cleanup finishes. This is where the playback lifecycle ends the
 * previous owner.
 *
 * - `stopped` from the bridge: resolves to idle (normal).
 * - `failed` from the bridge: the session died and nothing more will come.
 * - Bridge closed: the screen was left and nothing more will come.
 * - No answer: resolves at the grace limit. This limit is the VM's deadline, not the save's.
 *
 * `stop()` is synchronous because it is the session's decision (one message across the bridge).
 * Waiting for its end is this function's job. The wait matters for ordering: cleanup functions can
 * emit a final commit, and that commit crosses the bridge before `stopped` (same channel, so the
 * order holds). Once the promise settles, no later save commit exists, and the lifecycle's flush
 * carries the last value.
 *
 * The limit covers a bridge that is alive while the document never answers. Past it, saving still
 * flushes to completion, because commits already delivered are in the coordinator.
 */
export function stopNativeSession(
	session: NativeRuntimeSession,
	options: {
		graceMs: number;
		delay: (ms: number) => Promise<void>;
	},
): Promise<void> {
	session.stop();
	const settled = (): boolean => {
		const state = session.getState();
		return (
			state.status === "idle" ||
			state.status === "failed" ||
			session.transport.closed
		);
	};
	if (settled()) return Promise.resolve();
	return new Promise<void>((resolve) => {
		let done = false;
		const finish = (): void => {
			if (done) return;
			done = true;
			unsubscribe();
			resolve();
		};
		const unsubscribe = session.subscribe(() => {
			if (settled()) finish();
		});
		void options.delay(options.graceMs).then(finish);
	});
}
