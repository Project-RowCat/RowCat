import type Redis from "ioredis";
import type { CacheStore } from "./store.ts";

/**
 * Redis cache adapter, the only cache store in this deployment.
 *
 * - The connection is not this file's. `lib/redis.ts` creates one per process and rate limiting
 *   already shares it; a `new Redis(...)` here would make two config paths, and one deployment
 *   could have TLS on for one and off for the other.
 * - Failure is a miss and stays inside this file. Neither `get` nor `set` throws: a cache is an
 *   optimization, not a source of truth, and a gallery that dies with Redis makes the cache an
 *   extra failure surface. A Postgres failure never reaches here; only a Redis command is
 *   swallowed, and the caller rethrows failures computing the value (merging them would turn a DB
 *   outage into an empty gallery).
 * - No logging. Per-command logs would pile up the same line per request while Redis is down and
 *   bury the real problem (same call as not logging normal 429s, `rate-limit/limiter.ts`).
 *   `lib/redis.ts`'s listener already logs connection failures by error kind only.
 * - A corrupt value is a miss: a throwing `JSON.parse` would let one stray byte in Redis 500 the
 *   whole gallery, and the value is not ours to control (old-version code, hand edits, truncated
 *   writes). As a miss the next request recomputes from Postgres and overwrites it correctly.
 * - No retries on top: `lib/redis.ts` already fails fast (`maxRetriesPerRequest: 0` plus
 *   `commandTimeout`); retrying would make one miss slower than Postgres.
 */
export function createRedisCacheStore(client: Redis): CacheStore {
	return {
		kind: "redis",

		async get(key: string): Promise<unknown> {
			let raw: string | null;
			try {
				raw = await client.get(key);
			} catch {
				return null;
			}
			if (raw === null) return null;
			try {
				return JSON.parse(raw) as unknown;
			} catch {
				return null;
			}
		},

		async set(key: string, value: unknown, ttlMs: number): Promise<void> {
			// A serialization failure (cycles etc.) means the value is not cacheable; throwing here would
			// turn an already computed good response into a failure.
			let payload: string;
			try {
				payload = JSON.stringify(value);
			} catch {
				return;
			}
			try {
				// `SET ... PX` carries value and expiry in one command. A separate `PEXPIRE` lets a process
				// dying in between leave a key with no expiry that nobody deletes (we do not lean on eviction;
				// the rate-limit counters live in the same Redis).
				await client.set(key, payload, "PX", ttlMs);
			} catch {
				// Whatever was not written is recomputed by the next request.
			}
		},
	};
}
