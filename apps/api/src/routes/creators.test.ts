import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { member, story } from "../db/schema.ts";
import { newId } from "../lib/id.ts";

import { createTestMember, TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * Public profile: what goes out and what does not. Half of this file counts fields one by one
 * because a mistake at this boundary is irreversible: an email once in a public response spreads to
 * caches, proxies, logs and crawlers and is not recalled by a fix. So it checks that only allowed
 * fields exist, not that sensitive ones are absent; the latter passes when a member column is added
 * later while exposing its value.
 *
 * The other half is the story list's exposure boundary: whether it uses the same predicate as the
 * gallery, and in particular whether the one split axis (own private stories) really is split.
 *
 * Runs against real Postgres and the real Hono app, since session-to-member wiring and SQL
 * predicates are under test.
 */

const EMAIL_PREFIX = "creators-test-";

/**
 * Creates a member. The final `/me` matters: the member row is created on the first request, not at
 * signup (ensureMember in `auth/viewer.ts`); without it the updates below fix 0 rows.
 */
const signUp = (name = "Profile test") =>
	createTestMember(EMAIL_PREFIX, { name });

const get = (path: string, cookie?: string | null): Promise<Response> =>
	Promise.resolve(
		app.request(path, {
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
		}),
	);

const patchMe = (
	path: string,
	cookie: string,
	body: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/me/${path}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	);

// Entitlement to publish adult content (legal requirement); the display opt-in is still off.
const grantAdultEligibility = (memberId: string) =>
	db
		.update(member)
		.set({ verified: true, adult: true })
		.where(eq(member.id, memberId));

// The adult content display opt-in, a different axis from entitlement.
const enableAdultDisplay = (memberId: string) =>
	db.update(member).set({ show_adult: true }).where(eq(member.id, memberId));

interface SeedStory {
	visibility?: "public" | "private" | "archived";
	adult?: boolean;
	hidden?: boolean;
	title?: string;
	createdAt?: Date;
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
		...(options.createdAt ? { created_at: options.createdAt } : {}),
	});
	return id;
}

