import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { member, story, story_comment } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `GET /v2/me/creator-analytics`: the `Analytics` tab of the creation workspace.
 *
 * What this file pins:
 *
 * 1. Ownership isolation: Alice's metrics carry none of Bob's works (not a line, not 1 in the
 *    totals), and the request cannot shake that, since no path, query or body slot names a target
 *    member.
 * 2. The owner sees everything: private, archived, operator-hidden and adult works are all
 *    included. That is why this resource split from the public ones (gallery, profile grid);
 *    filtering any axis would silently shrink the creator's totals.
 * 3. Totals cover everything, not the page: `pageSize=1` must not change them. Summing pages
 *    would make total views grow on every `Show more`, read as views having increased.
 * 4. Comments count lines that exist now; counting cumulative writes would never decrease.
 * 5. Projection boundary: the whole response key set is counted. `not.toHaveProperty(...)` would
 *    only block fields known today and let the playback payload or viewer identity leak when a
 *    column is added or a join result is passed through.
 *
 * Runs against real Postgres and the real Hono app: session-to-member wiring and the aggregation
 * SQL are under test, so calling service functions alone would leave the fragile parts outside.
 */

const EMAIL_PREFIX = "me-analytics-test-";

/** One member. The final `/me` creates the member row (it appears on the first request, not at signup). */
const signUp = (name = "Analytics test") =>
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
	views?: number;
	favorites?: number;
	downloads?: number;
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
		views: options.views ?? 0,
		favorites: options.favorites ?? 0,
		/** Must not be exposed, so a non-zero number is planted on purpose. */
		downloads: options.downloads ?? 77,
		/** Fill the playback payload on purpose: if the projection leaks, this value shows up in the response. */
		play_payload: {
			version: 1,
			storyId: id,
			title: "Secret title",
			scenario: "a scenario body that must never appear in a response",
		},
	});
	return id;
}

/** One comment line. The author does not matter; what is counted is lines on the work. */
async function seedComment(
	storyId: string,
	authorId: string,
	body = "A comment",
): Promise<string> {
	const id = newId();
	await db
		.insert(story_comment)
		.values({ id, story_id: storyId, author: authorId, body });
	return id;
}

interface AnalyticsWork {
	id: string;
	title: string;
	visibility: string;
	hidden: boolean;
	views: number;
	favorites: number;
	comments: number;
	updatedAt: string;
}

interface AnalyticsBody {
	summary: { views: number; favorites: number; comments: number };
	items: AnalyticsWork[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

const readAnalytics = async (
	cookie?: string | null,
	query = "",
): Promise<AnalyticsBody> =>
	(await (
		await get(`/v2/me/creator-analytics${query}`, cookie)
	).json()) as AnalyticsBody;

const idsOf = (body: AnalyticsBody): string[] => body.items.map((w) => w.id);

/** Eligibility to publish adult work (legal requirement); the display opt-in stays off. */
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
	"GET /v2/me/creator-analytics — ownership isolation",
	() => {
		test("only my stories come — someone else's are neither in the rows nor in the total", async () => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");

			const a1 = await seedStory(alice.memberId, { views: 10, favorites: 2 });
			const bobStory = await seedStory(bob.memberId, {
				views: 1000,
				favorites: 500,
			});
			await seedComment(bobStory, bob.memberId);

			const body = await readAnalytics(alice.cookie);
			expect(idsOf(body)).toEqual([a1]);
			expect(body.total).toBe(1);
			/** None of Bob's 1000, 500 and 1 may leak into the totals. */
			expect(body.summary).toEqual({
				views: 10,
				favorites: 2,
				comments: 0,
				playStarts: 0,
				windowViews: 10,
				windowPlayStarts: 0,
			});
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
			"?viewerId=",
		])("adding `%s` still can't show someone else's analytics", async (param) => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");
			await seedStory(alice.memberId, { views: 3 });
			await seedStory(bob.memberId, { views: 900 });

			const body = await readAnalytics(alice.cookie, `${param}${bob.memberId}`);
			expect(body.summary.views).toBe(3);
			expect(body.total).toBe(1);
		});

		test("a guest gets 401", async () => {
			const response = await get("/v2/me/creator-analytics");
			expect(response.status).toBe(401);
		});

		test("with no stories at all the total is three zeros (not null)", async () => {
			const alice = await signUp();
			const body = await readAnalytics(alice.cookie);
			expect(body).toMatchObject({
				summary: { views: 0, favorites: 0, comments: 0 },
				items: [],
				total: 0,
				page: 1,
				pageCount: 1,
			});
		});
	},
);

