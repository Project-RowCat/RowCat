/**
 * Rate-limit counter store: a single port. No vendor type may pass this file.
 *
 * Same shape and reason as `lib/media/storage.ts`: if the limiter does not know where counters
 * live, swapping the store is one adapter. Once `ioredis` types climb above this file the SDK
 * spreads into policy, services and tests.
 *
 * ## Why so narrow: one counting method
 *
 * There is no `reset()`, `peek()` or `get()`. `peek()` in particular must not exist: it invites
 * callers to read, decide, then increment, and the window between those steps is exactly the race
 * this slice removes. Reading and incrementing must be impossible to separate.
 *
 * ## The store does not know the limit
 *
 * `consume` takes no `max` and answers only "which hit is this". Deciding whether it is over the
 * limit belongs to the limiter, which knows the policy (`limiter.ts`). So the adapter holds no
 * product rule, and changing a limit never means touching the Lua script.
 *
 * Consequently a rejected request still increments the counter. With a fixed window that is not a
 * correctness problem (the window still expires on time; the number just grows past the limit), and
 * it buys a single atomic operation per decision, with no "increment, then undo if rejected" second
 * round trip.
 *
 * ## Weighted consumption and `release`
 *
 * Some policies count an amount rather than a number of requests (the remote-image byte budget).
 * The real amount is unknown until the request ends, so entry reserves the cap (`cost` on
 * `consume`) and the unused part is given back afterwards (`release`).
 *
 * This looks like the "undo" round trip ruled out above, but the race points the other way:
 * admission is still one atomic increment, and `release` only shrinks an amount the same request
 * already reserved. The only effect of the window is that others get in slightly less; if `release`
 * fails the result is over-counting (the safe direction).
 */

export interface RateLimitConsumption {
	/** Hits in the window, including this call. Starts at 1. */
	readonly count: number;
	/** Milliseconds until the window ends; the raw material for `Retry-After`. */
	readonly resetMs: number;
}

export interface RateLimitStore {
	/**
	 * Reported in ops logs and the boot log: a deployment running on the in-process counter not
	 * knowing it is the one risk of this setting.
	 */
	readonly kind: "redis" | "memory";

	/**
	 * Atomically increments the key's counter and returns the new value.
	 *
	 * The first call opens the window. An open window's expiry is never pushed out: otherwise a client
	 * stuck at the limit extends its own window just by retrying and is locked out forever (a common
	 * defect when imitating a sliding window).
	 *
	 * Failures throw instead of folding into allow/deny, because that decision is the policy's
	 * (fail-open/fail-closed); deciding it here would make that policy field dead.
	 */
	consume(
		key: string,
		windowMs: number,
		/**
		 * Amount to add; defaults to 1 (every count-based policy). Positive integers only. On the call
		 * that opens the window this is the window's initial value.
		 */
		cost?: number,
	): Promise<RateLimitConsumption>;

	/**
	 * Gives back the unused part of an earlier reservation, only while the window is still alive.
	 *
	 * - It never opens a window: releasing into an expired key would start the next window negative,
	 *   creating free budget equal to the reservation. A missing key is a no-op.
	 * - It never goes below 0: if the amount exceeds the current value (the window rolled over and a
	 *   same-named new window is being credited), it stops at 0.
	 *
	 * The expiry is left alone.
	 */
	release(key: string, amount: number): Promise<void>;

	/** Shutdown and test cleanup; the in-process adapter releases its timer here. */
	close(): Promise<void>;
}
