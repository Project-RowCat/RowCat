import { describe, expect, test } from "vitest";
import { ApiError } from "../errors.ts";
import { enforceRateLimit, rateLimitKey, reserveRateLimit } from "./limiter.ts";
import { createMemoryRateLimitStore } from "./memory-store.ts";
import type { RateLimitPolicy } from "./policy.ts";
import type { RateLimitStore } from "./store.ts";

/**
 * Checks the limiter's decisions by value. The store is the in-process adapter, not real Redis,
 * because what is tested is policy interpretation (from which count it rejects, what goes out when
 * the store dies, what enters the key). Counter atomicity is covered by `store-contract.test.ts`.
 */

const policy = (over: Partial<RateLimitPolicy> = {}): RateLimitPolicy => ({
	name: "test-policy",
	max: 3,
	windowMs: 10_000,
	subject: "member",
	onStoreFailure: "allow",
	code: "test_rate_limited",
	message: "Too many requests.",
	...over,
});

/** A store that always throws, simulating an infrastructure failure. */
const brokenStore = (): RateLimitStore => ({
	kind: "memory",
	consume: () => Promise.reject(new Error("ECONNREFUSED 10.0.0.5:6379")),
	release: () => Promise.reject(new Error("ECONNREFUSED 10.0.0.5:6379")),
	close: () => Promise.resolve(),
});

const errorOf = async (run: () => Promise<unknown>): Promise<ApiError> => {
	try {
		await run();
	} catch (error) {
		if (error instanceof ApiError) return error;
		throw error;
	}
	throw new Error("did not throw");
};

describe("ceiling decision", () => {
	test("passes up to the ceiling and rejects the next", async () => {
		const store = createMemoryRateLimitStore();
		const p = policy({ max: 3 });

		// All three, including the last allowed request, must pass.
		for (let i = 0; i < 3; i++)
			await expect(
				enforceRateLimit(store, { policy: p, subject: "alice" }),
			).resolves.toBeUndefined();

		const error = await errorOf(() =>
			enforceRateLimit(store, { policy: p, subject: "alice" }),
		);
		expect(error.status).toBe(429);
		expect(error.code).toBe("test_rate_limited");
		expect(error.message).toBe("Too many requests.");
		await store.close();
	});

	test("different subjects do not share a ceiling", async () => {
		const store = createMemoryRateLimitStore();
		const p = policy({ max: 1 });
		await enforceRateLimit(store, { policy: p, subject: "alice" });
		await expect(
			enforceRateLimit(store, { policy: p, subject: "bob" }),
		).resolves.toBeUndefined();
		await store.close();
	});

	test("different policies do not mix counters even for the same subject", async () => {
		const store = createMemoryRateLimitStore();
		const a = policy({ name: "policy-a", max: 1 });
		const b = policy({ name: "policy-b", max: 1 });
		await enforceRateLimit(store, { policy: a, subject: "alice" });
		await expect(
			enforceRateLimit(store, { policy: b, subject: "alice" }),
		).resolves.toBeUndefined();
		await store.close();
	});

	test("different scopes split the counters", async () => {
		const store = createMemoryRateLimitStore();
		const p = policy({ max: 1 });
		await enforceRateLimit(store, {
			policy: p,
			subject: "alice",
			scope: "story-1",
		});
		await expect(
			enforceRateLimit(store, {
				policy: p,
				subject: "alice",
				scope: "story-2",
			}),
		).resolves.toBeUndefined();
		await store.close();
	});

	test("passes again once the window has passed", async () => {
		const store = createMemoryRateLimitStore();
		const p = policy({ max: 1, windowMs: 150 });
		await enforceRateLimit(store, { policy: p, subject: "alice" });
		await expect(
			enforceRateLimit(store, { policy: p, subject: "alice" }),
		).rejects.toBeInstanceOf(ApiError);

		await new Promise((r) => setTimeout(r, 200));
		await expect(
			enforceRateLimit(store, { policy: p, subject: "alice" }),
		).resolves.toBeUndefined();
		await store.close();
	});

	/**
	 * Hammering past the limit keeps raising the counter but the window still ends on time. If this
	 * broke, a throttled person would stay locked out just by retrying.
	 */
	test("knocking on after a rejection does not extend the window", async () => {
		const store = createMemoryRateLimitStore();
		const p = policy({ max: 1, windowMs: 200 });
		await enforceRateLimit(store, { policy: p, subject: "alice" });
		for (let i = 0; i < 5; i++) {
			await new Promise((r) => setTimeout(r, 30));
			await expect(
				enforceRateLimit(store, { policy: p, subject: "alice" }),
			).rejects.toBeInstanceOf(ApiError);
		}
		await new Promise((r) => setTimeout(r, 100));
		await expect(
			enforceRateLimit(store, { policy: p, subject: "alice" }),
		).resolves.toBeUndefined();
		await store.close();
	});
});