describe.skipIf(!databaseReady)(
	"GET /v2/me/creator-analytics — the owner sees everything",
	() => {
		test("private, public, archived and operator-hidden are all included", async () => {
			const alice = await signUp();
			const priv = await seedStory(alice.memberId, {
				visibility: "private",
				views: 1,
			});
			const pub = await seedStory(alice.memberId, {
				visibility: "public",
				views: 2,
			});
			const archived = await seedStory(alice.memberId, {
				visibility: "archived",
				views: 4,
			});
			const hidden = await seedStory(alice.memberId, {
				hidden: true,
				views: 8,
			});

			const body = await readAnalytics(alice.cookie);
			expect(idsOf(body).sort()).toEqual([priv, pub, archived, hidden].sort());
			/** Totals pass through the same predicate; a filtered work would make them diverge here. */
			expect(body.summary.views).toBe(15);
		});

		/**
		 * Adult-verified creator with the display opt-in off. Reusing the gallery predicate would make
		 * this work vanish from their own analytics.
		 */
		test("even with the display off, own adult stories' performance is visible", async () => {
			const alice = await signUp();
			await grantAdultEligibility(alice.memberId);
			const id = await seedStory(alice.memberId, { adult: true, views: 12 });

			const body = await readAnalytics(alice.cookie);
			expect(idsOf(body)).toEqual([id]);
			expect(body.summary.views).toBe(12);
		});

		/** Sanctions block outward writes, not reading one's own assets. */
		test.each([
			"suspended",
			"banned",
		] as const)("a %s member reads their own analytics too", async (status) => {
			const alice = await signUp();
			const id = await seedStory(alice.memberId, { views: 5 });
			await setStatus(alice.memberId, status);

			const response = await get("/v2/me/creator-analytics", alice.cookie);
			expect(response.status).toBe(200);
			const body = (await response.json()) as AnalyticsBody;
			expect(idsOf(body)).toEqual([id]);
			expect(body.summary.views).toBe(5);
		});
	},
);

describe.skipIf(!databaseReady)("GET /v2/me/creator-analytics — total", () => {
	test("adds up all three", async () => {
		const alice = await signUp();
		const a1 = await seedStory(alice.memberId, { views: 10, favorites: 2 });
		const a2 = await seedStory(alice.memberId, { views: 20, favorites: 5 });
		for (let i = 0; i < 3; i++) await seedComment(a1, alice.memberId, `a${i}`);
		for (let i = 0; i < 4; i++) await seedComment(a2, alice.memberId, `b${i}`);

		expect((await readAnalytics(alice.cookie)).summary).toEqual({
			views: 30,
			favorites: 7,
			comments: 7,
			playStarts: 0,
			windowViews: 30,
			windowPlayStarts: 0,
		});
	});

	/**
	 * Key assertion: if totals were a sum of pages, they would shrink at `pageSize=1` while the screen
	 * looked perfectly normal.
	 */
	test("the total stays the same however the pages are cut", async () => {
		const alice = await signUp();
		const a1 = await seedStory(alice.memberId, { views: 10, favorites: 2 });
		const a2 = await seedStory(alice.memberId, { views: 20, favorites: 5 });
		for (let i = 0; i < 3; i++) await seedComment(a1, alice.memberId, `a${i}`);
		for (let i = 0; i < 4; i++) await seedComment(a2, alice.memberId, `b${i}`);

		const expected = {
			views: 30,
			favorites: 7,
			comments: 7,
			playStarts: 0,
			windowViews: 30,
			windowPlayStarts: 0,
		};
		const first = await readAnalytics(alice.cookie, "?pageSize=1");
		const second = await readAnalytics(alice.cookie, "?page=2&pageSize=1");

		expect(first.items).toHaveLength(1);
		expect(first.summary).toEqual(expected);
		expect(second.summary).toEqual(expected);
		expect(first.total).toBe(2);
		expect(first.pageCount).toBe(2);
	});
});

