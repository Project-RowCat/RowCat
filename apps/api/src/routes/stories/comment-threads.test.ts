import { STORY_COMMENT_ERROR_CODE } from "@rowcat/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	block,
	member,
	notification,
	story,
	story_comment,
	story_comment_reaction,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import {
	__setRateLimitStoreForTest,
	createMemoryRateLimitStore,
} from "../../lib/rate-limit/index.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Replies, reactions and tombstones, exercised across every boundary with the real Hono app and a
 * real Postgres. Three guarantees that mocks cannot check:
 *
 * - threads are one level deep (the parent check runs on a locked row inside the transaction)
 * - deleting your own comment never deletes other people's replies (tombstone transition plus FK)
 * - aggregation is not N+1 (counting queries per page needs the real driver)
 *
 * The second is the costliest defect: the loss is irreversible and the success response looks
 * normal.
 */

const EMAIL_PREFIX = "comment-threads-test-";

const signUp = () => createTestMember(EMAIL_PREFIX, { name: "Thread test" });

async function seedStory(ownerId: string): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: `Story ${id.slice(0, 6)}`,
		visibility: "public",
		adult: false,
		hidden: false,
		origin_draft_id: newId(),
		play_payload: { v: 1 },
	});
	return id;
}

const headers = (cookie: string | null, json = false) => ({
	Origin: WEB_ORIGIN,
	...(json ? { "Content-Type": "application/json" } : {}),
	...(cookie ? { Cookie: cookie } : {}),
});

const postComment = (storyId: string, cookie: string, body: string) =>
	app.request(`/v2/stories/${storyId}/comments`, {
		method: "POST",
		headers: headers(cookie, true),
		body: JSON.stringify({ body }),
	});

const postReply = (
	storyId: string,
	parentId: string,
	cookie: string | null,
	body: string,
) =>
	app.request(`/v2/stories/${storyId}/comments/${parentId}/replies`, {
		method: "POST",
		headers: headers(cookie, true),
		body: JSON.stringify({ body }),
	});

const listReplies = (
	storyId: string,
	parentId: string,
	query = "",
	cookie: string | null = null,
) =>
	app.request(`/v2/stories/${storyId}/comments/${parentId}/replies${query}`, {
		headers: headers(cookie),
	});

const listComments = (storyId: string, cookie: string | null = null) =>
	app.request(`/v2/stories/${storyId}/comments`, { headers: headers(cookie) });

const react = (
	storyId: string,
	commentId: string,
	cookie: string | null,
	kind = "like",
) =>
	app.request(
		`/v2/stories/${storyId}/comments/${commentId}/reactions/${kind}`,
		{ method: "PUT", headers: headers(cookie) },
	);

const unreact = (
	storyId: string,
	commentId: string,
	cookie: string | null,
	kind = "like",
) =>
	app.request(
		`/v2/stories/${storyId}/comments/${commentId}/reactions/${kind}`,
		{ method: "DELETE", headers: headers(cookie) },
	);

const removeComment = (
	storyId: string,
	commentId: string,
	cookie: string | null,
) =>
	app.request(`/v2/stories/${storyId}/comments/${commentId}`, {
		method: "DELETE",
		headers: headers(cookie),
	});

interface Row {
	id: string;
	storyId: string;
	parentId: string | null;
	state: "visible" | "deleted";
	createdAt: string;
	replyCount: number;
	author?: { id: string; nickname: string; avatarUrl: string | null };
	body?: string;
	likeCount?: number;
	viewerLiked?: boolean;
}

const json = async <T>(response: Response): Promise<T> =>
	(await response.json()) as T;

async function makeComment(
	storyId: string,
	cookie: string,
	body = "Root",
): Promise<Row> {
	const created = await postComment(storyId, cookie, body);
	expect(created.status).toBe(201);
	return (await json<{ comment: Row }>(created)).comment;
}

async function makeReply(
	storyId: string,
	parentId: string,
	cookie: string,
	body = "A reply",
): Promise<Row> {
	const created = await postReply(storyId, parentId, cookie, body);
	expect(created.status).toBe(201);
	return (await json<{ reply: Row }>(created)).reply;
}

const rowsOf = (storyId: string) =>
	db.select().from(story_comment).where(eq(story_comment.story_id, storyId));

/**
 * Rate limiting is not under test here and each test writes several rows, so every test gets a
 * fresh store (`comments.test.ts` covers the policy).
 */