describe("Retry-After", () => {
	test("a rejection always carries a wait of at least one second", async () => {
		const store = createMemoryRateLimitStore();
		const p = policy({ max: 1, windowMs: 10_000 });
		await enforceRateLimit(store, { policy: p, subject: "alice" });
		const error = await errorOf(() =>
			enforceRateLimit(store, { policy: p, subject: "alice" }),
		);
		expect(error.retryAfterSeconds).toBeGreaterThan(0);
		expect(error.retryAfterSeconds).toBeLessThanOrEqual(10);
		await store.close();
	});

	/**
	 * Never emit 0 even when under a second remains: `Retry-After: 0` means "right now", so a client
	 * would retry immediately and get another 429.
	 */
	test("not zero even when less than a second remains", async () => {
		const store = createMemoryRateLimitStore();
		const p = policy({ max: 1, windowMs: 300 });
		await enforceRateLimit(store, { policy: p, subject: "alice" });
		await new Promise((r) => setTimeout(r, 120));
		const error = await errorOf(() =>
			enforceRateLimit(store, { policy: p, subject: "alice" }),
		);
		expect(error.retryAfterSeconds).toBe(1);
		await store.close();
	});
});

describe("storage failure — the policy decides", () => {
	test("allow lets it through", async () => {
		await expect(
			enforceRateLimit(brokenStore(), {
				policy: policy({ onStoreFailure: "allow" }),
				subject: "alice",
			}),
		).resolves.toBeUndefined();
	});

	/**
	 * Fail-closed is a 503, not a 429: the client did nothing, so a 429 would make the user think they
	 * were too fast, and keep thinking so while no amount of waiting helps.
	 */
	test("deny is 503, not 429", async () => {
		const error = await errorOf(() =>
			enforceRateLimit(brokenStore(), {
				policy: policy({ onStoreFailure: "deny" }),
				subject: "alice",
			}),
		);
		expect(error.status).toBe(503);
		expect(error.retryAfterSeconds).toBeGreaterThan(0);
	});

	/** The raw error carries host and port; the user-facing message must not. */
	test("the raw Redis error does not leak into the user response", async () => {
		const error = await errorOf(() =>
			enforceRateLimit(brokenStore(), {
				policy: policy({ onStoreFailure: "deny" }),
				subject: "alice",
			}),
		);
		expect(error.message).not.toMatch(/ECONNREFUSED|6379|10\.0\.0\.5|redis/i);
	});
});

describe("storage keys", () => {
	test("the policy name is plain text and the subject does not remain", () => {
		const key = rateLimitKey("story-comment-create", "member-alice-123");
		expect(key.startsWith("rl:1:story-comment-create:")).toBe(true);
		expect(key).not.toContain("member-alice-123");
		expect(key).not.toContain("alice");
	});

	/**
	 * Some subjects are real secrets (the guardian consent token). Without a hash-always rule, each
	 * new policy author would redo that judgment, and one mistake leaves the secret in Redis keys,
	 * `MONITOR`, backups and the slowlog.
	 */
	test("passing a secret as the subject leaves no raw value in the key", () => {
		const secret = "guardian-consent-token-9f2c8ab41d";
		const key = rateLimitKey("guardian-verify", secret);
		expect(key).not.toContain(secret);
		expect(key).not.toContain("guardian-consent-token");
		expect(key).toMatch(/^rl:1:guardian-verify:[0-9a-f]{32}$/);
	});

	test("the same input gives the same key", () => {
		expect(rateLimitKey("p", "alice")).toBe(rateLimitKey("p", "alice"));
	});

	/**
	 * Without a separator between scope and subject, `("a", "bc")` and `("ab", "c")` would share a
	 * key, silently merging the counters of two resources.
	 */
	test("the boundary between scope and subject is unambiguous", () => {
		expect(rateLimitKey("p", "bc", "a")).not.toBe(rateLimitKey("p", "c", "ab"));
	});

	test("a key with a scope differs from one without", () => {
		expect(rateLimitKey("p", "alice")).not.toBe(
			rateLimitKey("p", "alice", "story-1"),
		);
	});
});