interface StoriesBody {
	items: { id: string; title: string }[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

const readStories = async (response: Response): Promise<StoriesBody> =>
	(await response.json()) as StoriesBody;

const idsOf = (body: StoriesBody): string[] => body.items.map((s) => s.id);

const listStories = async (
	creatorId: string,
	cookie?: string | null,
	query = "",
): Promise<StoriesBody> =>
	readStories(await get(`/v2/creators/${creatorId}/stories${query}`, cookie));

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("GET /v2/creators/:creatorId", () => {
	test("guests can see public profiles too", async () => {
		// No login wall is the policy: with the gallery open to guests, a creator behind a wall would cut
		// the path from story to person for guests only.
		const alice = await signUp("Alice");

		const response = await get(`/v2/creators/${alice.memberId}`);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: alice.memberId,
			displayName: "Alice",
		});
	});

	test("the response has **only the five allowed fields**", async () => {
		// The most important assertion in the repository. It is not written as
		// `not.toHaveProperty("email")` because that only blocks fields known today; if a member column
		// is added and someone puts it in the projection, such a test passes while publishing the new
		// value. Counting the whole key set stops right here.
		const alice = await signUp("Alice");
		await grantAdultEligibility(alice.memberId);

		const body = (await (
			await get(`/v2/creators/${alice.memberId}`)
		).json()) as Record<string, unknown>;

		expect(Object.keys(body).sort()).toEqual([
			"avatarUrl",
			"bio",
			"displayName",
			"followers",
			"id",
		]);
	});

	test.each([
		"email",
		"emailVerified",
		"userId",
		"user_id",
		"birthDate",
		"birth",
		"age",
		"verified",
		"adult",
		"showAdult",
		"show_adult",
		"status",
		"createdAt",
		"created_at",
		"methods",
		"hasPassword",
		"password",
		// `following` must not appear even after a follow exists. The follower count is a public
		// aggregate (it is in the key set above), but whether I follow this person differs per viewer;
		// carrying it would personalize the resource, keep it out of the shared cache (`public,
		// max-age=60`) and open a path for one person's response to reach another. `/me/state` answers
		// that axis.
		"following",
		"blocked",
	])("the private field `%s` is not in the response", async (field) => {
		// Already covered by the key-set test, but naming each field has its own value: the failure says
		// what leaked, and the list records the decision that these values must not reach a public
		// profile, so adding the signup date later means deleting a line on purpose.
		const alice = await signUp();
		await grantAdultEligibility(alice.memberId);

		const body = (await (
			await get(`/v2/creators/${alice.memberId}`)
		).json()) as Record<string, unknown>;
		expect(body).not.toHaveProperty(field);
	});

	test("an unset bio is null, not an empty string", async () => {
		// Checks the storage representation (`notNull default ''`) does not leak into the product model;
		// the screen has no reason to tell "wrote an empty bio" from "wrote none".
		const alice = await signUp();
		const body = (await (
			await get(`/v2/creators/${alice.memberId}`)
		).json()) as { bio: unknown; avatarUrl: unknown };
		expect(body.bio).toBeNull();
		expect(body.avatarUrl).toBeNull();
	});

	test("an unknown member is 404", async () => {
		expect((await get(`/v2/creators/${newId()}`)).status).toBe(404);
	});

	test("a deleted member's profile disappears", async () => {
		// Contract with the account-deletion slice: deleting the member row alone must close this path,
		// with no separate "was it deleted" branch (one would be missed somewhere and resurrect a deleted
		// account's profile). It is also pinned to be the same 404 as an unknown id; distinguishing them
		// would reveal "this id existed" and let a deleted identity be re-confirmed by id.
		const alice = await signUp("Alice");
		expect((await get(`/v2/creators/${alice.memberId}`)).status).toBe(200);

		const deleted = await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: alice.cookie,
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});
		expect(deleted.status).toBe(200);

		const after = await get(`/v2/creators/${alice.memberId}`);
		expect(after.status).toBe(404);
		expect(((await after.json()) as { code?: string }).code).toBe("not_found");
	});

	test("changing the nickname keeps the address and shows the new name", async () => {
		// Pins that the address identity is the id; with a nickname as address, renaming would 404 this
		// lookup and break every link others saved.
		const alice = await signUp("Alice");
		expect(
			(await patchMe("nickname", alice.cookie, { nickname: "NightCat" }))
				.status,
		).toBe(200);

		const response = await get(`/v2/creators/${alice.memberId}`);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: alice.memberId,
			displayName: "NightCat",
		});
	});

	test("changing the bio shows up on the public profile as is", async () => {
		const alice = await signUp();
		const saved = await patchMe("bio", alice.cookie, {
			bio: "  I like cats  ",
		});
		expect(saved.status).toBe(200);
		// The server-trimmed value is stored; leftover surrounding whitespace would split screen and
		// storage.
		expect(await saved.json()).toMatchObject({ bio: "I like cats" });

		const body = (await (
			await get(`/v2/creators/${alice.memberId}`)
		).json()) as { bio: string | null };
		expect(body.bio).toBe("I like cats");
	});

	test("clearing the bio makes it null again", async () => {
		// Clearing must be expressible; rejecting the empty string would make a written bio permanent.
		const alice = await signUp();
		await patchMe("bio", alice.cookie, { bio: "One line" });
		const cleared = await patchMe("bio", alice.cookie, { bio: "" });
		expect(cleared.status).toBe(200);
		expect(await cleared.json()).toMatchObject({ bio: null });
	});

	test("a guest can't change the bio", async () => {
		expect(
			(
				await app.request("/v2/me/bio", {
					method: "PATCH",
					headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
					body: JSON.stringify({ bio: "sneakily" }),
				})
			).status,
		).toBe(401);
	});

	test("a suspended account can't change the bio", async () => {
		// Must be the same gate as the nickname: both show on public screens, and if only one is loose a
		// suspended account can keep publishing through the bio.
		const alice = await signUp();
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, alice.memberId));

		const response = await patchMe("bio", alice.cookie, { bio: "still" });
		expect(response.status).toBe(403);
	});

	test("a bio over the limit is a 400", async () => {
		const alice = await signUp();
		const response = await patchMe("bio", alice.cookie, {
			bio: "a".repeat(301),
		});
		expect(response.status).toBe(400);
	});
});