const resetLimiter = () =>
	__setRateLimitStoreForTest(createMemoryRateLimitStore());

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) {
		await db.delete(story).where(isNull(story.owner));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	__setRateLimitStoreForTest(null);
	await closeDb();
});

describe.skipIf(!databaseReady)("replies — creating", () => {
	test("members reply to comments on public stories", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		const created = await postReply(storyId, root.id, bob.cookie, "Loved it");
		expect(created.status).toBe(201);
		const body = await json<{ reply: Row; parent: Row }>(created);

		expect(body.reply.parentId).toBe(root.id);
		expect(body.reply.storyId).toBe(storyId);
		expect(body.reply.state).toBe("visible");
		expect(body.reply.body).toBe("Loved it");
		/** A reply has no replies, so its own count is always 0. */
		expect(body.reply.replyCount).toBe(0);
		/** The parent's count is the value the server counted. */
		expect(body.parent.id).toBe(root.id);
		expect(body.parent.replyCount).toBe(1);
	});

	test("the author is always the member who sent the request", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		/**
		 * Sends someone else's identity in the body. The contract has no such field, so it is ignored and
		 * the stored author is the member the session resolved.
		 */
		const created = await app.request(
			`/v2/stories/${storyId}/comments/${root.id}/replies`,
			{
				method: "POST",
				headers: headers(bob.cookie, true),
				body: JSON.stringify({
					body: "impersonation",
					authorId: alice.memberId,
					author: alice.memberId,
					parentId: "other-parent",
					storyId: "other-story",
				}),
			},
		);
		expect(created.status).toBe(201);
		const { reply } = await json<{ reply: Row }>(created);
		expect(reply.author?.id).toBe(bob.memberId);
		/** Parent and story come from the path; body values reach nothing. */
		expect(reply.parentId).toBe(root.id);
		expect(reply.storyId).toBe(storyId);
	});

	test("can't reply to a missing parent", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);

		const created = await postReply(
			storyId,
			newId(),
			alice.cookie,
			"into the void",
		);
		expect(created.status).toBe(404);
	});

	test("another story's comment can't be pointed at through this story's path", async () => {
		resetLimiter();
		const alice = await signUp();
		const here = await seedStory(alice.memberId);
		const there = await seedStory(alice.memberId);
		const root = await makeComment(there, alice.cookie);

		/**
		 * The path's story and the parent's story disagree. Letting it through would post into B's thread
		 * past A's comment boundary, bypassing B's exposure gate.
		 */
		const created = await postReply(here, root.id, alice.cookie, "wrong path");
		expect(created.status).toBe(404);
		expect(await rowsOf(there)).toHaveLength(1);
	});

	test("can't reply to a reply — threads are one level", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		const reply = await makeReply(storyId, root.id, bob.cookie);

		const nested = await postReply(storyId, reply.id, alice.cookie, "deeper");
		expect(nested.status).toBe(409);
		expect((await json<{ code: string }>(nested)).code).toBe(
			STORY_COMMENT_ERROR_CODE.replyDepth,
		);
		/** A rejection stores nothing. */
		expect(await rowsOf(storyId)).toHaveLength(2);
	});

	test("can't add new replies to a tombstone — existing replies stay readable", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await makeReply(storyId, root.id, bob.cookie, "An earlier reply");

		// A reply remains, so this delete produces a tombstone.
		expect((await removeComment(storyId, root.id, alice.cookie)).status).toBe(
			200,
		);

		const blocked = await postReply(storyId, root.id, bob.cookie, "later");
		expect(blocked.status).toBe(409);
		expect((await json<{ code: string }>(blocked)).code).toBe(
			STORY_COMMENT_ERROR_CODE.replyToDeleted,
		);

		/** Existing replies stay readable; only new ones are blocked. */
		const page = await json<{ items: Row[] }>(
			await listReplies(storyId, root.id),
		);
		expect(page.items.map((row) => row.body)).toEqual(["An earlier reply"]);
	});

	test("guests can read but not write", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await makeReply(storyId, root.id, alice.cookie);

		expect((await listReplies(storyId, root.id)).status).toBe(200);
		expect((await postReply(storyId, root.id, null, "guest")).status).toBe(401);
	});

	test("a private story is blocked with the same code on the reply path too", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await db
			.update(story)
			.set({ visibility: "private" })
			.where(eq(story.id, storyId));

		/**
		 * The owner is told the reason (they already see the story, so existence hiding is not broken).
		 * It must be the same code as the top-level boundary so the screen shows one sentence.
		 */
		const listed = await listReplies(storyId, root.id, "", alice.cookie);
		expect(listed.status).toBe(404);
		expect((await json<{ code: string }>(listed)).code).toBe(
			STORY_COMMENT_ERROR_CODE.unavailable,
		);

		/** Everyone else gets a different code that does not reveal the story exists. */
		const other = await signUp();
		const stranger = await listReplies(storyId, root.id, "", other.cookie);
		expect(stranger.status).toBe(404);
		expect((await json<{ code: string }>(stranger)).code).not.toBe(
			STORY_COMMENT_ERROR_CODE.unavailable,
		);
	});
});

