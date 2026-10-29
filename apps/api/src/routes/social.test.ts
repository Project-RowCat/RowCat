import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { block, follow, member, story } from "../db/schema.ts";
import { newId } from "../lib/id.ts";

import { createTestMember, TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * Relations: follow and block.
 *
 * Guards states that must not be representable; hiding buttons stops none of them because endpoints
 * are called directly:
 *
 * ```text
 * a member following themselves        the feed is polluted with their own work
 * a follow row for a missing member    FK-violation 500, nothing for the screen to branch on
 * blocked but still followed           the block is half-done
 * blocked but work/comments remain     the safety button does nothing
 * ```
 *
 * And one number: duplicate requests must not move the follower count. That drift is invisible on
 * screen (it just reads as a slightly larger number).
 *
 * Runs through a real Postgres and the real Hono app, since the session-to-member wiring and the
 * SQL predicates are what is under test.
 */

const EMAIL_PREFIX = "social-test-";

interface Person {
	cookie: string;
	memberId: string;
}

/** One member. The final `/me` matters: the member row is created by the first request, not signup (`ensureMember` in `auth/viewer.ts`). */
const signUp = (name = "Relationship test") =>
	createTestMember(EMAIL_PREFIX, { name });

const get = (path: string, cookie?: string | null): Promise<Response> =>
	Promise.resolve(
		app.request(path, {
			headers: { Origin: WEB_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
		}),
	);

const put = (
	path: string,
	body: unknown,
	cookie?: string | null,
): Promise<Response> =>
	Promise.resolve(
		app.request(path, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const setFollow = (person: Person, creator: string, following: boolean) =>
	put("/v2/follows", { creator, following }, person.cookie);

const setBlock = (person: Person, creator: string, blocked: boolean) =>
	put("/v2/blocks", { creator, blocked }, person.cookie);

const errorCode = async (response: Response): Promise<string> =>
	((await response.json()) as { code?: string }).code ?? "";

const followersOf = async (creatorId: string): Promise<number> =>
	(
		(await (await get(`/v2/creators/${creatorId}`)).json()) as {
			followers: number;
		}
	).followers;

interface StateBody {
	favorites: string[];
	following: string[];
	blocked: string[];
}

const stateOf = async (person: Person): Promise<StateBody> =>
	(await (await get("/v2/me/state", person.cookie)).json()) as StateBody;

async function seedStory(
	ownerId: string,
	options: { title?: string; adult?: boolean } = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: options.title ?? "Story",
		visibility: "public",
		adult: options.adult ?? false,
		hidden: false,
	});
	return id;
}

const galleryIds = async (
	query: string,
	cookie?: string | null,
): Promise<string[]> => {
	const body = (await (await get(`/v2/stories${query}`, cookie)).json()) as {
		items?: { id: string }[];
	};
	return (body.items ?? []).map((s) => s.id);
};

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("PUT /v2/follows", () => {
	test("follows, and repeating the same request keeps the state and count", async () => {
		/** The API takes the desired state, not a toggle, so a client that lost the response can resend without flipping the result. */
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");

		const first = await setFollow(alice, bob.memberId, true);
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ following: true, followers: 1 });

		const again = await setFollow(alice, bob.memberId, true);
		expect(await again.json()).toEqual({ following: true, followers: 1 });
		expect((await stateOf(alice)).following).toEqual([bob.memberId]);
	});

	test("unfollows, and repeating it never goes below 0", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(alice, bob.memberId, true);

		const first = await setFollow(alice, bob.memberId, false);
		expect(await first.json()).toEqual({ following: false, followers: 0 });
		const again = await setFollow(alice, bob.memberId, false);
		expect(await again.json()).toEqual({ following: false, followers: 0 });
		expect((await stateOf(alice)).following).toEqual([]);
	});

	test("can't follow yourself", async () => {
		// Hiding the button cannot stop this; the server needs the same check.
		const alice = await signUp();
		const response = await setFollow(alice, alice.memberId, true);
		expect(response.status).toBe(400);
		expect(await errorCode(response)).toBe("self_follow");
	});

	test("following an unknown member is a 404, not a 500", async () => {
		/** Without this check an FK violation becomes a 500: counted as a server fault though the client erred, with nothing in the body for the screen to branch on. */
		const alice = await signUp();
		const response = await setFollow(alice, newId(), true);
		expect(response.status).toBe(404);
		expect(await errorCode(response)).toBe("not_found");
	});

	test("a guest gets 401", async () => {
		const bob = await signUp();
		const response = await put("/v2/follows", {
			creator: bob.memberId,
			following: true,
		});
		expect(response.status).toBe(401);
	});

	test("a restricted account gets 403", async () => {
		// A suspension that still allows interaction means nothing.
		const alice = await signUp();
		const bob = await signUp();
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, alice.memberId));

		const response = await setFollow(alice, bob.memberId, true);
		expect(response.status).toBe(403);
		expect(await errorCode(response)).toBe("account_restricted");
	});

	test("the body has no slot for the follower (subject)", async () => {
		/** Fields outside the contract are ignored and the subject comes only from the session; a request creating a relation in someone else's name must not be expressible. */
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();

		await put(
			"/v2/follows",
			{ creator: bob.memberId, following: true, follower: carol.memberId },
			alice.cookie,
		);

		expect((await stateOf(carol)).following).toEqual([]);
		expect((await stateOf(alice)).following).toEqual([bob.memberId]);
	});
});

