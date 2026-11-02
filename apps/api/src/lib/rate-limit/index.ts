import { randomUUID } from "node:crypto";
import { env } from "../../env.ts";
import { closeRedis, getRedis } from "../redis.ts";
import {
	enforceRateLimit,
	holdSlot,
	type RateLimitReservation,
	type RateLimitSlotHold,
	rateLimitKey,
	reserveRateLimit as reserveRateLimitWith,
} from "./limiter.ts";
import { createMemoryRateLimitStore } from "./memory-store.ts";
import {
	RATE_LIMIT_POLICIES,
	type RateLimitPolicy,
	type RateLimitPolicyKey,
} from "./policy.ts";
import { createRedisRateLimitStore } from "./redis-store.ts";
import type { RateLimitObservation, RateLimitStore } from "./store.ts";

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
 * Limits a deployment sets for itself. The table in `policy.ts` holds the code's defaults and stays
 * pure; the few ceilings that are the operator's money (managed generation on their key) are read
 * from the environment here, the assembly point, so an image deployment can set them without
 * editing code. Every door below goes through this, and so does the console's report — the number
 * shown is the number enforced.
 */
const DEPLOYMENT_LIMITS: Partial<Record<RateLimitPolicyKey, () => number>> = {
	managedGenerationTokens: () => env.MANAGED_GENERATION_DAILY_TOKENS,
	managedGenerationSlots: () => env.MANAGED_GENERATION_CONCURRENCY,
};

export function rateLimitPolicy(key: RateLimitPolicyKey): RateLimitPolicy {
	const policy: RateLimitPolicy = RATE_LIMIT_POLICIES[key];
	const max = DEPLOYMENT_LIMITS[key]?.();
	return max === undefined ? policy : { ...policy, max };
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
		policy: rateLimitPolicy(policy),
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
		{ policy: rateLimitPolicy(policy), subject, scope },
		amount,
	);
}

/**
 * Door for slot policies: holds one of the policy's `max` slots until `release()`.
 * ```ts
 * const slot = await holdRateLimitSlot("managedGenerationSlots", DEPLOYMENT);
 * try { … } finally { await slot.release(); }
 * ```
 * The holder id is minted here, so no caller can name (and release) another request's slot.
 */
export function holdRateLimitSlot(
	policy: RateLimitPolicyKey,
	subject: string,
	scope?: string,
): Promise<RateLimitSlotHold> {
	return holdSlot(
		rateLimitStore(),
		{ policy: rateLimitPolicy(policy), subject, scope },
		randomUUID(),
	);
}

/**
 * What a policy's counter or slots hold right now, for the operations console only. Never feed this
 * into a decision (`store.ts` §observe; `boundaries.test.ts` pins its one caller). Throws when the
 * store cannot be read; the caller reports that as unknown, never as 0.
 */
export function observeRateLimit(
	policy: RateLimitPolicyKey,
	subject: string,
	scope?: string,
): Promise<RateLimitObservation | null> {
	const resolved = rateLimitPolicy(policy);
	return rateLimitStore().observe(
		rateLimitKey(resolved.name, subject, scope),
		resolved.unit === "slots" ? "slots" : "counter",
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