describe.skipIf(!databaseReady)("replies — reading", () => {
	/** Seeded directly, bypassing requests, so timestamps are ours to choose. */
	const seedReply = (
		storyId: string,
		parentId: string,
		authorId: string,
		body: string,
		createdAt: Date,
	) =>
		db.insert(story_comment).values({
			id: newId(),
			story_id: storyId,
			parent_id: parentId,
			author: authorId,
			body,
			created_at: createdAt,
		});

	test("the top-level list carries no replies — only the count", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await makeReply(storyId, root.id, bob.cookie, "one");
		await makeReply(storyId, root.id, bob.cookie, "two");

		const page = await json<{ items: Row[] }>(await listComments(storyId));
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.id).toBe(root.id);
		expect(page.items[0]?.replyCount).toBe(2);
		/** No array is sent; otherwise one page's cost scales with thread length. */
		expect(page.items[0]).not.toHaveProperty("replies");
	});

	test("walks oldest first, with no duplicates or drops at boundaries", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		const base = Date.parse("2026-03-01T00:00:00.000Z");
		for (let i = 0; i < 7; i++)
			await seedReply(
				storyId,
				root.id,
				alice.memberId,
				`Reply ${i}`,
				new Date(base + i * 1000),
			);

		const seen: string[] = [];
		let cursor = "";
		for (let page = 0; page < 5; page++) {
			const body = await json<{ items: Row[]; nextCursor: string | null }>(
				await listReplies(
					storyId,
					root.id,
					`?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
				),
			);
			seen.push(...body.items.map((row) => row.body ?? ""));
			if (!body.nextCursor) break;
			cursor = body.nextCursor;
		}

		expect(seen).toEqual([
			"Reply 0",
			"Reply 1",
			"Reply 2",
			"Reply 3",
			"Reply 4",
			"Reply 5",
			"Reply 6",
		]);
	});

	test("the order is fixed even with equal times", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		const at = new Date("2026-03-02T00:00:00.000Z");
		for (let i = 0; i < 6; i++)
			await seedReply(storyId, root.id, alice.memberId, `Concurrent ${i}`, at);

		const first = await json<{ items: Row[]; nextCursor: string | null }>(
			await listReplies(storyId, root.id, "?limit=3"),
		);
		expect(first.nextCursor).not.toBeNull();
		const second = await json<{ items: Row[] }>(
			await listReplies(
				storyId,
				root.id,
				`?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
			),
		);

		const ids = [...first.items, ...second.items].map((row) => row.id);
		expect(new Set(ids).size).toBe(6);
	});

	test("another story's thread is a 404, not an empty page", async () => {
		resetLimiter();
		const alice = await signUp();
		const here = await seedStory(alice.memberId);
		const there = await seedStory(alice.memberId);
		const root = await makeComment(there, alice.cookie);
		await makeReply(there, root.id, alice.cookie);

		/**
		 * An empty page would make "another story's thread" indistinguishable from "a comment with no
		 * replies", turning the response into an existence probe.
		 */
		expect((await listReplies(here, root.id)).status).toBe(404);
	});

	test("a blocked person's replies drop out only for that viewer, and the count drops with them", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await makeReply(storyId, root.id, bob.cookie, "Bob's reply");

		await db
			.insert(block)
			.values({ blocker: alice.memberId, creator: bob.memberId });

		const mine = await json<{ items: Row[] }>(
			await listComments(storyId, alice.cookie),
		);
		/**
		 * If the count disagrees with the list, pressing `View 1 reply` opens an empty list; using the same
		 * predicate closes that window.
		 */
		expect(mine.items[0]?.replyCount).toBe(0);
		const thread = await json<{ items: Row[] }>(
			await listReplies(storyId, root.id, "", alice.cookie),
		);
		expect(thread.items).toHaveLength(0);

		/** Other viewers still see it; a personal block is not moderation. */
		const others = await json<{ items: Row[] }>(
			await listComments(storyId, bob.cookie),
		);
		expect(others.items[0]?.replyCount).toBe(1);
	});

	test("tombstones stay in the list too — even with a block list", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await makeReply(storyId, root.id, bob.cookie, "A reply that stays");
		await removeComment(storyId, root.id, alice.cookie);

		/**
		 * A tombstone's `author` is NULL and `NULL not in (…)` is NULL, not true, so a wrong predicate
		 * hides tombstones only for viewers with a non-empty block list, leaving their replies without a
		 * parent.
		 */
		await db
			.insert(block)
			.values({ blocker: carol.memberId, creator: bob.memberId });

		const page = await json<{ items: Row[] }>(
			await listComments(storyId, carol.cookie),
		);
		expect(page.items.map((row) => row.id)).toEqual([root.id]);
		expect(page.items[0]?.state).toBe("deleted");
	});

	test("the projection splits exactly per branch — a tombstone has neither body nor author", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(
			storyId,
			alice.cookie,
			"A post to be deleted",
		);
		await makeReply(storyId, root.id, bob.cookie);
		await removeComment(storyId, root.id, alice.cookie);

		const page = await json<{ items: Row[] }>(await listComments(storyId));
		expect(Object.keys(page.items[0] ?? {}).sort()).toEqual([
			"createdAt",
			"id",
			"parentId",
			"replyCount",
			"state",
			"storyId",
		]);
	});
});

