import type { BetterAuthOptions } from "better-auth";

/**
 * The one command this adapter uses. `ioredis` is not imported by name here: only `lib/redis.ts`
 * and the rate-limit adapter hold that name (`lib/rate-limit/boundaries.test.ts`); `auth/index.ts`
 * passes in the client from `getRedis()`.
 */
export interface AuthRateLimitRedis {
	eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/** Derived from the options because `@better-auth/core` is not a direct dependency. */
type BetterAuthRateLimitStorage = NonNullable<
	NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]
>;

/**
 * Storage for Better Auth's limiter: Redis when configured, otherwise the library's in-memory
 * default.
 *
 * The in-memory store is per process, so replicas count separately and a restart forgets. Sign-in,
 * sign-up and password change are guarded by this limiter alone (`lib/rate-limit` deliberately
 * ignores unauthenticated endpoints), so the cap must not vary with deployment shape. Our own Redis
 * adapter is not reused because the library's `consume` must also return the verdict (`allowed`,
 * `retryAfter`).
 *
 * The Lua script is atomic for the same reason as ours: split into round trips, a process dying
 * right after `INCR` leaves a key with no TTL that blocks that IP forever.
 *
 * Storage failure lets the request through. Failing closed would let one Redis outage take down all
 * authentication, and password verification still stands behind this limiter.
 */
const CONSUME_LUA = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

const KEY_PREFIX = "ba-rl:v1:";

export function createRedisAuthRateLimitStorage(
	redis: AuthRateLimitRedis,
): BetterAuthRateLimitStorage {
	return {
		async consume(key, rule) {
			const windowMs = Math.max(1, Math.round(rule.window * 1000));
			try {
				const [count, ttlMs] = (await redis.eval(
					CONSUME_LUA,
					1,
					`${KEY_PREFIX}${key}`,
					String(windowMs),
				)) as [number, number];
				if (count <= rule.max) return { allowed: true, retryAfter: null };
				return {
					allowed: false,
					retryAfter: Math.max(1, Math.ceil(ttlMs / 1000)),
				};
			} catch {
				return { allowed: true, retryAfter: null };
			}
		},
	};
}
