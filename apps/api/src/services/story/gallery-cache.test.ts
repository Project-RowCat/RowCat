import type { Story } from "@rowcat/domain";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __setCacheStoreForTest } from "../../lib/cache/index.ts";
import {
	type CacheStore,
	DISABLED_CACHE_STORE,
} from "../../lib/cache/store.ts";

/**
 * `listStories()` hits real Postgres. What is asserted here is whether that query runs, not its
 * result, so the boundary is swapped out: a cache hit is defined as "Postgres did not run", which
 * makes the swap part of the assertion.
 */
vi.mock("./index.ts", () => ({ listStories: vi.fn() }));

import {
	GUEST_GALLERY_CACHE_TTL_MS,
	GUEST_GALLERY_CACHED_PAGE_SIZE,
	GUEST_GALLERY_MAX_CACHED_PAGE,
	guestGalleryCacheDimensions,
	guestGalleryCacheKey,
	listGalleryStories,
} from "./gallery-cache.ts";
import { type ListStoriesOptions, listStories } from "./index.ts";

const listStoriesMock = vi.mocked(listStories);

/** Arguments of the first guest gallery page, in the shape the route actually passes. */
const guestOptions = (
	over: Partial<ListStoriesOptions> = {},
): ListStoriesOptions => ({
	orientation: null,
	adult: null,
	search: "",
	tag: null,
	viewerId: null,
	/** The route always passes `true`; without a `viewerId` it is not a predicate. */
	ownPrivateVisible: true,
	/** Discovery surfaces exclude unlisted stories; the route always passes `false`. */
	unlistedVisible: false,
	adultAllowed: false,
	ownAdultAllowed: false,
	blocked: [],
	favoritedBy: null,
	followingOf: null,
	creatorId: null,
	sort: "recent",
	period: "all",
	page: 1,
	pageSize: GUEST_GALLERY_CACHED_PAGE_SIZE,
	...over,
});

const story = (id: string): Story => ({
	id,
	title: `Story ${id}`,
	description: "description",
	author: "Author",
	coverUrl: null,
	orientation: "female",
	adult: false,
	visibility: "public",
	promptProtected: false,
	tags: ["Tag"],
	favorites: 3,
	creator: { id: "m1", nickname: "Nick" },
	playMode: "chat",
	createdAt: "2026-08-01T00:00:00.000Z",
	updatedAt: "2026-08-02T00:00:00.000Z",
	sizeBytes: 1024,
});

/** In-process store honoring the contract; records what was read and written, and when. */
function memoryStore(seed: Record<string, unknown> = {}) {
	const entries = new Map<string, { value: unknown; ttlMs: number }>(
		Object.entries(seed).map(([key, value]) => [key, { value, ttlMs: 0 }]),
	);
	const gets: string[] = [];
	const store: CacheStore = {
		kind: "redis",
		get(key) {
			gets.push(key);
			return Promise.resolve(entries.get(key)?.value ?? null);
		},
		set(key, value, ttlMs) {
			entries.set(key, { value, ttlMs });
			return Promise.resolve();
		},
	};
	return { store, entries, gets };
}

/** Key of an eligible request; throws when not eligible, since the test's premise is broken. */
function keyFor(opts: ListStoriesOptions): string {
	const dimensions = guestGalleryCacheDimensions(opts);
	if (!dimensions) throw new Error("this combination must be cache-eligible");
	return guestGalleryCacheKey(dimensions);
}

beforeEach(() => {
	listStoriesMock.mockReset();
});

afterEach(() => {
	__setCacheStoreForTest(null);
});

