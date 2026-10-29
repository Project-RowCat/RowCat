import { createHash } from "node:crypto";
import {
	retryAfterSecondsFrom,
	serviceUnavailable,
	tooManyRequests,
} from "../errors.ts";
import type { RateLimitPolicy } from "./policy.ts";
import type { RateLimitStore } from "./store.ts";

/**
 * Policy + subject -> pass or 429. The only place a rate-limit decision is made.
 *
 * It knows what a policy means but not where counters live (that is behind the port), so stores can
 * be swapped and tests can check policy, rejection and wait time by value on the in-process
 * adapter.
 *
 * Key shape, and why the subject is always hashed:
 *
 * ```text
 * rl:1:<policy name>:<first 32 hex of sha256(scope \0 subject)>
 *    |  |             the plaintext never survives
 *    |  keeps counters of different policies apart
 *    key-format version, so a new algorithm cannot collide with old counters
 * ```
 *
 * Subjects are server-verified ids today and not secret, but hashing is unconditional so a new
 * policy over a more sensitive identity needs no "hash this one too" judgment, and Redis `MONITOR`,
 * `KEYS`, backups and the slowlog only ever hold fixed-length digests. Same judgment as
 * `sync_pairing` storing `codeHash` rather than the code (`docs/sync/ARCHITECTURE.md` §13).
 *
 * No payload (comment text, report reason, prompt, mail body) ever reaches a key; the signature has
 * no slot for one.
 *
 * Key TTL equals the window and is attached by the store. Neither adapter can create a key without
 * expiry (the Redis script always sets a TTL when missing).
 */

/** Bump when the hash method or scope separator changes. */
const KEY_VERSION = "1";

/** 32 hex chars = 128 bits: collisions are impossible at this scale, and keys are shorter than the full 64. */
const HASH_LENGTH = 32;

export interface RateLimitRequest {
	readonly policy: RateLimitPolicy;
	/**
	 * What is counted: a member id or a verified consent request id (the policy's `subject` fixes the
	 * kind). Never pass a client-chosen value unvalidated.
	 */
	readonly subject: string;
	/**
	 * Optional resource scope (e.g. a story id) for counting within one resource; global when absent.
	 * No policy uses it yet. The slot exists so a later per-story limit does not make callers
	 * concatenate two values into `subject`, each inventing its own separator.
	 */
	readonly scope?: string;
}

/**
 * Reports a store failure at a different severity than a rejection.
 *
 * A normal 429 logs nothing (the limiter doing its job; logging would let one script flood the
 * log). A store read failure is infrastructure, so it logs at error. The raw error is omitted
 * because ioredis messages carry host and port. The subject is not logged, not even hashed.
 */
function logStoreFailure(policy: RateLimitPolicy, error: unknown): void {
	console.error(
		`[rate-limit] store unavailable: policy=${policy.name} ` +
			`mode=${policy.onStoreFailure} error=${error instanceof Error ? error.name : "unknown"}`,
	);
}

/**
 * Throws when the request is over the policy. It returns no boolean because a caller could ignore
 * it, and code that calls the limiter without checking the result is indistinguishable in review
 * from code with no limiter.
 */
export async function enforceRateLimit(
	store: RateLimitStore,
	{ policy, subject, scope }: RateLimitRequest,
): Promise<void> {
	/** A bytes policy counted per request would count 1 byte each and block nothing. */
	if (policy.unit === "bytes")
		throw new Error(
			`${policy.name} is a policy that counts amounts — call it through reserve`,
		);
	const key = rateLimitKey(policy.name, subject, scope);

	let consumption: Awaited<ReturnType<RateLimitStore["consume"]>>;
	try {
		consumption = await store.consume(key, policy.windowMs);
	} catch (error) {
		logStoreFailure(policy, error);
		/**
		 * `allow` passes as if there were no limiter; `deny` is a 503, not a 429, because the client did
		 * nothing wrong. The cause is in the log only.
		 */
		if (policy.onStoreFailure === "deny")
			throw serviceUnavailable(
				"Temporarily unavailable. Please try again in a moment.",
				policy.code,
				retryAfterSecondsFrom(STORE_FAILURE_RETRY_MS),
			);
		return;
	}

	if (consumption.count <= policy.max) return;

	throw tooManyRequests(
		policy.message,
		policy.code,
		retryAfterSecondsFrom(consumption.resetMs),
	);
}

