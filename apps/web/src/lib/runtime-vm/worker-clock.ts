import type { RuntimeHostSchedulerClock } from "@rowcat/runtime-host/scheduler/clock";

/**
 * Yielding uses MessageChannel. The scheduler core takes a clock port rather than choosing
 * setTimeout, requestAnimationFrame, or scheduler.postTask. In a worker, setTimeout(0) has a
 * minimum delay of several milliseconds, which wastes the gap between slices, while MessageChannel
 * gives the same macrotask boundary with no delay. The PoC lab worker and the preview worker plug
 * in the same clock, since two copies would let only one get fixed.
 */
export const workerSchedulerClock = (): RuntimeHostSchedulerClock => {
	const channel = new MessageChannel();
	let waiters: (() => void)[] = [];
	channel.port1.onmessage = () => {
		const current = waiters;
		waiters = [];
		for (const waiter of current) waiter();
	};
	return {
		now: () => performance.now(),
		yield: () =>
			new Promise((resolve) => {
				waiters.push(resolve);
				channel.port2.postMessage(null);
			}),
	};
};
