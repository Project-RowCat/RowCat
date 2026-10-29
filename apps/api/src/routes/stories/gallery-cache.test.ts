import type { StoriesPage } from "@rowcat/contracts";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { member, story } from "../../db/schema.ts";
import { __setCacheStoreForTest } from "../../lib/cache/index.ts";
import type { CacheStore } from "../../lib/cache/store.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api } from "../../test/http.ts";

/**
 * Checks that the gallery cache is on the real request path, using the real Hono app and Postgres.
 *
 * `services/story/gallery-cache.test.ts` checks the rules (eligibility, key, resolution) but not
 * that the route is wired to them; a change making `routes/stories/index.ts` call `listStories()`
 * again would pass those files and leave a cache that caches nothing.
 *
 * ```text
 * a guest's repeated request skips Postgres the second time   the cache is on the path
 * a member's identical request does not consume the guest slot   the cache is guest-only
 * ```
 *
 * The second is a security property rather than performance, so it must break here first if the
 * route changes how it passes the viewer.
 */

const EMAIL_PREFIX = "gallery-cache-test-";
const TITLE_PREFIX = "GalleryCacheTest-";

const ready = await connectTestDatabase();
if (!ready) {
	console.warn(
		"[api.test] skipping the gallery cache route check without Postgres",
	);
}

/** In-process store honoring the contract; records what was read and written. */
function memoryStore() {
	const entries = new Map<string, unknown>();
	const gets: string[] = [];
	const sets: string[] = [];
	const store: CacheStore = {
		kind: "redis",
		get(key) {
			gets.push(key);
			return Promise.resolve(entries.get(key) ?? null);
		},
		set(key, value) {
			sets.push(key);
			entries.set(key, value);
			return Promise.resolve();
		},
	};
	return { store, entries, gets, sets };
}

async function seedStory(title: string, owner: string | null): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner,
		title,
		visibility: "public",
		adult: false,
		origin_draft_id: newId(),
		play_payload: { v: 1 },
	});
	return id;
}

const titles = (page: StoriesPage): string[] =>
	page.items
		.map((item) => item.title)
		.filter((t) => t.startsWith(TITLE_PREFIX));

async function cleanup(): Promise<void> {
	await db.delete(story).where(like(story.title, `${TITLE_PREFIX}%`));
	await deleteTestUsers(EMAIL_PREFIX);
}

describe.skipIf(!ready)("guest gallery server cache", () => {
	beforeAll(cleanup);

	afterEach(() => {
		__setCacheStoreForTest(null);
	});

	afterAll(async () => {
		await cleanup();
		await closeDb();
	});

	/**
	 * Proves the cache is on the path through staleness: if the second request misses a story seeded
	 * in between, it did not come from Postgres. Observing the 30-second staleness is the point, and
	 * it is the one imprecision this layer accepts.
	 */
	test("a guest's identical request skips Postgres the second time", async () => {
		const { store, gets, sets } = memoryStore();
		__setCacheStoreForTest(store);

		await seedStory(`${TITLE_PREFIX}First`, null);
		const first = (await (await api("/stories")).json()) as StoriesPage;
		expect(titles(first)).toContain(`${TITLE_PREFIX}First`);
		expect(sets).toHaveLength(1);

		/** Without the cache this story would appear in the second response. */
		await seedStory(`${TITLE_PREFIX}Second`, null);
		const second = (await (await api("/stories")).json()) as StoriesPage;
		expect(titles(second)).toEqual(titles(first));
		expect(titles(second)).not.toContain(`${TITLE_PREFIX}Second`);

		/** Same key read twice, written once: the second is a hit. */
		expect(gets).toHaveLength(2);
		expect(new Set(gets).size).toBe(1);
		expect(sets).toHaveLength(1);
	});

	/**
	 * The security property: a member's response neither comes from nor is written to the guest slot,
	 * because the eligibility decision stands before the cache and the member path never touches the
	 * store.
	 */
	test("a member's identical request doesn't consume the guest cell", async () => {
		const { store, gets, sets, entries } = memoryStore();
		__setCacheStoreForTest(store);

		await seedStory(`${TITLE_PREFIX}GuestOnly`, null);
		const guest = (await (await api("/stories")).json()) as StoriesPage;
		expect(titles(guest)).toContain(`${TITLE_PREFIX}GuestOnly`);
		expect(sets).toHaveLength(1);
		const guestKey = sets[0] ?? "";
		const guestEntry = entries.get(guestKey);

		const account = await createTestMember(EMAIL_PREFIX, {
			name: "Cache member",
		});
		/** Visible only to this member, so it cannot be in the guest slot. */
		await db.insert(story).values({
			id: newId(),
			owner: account.memberId,
			title: `${TITLE_PREFIX}MyPrivate`,
			visibility: "private",
			adult: false,
			origin_draft_id: newId(),
			play_payload: { v: 1 },
		});

		const readsBefore = gets.length;
		const mine = (await (
			await api("/stories", { cookie: account.cookie })
		).json()) as StoriesPage;

		/** Own private story visible, so this is not the guest's response. */
		expect(titles(mine)).toContain(`${TITLE_PREFIX}MyPrivate`);
		/** The guest slot was neither read nor overwritten with the member's response. */
		expect(gets).toHaveLength(readsBefore);
		expect(sets).toHaveLength(1);
		expect(entries.get(guestKey)).toBe(guestEntry);

		await db.delete(member).where(eq(member.id, account.memberId));
	});

	/** Search is ineligible, so arbitrary strings never become keys. */
	test("search requests skip the cache entirely", async () => {
		const { store, gets, sets } = memoryStore();
		__setCacheStoreForTest(store);

		await seedStory(`${TITLE_PREFIX}SearchTarget`, null);
		const found = (await (
			await api(
				`/stories?q=${encodeURIComponent(`${TITLE_PREFIX}SearchTarget`)}`,
			)
		).json()) as StoriesPage;

		expect(titles(found)).toContain(`${TITLE_PREFIX}SearchTarget`);
		expect(gets).toEqual([]);
		expect(sets).toEqual([]);
	});

	/**
	 * The response cache policy is unchanged: the same handler also builds member responses, and
	 * opening it to shared HTTP caches is a separate decision after proving the two never mix.
	 */
	test("the response is still private, no-cache", async () => {
		const { store } = memoryStore();
		__setCacheStoreForTest(store);
		const response = await api("/stories");
		expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
	});
});
