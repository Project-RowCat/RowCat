import {
	STORY_COMMENT_ERROR_CODE,
	STORY_COMMENT_LIMITS,
} from "@rowcat/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { member, story, story_comment } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import {
	__setRateLimitStoreForTest,
	createMemoryRateLimitStore,
} from "../../lib/rate-limit/index.ts";

import { createTestMember, TEST_PASSWORD } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Story comments, exercised across every boundary with the real Hono app and a real Postgres.
 * Calling service functions directly would leave the fragile spots outside the test: reading the
 * author from the session, passing the story exposure gate, and the cursor's interlock with index
 * order (SQL row comparison and column precision, which mocks cannot check).
 *
 * The point is the reverse of "is it stored as requested": whatever the client sends, only what the
 * server decides is stored, and the discussion of a story the viewer cannot see never leaks.
 */

const EMAIL_PREFIX = "story-comments-test-";

/**
 * One member. The final `/me` matters: member rows are created on the first request, not at signup
 * (`ensureMember` in `auth/viewer.ts`).
 */
const signUp = () => createTestMember(EMAIL_PREFIX, { name: "Comment test" });

type Visibility = "public" | "private" | "archived";

async function seedStory(
	ownerId: string,
	options: {
		visibility?: Visibility;
		adult?: boolean;
		hidden?: boolean;
	} = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: `Story ${id.slice(0, 6)}`,
		visibility: options.visibility ?? "public",
		adult: options.adult ?? false,
		hidden: options.hidden ?? false,
		origin_draft_id: newId(),
		play_payload: { v: 1 },
	});
	return id;
}

/** The three adult-viewing axes: identity verification, age 19+, display opt-in. */
const grantAdultViewing = (memberId: string) =>
	db
		.update(member)
		.set({ verified: true, adult: true, show_adult: true })
		.where(eq(member.id, memberId));

const suspend = (memberId: string) =>
	db.update(member).set({ status: "suspended" }).where(eq(member.id, memberId));