describe.skipIf(!databaseReady)(
	"deletion — a tombstone when there are replies",
	() => {
		test("a root with no replies loses its row", async () => {
			resetLimiter();
			const alice = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie);

			const deleted = await removeComment(storyId, root.id, alice.cookie);
			expect(deleted.status).toBe(200);
			expect((await json<{ comment: Row | null }>(deleted)).comment).toBeNull();
			expect(await rowsOf(storyId)).toHaveLength(0);
		});

		test("a root that still has replies becomes a tombstone and the replies stay", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(
				storyId,
				alice.cookie,
				"A root to be deleted",
			);
			const reply = await makeReply(
				storyId,
				root.id,
				bob.cookie,
				"Bob's remark",
			);

			const deleted = await removeComment(storyId, root.id, alice.cookie);
			expect(deleted.status).toBe(200);
			const { comment } = await json<{ comment: Row | null }>(deleted);
			expect(comment?.state).toBe("deleted");
			expect(comment?.replyCount).toBe(1);

			/** None of other people's replies may disappear; this is the costliest defect in the slice. */
			const thread = await json<{ items: Row[] }>(
				await listReplies(storyId, root.id),
			);
			expect(thread.items.map((row) => row.id)).toEqual([reply.id]);
			expect(thread.items[0]?.body).toBe("Bob's remark");
		});

		test("a tombstone keeps neither the original nor the identity — in the row or the response", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie, "A secret review");
			await makeReply(storyId, root.id, bob.cookie);
			await removeComment(storyId, root.id, alice.cookie);

			const [row] = await db
				.select()
				.from(story_comment)
				.where(eq(story_comment.id, root.id));
			/** Not moved to another column; moving it is not deleting it. */
			expect(row?.body).toBe("");
			expect(row?.author).toBeNull();
			expect(row?.deleted_at).not.toBeNull();
			expect(JSON.stringify(row)).not.toContain("A secret review");

			const page = await json<{ items: Row[] }>(await listComments(storyId));
			const tombstone = page.items.find((item) => item.id === root.id);
			expect(tombstone?.author).toBeUndefined();
			expect(tombstone?.body).toBeUndefined();
			expect(JSON.stringify(page)).not.toContain("A secret review");
			expect(JSON.stringify(page)).not.toContain(alice.memberId);
		});

		test("a tombstone's reactions are deleted with it", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie);
			await makeReply(storyId, root.id, bob.cookie);
			expect((await react(storyId, root.id, bob.cookie)).status).toBe(200);

			await removeComment(storyId, root.id, alice.cookie);

			/**
			 * The FK cascade does not reach this row because it survives, and a tombstone must not keep a
			 * like count for a statement that no longer exists.
			 */
			expect(
				await db
					.select()
					.from(story_comment_reaction)
					.where(eq(story_comment_reaction.comment_id, root.id)),
			).toHaveLength(0);
		});

		test("deleting a row that is already a tombstone is a 404", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie);
			await makeReply(storyId, root.id, bob.cookie);
			await removeComment(storyId, root.id, alice.cookie);

			expect((await removeComment(storyId, root.id, alice.cookie)).status).toBe(
				404,
			);
		});

		test("deleting one reply leaves its siblings and root as they are", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie);
			const first = await makeReply(storyId, root.id, bob.cookie, "First");
			const second = await makeReply(storyId, root.id, bob.cookie, "Second");

			const deleted = await removeComment(storyId, first.id, bob.cookie);
			expect(deleted.status).toBe(200);
			/** A reply has no children, so its row is physically deleted. */
			expect((await json<{ comment: Row | null }>(deleted)).comment).toBeNull();

			const thread = await json<{ items: Row[] }>(
				await listReplies(storyId, root.id),
			);
			expect(thread.items.map((row) => row.id)).toEqual([second.id]);

			const page = await json<{ items: Row[] }>(await listComments(storyId));
			expect(page.items[0]?.state).toBe("visible");
			expect(page.items[0]?.replyCount).toBe(1);
		});

		/**
		 * A tombstone exists to protect others' replies. Once the last reply goes it has nothing to
		 * protect, and with no author or body no delete predicate catches it, so without cleanup an empty
		 * `0 replies` row stays forever.
		 */
		test("deleting the last reply under a tombstone removes the tombstone too", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie);
			const first = await makeReply(storyId, root.id, bob.cookie, "First");
			const second = await makeReply(storyId, root.id, bob.cookie, "Second");
			await removeComment(storyId, root.id, alice.cookie);

			// One reply remains, so the tombstone stays.
			await removeComment(storyId, first.id, bob.cookie);
			expect((await rowsOf(storyId)).map((row) => row.id).sort()).toEqual(
				[root.id, second.id].sort(),
			);

			const deleted = await removeComment(storyId, second.id, bob.cookie);
			expect(deleted.status).toBe(200);
			expect(await rowsOf(storyId)).toHaveLength(0);
			const page = await json<{ items: Row[] }>(await listComments(storyId));
			expect(page.items).toHaveLength(0);
		});

		test("a live root stays even when its last reply is deleted", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie, "A live root");
			const reply = await makeReply(storyId, root.id, bob.cookie);

			await removeComment(storyId, reply.id, bob.cookie);
			const rows = await rowsOf(storyId);
			expect(rows.map((row) => row.id)).toEqual([root.id]);
			expect(rows[0]?.body).toBe("A live root");
		});

		/**
		 * A story-delete cascade must go through. `parent_id` is `no action`, so a statement deleting a
		 * row that still has replies fails, but the cascade removes parent and children in the same
		 * statement and passes the end-of-statement check. That reliance is asserted by value: if it is
		 * wrong, any story with a reply fails to delete with a 500, and nothing else exercises that path.
		 */
		test("deleting the story removes the whole thread — the cascade is not blocked", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie);
			await makeReply(storyId, root.id, bob.cookie);
			await makeReply(storyId, root.id, alice.cookie);

			await db.delete(story).where(eq(story.id, storyId));
			expect(await rowsOf(storyId)).toHaveLength(0);
		});

		test("can't delete someone else's reply — the same 404 as a missing row", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);
			const root = await makeComment(storyId, alice.cookie);
			const reply = await makeReply(storyId, root.id, bob.cookie);

			expect(
				(await removeComment(storyId, reply.id, alice.cookie)).status,
			).toBe(404);
			expect(await rowsOf(storyId)).toHaveLength(2);
		});
	},
);