describe.skipIf(!databaseReady)("GET /v2/creators/:creatorId/stories", () => {
	test("includes only public stories, leaving out private, archived and operator-hidden ones", async () => {
		const alice = await signUp();
		const open = await seedStory(alice.memberId, { visibility: "public" });
		await seedStory(alice.memberId, { visibility: "private" });
		await seedStory(alice.memberId, { visibility: "archived" });
		await seedStory(alice.memberId, { visibility: "public", hidden: true });

		const body = await listStories(alice.memberId);
		expect(idsOf(body)).toEqual([open]);
		// The total must use the same predicate; otherwise the last page is empty or a nonexistent page
		// is requested.
		expect(body.total).toBe(1);
	});

	test("the owner's own private stories are not included **even for the owner**", async () => {
		// The only axis split from the gallery, and the whole reason this route exists. The gallery
		// (`/v2/stories`) includes your own private stories because it also checks your own catalogue;
		// the same rule on a public profile would give the owner a different list than everyone else and
		// no way to see how the profile looks from outside. That difference is invisible on screen, so it
		// is pinned here.
		const alice = await signUp();
		const open = await seedStory(alice.memberId, { visibility: "public" });
		const secret = await seedStory(alice.memberId, { visibility: "private" });

		// The owner views their own profile with their own cookie.
		const own = await listStories(alice.memberId, alice.cookie);
		expect(idsOf(own)).toEqual([open]);
		expect(idsOf(own)).not.toContain(secret);

		// and that list is the same as the guest's.
		const guest = await listStories(alice.memberId);
		expect(idsOf(guest)).toEqual(idsOf(own));
		expect(guest.total).toBe(own.total);

		// Control: the same story is visible to the owner in the gallery (that rule is unchanged).
		const gallery = await readStories(
			await get("/v2/stories?pageSize=100", alice.cookie),
		);
		expect(idsOf(gallery)).toContain(secret);
	});

	test("someone else's stories are not included", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const mine = await seedStory(alice.memberId);
		const theirs = await seedStory(bob.memberId);

		expect(idsOf(await listStories(alice.memberId))).toEqual([mine]);
		expect(idsOf(await listStories(bob.memberId))).toEqual([theirs]);
	});

	test("adult stories go through **the same gate** as the gallery — and are left out of the total too", async () => {
		// Dropping rows from the list but not the total would reveal how many unviewable stories exist
		// from one number; counting with the same predicate makes that structurally impossible.
		const alice = await signUp();
		await grantAdultEligibility(alice.memberId);
		const sfw = await seedStory(alice.memberId, { adult: false });
		const adult = await seedStory(alice.memberId, { adult: true });

		const guest = await listStories(alice.memberId);
		expect(idsOf(guest)).toEqual([sfw]);
		expect(guest.total).toBe(1);

		// Closed in the list even for the owner; the display opt-in applies here too.
		const owner = await listStories(alice.memberId, alice.cookie);
		expect(idsOf(owner)).toEqual([sfw]);

		// Open only to a viewer with entitlement and display turned on.
		const reader = await signUp();
		await grantAdultEligibility(reader.memberId);
		await enableAdultDisplay(reader.memberId);
		const shown = await listStories(alice.memberId, reader.cookie);
		expect(idsOf(shown).sort()).toEqual([sfw, adult].sort());
		expect(shown.total).toBe(2);
	});

	test("a blocked creator's profile looks empty of stories", async () => {
		// Blocking would be half-done if everything stayed visible on the profile.
		const alice = await signUp();
		const bob = await signUp();
		await seedStory(bob.memberId);

		const blocked = await app.request("/v2/blocks", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: alice.cookie,
			},
			body: JSON.stringify({ creator: bob.memberId, blocked: true }),
		});
		// Check the block really took effect first; if this request silently failed, the assertion below
		// would confirm "never blocked" rather than "blocking works".
		expect(blocked.status).toBe(200);

		const body = await listStories(bob.memberId, alice.cookie);
		expect(body.items).toHaveLength(0);
		expect(body.total).toBe(0);
	});

	test("paging never duplicates or drops an entry", async () => {
		// Without deterministic ordering, rows with equal timestamps duplicate or drop at page
		// boundaries. Timestamps are made equal on purpose to force that; without the service's secondary
		// sort key (id) this breaks.
		const alice = await signUp();
		const sameMoment = new Date();
		const seeded = await Promise.all(
			Array.from({ length: 5 }, (_, index) =>
				seedStory(alice.memberId, {
					title: `Story ${index}`,
					createdAt: sameMoment,
				}),
			),
		);

		const first = await listStories(alice.memberId, null, "?pageSize=2");
		const second = await listStories(
			alice.memberId,
			null,
			"?page=2&pageSize=2",
		);
		const third = await listStories(alice.memberId, null, "?page=3&pageSize=2");

		expect(first.total).toBe(5);
		expect(first.pageCount).toBe(3);
		const seen = [...idsOf(first), ...idsOf(second), ...idsOf(third)];
		expect(seen).toHaveLength(5);
		expect(new Set(seen).size).toBe(5);
		expect(seen.sort()).toEqual([...seeded].sort());
	});

	test("no stories is still 200 with one empty page", async () => {
		// A pageCount of 0 for zero rows would make the client's `page <= pageCount` check read even the
		// first page as nonexistent.
		const alice = await signUp();
		const body = await listStories(alice.memberId);
		expect(body.items).toHaveLength(0);
		expect(body.total).toBe(0);
		expect(body.pageCount).toBe(1);
	});

	test("an unknown member's list is an empty page, not 404", async () => {
		// This resource answers "stories published under that id" and the profile route answers whether
		// the member exists. A 404 here would need another member lookup, making two routes decide the
		// same thing; the screen already learns it from the profile lookup.
		const response = await get(`/v2/creators/${newId()}/stories`);
		expect(response.status).toBe(200);
		expect((await readStories(response)).total).toBe(0);
	});

	test("an invalid pageSize is a 400", async () => {
		const alice = await signUp();
		expect(
			(await get(`/v2/creators/${alice.memberId}/stories?pageSize=1000`))
				.status,
		).toBe(400);
		expect(
			(await get(`/v2/creators/${alice.memberId}/stories?page=0`)).status,
		).toBe(400);
	});

	test("after deletion, anonymized public stories do not remain on the old profile", async () => {
		// Deletion policy keeps public stories in the catalogue with identity detached (`owner = NULL`).
		// If such a story were still found by the old member id, the deleted identity would live on as a
		// lookup axis of the list.
		const alice = await signUp();
		const open = await seedStory(alice.memberId, { visibility: "public" });
		expect(idsOf(await listStories(alice.memberId))).toEqual([open]);

		await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: alice.cookie,
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});

		// The story itself remains in the catalogue (policy), but ownerless.
		const [survivor] = await db
			.select({ owner: story.owner })
			.from(story)
			.where(eq(story.id, open));
		expect(survivor?.owner).toBeNull();

		// and it disappears from the old profile's list.
		expect((await listStories(alice.memberId)).total).toBe(0);
	});
});