describe("reservation — bytes policy", () => {
	const bytes = (over: Partial<RateLimitPolicy> = {}) =>
		policy({ name: "test-bytes", unit: "bytes", max: 100, ...over });

	test("only what was used remains, and the rest comes back", async () => {
		const store = createMemoryRateLimitStore();
		const request = { policy: bytes(), subject: "m-1" };
		const first = await reserveRateLimit(store, request, 40);
		await first.settle(10);
		/** Only 10 is left used, so 90 more can be reserved (100 or less). */
		const second = await reserveRateLimit(store, request, 90);
		await second.settle(90);
		await expect(reserveRateLimit(store, request, 1)).rejects.toMatchObject({
			status: 429,
			code: "test_rate_limited",
		});
		await store.close();
	});

	/**
	 * Bytes never received are not bytes used. If rejected reservations stayed, a few concurrent
	 * legitimate requests being rejected would lock the whole member out until the window ends.
	 */
	test("a refused reservation leaves nothing behind", async () => {
		const store = createMemoryRateLimitStore();
		const request = { policy: bytes(), subject: "m-1" };
		const held = await reserveRateLimit(store, request, 80);
		for (let i = 0; i < 5; i += 1)
			await expect(reserveRateLimit(store, request, 30)).rejects.toMatchObject({
				status: 429,
			});
		await held.settle(0);
		/** All 80 came back and the five rejected left no trace, so the full 100 can be taken again. */
		await expect(reserveRateLimit(store, request, 100)).resolves.toBeDefined();
		await store.close();
	});

	test("settling happens once — calling it twice does not give back twice", async () => {
		const store = createMemoryRateLimitStore();
		const request = { policy: bytes(), subject: "m-1" };
		await (await reserveRateLimit(store, request, 50)).settle(50);
		const reservation = await reserveRateLimit(store, request, 50);
		await reservation.settle(0);
		await reservation.settle(0);
		/** The first 50 stayed used; had the second settle given that back too, 100 would fit. */
		await expect(reserveRateLimit(store, request, 51)).rejects.toMatchObject({
			status: 429,
		});
		await store.close();
	});

	test("never counts more than the reservation as used, and negative is zero", async () => {
		const store = createMemoryRateLimitStore();
		const request = { policy: bytes(), subject: "m-1" };
		await (await reserveRateLimit(store, request, 30)).settle(10_000);
		await (await reserveRateLimit(store, request, 30)).settle(-5);
		/** 30 + 0 = 30 remains. */
		await expect(reserveRateLimit(store, request, 70)).resolves.toBeDefined();
		await store.close();
	});

	/** Unknown is not 0: count it as fully used so the budget does not open the day metering breaks. */
	test("usage that can't be read counts as the whole reservation", async () => {
		const store = createMemoryRateLimitStore();
		const request = { policy: bytes(), subject: "m-1" };
		await (await reserveRateLimit(store, request, 60)).settle(Number.NaN);
		await expect(reserveRateLimit(store, request, 41)).rejects.toMatchObject({
			status: 429,
		});
		await store.close();
	});

	test("different members do not share a budget", async () => {
		const store = createMemoryRateLimitStore();
		await reserveRateLimit(store, { policy: bytes(), subject: "alice" }, 100);
		await expect(
			reserveRateLimit(store, { policy: bytes(), subject: "bob" }, 100),
		).resolves.toBeDefined();
		await store.close();
	});

	test("when storage is down the policy decides — fail-open passes and settling does not throw", async () => {
		const reservation = await reserveRateLimit(
			brokenStore(),
			{ policy: bytes(), subject: "m-1" },
			40,
		);
		await expect(reservation.settle(10)).resolves.toBeUndefined();
		await expect(
			reserveRateLimit(
				brokenStore(),
				{ policy: bytes({ onStoreFailure: "deny" }), subject: "m-1" },
				40,
			),
		).rejects.toMatchObject({ status: 503 });
	});

	/** A door of the wrong unit throws on the spot instead of silently counting 1 byte. */
	test("throws when the door and the policy's unit disagree", async () => {
		const store = createMemoryRateLimitStore();
		await expect(
			enforceRateLimit(store, { policy: bytes(), subject: "m-1" }),
		).rejects.toThrow(/reserve/);
		await expect(
			reserveRateLimit(store, { policy: policy(), subject: "m-1" }, 10),
		).rejects.toThrow(/check/);
		await store.close();
	});
});
