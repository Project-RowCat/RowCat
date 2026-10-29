/**
 * Server cache port; no vendor passes this file. Same shape and reason as `lib/rate-limit/store.ts`
 * and `lib/media/storage.ts`: callers do not know where values live, so swapping storage is one
 * adapter. Once `ioredis` types climb above this file the SDK spreads into services and tests and a
 * swap becomes a refactor.
 *
 * - Only two methods. No `delete()`, `mget()`, `keys()` or `invalidateTag()`. Especially no
 *   `keys()`: it would invite prefix-scan invalidation, and that scan walks the same Redis as the
 *   rate-limit counters. Expiry is TTL alone (the first consumer lives 30 seconds); tag
 *   invalidation is a separate design that has to say what makes each key stale.
 * - `get` does not distinguish miss, corruption and failure; all are `null` and the caller's
 *   response is the same (look at Postgres). Distinguishing them invites a caller that throws on
 *   failure, and then the cache is a dependency instead of an optimization.
 * - Values are `unknown`. `get<T>()` would be an unchecked cast, and the bytes may have been
 *   written by another deployment's code (an older version on the same Redis), the same kind of
 *   value as a jsonb column re-parsed against its contract (`StoryChatSeedDto.safeParse` in
 *   `routes/stories/index.ts`). The caller interprets.
 */
export interface CacheStore {
	/** Lets logs and diagnostics say what is caching right now. */
	readonly kind: "redis" | "disabled";

	/**
	 * Never throws: a failed cache read is a miss to the caller, and saying so in the signature keeps
	 * callers from re-expressing it with try/catch.
	 */
	get(key: string): Promise<unknown>;

	/**
	 * Writes and attaches the TTL in the same operation. Split into two round trips, a process dying
	 * between them leaves a key with no expiry that nobody deletes (the rate-limit adapter used Lua to
	 * remove the same state). Failures are swallowed: not caching is no reason to undo an already
	 * computed response.
	 */
	set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

/**
 * Store for deployments without a cache (`REDIS_URL` unset: local dev, CI): always a miss, writes
 * do nothing, so behaviour is exactly the pre-cache one. No in-process Map substitute, unlike rate
 * limiting where "better than counting nothing" was the argument; here it would leave each replica
 * holding different values for 30 seconds, a bigger loss than the one round trip saved in dev.
 */
export const DISABLED_CACHE_STORE: CacheStore = {
	kind: "disabled",
	get: () => Promise.resolve(null),
	set: () => Promise.resolve(),
};