describe("guest gallery cache key", () => {
	const dims = (over: Partial<ListStoriesOptions> = {}) => {
		const d = guestGalleryCacheDimensions(guestOptions(over));
		if (!d) throw new Error("this combination must be cache-eligible");
		return d;
	};

	test("the same normalized filter is the same key", () => {
		expect(guestGalleryCacheKey(dims())).toBe(guestGalleryCacheKey(dims()));
	});

	test("a different sort is a different key", () => {
		expect(guestGalleryCacheKey(dims({ sort: "popular" }))).not.toBe(
			guestGalleryCacheKey(dims({ sort: "recent" })),
		);
	});

	test("under popular sort, the period splits the key", () => {
		expect(
			guestGalleryCacheKey(dims({ sort: "popular", period: "week" })),
		).not.toBe(
			guestGalleryCacheKey(dims({ sort: "popular", period: "month" })),
		);
	});

	/**
	 * Under recent sort the period does not affect the server result (`selectPage` builds no cutoff);
	 * unfolded, the same response splits over four cells. The client folds the same way
	 * (`canonicalGalleryFilters`).
	 */
	test("under recent sort, the period folds", () => {
		expect(guestGalleryCacheKey(dims({ sort: "recent", period: "week" }))).toBe(
			guestGalleryCacheKey(dims({ sort: "recent", period: "all" })),
		);
	});

	test("page and page size are part of the key", () => {
		const base = guestGalleryCacheKey(dims({ page: 1 }));
		expect(guestGalleryCacheKey(dims({ page: 2 }))).not.toBe(base);
		/** Eligibility allows one page size, but the key itself must carry that axis. */
		expect(
			guestGalleryCacheKey({ ...dims({ page: 1 }), pageSize: 12 }),
		).not.toBe(base);
	});

	test("flavor and rating don't collide", () => {
		const keys = new Set<string>();
		for (const orientation of [null, "female", "male", "all"] as const) {
			for (const adult of [null, true, false] as const) {
				keys.add(guestGalleryCacheKey(dims({ orientation, adult })));
			}
		}
		expect(keys.size).toBe(12);
	});
});

describe("guest gallery cache eligibility", () => {
	test("caches when anonymous, unpersonalized and near the front", () => {
		expect(guestGalleryCacheDimensions(guestOptions())).not.toBeNull();
		expect(
			guestGalleryCacheDimensions(
				guestOptions({ page: GUEST_GALLERY_MAX_CACHED_PAGE }),
			),
		).not.toBeNull();
	});

	test.each([
		["member", { viewerId: "m1" }],
		["block list", { blocked: ["m2"] }],
		["favorites feed", { favoritedBy: "m1" }],
		["following feed", { followingOf: "m1" }],
		["creator filter", { creatorId: "m1" }],
		["a viewer with the adult gate open", { adultAllowed: true }],
		["own adult exception", { ownAdultAllowed: true }],
		["search", { search: "Cat" }],
		["a search that isn't only spaces", { search: "  cat  " }],
		["a deep page", { page: GUEST_GALLERY_MAX_CACHED_PAGE + 1 }],
		["a non-default page size", { pageSize: 12 }],
	] satisfies [
		string,
		Partial<ListStoriesOptions>,
	][])("%s is not cached", (_label, over) => {
		expect(guestGalleryCacheDimensions(guestOptions(over))).toBeNull();
	});

	/** A query of only surrounding whitespace builds no predicate, so it keeps eligibility. */
	test("a whitespace-only query doesn't lose eligibility", () => {
		expect(
			guestGalleryCacheDimensions(guestOptions({ search: "   " })),
		).not.toBeNull();
	});

	test("tag filters are not cached — arbitrary strings don't become keys", () => {
		expect(
			guestGalleryCacheDimensions(guestOptions({ tag: "school drama" })),
		).toBeNull();
	});

	test("relevance with no query is the same cell as recent — the server predicate folds the same way", () => {
		const relevance = guestGalleryCacheDimensions(
			guestOptions({ sort: "relevance" }),
		);
		const recent = guestGalleryCacheDimensions(
			guestOptions({ sort: "recent" }),
		);
		if (!relevance || !recent) throw new Error("both must be eligible");
		expect(guestGalleryCacheKey(relevance)).toBe(guestGalleryCacheKey(recent));
	});
});

