import { afterAll, describe, expect, test } from "vitest";
import { createMemoryRateLimitStore } from "./memory-store.ts";
import { createRedisRateLimitStore } from "./redis-store.ts";
import type { RateLimitStore } from "./store.ts";

/**
 * One port, two adapters, run against the same table.
 *
 * No mock on purpose: a JavaScript transcription of the Lua script would fail together with the
 * implementation, so a pass would say nothing. The comparison is between two independently
 * implemented adapters, and both passing the same table is the evidence that the port contract
 * exists.
 *
 * The Redis adapter hits a real Redis and is skipped, not failed, when absent. This follows the
 * repo's Postgres-test convention (`vitest.config.ts` header), which matters here because running
 * without Redis is this deployment's normal development shape.
 */

/** Short window: some tests really wait for expiry. */
const WINDOW_MS = 200;

let redisClient: Awaited<ReturnType<typeof connectRedis>> = null;

async function connectRedis() {
	const url = process.env.REDIS_TEST_URL || process.env.REDIS_URL;
	if (!url) return null;
	const { default: Redis } = await import("ioredis");
	const client = new Redis(url, {
		lazyConnect: true,
		maxRetriesPerRequest: 0,
		enableOfflineQueue: false,
		commandTimeout: 500,
		connectTimeout: 500,
		retryStrategy: () => null,
	});
	client.on("error", () => {});
	try {
		await client.connect();
		await client.ping();
		return client;
	} catch {
		client.disconnect();
		return null;
	}
}

redisClient = await connectRedis();
if (!redisClient) {
	console.warn(
		"[rate-limit.test] couldn't connect to Redis, so the adapter integration check is skipped — set REDIS_TEST_URL to run it",
	);
}

afterAll(async () => {
	if (redisClient) await redisClient.quit().catch(() => {});
});