describe.skipIf(!databaseReady)("follower count", () => {
	test("two follow and one unfollows — exactly one", async () => {
		const alice = await signUp();
		const carol = await signUp();
		const bob = await signUp();

		await setFollow(alice, bob.memberId, true);
		const two = await setFollow(carol, bob.memberId, true);
		expect(await two.json()).toEqual({ following: true, followers: 2 });

		const one = await setFollow(alice, bob.memberId, false);
		expect(await one.json()).toEqual({ following: false, followers: 1 });
		expect(await followersOf(bob.memberId)).toBe(1);
	});

	test("a duplicate follow doesn't raise the count", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(alice, bob.memberId, true);
		await setFollow(alice, bob.memberId, true);
		await setFollow(alice, bob.memberId, true);
		expect(await followersOf(bob.memberId)).toBe(1);
	});

	test("a refused follow doesn't change the count", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(alice, bob.memberId, true);

		// Self-follow is refused, and that request has no reason to touch anyone else's count.
		await setFollow(bob, bob.memberId, true);
		expect(await followersOf(bob.memberId)).toBe(1);
	});

	test("the public profile carries the follower count, and guests see the same value", async () => {
		/** The follower count is a public aggregate, the same for everyone. "Am I following" stays out of this response; carrying it would personalize the resource and break shared caching. */
		const alice = await signUp();
		const bob = await signUp("Bob");
		await setFollow(alice, bob.memberId, true);

		const body = (await (
			await get(`/v2/creators/${bob.memberId}`, alice.cookie)
		).json()) as Record<string, unknown>;

		expect(body.followers).toBe(1);
		expect(body).not.toHaveProperty("following");
		expect(await followersOf(bob.memberId)).toBe(1);
	});
});

