import {
	PINNED_STORY_ERROR_CODE,
	PROFILE_PINNED_STORY_LIMIT,
} from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { block, member, profile_pinned_story, story } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api, apiGet, jsonOf } from "../../test/http.ts";

/**
 * Pinned works: the owner chooses, others see only what is currently visible.
 *
 * 1. Pinning does not bypass the visibility boundary: works turned private, hidden by an
 *    operator, of an unviewable rating, or by a blocked creator do not reach the public read even
 *    if pinned. This is the key test; a pin slot that skipped the grid's predicate would be a
 *    second exposure path.
 * 2. The owner sees pins that are no longer visible, with their state axis.
 * 3. Newly pinning accepts only the member's own currently public works, rejected with one code
 *    (foreign and missing are not distinguished); a rejected request changes no row.
 * 4. Already-pinned works may stay while private, so a reorder-only request is not blocked.
 * 5. The whole list is replaced and order is display order; repeating a request gives the same
 *    result.
 * 6. Suspended accounts cannot edit (same gate as bio); reads stay open.
 *
 * Runs against real Postgres and the real Hono app, since predicates and transactions are under
 * test.
 */

const EMAIL_PREFIX = "pinned-stories-test-";
const PATH = "/me/pinned-stories";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

const signUp = (name = "Pinned works test") =>
	createTestMember(EMAIL_PREFIX, { name });

interface SeedStory {
	visibility?: "public" | "unlisted" | "private" | "archived";
	adult?: boolean;
	hidden?: boolean;
	title?: string;
}

async function seedStory(
	ownerId: string,
	options: SeedStory = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: options.title ?? "Story",
		visibility: options.visibility ?? "public",
		adult: options.adult ?? false,
		hidden: options.hidden ?? false,
	});
	return id;
}

interface OwnBody {
	items: { id: string; visibility: string; hidden: boolean }[];
}
interface PublicBody {
	items: { id: string }[];
}

const put = (cookie: string, storyIds: unknown) =>
	api(PATH, { method: "PUT", body: { storyIds }, cookie });

const readOwn = async (cookie: string): Promise<string[]> =>
	(await jsonOf<OwnBody>(await apiGet(PATH, cookie))).items.map((s) => s.id);

const readPublic = async (
	creatorId: string,
	cookie?: string,
): Promise<string[]> =>
	(
		await jsonOf<PublicBody>(
			await apiGet(`/creators/${creatorId}/pinned-stories`, cookie),
		)
	).items.map((s) => s.id);

const setVisibility = (
	id: string,
	visibility: "public" | "unlisted" | "private" | "archived",
) => db.update(story).set({ visibility }).where(eq(story.id, id));