/** A fresh key per test, so sharing one Redis does not make tests trample each other. */
let counter = 0;
const freshKey = (label: string) =>
	`rl:test:${label}:${process.pid}:${Date.now()}:${counter++}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Adapter {
	label: string;
	skip: boolean;
	create: () => RateLimitStore;
}

const ADAPTERS: Adapter[] = [
	{
		label: "memory",
		skip: false,
		create: createMemoryRateLimitStore,
	},
	{
		label: "redis",
		skip: !redisClient,
		create: () => {
			if (!redisClient) throw new Error("unreachable — skip blocks it");
			return createRedisRateLimitStore(redisClient);
		},
	},
];

for (const adapter of ADAPTERS) {
	describe.skipIf(adapter.skip)(
		`RateLimitStore contract — ${adapter.label}`,
		() => {
			test("the first call answers 1 and opens the window", async () => {
				const store = adapter.create();
				const first = await store.consume(freshKey("first"), WINDOW_MS);
				expect(first.count).toBe(1);
				expect(first.resetMs).toBeGreaterThan(0);
				expect(first.resetMs).toBeLessThanOrEqual(WINDOW_MS);
				await store.close();
			});

			test("repeated calls on the same key increase monotonically", async () => {
				const store = adapter.create();
				const key = freshKey("monotonic");
				const counts: number[] = [];
				for (let i = 0; i < 5; i++)
					counts.push((await store.consume(key, WINDOW_MS)).count);
				expect(counts).toEqual([1, 2, 3, 4, 5]);
				await store.close();
			});

			test("different keys don't see each other's counters", async () => {
				const store = adapter.create();
				const a = freshKey("iso-a");
				const b = freshKey("iso-b");
				await store.consume(a, WINDOW_MS);
				await store.consume(a, WINDOW_MS);
				expect((await store.consume(b, WINDOW_MS)).count).toBe(1);
				await store.close();
			});

			test("starts from 1 again once the window has passed", async () => {
				const store = adapter.create();
				const key = freshKey("expiry");
				await store.consume(key, WINDOW_MS);
				await store.consume(key, WINDOW_MS);
				await sleep(WINDOW_MS + 80);
				expect((await store.consume(key, WINDOW_MS)).count).toBe(1);
				await store.close();
			});

			/**
			 * The window is never pushed out. Without this, a throttled client could extend its own window
			 * just by hammering and stay locked forever. It is a defect from imitating a sliding window, and
			 * "only some users never get released" is hard to reproduce.
			 */
			test("repeated calls inside the window don't push the expiry back", async () => {
				const store = adapter.create();
				const key = freshKey("no-slide");
				const opened = await store.consume(key, WINDOW_MS);
				await sleep(80);
				const later = await store.consume(key, WINDOW_MS);
				expect(later.resetMs).toBeLessThan(opened.resetMs);
				await store.close();
			});

			test("a weight raises it by that much — the window-opening first call too", async () => {
				const store = adapter.create();
				const key = freshKey("cost");
				expect((await store.consume(key, WINDOW_MS, 7)).count).toBe(7);
				expect((await store.consume(key, WINDOW_MS, 5)).count).toBe(12);
				expect((await store.consume(key, WINDOW_MS)).count).toBe(13);
				await store.close();
			});

			test("goes down by what is given back, and never below 0", async () => {
				const store = adapter.create();
				const key = freshKey("release");
				await store.consume(key, 5_000, 10);
				await store.release(key, 4);
				expect((await store.consume(key, 5_000, 1)).count).toBe(7);
				await store.release(key, 1_000);
				expect((await store.consume(key, 5_000, 1)).count).toBe(1);
				await store.close();
			});

			/**
			 * Giving back to a passed window would start the next window negative, creating free budget of
			 * the reserved amount. Giving back to a missing key must create nothing.
			 */
			test("with no window, giving back creates nothing", async () => {
				const store = adapter.create();
				const key = freshKey("release-missing");
				await store.release(key, 50);
				expect((await store.consume(key, WINDOW_MS, 3)).count).toBe(3);

				const expired = freshKey("release-expired");
				await store.consume(expired, WINDOW_MS, 10);
				await sleep(WINDOW_MS + 80);
				await store.release(expired, 10);
				expect((await store.consume(expired, WINDOW_MS, 2)).count).toBe(2);
				await store.close();
			});

			test("giving back does not push the expiry", async () => {
				const store = adapter.create();
				const key = freshKey("release-ttl");
				const opened = await store.consume(key, WINDOW_MS, 5);
				await sleep(80);
				await store.release(key, 2);
				const later = await store.consume(key, WINDOW_MS, 1);
				expect(later.resetMs).toBeLessThan(opened.resetMs);
				expect(later.count).toBe(4);
				await store.close();
			});

			/**
			 * Concurrency is the whole reason for this table. Sequential calls cannot test atomicity, so
			 * twenty calls on one key launch at once and the returned values must be a permutation of 1..20.
			 * A read-decide-increment implementation lets two calls receive the same number and leaves a
			 * hole in that set.
			 */
			test("concurrent calls never hand out the same number twice", async () => {
				const store = adapter.create();
				const key = freshKey("race");
				const CONCURRENCY = 20;
				const results = await Promise.all(
					Array.from({ length: CONCURRENCY }, () =>
						store.consume(key, 5_000).then((r) => r.count),
					),
				);
				expect([...results].sort((a, b) => a - b)).toEqual(
					Array.from({ length: CONCURRENCY }, (_, i) => i + 1),
				);
				await store.close();
			});
		},
	);
}

/**
 * Assertions for the Redis adapter only: keys always expire. In the in-process adapter the question
 * has a different shape (map entries carry an expiry time and the sweep removes them), so it cannot
 * go in the shared table. On Redis the failure costs far more: one key with no TTL means that
 * account is blocked for that policy permanently (the counter never shrinks) and stays in Redis
 * memory forever.
 */
describe.skipIf(!redisClient)("Redis adapter — expiry", () => {
	test("a key consume creates always gets a TTL", async () => {
		if (!redisClient) return;
		const store = createRedisRateLimitStore(redisClient);
		const key = freshKey("ttl");
		await store.consume(key, 5_000);
		const ttl = await redisClient.pttl(key);
		// -1 = no expiry, -2 = no key. Both are failures.
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(5_000);
		await redisClient.del(key);
	});

	/**
	 * Regression test: the first command after boot must succeed. The other tests use an already
	 * connected client and cannot test this, so here a new connection is made with the same options as
	 * `lib/redis.ts` and the first command goes out immediately.
	 *
	 * The config was originally `enableOfflineQueue: false`; in that combination a command arriving
	 * before the connection is established cannot use the queue and is rejected at once, and that
	 * command is the first request after boot. With Redis healthy, the first request of fail-closed
	 * policies (adult verification, guardian consent) got a 503, caught by those two route tests. This
	 * reproduces that failure directly at the adapter layer.
	 */
	test("the first command on a fresh connection succeeds", async () => {
		if (!redisClient) return;
		const { default: Redis } = await import("ioredis");
		const fresh = new Redis(
			process.env.REDIS_TEST_URL || process.env.REDIS_URL || "",
			{
				lazyConnect: true,
				enableOfflineQueue: true,
				maxRetriesPerRequest: 0,
				commandTimeout: 500,
				connectTimeout: 500,
				retryStrategy: (attempt: number) => Math.min(attempt * 200, 5_000),
			},
		);
		fresh.on("error", () => {});
		const key = freshKey("cold-start");
		try {
			const store = createRedisRateLimitStore(fresh);
			// Do not warm the connection first; that is the whole test.
			const result = await store.consume(key, 5_000);
			expect(result.count).toBe(1);
		} finally {
			await fresh.del(key).catch(() => {});
			fresh.disconnect();
		}
	});

	/**
	 * A key left without TTL because the process died right after `INCR`. The common implementation
	 * (`if count == 1 then EXPIRE`) never recovers from this, since the key never becomes 1 again and
	 * gets no chance at an expiry. This script always attaches a TTL when missing.
	 */
	test("the next consume also fixes a key left without a TTL", async () => {
		if (!redisClient) return;
		const store = createRedisRateLimitStore(redisClient);
		const key = freshKey("orphan");
		await redisClient.set(key, "7");
		expect(await redisClient.pttl(key)).toBe(-1);

		const result = await store.consume(key, 5_000);
		expect(result.count).toBe(8);
		expect(await redisClient.pttl(key)).toBeGreaterThan(0);
		await redisClient.del(key);
	});
});