describe.skipIf(!databaseReady)("when an identity disappears", () => {
	test("on account deletion that person's replies disappear, and roots with others' replies become tombstones", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		const kept = await makeComment(
			storyId,
			alice.cookie,
			"Someone else replies here",
		);
		const bobReply = await makeReply(
			storyId,
			kept.id,
			bob.cookie,
			"Bob's reply",
		);
		/** Alice's thread with only her own replies under her own root; it must vanish whole. */
		const solo = await makeComment(
			storyId,
			alice.cookie,
			"A thread written alone",
		);
		await makeReply(storyId, solo.id, alice.cookie, "My reply");

		const deleted = await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: headers(alice.cookie, true),
			body: JSON.stringify({}),
		});
		expect(deleted.ok).toBe(true);

		const rows = await rowsOf(storyId);
		const byId = new Map(rows.map((row) => [row.id, row]));
		/** A thread written alone leaves neither root nor replies. */
		expect(byId.has(solo.id)).toBe(false);
		/** A root with other people's replies keeps only its place. */
		expect(byId.get(kept.id)?.body).toBe("");
		expect(byId.get(kept.id)?.author).toBeNull();
		expect(byId.get(kept.id)?.deleted_at).not.toBeNull();
		/** Bob's reply survives; one person's deletion does not erase others' words. */
		expect(byId.get(bobReply.id)?.body).toBe("Bob's reply");
		expect(byId.get(bobReply.id)?.author).toBe(bob.memberId);
	});

	test("when account deletion removes the last reply under a tombstone, the tombstone goes too", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory((await signUp()).memberId);
		const root = await makeComment(
			storyId,
			alice.cookie,
			"A root to delete first",
		);
		await makeReply(storyId, root.id, bob.cookie, "Bob's only reply");
		await removeComment(storyId, root.id, alice.cookie);

		const deleted = await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: headers(bob.cookie, true),
			body: JSON.stringify({}),
		});
		expect(deleted.ok).toBe(true);
		expect(await rowsOf(storyId)).toHaveLength(0);
	});

	test("operator deletes go through the same structural rules", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(
			storyId,
			alice.cookie,
			"A post that breaks policy",
		);
		const reply = await makeReply(
			storyId,
			root.id,
			bob.cookie,
			"An innocent reply",
		);

		const { deleteStoryComment } = await import("../../services/comments.ts");
		const snapshot = await deleteStoryComment({
			kind: "moderator",
			commentId: root.id,
		});

		/** The audit evidence is the same snapshot whether the row becomes a tombstone or disappears. */
		expect(snapshot?.body).toBe("A post that breaks policy");
		expect(snapshot?.authorId).toBe(alice.memberId);
		expect(snapshot?.tombstoned).toBe(true);

		const rows = await rowsOf(storyId);
		expect(rows.find((row) => row.id === reply.id)?.body).toBe(
			"An innocent reply",
		);
		expect(rows.find((row) => row.id === root.id)?.body).toBe("");
	});

	test("a tombstone is absent from report target lookups", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(
			storyId,
			alice.cookie,
			"A post to be deleted",
		);
		await makeReply(storyId, root.id, bob.cookie);
		await removeComment(storyId, root.id, alice.cookie);

		const { getStoryCommentById, getStoryCommentSnapshot } = await import(
			"../../services/comments.ts"
		);
		/** Even a public query unaware of moderation cannot reach the deleted body. */
		expect(await getStoryCommentById(root.id)).toBeNull();
		expect(await getStoryCommentSnapshot(storyId, root.id)).toBeNull();
	});
});