describe.skipIf(!databaseReady)("PUT /v2/blocks", () => {
	test("blocks, and repeating keeps the same state", async () => {
		const alice = await signUp();
		const bob = await signUp();

		const first = await setBlock(alice, bob.memberId, true);
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ blocked: true, followers: 0 });
		await setBlock(alice, bob.memberId, true);
		expect((await stateOf(alice)).blocked).toEqual([bob.memberId]);
	});

	test("a block cuts an existing follow **in the same operation**", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(alice, bob.memberId, true);

		const response = await setBlock(alice, bob.memberId, true);
		// The response count must already be reduced so the screen does not guess ±1.
		expect(await response.json()).toEqual({ blocked: true, followers: 0 });

		const state = await stateOf(alice);
		expect(state.blocked).toEqual([bob.memberId]);
		expect(state.following).toEqual([]);
	});

	test("you can't follow someone you blocked again", async () => {
		/** Pairs with the block severing the follow; without it one request revives "blocked but following". */
		const alice = await signUp();
		const bob = await signUp();
		await setBlock(alice, bob.memberId, true);

		const response = await setFollow(alice, bob.memberId, true);
		expect(response.status).toBe(400);
		expect(await errorCode(response)).toBe("follow_blocked_target");
		expect((await stateOf(alice)).following).toEqual([]);
		expect(await followersOf(bob.memberId)).toBe(0);
	});

	test("unblocking doesn't revive the follow", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(alice, bob.memberId, true);
		await setBlock(alice, bob.memberId, true);

		await setBlock(alice, bob.memberId, false);

		const state = await stateOf(alice);
		expect(state.blocked).toEqual([]);
		// Reviving would require keeping the pre-block relation, i.e. holding one the user removed.
		expect(state.following).toEqual([]);
		expect(await followersOf(bob.memberId)).toBe(0);

		// After unblocking, following again works.
		expect((await setFollow(alice, bob.memberId, true)).status).toBe(200);
	});

	test("you can't block yourself, and an unknown member is a 404", async () => {
		const alice = await signUp();
		const own = await setBlock(alice, alice.memberId, true);
		expect(own.status).toBe(400);
		expect(await errorCode(own)).toBe("self_block");

		const missing = await setBlock(alice, newId(), true);
		expect(missing.status).toBe(404);
	});
});

describe.skipIf(!databaseReady)("following feed", () => {
	test("empty before following, and following brings that creator's stories", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const bobStory = await seedStory(bob.memberId, { title: "Bob's story" });

		expect(await galleryIds("?following=1", alice.cookie)).toEqual([]);

		await setFollow(alice, bob.memberId, true);
		expect(await galleryIds("?following=1", alice.cookie)).toContain(bobStory);
	});

	test("unfollowing takes them out again", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const bobStory = await seedStory(bob.memberId);
		await setFollow(alice, bob.memberId, true);
		expect(await galleryIds("?following=1", alice.cookie)).toContain(bobStory);

		await setFollow(alice, bob.memberId, false);
		expect(await galleryIds("?following=1", alice.cookie)).not.toContain(
			bobStory,
		);
	});

	test("a guest's following feed is a 401", async () => {
		// The subject of a personal feed comes only from the session; if the client could pick the member
		// id, anyone could read another's feed.
		expect((await get("/v2/stories?following=1")).status).toBe(401);
	});

	test("a blocked creator's stories are in neither the following feed nor discovery", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const bobStory = await seedStory(bob.memberId);
		await setFollow(alice, bob.memberId, true);
		expect(await galleryIds("?following=1", alice.cookie)).toContain(bobStory);

		await setBlock(alice, bob.memberId, true);

		/** Two layers: the block severed the follow so nothing should enter the feed, and the predicate's block filter is the second line of defence. */
		expect(await galleryIds("?following=1", alice.cookie)).not.toContain(
			bobStory,
		);
		expect(await galleryIds("", alice.cookie)).not.toContain(bobStory);
	});
});

