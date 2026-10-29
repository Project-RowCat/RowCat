import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { member, story, story_cover } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `GET /v2/me/stories` — the `Published` tab of the creation workspace.
 *
 * Three things are pinned here:
 * 1. Ownership isolation. Alice's list never carries Bob's work, and no request can change that
 *    — there is no slot for a target member in the path, query or body.
 * 2. The owner sees everything (private, archived, operator-hidden, adult). This is why the
 *    resource split from the public profile grid; if any axis is filtered here, creators cannot fix
 *    their own work.
 * 3. Projection boundary. The whole key set is counted; a `not.toHaveProperty(...)` check would
 *    only block today's fields and leak the playback payload the day a column is added or
 *    `storyColumns` is reused.
 *
 * Runs against real Postgres and the real Hono app, since the session-to-member wiring and the SQL
 * predicates are what is under test.
 */

const EMAIL_PREFIX = "me-stories-test-";

/** The member row is created by the last `/me`, not at signup. */
const signUp = (name = "Workspace test") =>
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

interface SeedStory {
	visibility?: "public" | "private" | "archived";
	adult?: boolean;
	hidden?: boolean;
	title?: string;
	originDraftId?: string | null;
	updatedAt?: Date;
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
		visibility: options.visibility ?? "private",
		adult: options.adult ?? false,
		hidden: options.hidden ?? false,
		origin_draft_id:
			options.originDraftId === undefined
				? `draft-${id}`
				: options.originDraftId,
		// Fill the playback payload so a leaking projection puts it in the response.
		play_payload: {
			version: 1,
			storyId: id,
			title: "Secret title",
			scenario: "a scenario body that must never appear in a response",
		},
		...(options.updatedAt ? { updated_at: options.updatedAt } : {}),
	});
	return id;
}

/**
 *  /**
 * A cover row with literal bytes: `version` is a generated column and cannot be written, and this
 * screen only needs to see that the value surfaces as an address (normalization is the cover tests'
 * job).
 */
const seedCover = (storyId: string) =>
	db.insert(story_cover).values({
		story_id: storyId,
		bytes: Buffer.from("cover"),
		mime: "image/webp",
	});

interface WorksBody {
	items: {
		id: string;
		originDraftId: string | null;
		title: string;
		visibility: string;
		adult: boolean;
		promptProtected: boolean;
		hidden: boolean;
		coverUrl: string | null;
		createdAt: string;
		updatedAt: string;
	}[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

const listWorks = async (
	cookie?: string | null,
	query = "",
): Promise<WorksBody> =>
	(await (await get(`/v2/me/stories${query}`, cookie)).json()) as WorksBody;

const idsOf = (body: WorksBody): string[] => body.items.map((w) => w.id);

/** Eligibility to publish adult work (the legal requirement); the display opt-in stays off. */
const grantAdultEligibility = (memberId: string) =>
	db
		.update(member)
		.set({ verified: true, adult: true })
		.where(eq(member.id, memberId));

const setStatus = (memberId: string, status: "suspended" | "banned") =>
	db.update(member).set({ status }).where(eq(member.id, memberId));

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)(
	"GET /v2/me/stories — ownership isolation",
	() => {
		test("only my stories come — not a single row of someone else's", async () => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");

			const a1 = await seedStory(alice.memberId, { title: "Alice 1" });
			const a2 = await seedStory(alice.memberId, { title: "Alice 2" });
			const b1 = await seedStory(bob.memberId, { title: "Bob 1" });

			const mine = await listWorks(alice.cookie);
			expect(idsOf(mine).sort()).toEqual([a1, a2].sort());
			expect(idsOf(mine)).not.toContain(b1);
			expect(mine.total).toBe(2);

			// Check the other side too; checking one side passes even if the predicate is inverted.
			const bobs = await listWorks(bob.cookie);
			expect(idsOf(bobs)).toEqual([b1]);
		});

		/**
		 * The request cannot change the target. The contract has no slot for it so types block it first,
		 * but a hand-built client skips types; this locks that the server never reads the value.
		 */
		test.each([
			"owner",
			"ownerId",
			"memberId",
			"creator",
			"creatorId",
			"viewerId",
		])("`%s` in the query is ignored", async (key) => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");
			const a1 = await seedStory(alice.memberId);
			await seedStory(bob.memberId);

			const body = await listWorks(
				alice.cookie,
				`?${key}=${encodeURIComponent(bob.memberId)}`,
			);
			expect(idsOf(body)).toEqual([a1]);
		});