describe.skipIf(!databaseReady)("Pinned work", () => {
	test("stored in the chosen order, and others see that order too", async () => {
		const alice = await signUp();
		const [one, two, three] = await Promise.all([
			seedStory(alice.memberId, { title: "one" }),
			seedStory(alice.memberId, { title: "two" }),
			seedStory(alice.memberId, { title: "three" }),
		]);

		const response = await put(alice.cookie, [three, one, two]);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(
			(await jsonOf<OwnBody>(response)).items.map((item) => item.id),
		).toEqual([three, one, two]);

		// A guest reads it; the public read needs no sign-in (same as the profile).
		const guest = await apiGet(`/creators/${alice.memberId}/pinned-stories`);
		expect(guest.status).toBe(200);
		expect(guest.headers.get("cache-control")).toBe("private, no-cache");
		expect(await readPublic(alice.memberId)).toEqual([three, one, two]);
	});

	test("swaps the whole list — the same request gives the same result however many times", async () => {
		const alice = await signUp();
		const [one, two] = await Promise.all([
			seedStory(alice.memberId),
			seedStory(alice.memberId),
		]);

		await put(alice.cookie, [one, two]);
		await put(alice.cookie, [two]);
		await put(alice.cookie, [two]);
		expect(await readOwn(alice.cookie)).toEqual([two]);

		// An empty array unpins everything.
		expect((await put(alice.cookie, [])).status).toBe(200);
		expect(await readOwn(alice.cookie)).toEqual([]);
	});

	test("pinning doesn't bypass the visibility boundary", async () => {
		const alice = await signUp();
		const bob = await signUp("Bob");
		const [visible, laterPrivate, laterHidden, adult] = await Promise.all([
			seedStory(alice.memberId),
			seedStory(alice.memberId),
			seedStory(alice.memberId),
			seedStory(alice.memberId, { adult: true }),
		]);
		await db
			.update(member)
			.set({ verified: true, adult: true })
			.where(eq(member.id, alice.memberId));

		expect(
			(await put(alice.cookie, [visible, laterPrivate, adult])).status,
		).toBe(200);
		await setVisibility(laterPrivate, "private");

		/**
		 * A work turned private reaches no one, the owner included: the public view must be the same for
		 * everyone (same axis as the grid's `ownPrivateVisible: false`). Adult works reach only viewers
		 * who may see them.
		 */
		expect(await readPublic(alice.memberId)).toEqual([visible]);
		expect(await readPublic(alice.memberId, alice.cookie)).toEqual([visible]);
		expect(await readPublic(alice.memberId, bob.cookie)).toEqual([visible]);

		// Operator hiding behaves the same.
		await put(alice.cookie, [visible, laterHidden]);
		await db
			.update(story)
			.set({ hidden: true })
			.where(eq(story.id, laterHidden));
		expect(await readPublic(alice.memberId, bob.cookie)).toEqual([visible]);

		// A blocked creator's pins are empty, matching the grid's zero results.
		await db
			.insert(block)
			.values({ blocker: bob.memberId, creator: alice.memberId });
		expect(await readPublic(alice.memberId, bob.cookie)).toEqual([]);
	});

	test("the owner sees even pins that aren't visible now, with their state", async () => {
		const alice = await signUp();
		const [one, two] = await Promise.all([
			seedStory(alice.memberId),
			seedStory(alice.memberId),
		]);
		await put(alice.cookie, [one, two]);
		await setVisibility(two, "private");

		const own = await jsonOf<OwnBody>(await apiGet(PATH, alice.cookie));
		expect(own.items.map((item) => [item.id, item.visibility])).toEqual([
			[one, "public"],
			[two, "private"],
		]);
	});

	test("an already-pinned story can stay and be reordered even when private", async () => {
		const alice = await signUp();
		const [one, two] = await Promise.all([
			seedStory(alice.memberId),
			seedStory(alice.memberId),
		]);
		await put(alice.cookie, [one, two]);
		await setVisibility(one, "private");

		expect((await put(alice.cookie, [two, one])).status).toBe(200);
		expect(await readOwn(alice.cookie)).toEqual([two, one]);

		/** Republishing returns it to its slot. */
		await setVisibility(one, "public");
		expect(await readPublic(alice.memberId)).toEqual([two, one]);
	});

	test.each([
		["private", { visibility: "private" }],
		["unlisted", { visibility: "unlisted" }],
		["archived", { visibility: "archived" }],
		["operator-hidden", { hidden: true }],
	] as const)("can't newly pin a %s story", async (_, options) => {
		const alice = await signUp();
		const [kept, candidate] = await Promise.all([
			seedStory(alice.memberId),
			seedStory(alice.memberId, options),
		]);
		await put(alice.cookie, [kept]);

		const response = await put(alice.cookie, [kept, candidate]);
		expect(response.status).toBe(409);
		expect(await jsonOf<{ code: string }>(response)).toMatchObject({
			code: PINNED_STORY_ERROR_CODE.unavailable,
		});
		/** A rejected request changes no row. */
		expect(await readOwn(alice.cookie)).toEqual([kept]);
	});

	test("someone else's story and a missing story get the same refusal", async () => {
		const alice = await signUp();
		const bob = await signUp("Bob");
		const bobs = await seedStory(bob.memberId);

		const foreign = await put(alice.cookie, [bobs]);
		const missing = await put(alice.cookie, [newId()]);
		expect(foreign.status).toBe(409);
		expect(missing.status).toBe(409);
		/** Only the request id differs; any differing word would make the response an existence probe. */
		const { requestId: _f, ...foreignBody } =
			await jsonOf<Record<string, unknown>>(foreign);
		const { requestId: _m, ...missingBody } =
			await jsonOf<Record<string, unknown>>(missing);
		expect(foreignBody).toEqual(missingBody);
		const rows = await db
			.select()
			.from(profile_pinned_story)
			.where(eq(profile_pinned_story.member_id, alice.memberId));
		expect(rows).toEqual([]);
	});

	test("the cap, duplicates and unknown keys fall to the contract", async () => {
		const alice = await signUp();
		const ids = await Promise.all(
			Array.from({ length: PROFILE_PINNED_STORY_LIMIT + 1 }, () =>
				seedStory(alice.memberId),
			),
		);
		const [first] = ids;
		expect((await put(alice.cookie, ids)).status).toBe(400);
		expect((await put(alice.cookie, [first, first])).status).toBe(400);
		/** There is no slot for a target member: sending one is rejected, not accepted and ignored. */
		const withOwner = await api(PATH, {
			method: "PUT",
			body: { storyIds: [first], memberId: newId() },
			cookie: alice.cookie,
		});
		expect(withOwner.status).toBe(400);
	});

	test("a suspended account can't change it, and reading stays open", async () => {
		const alice = await signUp();
		const one = await seedStory(alice.memberId);
		await put(alice.cookie, [one]);
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, alice.memberId));

		expect((await put(alice.cookie, [])).status).toBe(403);
		expect((await apiGet(PATH, alice.cookie)).status).toBe(200);
		expect(await readOwn(alice.cookie)).toEqual([one]);
	});

	test("a guest can neither read nor write my pinned works", async () => {
		expect((await apiGet(PATH)).status).toBe(401);
		expect(
			(await api(PATH, { method: "PUT", body: { storyIds: [] } })).status,
		).toBe(401);
	});

	test("when the story is deleted the pin disappears too", async () => {
		const alice = await signUp();
		const [one, two] = await Promise.all([
			seedStory(alice.memberId),
			seedStory(alice.memberId),
		]);
		await put(alice.cookie, [one, two]);
		await db.delete(story).where(eq(story.id, one));
		expect(await readOwn(alice.cookie)).toEqual([two]);
	});
});
