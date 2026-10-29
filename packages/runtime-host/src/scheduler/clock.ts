/**
 * The two things the scheduler asks the platform: what time it is, and how to yield to the event
 * loop.
 *
 * requestAnimationFrame, requestIdleCallback, scheduler.postTask, and setImmediate never appear in
 * this package's core. Those names belong to the platform (browser, Node, and WebView each differ).
 * If the core picked one, the code would die or behave silently differently on another platform.
 * Instead the core takes this port, and the web worker and native harnesses plug in their own.
 */

export interface RuntimeHostSchedulerClock {
	/** Monotonic milliseconds. `Date.now()` works, but `performance.now()` is better. */
	now(): number;
	/** Yields one macrotask. The host regains control before this promise resolves. */
	yield(): Promise<void>;
}

const monotonicNow = (): number =>
	typeof performance === "object" && typeof performance.now === "function"
		? performance.now()
		: Date.now();

export const defaultSchedulerClock = (): RuntimeHostSchedulerClock => ({
	now: monotonicNow,
	yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
});