describe.skipIf(!databaseReady)(
	"GET /v2/me/creator-analytics — what the metrics mean",
	() => {
		test("each row carries its story's comment count", async () => {
			const alice = await signUp();
			const many = await seedStory(alice.memberId, { views: 100 });
			const none = await seedStory(alice.memberId, { views: 50 });
			for (let i = 0; i < 3; i++)
				await seedComment(many, alice.memberId, `c${i}`);

			const body = await readAnalytics(alice.cookie);
			const byId = new Map(body.items.map((w) => [w.id, w]));
			expect(byId.get(many)?.comments).toBe(3);
			/** A work with no comments is 0, not null (the left join leaves it empty). */
			expect(byId.get(none)?.comments).toBe(0);
		});

		/**
		 * Counts lines that exist now: a cumulative count would never decrease, and the creator would
		 * read comments as existing on a work that has none.
		 */
		test("deleted comments are not counted", async () => {
			const alice = await signUp();
			const storyId = await seedStory(alice.memberId, { visibility: "public" });
			await seedComment(storyId, alice.memberId, "A comment that stays");
			const doomed = await seedComment(
				storyId,
				alice.memberId,
				"A comment to delete",
			);

			expect((await readAnalytics(alice.cookie)).summary.comments).toBe(2);

			// Delete through the product path; a direct DELETE would test the SQL, not the predicate.
			const deleted = await app.request(
				`/v2/stories/${storyId}/comments/${doomed}`,
				{
					method: "DELETE",
					headers: { Origin: WEB_ORIGIN, Cookie: alice.cookie },
				},
			);
			/** The delete responds 200 with `comment: null` since the line had no replies (the row is gone). */
			expect(deleted.status).toBe(200);

			const after = await readAnalytics(alice.cookie);
			expect(after.summary.comments).toBe(1);
			expect(after.items[0]?.comments).toBe(1);
		});

		/**
		 * Tombstones are not counted but replies are. The metric is the number of user utterances still
		 * standing: a reply has an author and a body, a tombstone has neither. The `deleted_at is null`
		 * predicate is the rule; if omitted, deleted text stays in the creator's metric with no error.
		 */
		test("replies count and tombstones don't", async () => {
			const alice = await signUp();
			const bob = await signUp();
			const storyId = await seedStory(alice.memberId, { visibility: "public" });
			const root = await seedComment(storyId, alice.memberId, "Root");

			const reply = await app.request(
				`/v2/stories/${storyId}/comments/${root}/replies`,
				{
					method: "POST",
					headers: {
						Origin: WEB_ORIGIN,
						Cookie: bob.cookie,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ body: "Bob's reply" }),
				},
			);
			expect(reply.status).toBe(201);
			// Root + reply = two; a reply is also an utterance on this work.
			expect((await readAnalytics(alice.cookie)).summary.comments).toBe(2);

			const deleted = await app.request(
				`/v2/stories/${storyId}/comments/${root}`,
				{
					method: "DELETE",
					headers: { Origin: WEB_ORIGIN, Cookie: alice.cookie },
				},
			);
			expect(deleted.status).toBe(200);
			/** The root becomes a tombstone because a reply remains: the row exists, the utterance does not. */
			expect(
				((await deleted.json()) as { comment: { state: string } | null })
					.comment?.state,
			).toBe("deleted");

			const after = await readAnalytics(alice.cookie);
			expect(after.summary.comments).toBe(1);
			expect(after.items[0]?.comments).toBe(1);
		});

		/** Order is by performance; rows with equal metrics are made deterministic by `id desc`. */
		test("ordered by performance and deterministic", async () => {
			const alice = await signUp();
			const low = await seedStory(alice.memberId, { views: 1, favorites: 0 });
			const high = await seedStory(alice.memberId, {
				views: 100,
				favorites: 0,
			});
			const mid = await seedStory(alice.memberId, { views: 50, favorites: 9 });

			expect(idsOf(await readAnalytics(alice.cookie))).toEqual([
				high,
				mid,
				low,
			]);
		});

		test("even with every metric equal, page boundaries neither duplicate nor drop", async () => {
			const alice = await signUp();
			const seeded: string[] = [];
			for (let i = 0; i < 5; i++) seeded.push(await seedStory(alice.memberId));

			const walked = [
				...idsOf(await readAnalytics(alice.cookie, "?pageSize=2")),
				...idsOf(await readAnalytics(alice.cookie, "?page=2&pageSize=2")),
				...idsOf(await readAnalytics(alice.cookie, "?page=3&pageSize=2")),
			];
			expect(new Set(walked).size).toBe(walked.length);
			expect(walked.sort()).toEqual([...seeded].sort());
		});
	},
);

