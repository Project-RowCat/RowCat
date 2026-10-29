import { getRedis } from "../redis.ts";
import { createRedisCacheStore } from "./redis-store.ts";
import { type CacheStore, DISABLED_CACHE_STORE } from "./store.ts";

/**
 * Assembly point of the server cache and the only door feature code sees.
 *
 * ```text
 * keys.ts          versioned key assembly   pure; knows neither Redis nor any domain
 * store.ts         store port               two methods + a disabled implementation
 * redis-store.ts   Redis adapter            JSON, SET ... PX, failure is a miss
 * index.ts         what this deployment uses   <- here
 * ```
 *
 * - Feature code issues no Redis commands. Only this file and `lib/rate-limit/index.ts` import
 *   `lib/redis.ts` (`lib/rate-limit/boundaries.test.ts` scans the list). A service holding the
 *   connection is one step from calling `SET` itself, and then key rules and TTLs appear per call
 *   site; one missing expiry leaves an undeletable key in the same Redis as the rate-limit
 *   counters.
 * - No invalidation, TTL only: no tag invalidation, stale-while-revalidate or background refresh.
 *   The first consumer (the guest gallery) lives 30 seconds, staleness the client already accepts
 *   (`staleTime` in `packages/query/src/gallery.ts`). Invalidation would need every domain to say
 *   what makes a key stale (publish, hide, favourite, block, deletion) and a missed one is
 *   invisible.
 * - The cache is not a source of truth. Only Redis commands are swallowed; a failing `load` is
 *   rethrown, since merging them would turn a Postgres outage into an empty list, a lie that there
 *   are no stories.
 */

let store: CacheStore | null = null;

/**
 * Adapter if Redis is configured, otherwise disabled. Not re-decided per request because
 * `REDIS_URL` is fixed at boot; whether the connection is alive is not checked here, since that
 * shows up as command failures the adapter handles (`rate-limit/index.ts` made the same call).
 */
export function cacheStore(): CacheStore {
	if (store) return store;
	const redis = getRedis();
	store = redis ? createRedisCacheStore(redis) : DISABLED_CACHE_STORE;
	return store;
}

/**
 * Shares one in-progress computation per key, as the promise itself. Not a distributed lock: with
 * two replicas each computes once, which is accepted (Redlock was never asked for and a failing
 * lock would hang the gallery). It stops the in-process case of twenty requests arriving at expiry
 * each running `count(*)` and the popularity aggregation. Same shape as `inFlight` in
 * `services/ops.ts` and viewer resolution in `middleware/viewer.ts`.
 */
const inFlight = new Map<string, Promise<unknown>>();

export interface CacheAsideInput<T> {
	/** Built by `cacheKey` in `lib/cache/keys.ts`. */
	readonly key: string;
	readonly ttlMs: number;
	/**
	 * Interprets the untrusted value read from the cache into a product value, or `null` (a miss).
	 * Required on purpose: with `get<T>()` the generic is an unchecked cast and an old version's shape
	 * would flow to the screen; being mandatory, the type stops anyone forgetting validation.
	 */
	readonly decode: (raw: unknown) => T | null;
	/** Source of truth; anything thrown here propagates. */
	readonly load: () => Promise<T>;
}

/**
 * One cache-aside pass.
 *
 * ```text
 * GET --hit--> decode --ok--> return
 *   |              `-fail-.
 *   `--miss/failure-------+--> load() --> best-effort SET(TTL) --> return
 * ```
 *
 * A corrupt value gets overwritten as a side effect: a key that fails to decode falls to a miss and
 * the next SET writes the correct value there, so it self-heals.
 */
export function cacheAside<T>(input: CacheAsideInput<T>): Promise<T> {
	const running = inFlight.get(input.key);
	if (running) return running as Promise<T>;

	const shared = runCacheAside(cacheStore(), input);
	inFlight.set(input.key, shared);
	// Clear the slot on success or failure; a retained failure would replicate one DB error to every
	// later request for the key regardless of TTL. Compared by identity because a new request may have
	// inserted a fresh promise while cleanup runs, and that one must not be deleted.
	const forget = (): void => {
		if (inFlight.get(input.key) === shared) inFlight.delete(input.key);
	};
	shared.then(forget, forget);
	return shared;
}

async function runCacheAside<T>(
	store: CacheStore,
	{ key, ttlMs, decode, load }: CacheAsideInput<T>,
): Promise<T> {
	const raw = await store.get(key);
	if (raw !== null && raw !== undefined) {
		const decoded = decode(raw);
		if (decoded !== null) return decoded;
	}
	const fresh = await load();
	// Await the write: fire-and-forget would lose it if the process dies soon and would make tests
	// observe "written" only by timing. The adapter swallows failures, so this cannot fail the
	// response.
	await store.set(key, fresh, ttlMs);
	return fresh;
}

/** Test-only store swap; product paths have no caller. Also clears the in-flight table so an earlier test's computation cannot answer the next test's first call. */
export function __setCacheStoreForTest(next: CacheStore | null): void {
	store = next;
	inFlight.clear();
}

export { cacheKey } from "./keys.ts";
