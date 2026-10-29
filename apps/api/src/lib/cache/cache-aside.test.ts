import { afterEach, describe, expect, test, vi } from "vitest";
import { __setCacheStoreForTest, cacheAside } from "./index.ts";
import { type CacheStore, DISABLED_CACHE_STORE } from "./store.ts";

/**
 * The cache is an optimization, not a source of truth. The swapped-in store is a second
 * implementation of the same port rather than a mock (two methods leave no logic to imitate).
 * Redis's own failures are covered by the adapter test.
 */

/** In-process store honouring the contract (`get` returns null on a miss, `set` does not throw). */
function memoryStore(seed: Record<string, unknown> = {}) {
	const entries = new Map<string, { value: unknown; ttlMs: number }>(
		Object.entries(seed).map(([key, value]) => [key, { value, ttlMs: 0 }]),
	);
	const store: CacheStore & {
		entries: typeof entries;
		gets: string[];
	} = {
		kind: "redis",
		entries,
		gets: [],
		get(key) {
			store.gets.push(key);
			return Promise.resolve(entries.get(key)?.value ?? null);
		},
		set(key, value, ttlMs) {
			entries.set(key, { value, ttlMs });
			return Promise.resolve();
		},
	};
	return store;
}

const identity = (raw: unknown): unknown => raw;

afterEach(() => {
	__setCacheStoreForTest(null);
});

describe("cacheAside", () => {
	test("a hit does not call load", async () => {
		__setCacheStoreForTest(memoryStore({ k: { total: 7 } }));
		const load = vi.fn(() => Promise.resolve({ total: 0 }));

		await expect(
			cacheAside({ key: "k", ttlMs: 30_000, decode: identity, load }),
		).resolves.toEqual({ total: 7 });
		expect(load).not.toHaveBeenCalled();
	});

	test("a miss returns load's value as is and writes it with the TTL", async () => {
		const store = memoryStore();
		__setCacheStoreForTest(store);
		const fresh = { total: 3 };

		await expect(
			cacheAside({
				key: "k",
				ttlMs: 30_000,
				decode: identity,
				load: () => Promise.resolve(fresh),
			}),
		).resolves.toBe(fresh);
		expect(store.entries.get("k")).toEqual({ value: fresh, ttlMs: 30_000 });
	});

	// An undecodable value is a miss and gets overwritten; that side effect is how a corrupt slot
	// self-heals.
	test("a null decode is a miss and is overwritten with the right value", async () => {
		const store = memoryStore({ k: { shape: "old version" } });
		__setCacheStoreForTest(store);

		await expect(
			cacheAside({
				key: "k",
				ttlMs: 30_000,
				decode: (raw) =>
					typeof raw === "object" && raw !== null && "total" in raw
						? (raw as { total: number })
						: null,
				load: () => Promise.resolve({ total: 1 }),
			}),
		).resolves.toEqual({ total: 1 });
		expect(store.entries.get("k")?.value).toEqual({ total: 1 });
	});

	// Postgres failures are not swallowed: that would turn a DB outage into an empty list, a lie that
	// there are no stories.
	test("rethrows when load throws", async () => {
		__setCacheStoreForTest(memoryStore());
		await expect(
			cacheAside({
				key: "k",
				ttlMs: 30_000,
				decode: identity,
				load: () => Promise.reject(new Error("db down")),
			}),
		).rejects.toThrow("db down");
	});

	/** A failure left in the in-flight table would replicate one error to later requests for the key. */
	test("a failed run does not poison the next call", async () => {
		__setCacheStoreForTest(memoryStore());
		await expect(
			cacheAside({
				key: "k",
				ttlMs: 30_000,
				decode: identity,
				load: () => Promise.reject(new Error("db down")),
			}),
		).rejects.toThrow();

		await expect(
			cacheAside({
				key: "k",
				ttlMs: 30_000,
				decode: identity,
				load: () => Promise.resolve({ total: 5 }),
			}),
		).resolves.toEqual({ total: 5 });
	});

	// Requests arriving at expiry must not each run the aggregation; this prevents the in-process case
	// only, not a distributed one.
	test("concurrent requests for the same key call load once", async () => {
		__setCacheStoreForTest(memoryStore());
		// Create the promise up front: made inside `load`, its executor would run after the `store.get`
		// microtask and the test could only release it by timing.
		let resolveLoad!: (value: { total: number }) => void;
		const pending = new Promise<{ total: number }>((resolve) => {
			resolveLoad = resolve;
		});
		const load = vi.fn(() => pending);

		// The second call arrives before the first's `store.get` finishes.
		const a = cacheAside({ key: "k", ttlMs: 30_000, decode: identity, load });
		const b = cacheAside({ key: "k", ttlMs: 30_000, decode: identity, load });
		resolveLoad({ total: 9 });

		await expect(a).resolves.toEqual({ total: 9 });
		await expect(b).resolves.toEqual({ total: 9 });
		expect(load).toHaveBeenCalledTimes(1);
	});

	test("concurrent requests for different keys each run", async () => {
		__setCacheStoreForTest(memoryStore());
		const load = vi.fn(() => Promise.resolve({ total: 1 }));
		await Promise.all([
			cacheAside({ key: "a", ttlMs: 30_000, decode: identity, load }),
			cacheAside({ key: "b", ttlMs: 30_000, decode: identity, load }),
		]);
		expect(load).toHaveBeenCalledTimes(2);
	});

	/** Deployment without `REDIS_URL`: exactly the pre-cache behaviour. */
	test("load always runs when the cache is disabled", async () => {
		__setCacheStoreForTest(DISABLED_CACHE_STORE);
		const load = vi.fn(() => Promise.resolve({ total: 2 }));

		await expect(
			cacheAside({ key: "k", ttlMs: 30_000, decode: identity, load }),
		).resolves.toEqual({ total: 2 });
		await expect(
			cacheAside({ key: "k", ttlMs: 30_000, decode: identity, load }),
		).resolves.toEqual({ total: 2 });
		expect(load).toHaveBeenCalledTimes(2);
	});
});
