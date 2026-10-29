import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { block, story, story_comment } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `GET /v2/me/creator-comments`: the creator comment inbox.
 *
 * What this file pins:
 *
 * 1. Ownership isolation: Alice's inbox carries no comment on Bob's works, and the request
 *    cannot shake that (no slot names a target member).
 * 2. Set definition: tombstones, my own lines and blocked authors' lines are out; replies are
 *    in. It must be the same set as analytics' `A comment` metric so the two cells never state different
 *    numbers.
 * 3. The owner sees everything: comments on archived, operator-hidden and private works are
 *    included, and the work's state rides on the line (the screen decides navigability from it).
 * 4. Cursor: newest first, with no duplicates or omissions even when same-millisecond lines
 *    straddle a boundary.
 *
 * Runs against real Postgres and the real Hono app: the ownership condition inside the join is
 * under test, so calling service functions alone would leave session-to-member wiring outside.
 */

const EMAIL_PREFIX = "me-creator-comments-test-";

const signUp = (name = "Inbox test") =>
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

async function seedStory(
	ownerId: string,
	options: {
		visibility?: "public" | "unlisted" | "private" | "archived";
		hidden?: boolean;
		title?: string;
	} = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: options.title ?? "Story",
		visibility: options.visibility ?? "public",
		hidden: options.hidden ?? false,
		play_payload: {
			version: 1,
			storyId: id,
			title: "Secret title",
			scenario: "a scenario body that must never appear in a response",
		},
	});
	return id;
}

async function seedComment(
	storyId: string,
	authorId: string,
	options: { body?: string; parentId?: string; createdAt?: Date } = {},
): Promise<string> {
	const id = newId();
	await db.insert(story_comment).values({
		id,
		story_id: storyId,
		author: authorId,
		body: options.body ?? "A comment",
		parent_id: options.parentId ?? null,
		...(options.createdAt ? { created_at: options.createdAt } : {}),
	});
	return id;
}

/** Tombstone in exactly the shape the service makes (author NULL, empty body, `deleted_at`). */
async function seedTombstone(storyId: string): Promise<string> {
	const id = newId();
	await db.insert(story_comment).values({
		id,
		story_id: storyId,
		author: null,
		body: "",
		deleted_at: new Date(),
	});
	return id;
}

interface InboxItem {
	comment: {
		id: string;
		storyId: string;
		parentId: string | null;
		state: string;
		body: string;
		author: { id: string; nickname: string };
	};
	story: { id: string; title: string; visibility: string; hidden: boolean };
}

interface InboxBody {
	items: InboxItem[];
	nextCursor: string | null;
}

const readInbox = async (
	cookie?: string | null,
	query = "",
): Promise<InboxBody> =>
	(await (
		await get(`/v2/me/creator-comments${query}`, cookie)
	).json()) as InboxBody;

const commentIds = (body: InboxBody): string[] =>
	body.items.map((item) => item.comment.id);

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)(
	"GET /v2/me/creator-comments — ownership isolation",
	() => {
		test("only comments on my stories come — none from someone else's stories", async () => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");
			const carol = await signUp("Carol");

			const mine = await seedStory(alice.memberId, { title: "Alice's story" });
			const bobs = await seedStory(bob.memberId, { title: "Bob's story" });
			const onMine = await seedComment(mine, carol.memberId, {
				body: "Nice",
			});
			await seedComment(bobs, carol.memberId, { body: "To Bob" });

			const body = await readInbox(alice.cookie);
			expect(commentIds(body)).toEqual([onMine]);
			expect(body.items[0]?.story).toEqual({
				id: mine,
				title: "Alice's story",
				visibility: "public",
				hidden: false,
			});
			expect(body.items[0]?.comment).toMatchObject({
				state: "visible",
				body: "Nice",
				storyId: mine,
				author: { id: carol.memberId, nickname: "Carol" },
			});

			/** Bob's inbox sees only his own too (the other side of the same decision). */
			const bobBody = await readInbox(bob.cookie);
			expect(bobBody.items.map((item) => item.story.id)).toEqual([bobs]);
		});

		/**
		 * Verify with a real request that there is no slot for a target member. The contract lacking the
		 * field is a type fact; this assertion is about a hand-built request.
		 */
		test.each([
			"?owner=",
			"?ownerId=",
			"?memberId=",
			"?creatorId=",
			"?storyOwner=",
		])("adding `%s` still can't show someone else's inbox", async (param) => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");
			const carol = await signUp("Carol");
			await seedComment(await seedStory(bob.memberId), carol.memberId);

			const body = await readInbox(alice.cookie, `${param}${bob.memberId}`);
			expect(body.items).toEqual([]);
		});

		test("a guest gets 401", async () => {
			const response = await get("/v2/me/creator-comments");
			expect(response.status).toBe(401);
		});

		test("the response is private, so no shared cache keeps it", async () => {
			const alice = await signUp();
			const response = await get("/v2/me/creator-comments", alice.cookie);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("private, no-store");
		});
	},
);