		test("a guest gets 401 — not an empty list", async () => {
			const response = await get("/v2/me/stories");
			expect(response.status).toBe(401);
		});

		test("a private list, so no shared cache keeps it", async () => {
			const alice = await signUp();
			await seedStory(alice.memberId);
			const response = await get("/v2/me/stories", alice.cookie);
			expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		});
	},
);

describe.skipIf(!databaseReady)(
	"GET /v2/me/stories — the owner sees everything",
	() => {
		/**
		 * The only state publishing creates today. The public profile grid omits it, which is why this
		 * resource exists; filtering it here would leave the workspace looking empty.
		 */
		test("private stories are included", async () => {
			const alice = await signUp();
			const id = await seedStory(alice.memberId, { visibility: "private" });

			const body = await listWorks(alice.cookie);
			expect(idsOf(body)).toContain(id);
			expect(body.items[0]?.visibility).toBe("private");

			// The same work is not visible on the public profile, which is why the two resources split.
			const publicGrid = (await (
				await get(`/v2/creators/${alice.memberId}/stories`, alice.cookie)
			).json()) as WorksBody;
			expect(idsOf(publicGrid)).not.toContain(id);
		});

		test("public stories come as `public`", async () => {
			const alice = await signUp();
			const id = await seedStory(alice.memberId, { visibility: "public" });
			const body = await listWorks(alice.cookie);
			expect(body.items.find((w) => w.id === id)?.visibility).toBe("public");
		});

		/**
		 * Archiving removes from lists without deleting; dropping it from the owner's management list too
		 * would leave the work visible nowhere.
		 */
		test("archived stories are included too, as `archived`", async () => {
			const alice = await signUp();
			const id = await seedStory(alice.memberId, { visibility: "archived" });
			const body = await listWorks(alice.cookie);
			expect(body.items.find((w) => w.id === id)?.visibility).toBe("archived");
		});

		/**
		 * If operator-hidden work vanished from the owner's list, the creator could not tell why it is
		 * absent from the gallery and detail, which looks the same as a broken product.
		 */
		test("operator-hidden stories are included too, with `hidden` true", async () => {
			const alice = await signUp();
			const id = await seedStory(alice.memberId, { hidden: true });
			const body = await listWorks(alice.cookie);
			expect(body.items.find((w) => w.id === id)?.hidden).toBe(true);
		});

		/**
		 * Checked with the adult display opt-in off: reusing the discovery predicate would filter the
		 * owner's own adult work out of their management list.
		 */
		test("own adult stories are included even with the adult display off", async () => {
			const alice = await signUp();
			await grantAdultEligibility(alice.memberId);
			const id = await seedStory(alice.memberId, { adult: true });

			const body = await listWorks(alice.cookie);
			expect(body.items.find((w) => w.id === id)?.adult).toBe(true);
		});

		/**
		 * The gate is `requireViewer`, not `requireActiveViewer`: a sanctioned member most needs to see
		 * the state of their own work, and sanctions block outward writes, not reading one's own asset
		 * list.
		 */
		test.each([
			"suspended",
			"banned",
		] as const)("a %s account reads its own story list too", async (status) => {
			const alice = await signUp();
			const id = await seedStory(alice.memberId);
			await setStatus(alice.memberId, status);

			const response = await get("/v2/me/stories", alice.cookie);
			expect(response.status).toBe(200);
			expect(idsOf((await response.json()) as WorksBody)).toEqual([id]);
		});
	},
);