const listComments = (
	storyId: string,
	query = "",
	cookie: string | null = null,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/comments${query}`, {
			headers: { Origin: WEB_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
		}),
	);

const postComment = (
	storyId: string,
	cookie: string | null,
	body: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/comments`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const deleteComment = (
	storyId: string,
	commentId: string,
	cookie: string | null,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/comments/${commentId}`, {
			method: "DELETE",
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
		}),
	);

interface CommentBody {
	comment: {
		id: string;
		storyId: string;
		body: string;
		createdAt: string;
		author: { id: string; nickname: string; avatarUrl: string | null };
	};
}
interface PageBody {
	items: CommentBody["comment"][];
	nextCursor: string | null;
}
interface ErrorBody {
	code: string;
}

/** Seeded directly, bypassing requests: avoids the rate limiter and lets us choose timestamps. */
const seedComment = (
	storyId: string,
	authorId: string,
	body: string,
	createdAt: Date,
): Promise<unknown> =>
	db.insert(story_comment).values({
		id: newId(),
		story_id: storyId,
		author: authorId,
		body,
		created_at: createdAt,
	});

const commentRows = (storyId: string) =>
	db.select().from(story_comment).where(eq(story_comment.story_id, storyId));

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) {
		// Ownerless public stories left by deletion tests are not removed with the user.
		await db.delete(story).where(isNull(story.owner));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("comments — body rules", () => {
	test("writes a comment on a public story", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		const response = await postComment(storyId, author.cookie, {
			body: "I enjoyed reading this",
		});
		expect(response.status).toBe(201);

		const { comment } = (await response.json()) as CommentBody;
		expect(comment.body).toBe("I enjoyed reading this");
		expect(comment.storyId).toBe(storyId);
		// The author projection rides on the response so rows need no per-row profile lookup.
		expect(comment.author.id).toBe(author.memberId);
		expect(comment.author.nickname).toBe("Comment test");

		const rows = await commentRows(storyId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.author).toBe(author.memberId);
	});

	/**
	 * Counts the public projection's whole key set, as the public profile test does. This response
	 * carries other people's identity: `toHaveProperty("nickname")` only checks known fields, so a new
	 * member column added to the author projection would pass while publishing it. Comments are not
	 * gated by viewer (guests read a public story's discussion), so a leak here has the widest reach.
	 *
	 * Both list and create responses are checked because one projection still has two paths that could
	 * diverge later.
	 */
	test("the response has only the fields the contract allows", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);
		await postComment(storyId, author.cookie, { body: "Key set" });

		const created = (await (
			await postComment(storyId, author.cookie, { body: "Key set 2" })
		).json()) as { comment: Record<string, unknown> };
		const listed = (await (await listComments(storyId)).json()) as {
			items: Record<string, unknown>[];
		};

		for (const comment of [created.comment, listed.items[0]]) {
			/**
			 * Counting the key set is the whole check; "no sensitive fields" would pass silently when a
			 * column is added. Replies and reactions grew five keys to nine: `state` is the discriminator
			 * (tombstone vs visible row), `parentId` is the thread axis, and the other three are aggregates.
			 * Internal axes such as `deletedAt` and `authorId` are still absent.
			 */
			expect(Object.keys(comment ?? {}).sort()).toEqual([
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
			expect(Object.keys((comment?.author ?? {}) as object).sort()).toEqual([
				"avatarUrl",
				"id",
				"nickname",
			]);
		}
	});

	test("leading and trailing spaces are trimmed and inner line breaks stay", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		const response = await postComment(storyId, author.cookie, {
			body: "  First line\n\nSecond paragraph  ",
		});
		expect(response.status).toBe(201);
		/**
		 * Folding inner newlines would destroy the author's paragraphs; only the ends are trimmed, by the
		 * contract's rule (`StoryCommentCreateRequest`).
		 */
		expect(((await response.json()) as CommentBody).comment.body).toBe(
			"First line\n\nSecond paragraph",
		);
	});

	test("refuses empty and whitespace-only bodies", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		expect(
			(await postComment(storyId, author.cookie, { body: "" })).status,
		).toBe(400);
		// Judged after trimming, so a whitespace-only comment is empty.
		expect(
			(await postComment(storyId, author.cookie, { body: "   \n  " })).status,
		).toBe(400);
		expect((await postComment(storyId, author.cookie, {})).status).toBe(400);
		expect(await commentRows(storyId)).toHaveLength(0);
	});

	test("cap boundary — exactly at it passes, one character over is refused", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		const exact = "a".repeat(STORY_COMMENT_LIMITS.body);
		expect(
			(await postComment(storyId, author.cookie, { body: exact })).status,
		).toBe(201);
		expect(
			(
				await postComment(storyId, author.cookie, {
					body: "a".repeat(STORY_COMMENT_LIMITS.body + 1),
				})
			).status,
		).toBe(400);
		expect(await commentRows(storyId)).toHaveLength(1);
	});
});

describe.skipIf(!databaseReady)("comments — authorization", () => {
	test("guests can read but not write", async () => {
		const owner = await signUp();
		const author = await signUp();
		const storyId = await seedStory(owner.memberId);
		await postComment(storyId, author.cookie, { body: "A public review" });

		const read = await listComments(storyId);
		expect(read.status).toBe(200);
		expect(((await read.json()) as PageBody).items).toHaveLength(1);

		// No anonymous comments; the author comes only from the session.
		const write = await postComment(storyId, null, { body: "I'm anonymous" });
		expect(write.status).toBe(401);
		expect(await commentRows(storyId)).toHaveLength(1);
	});

	test("the author is always the member who sent the request", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(bob.memberId);

		/**
		 * Sends an author in the body. The contract has no such field, so zod strips it and the server
		 * uses the session's member: not "received and ignored" but inexpressible.
		 */
		const response = await postComment(storyId, alice.cookie, {
			body: "Pretending to be Bob",
			authorId: bob.memberId,
			author: { id: bob.memberId, nickname: "Bob" },
			memberId: bob.memberId,
			nickname: "Bob",
			createdAt: "1999-01-01T00:00:00.000Z",
		});
		expect(response.status).toBe(201);

		const { comment } = (await response.json()) as CommentBody;
		expect(comment.author.id).toBe(alice.memberId);
		const rows = await commentRows(storyId);
		expect(rows[0]?.author).toBe(alice.memberId);
		// The server also decides the time; a past timestamp in the request is stored nowhere.
		expect(new Date(comment.createdAt).getFullYear()).toBeGreaterThan(2020);
	});

	test("can't delete someone else's comment, and can delete your own", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);

		const bobComment = (
			(await (
				await postComment(storyId, bob.cookie, { body: "Bob's review" })
			).json()) as CommentBody
		).comment;

		/**
		 * Deleting someone else's comment gets the same 404 as a missing one; a 403 would itself reveal
		 * that the comment exists.
		 */
		const stolen = await deleteComment(storyId, bobComment.id, alice.cookie);
		expect(stolen.status).toBe(404);
		expect(await commentRows(storyId)).toHaveLength(1);

		const own = await deleteComment(storyId, bobComment.id, bob.cookie);
		/**
		 * 200 rather than 204 because there are two outcomes (the row is removed or becomes a tombstone).
		 * A comment without replies is removed, and `comment: null` in the response says so.
		 */
		expect(own.status).toBe(200);
		expect(((await own.json()) as { comment: unknown }).comment).toBeNull();
		expect(await commentRows(storyId)).toHaveLength(0);
	});

	test("a comment on a story other than the path's story isn't deleted", async () => {
		const alice = await signUp();
		const mine = await seedStory(alice.memberId);
		const other = await seedStory(alice.memberId);

		const comment = (
			(await (
				await postComment(other, alice.cookie, { body: "A review over there" })
			).json()) as CommentBody
		).comment;

		/**
		 * Own comment, but deleted through another story's path. Letting it through would touch B's
		 * comment past A's boundary, bypassing B's exposure gate.
		 */
		expect((await deleteComment(mine, comment.id, alice.cookie)).status).toBe(
			404,
		);
		expect(await commentRows(other)).toHaveLength(1);
	});

	test("a suspended member can't write but can take down their own comments", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);
		const comment = (
			(await (
				await postComment(storyId, author.cookie, {
					body: "A review before suspension",
				})
			).json()) as CommentBody
		).comment;

		await suspend(author.memberId);

		const write = await postComment(storyId, author.cookie, {
			body: "After suspension",
		});
		expect(write.status).toBe(403);
		expect(((await write.json()) as ErrorBody).code).toBe("account_restricted");

		/**
		 * Deleting is not blocked. A suspension stops new writing; it must not trap someone with what
		 * they already wrote, so taking one's own words down stays possible.
		 */
		expect(
			(await deleteComment(storyId, comment.id, author.cookie)).status,
		).toBe(200);
	});

	test("rapid repeats are blocked with 429 and say when it works again", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		for (let i = 0; i < 5; i++)
			expect(
				(await postComment(storyId, author.cookie, { body: `Rapid ${i}` }))
					.status,
			).toBe(201);

		const blocked = await postComment(storyId, author.cookie, {
			body: "The sixth",
		});
		expect(blocked.status).toBe(429);
		expect(((await blocked.json()) as ErrorBody).code).toBe(
			STORY_COMMENT_ERROR_CODE.rateLimited,
		);
		// Without the header the client falls back to its own backoff and keeps hammering while limited.
		expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(await commentRows(storyId)).toHaveLength(5);
	});

	/**
	 * Each member has a separate budget. Without this assertion a limiter keyed wrongly (a global
	 * counter by policy name) passes. Its symptom would be getting blocked because someone else
	 * commented on a popular story, which even the affected person could not explain.
	 */
	test("the rapid-repeat cap is per member — someone else's comments don't spend my budget", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		for (let i = 0; i < 5; i++)
			expect(
				(await postComment(storyId, alice.cookie, { body: `Alice ${i}` }))
					.status,
			).toBe(201);
		expect(
			(await postComment(storyId, alice.cookie, { body: "The sixth" })).status,
		).toBe(429);

		// Bob never wrote; Alice being limited must not be visible to Bob.
		expect(
			(await postComment(storyId, bob.cookie, { body: "Bob's first line" }))
				.status,
		).toBe(201);
	});

	/**
	 * After the window passes, writing works again. We do not wait 30 seconds; only the store's clock
	 * moves (`createMemoryRateLimitStore({ now })`). Fake timers would shift the whole process's time,
	 * including the Postgres row timestamps and cursors in the same process, and the resulting
	 * failures would not say what broke.
	 *
	 * The store is restored afterwards so later tests do not run on the shifted clock.
	 */
	test("can write again once the window passes", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		let clock = Date.now();
		await __setRateLimitStoreForTest(
			createMemoryRateLimitStore({ now: () => clock }),
		);
		try {
			for (let i = 0; i < 5; i++)
				expect(
					(await postComment(storyId, author.cookie, { body: `Rapid ${i}` }))
						.status,
				).toBe(201);
			expect(
				(await postComment(storyId, author.cookie, { body: "The sixth" }))
					.status,
			).toBe(429);

			// The policy window is 30 seconds; push past it.
			clock += 31_000;

			expect(
				(
					await postComment(storyId, author.cookie, {
						body: "After the window",
					})
				).status,
			).toBe(201);
		} finally {
			await __setRateLimitStoreForTest(null);
		}
	});

	/**
	 * Comments still succeed when the counter store is down (fail-open). This checks the policy's
	 * failure mode is actually enforced: blocking here would stop everyone from commenting during a
	 * brief Redis wobble, which costs far more than the few spam lines lost.
	 */
	test("comments pass even when storage is down — this policy is fail-open", async () => {
		const author = await signUp();
		const storyId = await seedStory((await signUp()).memberId);

		await __setRateLimitStoreForTest({
			kind: "memory",
			consume: () => Promise.reject(new Error("ECONNREFUSED")),
			release: () => Promise.reject(new Error("ECONNREFUSED")),
			close: () => Promise.resolve(),
		});
		try {
			const response = await postComment(storyId, author.cookie, {
				body: "While storage is down",
			});
			expect(response.status).toBe(201);
		} finally {
			await __setRateLimitStoreForTest(null);
		}
	});
});

describe.skipIf(!databaseReady)("comments — story visibility policy", () => {
	test("an unknown story is 404", async () => {
		const alice = await signUp();
		expect((await listComments(newId())).status).toBe(404);
		expect(
			(await postComment(newId(), alice.cookie, { body: "Into the void" }))
				.status,
		).toBe(404);
	});

	test("private story — not even its existence is revealed to others", async () => {
		const owner = await signUp();
		const stranger = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "private" });
		// Even if the owner can view the story, discussion is not open, so a pre-seeded row must not
		// leak.
		await seedComment(storyId, owner.memberId, "Talking to myself", new Date());

		const guest = await listComments(storyId);
		expect(guest.status).toBe(404);
		expect(await guest.text()).not.toContain("Talking to myself");

		const other = await listComments(storyId, "", stranger.cookie);
		expect(other.status).toBe(404);
		expect(((await other.json()) as ErrorBody).code).toBe("not_found");

		expect(
			(await postComment(storyId, stranger.cookie, { body: "sneakily" }))
				.status,
		).toBe(404);
	});

	test("private story — the owner is told the reason", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "private" });

		const response = await listComments(storyId, "", owner.cookie);
		/**
		 * Only the owner, who already sees the story, reaches this branch, so stating the reason does not
		 * break existence hiding. The status is still 404.
		 */
		expect(response.status).toBe(404);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_COMMENT_ERROR_CODE.unavailable,
		);
		expect(
			(
				await postComment(storyId, owner.cookie, {
					body: "It's my story, though",
				})
			).status,
		).toBe(404);
	});

	test("discussion doesn't open on archived or operator-hidden stories", async () => {
		const owner = await signUp();
		const archived = await seedStory(owner.memberId, {
			visibility: "archived",
		});
		const hidden = await seedStory(owner.memberId, { hidden: true });
		await seedComment(
			archived,
			owner.memberId,
			"A review before archiving",
			new Date(),
		);
		await seedComment(
			hidden,
			owner.memberId,
			"A review before hiding",
			new Date(),
		);

		// Not open even to the owner: archiving removes it from lists and hiding is the operator's axis.
		for (const id of [archived, hidden]) {
			const response = await listComments(id, "", owner.cookie);
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("Review");
		}
	});

	test("adult story — only eligible viewers read and write", async () => {
		const owner = await signUp();
		await grantAdultViewing(owner.memberId);
		const storyId = await seedStory(owner.memberId, { adult: true });
		await seedComment(
			storyId,
			owner.memberId,
			"An adult story review",
			new Date(),
		);

		const eligible = await signUp();
		await grantAdultViewing(eligible.memberId);
		const allowed = await listComments(storyId, "", eligible.cookie);
		expect(allowed.status).toBe(200);
		expect(((await allowed.json()) as PageBody).items).toHaveLength(1);
		expect(
			(await postComment(storyId, eligible.cookie, { body: "Enjoyed it" }))
				.status,
		).toBe(201);

		/**
		 * Viewers without access get no body, title or author. If the comment path bypassed the gate the
		 * detail enforces, what leaks is the whole discussion, not one card.
		 */
		const ineligible = await signUp();
		const denied = await listComments(storyId, "", ineligible.cookie);
		expect(denied.status).toBe(404);
		expect(await denied.text()).not.toContain("Review");
		expect(
			(await postComment(storyId, ineligible.cookie, { body: "sneakily" }))
				.status,
		).toBe(404);
		expect((await listComments(storyId)).status).toBe(404);
	});
});

describe.skipIf(!databaseReady)("comments — cursor pagination", () => {
	/** Follows the cursor to the end, one page at a time, and returns the concatenated rows. */
	async function walk(
		storyId: string,
		limit: number,
		cookie: string | null = null,
	): Promise<{ ids: string[]; pages: number }> {
		const ids: string[] = [];
		let cursor: string | null = "";
		let pages = 0;
		while (cursor !== null) {
			const query = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
			const response = await listComments(storyId, query, cookie);
			expect(response.status).toBe(200);
			const page = (await response.json()) as PageBody;
			ids.push(...page.items.map((item) => item.id));
			cursor = page.nextCursor;
			pages += 1;
			if (pages > 20) throw new Error("the cursor never ends");
		}
		return { ids, pages };
	}

	test("walks oldest first, with no duplicates or drops", async () => {
		const author = await signUp();
		const storyId = await seedStory(author.memberId);
		const base = Date.now();
		for (let i = 0; i < 5; i++)
			await seedComment(
				storyId,
				author.memberId,
				`No. ${i}`,
				new Date(base + i),
			);

		const { ids, pages } = await walk(storyId, 2);
		expect(pages).toBe(3);
		expect(new Set(ids).size).toBe(5);

		// Ascending by time: the order a conversation is read.
		const rows = await db
			.select({ id: story_comment.id, body: story_comment.body })
			.from(story_comment)
			.where(eq(story_comment.story_id, storyId));
		const bodyOf = new Map(rows.map((row) => [row.id, row.body]));
		expect(ids.map((id) => bodyOf.get(id))).toEqual([
			"No. 0",
			"No. 1",
			"No. 2",
			"No. 3",
			"No. 4",
		]);
	});

	test("the order is fixed even with equal times", async () => {
		const author = await signUp();
		const storyId = await seedStory(author.memberId);
		/**
		 * Five rows in the same millisecond. With time as the only sort key, a row at a page boundary
		 * would be seen twice or vanish; the id tiebreak prevents exactly that.
		 */
		const at = new Date();
		for (let i = 0; i < 5; i++)
			await seedComment(storyId, author.memberId, `Concurrent ${i}`, at);

		const { ids } = await walk(storyId, 2);
		expect(ids).toHaveLength(5);
		expect(new Set(ids).size).toBe(5);
		// Walking twice gives the same order (deterministic sort).
		expect((await walk(storyId, 2)).ids).toEqual(ids);
		expect([...ids]).toEqual([...ids].sort());
	});

	test("a new comment during pagination doesn't throw it off", async () => {
		const author = await signUp();
		const late = await signUp();
		const storyId = await seedStory(author.memberId);
		const base = Date.now();
		for (let i = 0; i < 4; i++)
			await seedComment(
				storyId,
				author.memberId,
				`No. ${i}`,
				new Date(base + i),
			);

		const first = (await (
			await listComments(storyId, "?limit=2")
		).json()) as PageBody;
		expect(first.items).toHaveLength(2);
		expect(first.nextCursor).not.toBeNull();

		// A new row arrives after the first page is read; the cursor means "after the last seen row", so
		// it is unaffected.
		const created = (
			(await (
				await postComment(storyId, late.cookie, { body: "Just arrived" })
			).json()) as CommentBody
		).comment;

		const seen = [...first.items.map((item) => item.id)];
		let cursor: string | null = first.nextCursor;
		while (cursor) {
			const page = (await (
				await listComments(
					storyId,
					`?limit=2&cursor=${encodeURIComponent(cursor)}`,
				)
			).json()) as PageBody;
			seen.push(...page.items.map((item) => item.id));
			cursor = page.nextCursor;
		}

		// Each of the five appears once; the new row comes last (oldest first).
		expect(seen).toHaveLength(5);
		expect(new Set(seen).size).toBe(5);
		expect(seen[seen.length - 1]).toBe(created.id);
	});

	test("a limit over the cap and a broken cursor are a 400", async () => {
		const author = await signUp();
		const storyId = await seedStory(author.memberId);

		// Without a cap one request could dump the entire discussion.
		expect((await listComments(storyId, "?limit=100000")).status).toBe(400);
		expect((await listComments(storyId, "?limit=0")).status).toBe(400);
		expect((await listComments(storyId, "?limit=2.5")).status).toBe(400);
		/**
		 * A malformed cursor is not quietly folded into the first page; infinite scroll would repeat that
		 * page forever with no visible cause.
		 */
		expect(
			(await listComments(storyId, "?cursor=!!not-a-cursor!!")).status,
		).toBe(400);
	});
});

describe.skipIf(!databaseReady)("comments — lifetime", () => {
	test("deleting the story removes its discussion too", async () => {
		const owner = await signUp();
		const author = await signUp();
		const storyId = await seedStory(owner.memberId);
		await postComment(storyId, author.cookie, {
			body: "A review that will disappear",
		});
		expect(await commentRows(storyId)).toHaveLength(1);

		await db.delete(story).where(eq(story.id, storyId));
		// An orphaned comment would be personal data unreachable from any screen.
		expect(await commentRows(storyId)).toHaveLength(0);
	});

	test("on account deletion that person's comments disappear from other people's stories too", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const bobStory = await seedStory(bob.memberId);
		const aliceStory = await seedStory(alice.memberId);

		await postComment(bobStory, alice.cookie, { body: "Alice's review" });
		await postComment(aliceStory, bob.cookie, { body: "Bob's review" });

		const gone = await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: alice.cookie,
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});
		expect(gone.status).toBe(200);

		/**
		 * The policy is deletion, not anonymous retention. The story stays with identity detached, but a
		 * comment is that person's utterance; keeping it would leave their words in the catalogue and
		 * require a `Deleted user` placeholder on screen.
		 */
		expect(await commentRows(bobStory)).toHaveLength(0);
		expect(
			await db
				.select()
				.from(story_comment)
				.where(eq(story_comment.author, alice.memberId)),
		).toHaveLength(0);

		/**
		 * Alice's public story remains with identity detached (`owner = NULL`) and Bob's comment on it is
		 * unchanged, since someone else wrote it. No dangling identity remains.
		 */
		const survivors = await commentRows(aliceStory);
		expect(survivors).toHaveLength(1);
		expect(survivors[0]?.author).toBe(bob.memberId);
		const [row] = await db
			.select({ owner: story.owner })
			.from(story)
			.where(eq(story.id, aliceStory));
		expect(row?.owner).toBeNull();

		// An ownerless story's discussion stays readable (it is public).
		const stillPublic = await listComments(aliceStory);
		expect(stillPublic.status).toBe(200);
		expect(((await stillPublic.json()) as PageBody).items).toHaveLength(1);
	});

	test("no comment row pointing at a deleted member remains", async () => {
		const alice = await signUp();
		const bobStory = await seedStory((await signUp()).memberId);
		await postComment(bobStory, alice.cookie, {
			body: "A review about to disappear",
		});

		await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: alice.cookie,
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});

		/**
		 * If any comment still points at the vanished member id, the FK broke or cleanup was skipped;
		 * either way readers would join a nonexistent identity.
		 */
		expect(
			await db
				.select()
				.from(story_comment)
				.where(eq(story_comment.author, alice.memberId)),
		).toHaveLength(0);
		expect(
			await db.select().from(member).where(eq(member.id, alice.memberId)),
		).toHaveLength(0);
	});

	test("deleting a story doesn't touch comments on other people's stories", async () => {
		const owner = await signUp();
		const author = await signUp();
		const doomed = await seedStory(owner.memberId);
		const kept = await seedStory(owner.memberId);
		await postComment(doomed, author.cookie, {
			body: "The side to be deleted",
		});
		await postComment(kept, author.cookie, { body: "The side that stays" });

		await db.delete(story).where(and(eq(story.id, doomed)));

		expect(await commentRows(doomed)).toHaveLength(0);
		expect(await commentRows(kept)).toHaveLength(1);
	});
});
