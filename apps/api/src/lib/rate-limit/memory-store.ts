import type { RateLimitConsumption, RateLimitStore } from "./store.ts";

/**
 * In-process fixed-window counter: a fallback, not a bottleneck. Used when `REDIS_URL` is absent
 * (local dev, CI, single-instance production) and as the store that lets limiter tests check
 * policy, rejection and `Retry-After` by value.
 *
 * Limits: it counts this process only, so N replicas give an effective limit of limit x N and a
 * deploy or restart wipes the counters. The boot log says so when production falls back here
 * (`env.ts`); silently going loose is the only risk. It is still better than counting nothing, and
 * on a single instance it behaves exactly like the Redis adapter.
 *
 * It is a second, independent implementation of the same port rather than a mock of the Redis
 * adapter, so `store-contract.test.ts` can run both against one table and a pass means something. A
 * JavaScript transcription of the Lua script would fail together with it.
 *
 * Keys do not pile up: expired entries fold on read and a periodic sweep also runs. The sweep is
 * not a correctness condition (a dead timer costs only memory), the same axis as moderation expiry
 * being a predicate rather than a sweep (`services/moderation.ts`).
 */

interface Window {
	count: number;
	/** Absolute end of this window, in ms. */
	expiresAt: number;
}

/** Sweep period; affects memory only, not correctness. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Cap on live windows one process keeps per policy. TTL alone cannot stop an attack that pushes
 * unlimited distinct identities into one window. At the cap the store throws, and each policy's
 * fail-open/fail-closed decides pass or reject.
 */
const MAX_WINDOWS = 4_096;

/**
 * Policy name from a key `rl:<version>:<policy>:<hash>` (`rateLimitKey` in `limiter.ts`); policy
 * names contain no `:`. A format change breaks that file's tests before this function.
 */
const policyOf = (key: string): string => key.split(":")[2] ?? key;

const countByPolicy = (
	windows: Map<string, Window>,
	policy: string,
): number => {
	let count = 0;
	for (const key of windows.keys()) if (policyOf(key) === policy) count += 1;
	return count;
};

const sweepExpired = (windows: Map<string, Window>, now: number): void => {
	for (const [key, window] of windows) {
		if (window.expiresAt <= now) windows.delete(key);
	}
};

export interface MemoryRateLimitStoreOptions {
	/**
	 * Clock, defaulting to `Date.now`. Lets tests skip real window expiry by moving only this store's
	 * clock: API tests hit a real Postgres, so faking process-wide time would shift row timestamps and
	 * cursors and produce failures that say nothing. The Redis adapter has no such axis (its clock is
	 * Redis's), so this is an implementation detail of this adapter, not part of the port.
	 */
	readonly now?: () => number;
}

export function createMemoryRateLimitStore(
	options: MemoryRateLimitStoreOptions = {},
): RateLimitStore {
	const now = options.now ?? Date.now;
	const windows = new Map<string, Window>();

	/** `unref()` keeps this interval from holding the process open, which would hang test runners and CLIs. */
	const sweeper = setInterval(() => {
		sweepExpired(windows, now());
	}, SWEEP_INTERVAL_MS);
	sweeper.unref?.();

	return {
		kind: "memory",
		consume(
			key: string,
			windowMs: number,
			cost = 1,
		): Promise<RateLimitConsumption> {
			const at = now();
			const existing = windows.get(key);

			/**
			 * Open a new window when none exists or it has passed. Never reuse a passed window, same as the
			 * Redis adapter: pushing the expiry out would let a throttled client extend its own window just
			 * by hammering.
			 */
			if (!existing || existing.expiresAt <= at) {
				sweepExpired(windows, at);
				/**
				 * The cap is counted per policy. A single count would let one fail-open policy fill the windows
				 * and make fail-closed policies (identity verification, managed generation) start returning
				 * 503; the place of abuse and the place that pays differ.
				 */
				if (
					!windows.has(key) &&
					countByPolicy(windows, policyOf(key)) >= MAX_WINDOWS
				)
					return Promise.reject(
						new Error("exceeded the in-process rate-limit window ceiling"),
					);
				const opened: Window = { count: cost, expiresAt: at + windowMs };
				windows.set(key, opened);
				return Promise.resolve({ count: cost, resetMs: windowMs });
			}

			existing.count += cost;
			return Promise.resolve({
				count: existing.count,
				resetMs: Math.max(1, existing.expiresAt - at),
			});
		},
		release(key: string, amount: number): Promise<void> {
			/** No give-back to a passed window, so the next window does not start with free budget (same as Redis). */
			const existing = windows.get(key);
			if (existing && existing.expiresAt > now() && amount > 0)
				existing.count = Math.max(0, existing.count - amount);
			return Promise.resolve();
		},
		close(): Promise<void> {
			clearInterval(sweeper);
			windows.clear();
			return Promise.resolve();
		},
	};
}