describe.skipIf(!databaseReady)("GET /v2/me/stories — projection", () => {
	/**
	 * The most important assertion in this file.
	 *
	 * It counts the whole key set; asserting only that the playback payload is absent blocks today's
	 * fields and leaks the scenario the day someone reuses the gallery's `storyColumns`.
	 *
	 * `coverUrl` is the tenth key because cover management attached to this screen: an archived or
	 * operator-hidden work has a 404 public detail, so there is no other way to obtain its address.
	 */
	test("an item has **only the ten allowed fields**", async () => {
		const alice = await signUp();
		await seedStory(alice.memberId);

		const body = await listWorks(alice.cookie);
		expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
			"adult",
			"coverUrl",
			"createdAt",
			"hidden",
			"id",
			"originDraftId",
			"promptProtected",
			"title",
			"updatedAt",
			"visibility",
		]);
	});

	test.each([
		/** Whole authored body (scenario, characters, lore); a list response has no reason to carry it. */
		"play_payload",
		"playPayload",
		"scenario",
		"characters",
		"lore",
		/**
		 * Cover bytes and the storage implementation. The address (`coverUrl`) is carried now but bytes
		 * still pass only through the three cover endpoints; carrying them here would download every
		 * cover per visit.
		 */
		"cover",
		"coverKey",
		"coverBytes",
		"bytes",
		"mime",
		/** Values counted from outside; creator analytics is a different slice. */
		"views",
		"favorites",
		"downloads",
		"sizeBytes",
		/** The owner is decided by the session; the response has no reason to repeat it. */
		"owner",
		"ownerId",
		"creator",
		"email",
		/** Moderation internals; what a member may see is answered by `/v2/me/moderation`. */
		"moderator",
		"reason",
		"reportId",
		"caseId",
	])("the private or unneeded field `%s` is not in an item", async (field) => {
		const alice = await signUp();
		await seedStory(alice.memberId, { hidden: true });

		const body = await listWorks(alice.cookie);
		expect(body.items[0]).not.toHaveProperty(field);
	});

	/**
	 * Whether a cover exists is expressed only by whether the address exists. A separate boolean could
	 * disagree with the address, and the screen would draw an empty slot marked as having a cover.
	 */
	test("a cover gives a versioned address, and no cover gives null", async () => {
		const alice = await signUp();
		const covered = await seedStory(alice.memberId, {
			updatedAt: new Date("2026-05-02T00:00:00.000Z"),
		});
		const bare = await seedStory(alice.memberId, {
			updatedAt: new Date("2026-05-01T00:00:00.000Z"),
		});
		await seedCover(covered);

		const byId = new Map(
			(await listWorks(alice.cookie)).items.map((w) => [w.id, w]),
		);
		expect(byId.get(covered)?.coverUrl).toContain(
			`/stories/${covered}/cover?v=`,
		);
		expect(byId.get(bare)?.coverUrl).toBeNull();
	});

	/**
	 * Hidden and archived work still carries a cover address, and that address is a 404 even for the
	 * owner.
	 *
	 * Both are intended. The list predicate is `owner` alone, so it includes archived and hidden work
	 * (the creator needs to know their state), while cover reads go through the same predicate as the
	 * detail and stay closed (that is what hiding means). The screen bridges the gap: `CoverPreview`
	 * folds the missing picture into the same placeholder as a coverless work, and the management
	 * dialog says the cover exists but cannot be seen now. Without this test someone may fold the
	 * address to null as useless, and the screen would then claim there is no cover, which is a
	 * different fact. Writes (`PUT`/`DELETE`) stay open in that state, so there is even less reason to
	 * drop the address.
	 */
	test("hidden and archived stories still carry their cover address", async () => {
		const alice = await signUp();
		const hidden = await seedStory(alice.memberId, { hidden: true });
		const archived = await seedStory(alice.memberId, {
			visibility: "archived",
		});
		await seedCover(hidden);
		await seedCover(archived);

		const byId = new Map(
			(await listWorks(alice.cookie)).items.map((w) => [w.id, w]),
		);
		expect(byId.get(hidden)?.coverUrl).toContain(`/stories/${hidden}/cover?v=`);
		expect(byId.get(archived)?.coverUrl).toContain(
			`/stories/${archived}/cover?v=`,
		);
	});

	/** The two identities stay different; the bridge must be in the response for the screen to find the draft. */
	test("the origin draft id is included, or null when absent", async () => {
		const alice = await signUp();
		const linked = await seedStory(alice.memberId, {
			originDraftId: "draft-abc",
			updatedAt: new Date("2026-02-02T00:00:00.000Z"),
		});
		const orphan = await seedStory(alice.memberId, {
			originDraftId: null,
			updatedAt: new Date("2026-02-01T00:00:00.000Z"),
		});

		const body = await listWorks(alice.cookie);
		const byId = new Map(body.items.map((w) => [w.id, w]));
		expect(byId.get(linked)?.originDraftId).toBe("draft-abc");
		expect(byId.get(orphan)?.originDraftId).toBeNull();
		// Never invent the draft id from the story id.
		expect(byId.get(orphan)?.originDraftId).not.toBe(orphan);
	});
});

