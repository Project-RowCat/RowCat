import { closeRedis, getRedis } from "../redis.ts";
import {
	enforceRateLimit,
	type RateLimitReservation,
	reserveRateLimit as reserveRateLimitWith,
} from "./limiter.ts";
import { createMemoryRateLimitStore } from "./memory-store.ts";
import { RATE_LIMIT_POLICIES, type RateLimitPolicyKey } from "./policy.ts";
import { createRedisRateLimitStore } from "./redis-store.ts";
import type { RateLimitStore } from "./store.ts";

/**
 * Assembly point for rate limiting, and the only door feature code sees.
 *
 * ```text
 * policy.ts        limits and failure policy   pure; knows neither Redis nor Hono
 * store.ts         counter port
 * redis-store.ts   atomic Lua adapter          distributed
 * memory-store.ts  in-process adapter          fallback and test store
 * limiter.ts       decision, key, 429/503      the only place that knows policy
 * index.ts         which store this deployment uses
 * ```
 *
 * - Feature code issues no Redis commands. Direct `INCR` calls scatter limits, grow per-caller
 *   key rules, leave unexpired keys that block accounts forever, and diverge on store-failure
 *   handling. This folder is the only importer of `lib/redis.ts`; `boundaries.test.ts` scans for
 *   it.
 * - Unauthenticated endpoints are deliberately out of scope. They would need an IP subject, and
 *   this deployment has no trustworthy IP extraction (see `RateLimitSubjectKind` in `policy.ts`); a
 *   limiter on a forgeable header only blocks honest users. `/v2/auth/*` has Better Auth's own
 *   limiter (`auth/index.ts`). Once a trusted IP exists, the work is one policy plus one subject
 *   kind, not a redesign of this layer.
 */

let store: RateLimitStore | null = null;

/**
 * Redis when configured, otherwise the in-process store. Chosen once because `REDIS_URL` is fixed
 * at boot. Connection health is deliberately not checked here: command failures surface it and the
 * policy handles them, whereas a second health check would disagree with the first.
 */
export function rateLimitStore(): RateLimitStore {
	if (store) return store;
	const redis = getRedis();
	store = redis
		? createRedisRateLimitStore(redis)
		: createMemoryRateLimitStore();
	return store;
}

/**
 * Throws 429 when over the limit; a dead store is decided by the policy. The caller names only the
 * policy, the subject and an optional scope; windows, keys, `Retry-After` and codes stay inside.
 *
 * ```ts
 * await checkRateLimit("storyCommentCreate", authorId);
 * ```
 */
export function checkRateLimit(
	policy: RateLimitPolicyKey,
	subject: string,
	scope?: string,
): Promise<void> {
	return enforceRateLimit(rateLimitStore(), {
		policy: RATE_LIMIT_POLICIES[policy],
		subject,
		scope,
	});
}

/**
 * Door for amount-counting policies: reserves `amount` on entry, then settles to the amount used.
 *
 * ```ts
 * const reservation = await reserveRateLimit("runtimeRemoteAssetBytes", viewer.id, cap);
 * try { … } finally { await reservation.settle(bytesRead); }
 * ```
 *
 * Separate from `checkRateLimit` because an optional weight there would let a bytes policy be
 * called without one and count each request as 1 byte, blocking nothing. Each door throws on a
 * policy of the wrong unit.
 */
export function reserveRateLimit(
	policy: RateLimitPolicyKey,
	subject: string,
	amount: number,
	scope?: string,
): Promise<RateLimitReservation> {
	return reserveRateLimitWith(
		rateLimitStore(),
		{ policy: RATE_LIMIT_POLICIES[policy], subject, scope },
		amount,
	);
}

/** Test-only store swap; no product caller. */
export async function __setRateLimitStoreForTest(
	next: RateLimitStore | null,
): Promise<void> {
	if (store && store !== next) await store.close();
	store = next;
}

/** Releases timers and the optional Redis connection together at shutdown. */
export async function closeRateLimit(): Promise<void> {
	const current = store;
	store = null;
	await current?.close().catch(() => {});
	await closeRedis();
}

export { createMemoryRateLimitStore } from "./memory-store.ts";