describe.skipIf(!databaseReady)("reply notifications", () => {
	const notificationsOf = (recipient: string, kind: string) =>
		db
			.select()
			.from(notification)
			.where(
				and(eq(notification.recipient, recipient), eq(notification.kind, kind)),
			);

	test("the parent's author gets one comment_reply", async () => {
		resetLimiter();
		const owner = await signUp();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(owner.memberId);
		const root = await makeComment(storyId, alice.cookie);
		const reply = await makeReply(storyId, root.id, bob.cookie);

		const rows = await notificationsOf(alice.memberId, "comment_reply");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.actor).toBe(bob.memberId);
		expect(rows[0]?.comment_id).toBe(reply.id);
		expect(rows[0]?.story_id).toBe(storyId);
	});

	test("a reply does not create story_comment for the story owner", async () => {
		resetLimiter();
		const owner = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(owner.memberId);
		const root = await makeComment(storyId, owner.cookie);
		await makeReply(storyId, root.id, bob.cookie);

		/**
		 * One reply must not create two rows. The story owner wrote the thread's root, so they receive
		 * `comment_reply` anyway.
		 */
		expect(await notificationsOf(owner.memberId, "story_comment")).toHaveLength(
			0,
		);
		expect(await notificationsOf(owner.memberId, "comment_reply")).toHaveLength(
			1,
		);
	});

	test("replying to your own comment creates no notification", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory((await signUp()).memberId);
		const root = await makeComment(storyId, alice.cookie);
		await makeReply(storyId, root.id, alice.cookie);

		expect(await notificationsOf(alice.memberId, "comment_reply")).toHaveLength(
			0,
		);
	});

	test("replies from someone you blocked don't enter the inbox", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory((await signUp()).memberId);
		const root = await makeComment(storyId, alice.cookie);

		await db
			.insert(block)
			.values({ blocker: alice.memberId, creator: bob.memberId });
		await makeReply(storyId, root.id, bob.cookie);

		/** Filtering on screen is not enough; it must not count toward unread either. */
		expect(await notificationsOf(alice.memberId, "comment_reply")).toHaveLength(
			0,
		);
	});

	test("reactions create no notifications", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory((await signUp()).memberId);
		const root = await makeComment(storyId, alice.cookie);

		await react(storyId, root.id, bob.cookie);

		/**
		 * A like is a quiet action. Notifying would let one popular comment fill the inbox, after which
		 * people stop reading it, including enforcement and appeal notices.
		 */
		expect(
			await db
				.select()
				.from(notification)
				.where(eq(notification.recipient, alice.memberId)),
		).toHaveLength(0);
	});
});