describe.skipIf(!databaseReady)(
	"GET /v2/me/creator-comments — what is included",
	() => {
		test("replies are included; tombstones, my own lines and lines from people I blocked are left out", async () => {
			const alice = await signUp("Alice");
			const carol = await signUp("Carol");
			const dave = await signUp("Dave");
			const mine = await seedStory(alice.memberId);

			const root = await seedComment(mine, carol.memberId);
			const reply = await seedComment(mine, carol.memberId, {
				parentId: root,
			});
			/** My own reply, not one I received. */
			await seedComment(mine, alice.memberId, { parentId: root });
			await seedTombstone(mine);
			/** Comments by someone I blocked are removed from my screen. */
			await seedComment(mine, dave.memberId);
			await db
				.insert(block)
				.values({ blocker: alice.memberId, creator: dave.memberId });

			const body = await readInbox(alice.cookie);
			expect(new Set(commentIds(body))).toEqual(new Set([root, reply]));
			const replyRow = body.items.find((item) => item.comment.id === reply);
			expect(replyRow?.comment.parentId).toBe(root);
			/** Tombstones are excluded, so every line is live. */
			expect(body.items.every((item) => item.comment.state === "visible")).toBe(
				true,
			);
		});

		test("comments on archived, operator-hidden and private stories are included for the owner too — with the story's state", async () => {
			const alice = await signUp("Alice");
			const carol = await signUp("Carol");
			const archived = await seedStory(alice.memberId, {
				visibility: "archived",
			});
			const hidden = await seedStory(alice.memberId, { hidden: true });
			const privateStory = await seedStory(alice.memberId, {
				visibility: "private",
			});
			await seedComment(archived, carol.memberId);
			await seedComment(hidden, carol.memberId);
			await seedComment(privateStory, carol.memberId);

			const body = await readInbox(alice.cookie);
			const byStory = new Map(
				body.items.map((item) => [item.story.id, item.story] as const),
			);
			expect(byStory.get(archived)).toMatchObject({ visibility: "archived" });
			expect(byStory.get(hidden)).toMatchObject({ hidden: true });
			expect(byStory.get(privateStory)).toMatchObject({
				visibility: "private",
			});
		});

		/**
		 * Projection boundary: count the line's whole key set. Passing the work row through would leak
		 * the playback payload, and `not.toHaveProperty` only blocks names known today.
		 */
		test("a row's key set is exactly the contract's", async () => {
			const alice = await signUp("Alice");
			const carol = await signUp("Carol");
			await seedComment(await seedStory(alice.memberId), carol.memberId);

			const body = await readInbox(alice.cookie);
			const [item] = body.items;
			expect(Object.keys(body).sort()).toEqual(["items", "nextCursor"]);
			expect(Object.keys(item ?? {}).sort()).toEqual(["comment", "story"]);
			expect(Object.keys(item?.story ?? {}).sort()).toEqual([
				"hidden",
				"id",
				"title",
				"visibility",
			]);
			expect(Object.keys(item?.comment ?? {}).sort()).toEqual([
				"author",
				"body",
				"createdAt",
				"id",
				"likeCount",
				"parentId",
				"replyCount",
				"state",
				"storyId",
				"viewerLiked",
			]);
			expect(JSON.stringify(body)).not.toContain("scenario body");
		});
	},
);

describe.skipIf(!databaseReady)("GET /v2/me/creator-comments — cursor", () => {
	test("newest first, and rows in the same millisecond at a boundary neither duplicate nor drop", async () => {
		const alice = await signUp("Alice");
		const carol = await signUp("Carol");
		const mine = await seedStory(alice.memberId);
		const other = await seedStory(alice.memberId);

		/** Five lines share a timestamp, deliberately making a boundary where time alone does not decide order. */
		const sameMoment = new Date("2026-09-01T00:00:00.000Z");
		const seeded: { id: string; at: Date }[] = [];
		for (let i = 0; i < 5; i += 1)
			seeded.push({
				id: await seedComment(i % 2 ? mine : other, carol.memberId, {
					createdAt: sameMoment,
				}),
				at: sameMoment,
			});
		const later = new Date("2026-09-02T00:00:00.000Z");
		seeded.push({
			id: await seedComment(mine, carol.memberId, { createdAt: later }),
			at: later,
		});

		const expected = [...seeded]
			.sort(
				(a, b) =>
					b.at.getTime() - a.at.getTime() ||
					(a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
			)
			.map((row) => row.id);

		const walked: string[] = [];
		let cursor = "";
		for (let guard = 0; guard < 10; guard += 1) {
			const page = await readInbox(
				alice.cookie,
				`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			);
			walked.push(...commentIds(page));
			if (!page.nextCursor) break;
			cursor = page.nextCursor;
		}
		expect(walked).toEqual(expected);
		expect(new Set(walked).size).toBe(walked.length);
	});

	test("a broken cursor is a 400, not a fall back to the first page", async () => {
		const alice = await signUp();
		const response = await get(
			"/v2/me/creator-comments?cursor=not-a-cursor",
			alice.cookie,
		);
		expect(response.status).toBe(400);
	});

	test("exceeding the page size cap is a 400", async () => {
		const alice = await signUp();
		const response = await get(
			"/v2/me/creator-comments?limit=1000",
			alice.cookie,
		);
		expect(response.status).toBe(400);
	});
});