describe.skipIf(!databaseReady)(
	"GET /v2/me/creator-analytics — projection",
	() => {
		/**
		 * Key assertion: the whole key set is counted. Asserting "no playback payload" would block only
		 * fields known today and let the scenario body or viewer identity leak when someone reuses a join
		 * result or `storyColumns`.
		 */
		test("an item has **only the eleven allowed fields**", async () => {
			const alice = await signUp();
			await seedStory(alice.memberId, { views: 3, favorites: 1 });

			const body = await readAnalytics(alice.cookie);
			expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
				"comments",
				"favorites",
				"hidden",
				"id",
				"playStarts",
				"title",
				"updatedAt",
				"views",
				"visibility",
				"windowPlayStarts",
				"windowViews",
			]);
		});

		/** The envelope is counted too, so no other axis slips in beside the totals. */
		test("the response envelope has eight cells and the total has six", async () => {
			const alice = await signUp();
			await seedStory(alice.memberId);

			const body = await readAnalytics(alice.cookie);
			expect(Object.keys(body).sort()).toEqual([
				"items",
				"page",
				"pageCount",
				"pageSize",
				"since",
				"summary",
				"total",
				"window",
			]);
			expect(Object.keys(body.summary).sort()).toEqual([
				"comments",
				"favorites",
				"playStarts",
				"views",
				"windowPlayStarts",
				"windowViews",
			]);
		});

		test.each([
			/** The whole work body (scenario, characters, lore); an aggregate response has no reason to carry it. */
			"play_payload",
			"playPayload",
			"scenario",
			"characters",
			"lore",
			"prompt",
			/** Cover and storage key. */
			"cover",
			"coverUrl",
			"coverKey",
			"sizeBytes",
			/** The owner is decided by the session; the response has no reason to repeat it. */
			"owner",
			"ownerId",
			"creator",
			"creatorId",
			"email",
			/** Non-aggregates: who viewed, who saved and who wrote which comment are not this resource's question. */
			"viewer",
			"viewers",
			"viewerIds",
			"favoritedBy",
			"commenters",
			"commentBodies",
			"audience",
			/** Moderation internals; what a member may see is answered by `/v2/me/moderation`. */
			"moderator",
			"reason",
			"reportId",
			"caseId",
		])("the private or unneeded field `%s` is not in an item", async (field) => {
			const alice = await signUp();
			await seedStory(alice.memberId, { hidden: true });

			const body = await readAnalytics(alice.cookie);
			expect(body.items[0]).not.toHaveProperty(field);
		});

		/**
		 * Do not export what is not measured. `story.downloads`, `download_log` and `recordDownload()`
		 * exist but no live path calls them; once such a value ships, a screen starts drawing it under a
		 * name like `Downloads`, pretending to measure it. The seed plants `downloads: 77` so a leak shows 77,
		 * not 0.
		 */
		test.each([
			"downloads",
			"chatStarts",
			"plays",
			"sessions",
			"starts",
		])("the unmeasured metric `%s` is in neither an item nor the total", async (field) => {
			const alice = await signUp();
			await seedStory(alice.memberId, { downloads: 77 });

			const body = await readAnalytics(alice.cookie);
			expect(body.items[0]).not.toHaveProperty(field);
			expect(body.summary).not.toHaveProperty(field);
		});

		/** That string appears nowhere in the body, which also covers leaks through nested places. */
		test("neither the playback body nor a download axis appears in the raw response", async () => {
			const alice = await signUp();
			await seedStory(alice.memberId, { downloads: 77 });

			const raw = await (
				await get("/v2/me/creator-analytics", alice.cookie)
			).text();
			expect(raw).not.toContain(
				"a scenario body that must never appear in a response",
			);
			expect(raw).not.toContain("Secret title");
			expect(raw).not.toContain("downloads");
		});

		/** A private value must stay neither on disk nor in back-forward cache. */
		test("not cached", async () => {
			const alice = await signUp();
			const response = await get("/v2/me/creator-analytics", alice.cookie);
			expect(response.headers.get("Cache-Control")).toContain("no-store");
		});
	},
);

describe.skipIf(!databaseReady)(
	"GET /v2/me/creator-analytics — page size",
	() => {
		/** Without a cap, a single pageSize would allow dumping everything. */
		test("a pageSize over the cap is a 400", async () => {
			const alice = await signUp();
			expect(
				(await get("/v2/me/creator-analytics?pageSize=1000", alice.cookie))
					.status,
			).toBe(400);
		});

		test("fractional or text page sizes don't flow into the default — they are a 400", async () => {
			const alice = await signUp();
			expect(
				(await get("/v2/me/creator-analytics?page=1.5", alice.cookie)).status,
			).toBe(400);
			expect(
				(await get("/v2/me/creator-analytics?page=abc", alice.cookie)).status,
			).toBe(400);
		});

		test("the default page size is 24", async () => {
			const alice = await signUp();
			const body = await readAnalytics(alice.cookie);
			expect(body.pageSize).toBe(24);
		});
	},
);