/**
 * Reservation for an amount-counting policy: take the maximum on entry, confirm the used amount
 * afterwards.
 *
 * `settle(used)` gives back the rest. It returns the remainder once even if called twice (`finally`
 * and cancellation can overlap), and never throws: a failed give-back only over-counts, which is no
 * reason to fail a response that already finished.
 */
export interface RateLimitReservation {
	settle(used: number): Promise<void>;
}

const SETTLED: RateLimitReservation = { settle: () => Promise.resolve() };

/**
 * Throws 429 when the window budget is exceeded, giving back the amount just taken.
 *
 * Differs from count policies, which also count rejected requests (`store.ts` header): a rejected
 * reservation is not kept. Otherwise a few concurrent legitimate requests being rejected would each
 * burn a full response cap of budget for nothing received and lock the whole member out until the
 * window ends.
 */
export async function reserveRateLimit(
	store: RateLimitStore,
	{ policy, subject, scope }: RateLimitRequest,
	amount: number,
): Promise<RateLimitReservation> {
	if (policy.unit !== "bytes")
		throw new Error(
			`${policy.name} is a policy that counts calls — call it through check`,
		);
	const key = rateLimitKey(policy.name, subject, scope);

	let consumption: Awaited<ReturnType<RateLimitStore["consume"]>>;
	try {
		consumption = await store.consume(key, policy.windowMs, amount);
	} catch (error) {
		logStoreFailure(policy, error);
		if (policy.onStoreFailure === "deny")
			throw serviceUnavailable(
				"Temporarily unavailable. Please try again in a moment.",
				policy.code,
				retryAfterSecondsFrom(STORE_FAILURE_RETRY_MS),
			);
		/** An uncounted reservation has nothing to give back. */
		return SETTLED;
	}

	const giveBack = async (unused: number): Promise<void> => {
		if (unused <= 0) return;
		try {
			await store.release(key, unused);
		} catch (error) {
			logStoreFailure(policy, error);
		}
	};

	if (consumption.count > policy.max) {
		await giveBack(amount);
		throw tooManyRequests(
			policy.message,
			policy.code,
			retryAfterSecondsFrom(consumption.resetMs),
		);
	}

	let settled = false;
	return {
		async settle(used: number): Promise<void> {
			if (settled) return;
			settled = true;
			/**
			 * Never charge more than reserved (an overshoot is at most the last chunk). An unreadable value
			 * counts as fully used: folding unknown into 0 would open the whole budget the day metering
			 * breaks, so err toward the expensive side.
			 */
			const charged = Number.isFinite(used)
				? Math.min(Math.max(0, Math.floor(used)), amount)
				: amount;
			await giveBack(amount - charged);
		},
	};
}

/**
 * Wait quoted by a fail-closed response when the store is down. Not the window length, which means
 * "the counter is full". Short because Redis usually returns within seconds, and a long value makes
 * clients avoid an already-recovered service.
 */
const STORE_FAILURE_RETRY_MS = 5_000;

/** Exported so tests can check the key rule by value; feature code calling it would be building keys itself. */
export function rateLimitKey(
	policyName: string,
	subject: string,
	scope?: string,
): string {
	/** Joined with `\0`, which no input can contain, so ("a", "bc") and ("ab", "c") never share a key. */
	const digest = createHash("sha256")
		.update(scope ? `${scope}\0${subject}` : subject)
		.digest("hex")
		.slice(0, HASH_LENGTH);
	return `rl:${KEY_VERSION}:${policyName}:${digest}`;
}
