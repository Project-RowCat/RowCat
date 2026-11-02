import type Redis from "ioredis";
import type {
	RateLimitConsumption,
	RateLimitObservation,
	RateLimitSlot,
	RateLimitStore,
} from "./store.ts";

/**
 * Redis fixed-window counter: the distributed adapter.
 *
 * Why Lua: the operation is three steps (count, check expiry exists, set it if not). Split into
 * round trips with more than one replica, two things break:
 *
 * ```text
 * INCR -> (another instance interleaves) -> PTTL   two requests see the same window differently
 * INCR -> process dies                              a key with no expiry stays forever
 * ```
 *
 * The second is worse: that account is blocked permanently for that policy because the counter
 * never shrinks. One Lua script runs atomically inside Redis, so neither state is representable.
 * `WATCH`/`MULTI` would also work but needs a retry loop under contention, which is the code that
 * slows most under load; the script has no retry.
 *
 * The `INCRBY` then `PTTL` order is the rule. The common "EXPIRE only when count is 1" form does
 * not recover from the die-after-INCR state, since that key never becomes 1 again and never gets an
 * expiry. Here a TTL is always attached when missing, so no key from this adapter lacks expiry;
 * `redis-store.test.ts` asserts that.
 *
 * Scripts are not resent every call: `defineCommand` uses EVALSHA and falls back to EVAL on
 * `NOSCRIPT`, so an empty script cache after a Redis restart heals on the next call.
 */

/**
 * KEYS[1] counter key, ARGV[1] window ms, ARGV[2] amount to add -> {current value, remaining ms}.
 * Lua returns integers as-is, so ioredis receives `[number, number]`.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCRBY', KEYS[1], ARGV[2])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * KEYS[1] counter key, ARGV[1] amount to give back.
 *
 * Does nothing for a missing key: `DECRBY` would turn it into 0 and go negative, leaving a key with
 * no TTL that forever inflates that account's budget. A negative result is restored to 0.
 * `INCRBY`/`DECRBY` leave the TTL alone, so expiry does not move.
 */
const RELEASE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
local left = redis.call('DECRBY', KEYS[1], ARGV[1])
if left < 0 then
  redis.call('INCRBY', KEYS[1], -left)
end
return 1
`;

/**
 * Slots are a sorted set: member = holder, score = lease end in ms. The clock is Redis's own (`TIME`),
 * not the caller's — replicas whose clocks disagree would otherwise expire each other's leases early
 * or late. Scripts that call `TIME` are fine to run: Redis 7+ replicates a script's effects, not the
 * script.
 *
 * KEYS[1] slot key, ARGV[1] holder, ARGV[2] max, ARGV[3] lease ms -> {admitted 0|1, live holders}.
 * Expired holders go first, then the count decides, then the add — one step, so two replicas cannot
 * both see room for the last slot. The key's own TTL follows the newest lease, so an idle key leaves.
 */
const ACQUIRE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local held = redis.call('ZCARD', KEYS[1])
if held >= tonumber(ARGV[2]) then
  return {0, held}
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return {1, held + 1}
`;

/**
 * KEYS[1] key, ARGV[1] "counter" | "slots" -> {count, remaining ms} or {} when absent. Reads only:
 * expired holders are not counted, and not removed either (that belongs to `acquire`).
 */
const OBSERVE_SCRIPT = `
if ARGV[1] == 'slots' then
  local t = redis.call('TIME')
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  local held = redis.call('ZCOUNT', KEYS[1], '(' .. now, '+inf')
  if held == 0 then return {} end
  local last = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
  return {held, tonumber(last[2]) - now}
end
local value = redis.call('GET', KEYS[1])
if not value then return {} end
local ttl = redis.call('PTTL', KEYS[1])
return {tonumber(value), ttl}
`;

/** Shape of the methods ioredis `defineCommand` plants on the instance. */
interface RedisWithConsume extends Redis {
	rowcatRateLimitConsume(
		key: string,
		windowMs: string,
		cost: string,
	): Promise<[number, number]>;
	rowcatRateLimitRelease(key: string, amount: string): Promise<number>;
	rowcatRateLimitAcquire(
		key: string,
		holder: string,
		max: string,
		leaseMs: string,
	): Promise<[number, number]>;
	rowcatRateLimitObserve(key: string, kind: string): Promise<number[]>;
}

/** Do not define twice on one connection (ioredis warns). */
const defined = new WeakSet<Redis>();

export function createRedisRateLimitStore(client: Redis): RateLimitStore {
	if (!defined.has(client)) {
		client.defineCommand("rowcatRateLimitConsume", {
			numberOfKeys: 1,
			lua: CONSUME_SCRIPT,
		});
		client.defineCommand("rowcatRateLimitRelease", {
			numberOfKeys: 1,
			lua: RELEASE_SCRIPT,
		});
		client.defineCommand("rowcatRateLimitAcquire", {
			numberOfKeys: 1,
			lua: ACQUIRE_SCRIPT,
		});
		client.defineCommand("rowcatRateLimitObserve", {
			numberOfKeys: 1,
			lua: OBSERVE_SCRIPT,
		});
		defined.add(client);
	}
	const withConsume = client as RedisWithConsume;

	return {
		kind: "redis",
		async consume(
			key: string,
			windowMs: number,
			cost = 1,
		): Promise<RateLimitConsumption> {
			const [count, ttl] = await withConsume.rowcatRateLimitConsume(
				key,
				String(windowMs),
				String(cost),
			);
			return {
				count,
				/**
				 * The script prevents a negative TTL, but fold it anyway: this value becomes `Retry-After`, and
				 * a leaked negative would read to the client as "retry now".
				 */
				resetMs: ttl > 0 ? ttl : windowMs,
			};
		},
		async release(key: string, amount: number): Promise<void> {
			if (amount <= 0) return;
			await withConsume.rowcatRateLimitRelease(key, String(amount));
		},
		async acquire(
			key: string,
			holder: string,
			max: number,
			leaseMs: number,
		): Promise<RateLimitSlot> {
			const [admitted, held] = await withConsume.rowcatRateLimitAcquire(
				key,
				holder,
				String(max),
				String(leaseMs),
			);
			return { admitted: admitted === 1, held };
		},
		async releaseHolder(key: string, holder: string): Promise<void> {
			await client.zrem(key, holder);
		},
		async observe(
			key: string,
			kind: "counter" | "slots",
		): Promise<RateLimitObservation | null> {
			const [count, resetMs] = await withConsume.rowcatRateLimitObserve(
				key,
				kind,
			);
			if (count === undefined || resetMs === undefined) return null;
			return { count, resetMs: Math.max(0, resetMs) };
		},
		/** The connection belongs to `lib/redis.ts` and is shared per process; closing it here would kill the next consumer. */
		close: () => Promise.resolve(),
	};
}