describe.skipIf(!databaseReady)("GET /v2/me/stories — pagination", () => {
	test("most recently updated first", async () => {
		const alice = await signUp();
		const old = await seedStory(alice.memberId, {
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		const recent = await seedStory(alice.memberId, {
			updatedAt: new Date("2026-03-01T00:00:00.000Z"),
		});
		const middle = await seedStory(alice.memberId, {
			updatedAt: new Date("2026-02-01T00:00:00.000Z"),
		});

		expect(idsOf(await listWorks(alice.cookie))).toEqual([recent, middle, old]);
	});

	/**
	 * Rows updated in the same millisecond must not duplicate or drop across a page boundary; without
	 * the second sort key (`id desc`) this test breaks intermittently.
	 */
	test("joined pages neither duplicate nor drop", async () => {
		const alice = await signUp();
		const sameInstant = new Date("2026-04-01T00:00:00.000Z");
		const seeded: string[] = [];
		for (let i = 0; i < 5; i++)
			seeded.push(await seedStory(alice.memberId, { updatedAt: sameInstant }));

		const first = await listWorks(alice.cookie, "?pageSize=2");
		const second = await listWorks(alice.cookie, "?page=2&pageSize=2");
		const third = await listWorks(alice.cookie, "?page=3&pageSize=2");

		const walked = [...idsOf(first), ...idsOf(second), ...idsOf(third)];
		expect(new Set(walked).size).toBe(walked.length);
		expect(walked.sort()).toEqual([...seeded].sort());
		expect(first.total).toBe(5);
		expect(first.pageCount).toBe(3);
	});

	test("zero items is still one page", async () => {
		const alice = await signUp();
		const body = await listWorks(alice.cookie);
		expect(body).toMatchObject({ items: [], total: 0, page: 1, pageCount: 1 });
	});

	/** Without a cap, one pageSize value could dump everything. */
	test("a pageSize over the cap is a 400", async () => {
		const alice = await signUp();
		const response = await get("/v2/me/stories?pageSize=1000", alice.cookie);
		expect(response.status).toBe(400);
	});

	test("fractional or text page sizes don't flow into the default — they are a 400", async () => {
		const alice = await signUp();
		expect((await get("/v2/me/stories?page=1.5", alice.cookie)).status).toBe(
			400,
		);
		expect((await get("/v2/me/stories?page=abc", alice.cookie)).status).toBe(
			400,
		);
	});
});