describe.skipIf(!databaseReady)("reactions — a single like", () => {
	test("can be pressed on roots and replies", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		const reply = await makeReply(storyId, root.id, bob.cookie);

		for (const id of [root.id, reply.id]) {
			const response = await react(storyId, id, alice.cookie);
			expect(response.status).toBe(200);
			const { comment } = await json<{ comment: Row }>(response);
			expect(comment.id).toBe(id);
			expect(comment.likeCount).toBe(1);
			expect(comment.viewerLiked).toBe(true);
		}
	});

	test("sending PUT several times still leaves one reaction", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		for (let i = 0; i < 4; i++)
			expect((await react(storyId, root.id, alice.cookie)).status).toBe(200);

		const last = await json<{ comment: Row }>(
			await react(storyId, root.id, alice.cookie),
		);
		expect(last.comment.likeCount).toBe(1);
		expect(
			await db
				.select()
				.from(story_comment_reaction)
				.where(eq(story_comment_reaction.comment_id, root.id)),
		).toHaveLength(1);
	});

	test("DELETE is idempotent — it succeeds even if never pressed", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		const never = await unreact(storyId, root.id, alice.cookie);
		expect(never.status).toBe(200);
		expect((await json<{ comment: Row }>(never)).comment.viewerLiked).toBe(
			false,
		);

		await react(storyId, root.id, alice.cookie);
		const first = await json<{ comment: Row }>(
			await unreact(storyId, root.id, alice.cookie),
		);
		expect(first.comment.likeCount).toBe(0);
		const second = await json<{ comment: Row }>(
			await unreact(storyId, root.id, alice.cookie),
		);
		expect(second.comment.likeCount).toBe(0);
	});

	test("two people pressing make two, and `viewerLiked` differs per viewer", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		await react(storyId, root.id, alice.cookie);
		const second = await json<{ comment: Row }>(
			await react(storyId, root.id, bob.cookie),
		);
		expect(second.comment.likeCount).toBe(2);

		const forCarol = await json<{ items: Row[] }>(
			await listComments(storyId, carol.cookie),
		);
		expect(forCarol.items[0]?.likeCount).toBe(2);
		expect(forCarol.items[0]?.viewerLiked).toBe(false);

		const forBob = await json<{ items: Row[] }>(
			await listComments(storyId, bob.cookie),
		);
		expect(forBob.items[0]?.viewerLiked).toBe(true);

		/** Guests see the count, but the viewer is never counted among the likers. */
		const forGuest = await json<{ items: Row[] }>(await listComments(storyId));
		expect(forGuest.items[0]?.likeCount).toBe(2);
		expect(forGuest.items[0]?.viewerLiked).toBe(false);
	});

	test("on account deletion that person's presses disappear and the count drops", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await react(storyId, root.id, alice.cookie);
		await react(storyId, root.id, bob.cookie);

		expect(
			(await json<{ items: Row[] }>(await listComments(storyId))).items[0]
				?.likeCount,
		).toBe(2);

		const deleted = await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: headers(bob.cookie, true),
			body: JSON.stringify({}),
		});
		expect(deleted.ok).toBe(true);

		expect(
			(await json<{ items: Row[] }>(await listComments(storyId))).items[0]
				?.likeCount,
		).toBe(1);
		expect(
			await db
				.select()
				.from(story_comment_reaction)
				.where(eq(story_comment_reaction.member_id, bob.memberId)),
		).toHaveLength(0);
	});

	test("a kind outside the vocabulary is a 404 — it doesn't reveal the supported list", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);

		expect((await react(storyId, root.id, alice.cookie, "wow")).status).toBe(
			404,
		);
		expect((await react(storyId, root.id, alice.cookie, "🔥")).status).toBe(
			404,
		);
	});

	test("guests can't press, and nobody can press on a tombstone", async () => {
		resetLimiter();
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const root = await makeComment(storyId, alice.cookie);
		await makeReply(storyId, root.id, bob.cookie);

		expect((await react(storyId, root.id, null)).status).toBe(401);

		await removeComment(storyId, root.id, alice.cookie);
		expect((await react(storyId, root.id, bob.cookie)).status).toBe(404);
	});

	test("can't react to another story's comment through this story's path", async () => {
		resetLimiter();
		const alice = await signUp();
		const here = await seedStory(alice.memberId);
		const there = await seedStory(alice.memberId);
		const root = await makeComment(there, alice.cookie);

		expect((await react(here, root.id, alice.cookie)).status).toBe(404);
	});

	test("a suspended member can't press but can take back what they already pressed", async () => {
		resetLimiter();
		const alice = await signUp();
		const storyId = await seedStory((await signUp()).memberId);
		const root = await makeComment(storyId, alice.cookie);
		await react(storyId, root.id, alice.cookie);

		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, alice.memberId));

		expect((await react(storyId, root.id, alice.cookie)).status).toBe(403);
		/** Withdrawing a reaction already made must work even under a restriction. */
		expect((await unreact(storyId, root.id, alice.cookie)).status).toBe(200);
	});
});

