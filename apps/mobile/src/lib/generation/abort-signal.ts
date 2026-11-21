/**
 * The two `AbortSignal` conveniences generation code reached for, written against the part of the
 * API React Native actually has.
 *
 * React Native's `AbortSignal` (the `abort-controller` polyfill Hermes runs) has neither
 * `signal.throwIfAborted()` nor the static `AbortSignal.any` / `AbortSignal.timeout`. Calling them
 * throws `TypeError: undefined is not a function`, which a generation turn reports as an opaque
 * failure before any request leaves the device. Vitest runs on Node, where all three exist, so only a
 * device shows it (afterstate Phase 12 emulator run: every BYO turn failed this way).
 *
 * A deadline is not a retry: nothing here sends anything again. It lives outside the adapters
 * because their boundary test forbids timers there (`boundaries.test.ts`, "adapters don't retry on
 * their own").
 */

/** `signal.throwIfAborted()`: throws the abort reason, or an `AbortError` when there is none. */
export function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	const reason: unknown = signal.reason;
	if (reason !== undefined) throw reason;
	const aborted = new Error("The operation was aborted.");
	aborted.name = "AbortError";
	throw aborted;
}

/**
 * `AbortSignal.any([signal, AbortSignal.timeout(ms)])`: a signal that aborts when `signal` does or
 * after `ms`. Call `dispose` when the bounded work is over, so neither the timer nor the listener
 * outlives it.
 */
export function signalWithDeadline(
	signal: AbortSignal,
	ms: number,
): { signal: AbortSignal; dispose: () => void } {
	const bounded = new AbortController();
	const stop = () => bounded.abort();
	if (signal.aborted) stop();
	else signal.addEventListener("abort", stop);
	const timer = setTimeout(stop, ms);
	return {
		signal: bounded.signal,
		dispose: () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", stop);
		},
	};
}
