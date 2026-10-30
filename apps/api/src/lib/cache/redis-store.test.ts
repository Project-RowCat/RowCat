import type Redis from "ioredis";
import { afterAll, describe, expect, test, vi } from "vitest";
import { failIfServiceRequired } from "../../test/required-services.ts";
import { createRedisCacheStore } from "./redis-store.ts";

/**
 * The adapter's contract is "always answers". What is simulated is Redis failure, not behaviour:
 * the argument against re-writing Lua in JavaScript (header of `rate-limit/store-contract.test.ts`)
 * does not apply since this fake holds no logic and only returns or throws fixed values. Whether
 * values really flow is checked by the real-Redis block below.
 */

/** Minimal fake with only `get` and `set`; the adapter calls nothing else. */
function fakeRedis(behavior: {
	get?: () => Promise<string | null>;
	set?: () => Promise<"OK">;
}) {
	const get = vi.fn(behavior.get ?? (() => Promise.resolve(null)));
	const set = vi.fn(behavior.set ?? (() => Promise.resolve("OK" as const)));
	return { client: { get, set } as unknown as Redis, get, set };
}

describe("Redis cache adapter", () => {
	test("kind is redis", () => {
		expect(createRedisCacheStore(fakeRedis({}).client).kind).toBe("redis");
	});

	test("returns the stored JSON as a value", async () => {
		const { client } = fakeRedis({
			get: () => Promise.resolve(JSON.stringify({ total: 2 })),
		});
		await expect(createRedisCacheStore(client).get("k")).resolves.toEqual({
			total: 2,
		});
	});

	test("a missing key is null", async () => {
		const { client } = fakeRedis({ get: () => Promise.resolve(null) });
		await expect(createRedisCacheStore(client).get("k")).resolves.toBeNull();
	});

	// Throwing on a corrupt value would let one stray byte 500 the gallery; the value is not ours to
	// control (old-version code, hand edits, truncated writes).
	test("broken JSON is a miss", async () => {
		const { client } = fakeRedis({ get: () => Promise.resolve("{not json") });
		await expect(createRedisCacheStore(client).get("k")).resolves.toBeNull();
	});

	test("answers with a miss even when GET throws", async () => {
		const { client } = fakeRedis({
			get: () => Promise.reject(new Error("ECONNREFUSED 10.0.0.1:6379")),
		});
		await expect(createRedisCacheStore(client).get("k")).resolves.toBeNull();
	});

	// The TTL rides on the same command as the write: a separate `PEXPIRE` lets a process dying
	// between them leave a key with no expiry, and this deployment does not lean on eviction.
	test("writes with a single SET … PX command", async () => {
		const { client, set } = fakeRedis({});
		await createRedisCacheStore(client).set("k", { total: 1 }, 30_000);
		expect(set).toHaveBeenCalledWith(
			"k",
			JSON.stringify({ total: 1 }),
			"PX",
			30_000,
		);
	});

	test("does not throw even when SET throws", async () => {
		const { client } = fakeRedis({
			set: () => Promise.reject(new Error("READONLY")),
		});
		await expect(
			createRedisCacheStore(client).set("k", { a: 1 }, 30_000),
		).resolves.toBeUndefined();
	});

	/** An unserializable value is not cacheable; it must not fail the response. */
	test("a value that can't be serialized is skipped quietly", async () => {
		const { client, set } = fakeRedis({});
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		await expect(
			createRedisCacheStore(client).set("k", cyclic, 30_000),
		).resolves.toBeUndefined();
		expect(set).not.toHaveBeenCalled();
	});
});

// Real Redis; skipped when unavailable.

/**
 * The block above shows only what we sent; only a real server can say whether the command leaves
 * value and expiry. Running without Redis is this deployment's normal dev shape, so it skips
 * instead of failing (`rate-limit/store-contract.test.ts` uses the same convention).
 */
async function connectRedis() {
	const url = process.env.REDIS_TEST_URL || process.env.REDIS_URL;
	if (!url) return null;
	const { default: RedisClient } = await import("ioredis");
	const client = new RedisClient(url, {
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

const redisClient = await connectRedis();
if (!redisClient)
	failIfServiceRequired(
		"Redis",
		"REDIS_TEST_URL is unset or the server did not answer",
	);

afterAll(async () => {
	if (redisClient) await redisClient.quit().catch(() => {});
});

describe.skipIf(!redisClient)("Redis cache adapter — real server", () => {
	const freshKey = () =>
		`cache:test:${process.pid}:${Date.now()}:${Math.random()}`;

	test("the written value comes back as is with an expiry attached", async () => {
		if (!redisClient) throw new Error("unreachable — skip blocks it");
		const store = createRedisCacheStore(redisClient);
		const key = freshKey();
		const value = { items: [{ id: "a" }], total: 1 };

		await store.set(key, value, 30_000);
		await expect(store.get(key)).resolves.toEqual(value);

		// This adapter cannot create a key without an expiry.
		const ttl = await redisClient.pttl(key);
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(30_000);

		await redisClient.del(key);
	});

	test("a miss once it has expired", async () => {
		if (!redisClient) throw new Error("unreachable — skip blocks it");
		const store = createRedisCacheStore(redisClient);
		const key = freshKey();
		await store.set(key, { total: 1 }, 50);
		await new Promise((resolve) => setTimeout(resolve, 120));
		await expect(store.get(key)).resolves.toBeNull();
	});
});