describe.skipIf(!databaseReady)("blocks and visibility", () => {
	test("blocking removes them from the gallery, detail and profile grid together", async () => {
		/** If it vanishes from one path but stays reachable by another, it is sorting rather than blocking. Checks that all three screens use the same predicate (`galleryWhere`). */
		const alice = await signUp();
		const bob = await signUp();
		const bobStory = await seedStory(bob.memberId);

		expect(await galleryIds("", alice.cookie)).toContain(bobStory);
		expect((await get(`/v2/stories/${bobStory}`, alice.cookie)).status).toBe(
			200,
		);

		await setBlock(alice, bob.memberId, true);

		expect(await galleryIds("", alice.cookie)).not.toContain(bobStory);
		// An unviewable story gives the same 404 as a missing one (existence hiding).
		expect((await get(`/v2/stories/${bobStory}`, alice.cookie)).status).toBe(
			404,
		);
		const grid = (await (
			await get(`/v2/creators/${bob.memberId}/stories`, alice.cookie)
		).json()) as { items: unknown[]; total: number };
		expect(grid.items).toHaveLength(0);
		expect(grid.total).toBe(0);
	});

	test("blocking doesn't affect others — it isn't moderation", async () => {
		const alice = await signUp();
		const carol = await signUp();
		const bob = await signUp();
		const bobStory = await seedStory(bob.memberId);

		await setBlock(alice, bob.memberId, true);

		expect(await galleryIds("", carol.cookie)).toContain(bobStory);
		expect((await get(`/v2/stories/${bobStory}`, carol.cookie)).status).toBe(
			200,
		);
		// The blocked creator's profile identity still opens (it is also where the block is lifted).
		expect(
			(await get(`/v2/creators/${bob.memberId}`, alice.cookie)).status,
		).toBe(200);
	});

	test("a blocked member's comments are hidden only from me", async () => {
		/** No server row is deleted. A personal block is not moderation, so others still see the comment; only this viewer's list filters it. */
		const alice = await signUp();
		const carol = await signUp();
		const bob = await signUp();
		const carolStory = await seedStory(carol.memberId);

		const created = await app.request(`/v2/stories/${carolStory}/comments`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: bob.cookie,
			},
			body: JSON.stringify({ body: "Bob's comment" }),
		});
		expect(created.status).toBe(201);

		const listFor = async (person: Person): Promise<string[]> => {
			const body = (await (
				await get(`/v2/stories/${carolStory}/comments`, person.cookie)
			).json()) as { items: { body: string }[] };
			return body.items.map((c) => c.body);
		};

		expect(await listFor(alice)).toEqual(["Bob's comment"]);
		await setBlock(alice, bob.memberId, true);
		expect(await listFor(alice)).toEqual([]);
		// The same line on the same story is still there for others.
		expect(await listFor(carol)).toEqual(["Bob's comment"]);
	});
});

describe.skipIf(!databaseReady)("account lifecycle", () => {
	test("deleting the account removes follows and blocks in both directions", async () => {
		/** The FK cascade does this, but leftover rows would be personal identifiers no code reads (who blocked whom). This locks that deletion leaves none. */
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();

		await setFollow(alice, bob.memberId, true); // relation where the deleted member is the follower
		await setFollow(carol, alice.memberId, true); // relation where the deleted member is the target
		await setBlock(alice, bob.memberId, true); // relation where the deleted member is the blocker
		await setBlock(carol, alice.memberId, true); // relation where the deleted member was blocked

		await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: alice.cookie,
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});

		const follows = await db
			.select({ follower: follow.follower })
			.from(follow)
			.where(eq(follow.follower, alice.memberId));
		const followers = await db
			.select({ follower: follow.follower })
			.from(follow)
			.where(eq(follow.creator, alice.memberId));
		const blocksBy = await db
			.select({ blocker: block.blocker })
			.from(block)
			.where(eq(block.blocker, alice.memberId));
		const blocksOf = await db
			.select({ blocker: block.blocker })
			.from(block)
			.where(eq(block.creator, alice.memberId));

		expect(follows).toHaveLength(0);
		expect(followers).toHaveLength(0);
		expect(blocksBy).toHaveLength(0);
		expect(blocksOf).toHaveLength(0);

		// It also disappears from the remaining member's state (that list reads the same table).
		const carolState = await stateOf(carol);
		expect(carolState.following).not.toContain(alice.memberId);
		expect(carolState.blocked).not.toContain(alice.memberId);
	});

	test("one account's relationships don't leak into another's", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();
		await setFollow(alice, bob.memberId, true);
		await setBlock(alice, carol.memberId, true);

		// Same server, different cookie: a relation belongs to the member the session resolves to.
		const bobState = await stateOf(bob);
		expect(bobState.following).toEqual([]);
		expect(bobState.blocked).toEqual([]);

		// And in the DB it belongs to alice alone.
		const rows = await db
			.select({ follower: follow.follower })
			.from(follow)
			.where(and(eq(follow.creator, bob.memberId)));
		expect(rows.map((r) => r.follower)).toEqual([alice.memberId]);
	});
});