describe.skipIf(!databaseReady)(
	"aggregates — not proportional to row count",
	() => {
		/**
		 * Counts queries. The easiest performance defect here is a per-row `count(*)` (N+1), whose only
		 * symptom is "comments are slow". Counting works by briefly swapping the driver's logger, which
		 * needs a real Postgres, hence this file.
		 */
		test("the query count of one page is independent of the row count", async () => {
			resetLimiter();
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId);

			const roots: string[] = [];
			for (let i = 0; i < 6; i++) {
				resetLimiter();
				const root = await makeComment(storyId, alice.cookie, `Root ${i}`);
				roots.push(root.id);
				await makeReply(storyId, root.id, bob.cookie, `Reply ${i}`);
				await react(storyId, root.id, bob.cookie);
			}

			/**
			 * Briefly swaps drizzle's logger. The instance's `logger` field is what is actually used, so this
			 * counts the statements the request really sent.
			 */
			const countQueries = async (expected: number): Promise<number> => {
				let queries = 0;
				const handle = db as unknown as {
					logger: { logQuery: (q: string, p: unknown[]) => void };
				};
				const previous = handle.logger;
				handle.logger = {
					logQuery: () => {
						queries += 1;
					},
				};
				try {
					const response = await listComments(storyId, bob.cookie);
					expect(response.status).toBe(200);
					const page = await json<{ items: Row[] }>(response);
					expect(page.items).toHaveLength(expected);
					expect(page.items[0]?.replyCount).toBe(1);
					expect(page.items[0]?.likeCount).toBe(1);
				} finally {
					handle.logger = previous;
				}
				return queries;
			};

			const withSix = await countQueries(6);

			// Double the rows; a matching increase in queries would mean N+1.
			for (let i = 6; i < 12; i++) {
				resetLimiter();
				const root = await makeComment(storyId, alice.cookie, `Root ${i}`);
				roots.push(root.id);
				await makeReply(storyId, root.id, bob.cookie, `Reply ${i}`);
				await react(storyId, root.id, bob.cookie);
			}

			expect(roots).toHaveLength(12);
			/**
			 * Doubling the rows leaves the query count unchanged. No absolute number is pinned because
			 * session resolution and block-list queries are counted too; the guarded property is independence
			 * from row count.
			 */
			expect(await countQueries(12)).toBe(withSix);
		});
	},
);