describe("listGalleryStories", () => {
	test("a hit doesn't run Postgres", async () => {
		const opts = guestOptions();
		const key = keyFor(opts);
		const cached = { items: [story("cached")], total: 1 };
		const { store } = memoryStore({ [key]: cached });
		__setCacheStoreForTest(store);

		await expect(listGalleryStories(opts)).resolves.toEqual(cached);
		expect(listStoriesMock).not.toHaveBeenCalled();
	});

	test("a miss returns the lookup result as is and writes it with the TTL", async () => {
		const opts = guestOptions();
		const fresh = { items: [story("fresh")], total: 1 };
		listStoriesMock.mockResolvedValue(fresh);
		const { store, entries } = memoryStore();
		__setCacheStoreForTest(store);

		await expect(listGalleryStories(opts)).resolves.toEqual(fresh);
		expect(listStoriesMock).toHaveBeenCalledTimes(1);
		expect(listStoriesMock).toHaveBeenCalledWith(opts);

		const written = entries.get(keyFor(opts));
		expect(written?.value).toEqual(fresh);
		expect(written?.ttlMs).toBe(GUEST_GALLERY_CACHE_TTL_MS);
	});

	/**
	 * The slice's security property: an authenticated request neither reads nor writes the guest cell,
	 * because the eligibility decision stands before the cache and the store never appears on that
	 * path.
	 */
	test("authenticated requests don't consume the guest cell", async () => {
		const guest = guestOptions();
		const key = keyFor(guest);
		const guestPage = { items: [story("guest-only")], total: 1 };
		const { store, gets, entries } = memoryStore({ [key]: guestPage });
		__setCacheStoreForTest(store);

		const memberPage = { items: [story("member")], total: 1 };
		listStoriesMock.mockResolvedValue(memberPage);

		await expect(
			listGalleryStories(guestOptions({ viewerId: "m1", blocked: ["m2"] })),
		).resolves.toEqual(memberPage);
		expect(listStoriesMock).toHaveBeenCalledTimes(1);
		/** The guest cell was neither read nor overwritten with the member response. */
		expect(gets).toEqual([]);
		expect(entries.get(key)?.value).toEqual(guestPage);
	});

	test("the personal feed skips the cache entirely", async () => {
		const { store, gets } = memoryStore();
		__setCacheStoreForTest(store);
		listStoriesMock.mockResolvedValue({ items: [], total: 0 });

		await listGalleryStories(
			guestOptions({ viewerId: "m1", favoritedBy: "m1" }),
		);
		expect(gets).toEqual([]);
	});

	/** A corrupt cell falls through as a miss and the following write overwrites it: self-healing. */
	test("a malformed cache entry is a miss and gets overwritten", async () => {
		const opts = guestOptions();
		const key = keyFor(opts);
		const { store, entries } = memoryStore({
			[key]: { items: [{ id: "a" }], total: 1 },
		});
		__setCacheStoreForTest(store);
		const fresh = { items: [story("fresh")], total: 1 };
		listStoriesMock.mockResolvedValue(fresh);

		await expect(listGalleryStories(opts)).resolves.toEqual(fresh);
		expect(listStoriesMock).toHaveBeenCalledTimes(1);
		expect(entries.get(key)?.value).toEqual(fresh);
	});

	test("a total that isn't a number is a miss", async () => {
		const opts = guestOptions();
		const key = keyFor(opts);
		const { store } = memoryStore({ [key]: { items: [], total: "1" } });
		__setCacheStoreForTest(store);
		listStoriesMock.mockResolvedValue({ items: [], total: 0 });

		await listGalleryStories(opts);
		expect(listStoriesMock).toHaveBeenCalledTimes(1);
	});

	/** A JSON round trip does not change the public result, since timestamps are already ISO strings. */
	test("the serialization round trip doesn't change the value", async () => {
		const opts = guestOptions();
		const fresh = { items: [story("round-trip")], total: 1 };
		listStoriesMock.mockResolvedValue(fresh);
		const { store, entries } = memoryStore();
		__setCacheStoreForTest(store);
		await listGalleryStories(opts);

		const key = keyFor(opts);
		const wire = JSON.parse(JSON.stringify(entries.get(key)?.value)) as unknown;
		const { store: replay } = memoryStore({ [key]: wire });
		__setCacheStoreForTest(replay);
		listStoriesMock.mockClear();

		await expect(listGalleryStories(opts)).resolves.toEqual(fresh);
		expect(listStoriesMock).not.toHaveBeenCalled();
	});

	/** A deployment without Redis behaves exactly as before the cache existed. */
	test("answers from Postgres even with the cache disabled", async () => {
		__setCacheStoreForTest(DISABLED_CACHE_STORE);
		const fresh = { items: [story("db")], total: 1 };
		listStoriesMock.mockResolvedValue(fresh);

		await expect(listGalleryStories(guestOptions())).resolves.toEqual(fresh);
		await expect(listGalleryStories(guestOptions())).resolves.toEqual(fresh);
		expect(listStoriesMock).toHaveBeenCalledTimes(2);
	});

	/**
	 * With Redis down the adapter folds the failure into a miss, so the store always answers `null`
	 * and writes do nothing. A Postgres failure still propagates.
	 */
	test("even with storage down, a lookup failure isn't swallowed", async () => {
		const unavailable: CacheStore = {
			kind: "redis",
			get: () => Promise.resolve(null),
			set: () => Promise.resolve(),
		};
		__setCacheStoreForTest(unavailable);
		listStoriesMock.mockRejectedValue(new Error("db down"));

		await expect(listGalleryStories(guestOptions())).rejects.toThrow("db down");
	});
});
