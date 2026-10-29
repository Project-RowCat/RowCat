import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { story, story_play_log, story_view_log } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { readCreatorAnalytics } from "../../services/creator-analytics.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";

/**
 * The creator analytics window: from which day views and play starts are counted.
 *
 * The window boundary is UTC midnight (`creatorAnalyticsWindowStart`) and both ledgers are cut at
 * the same one. This file plants dates directly in the ledgers, one row inside and one outside the
 * day, and checks only the inside is counted. A one-day boundary slip shows up not as an error but
 * as "this week's views differ slightly", so only values catch it.
 *
 * The service is called directly to pin the clock (`now`); the route is checked only for echoing
 * the window and `since`.
 */

const EMAIL_PREFIX = "me-analytics-window-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

async function seedStory(ownerId: string, title = "Story"): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title,
		visibility: "public",
		origin_draft_id: `draft-${id}`,
	});
	return id;
}

/** One view-ledger row; also bumps the counter so "cumulative = ledger sum" holds. */
async function seedView(storyId: string, day: string): Promise<void> {
	await db
		.insert(story_view_log)
		.values({ story_id: storyId, viewer: `a:${newId().slice(0, 12)}`, day });
	await db
		.update(story)
		.set({ views: story.views })
		.where(eq(story.id, storyId));
}

async function seedPlay(storyId: string, at: Date): Promise<void> {
	await db.insert(story_play_log).values({
		story_id: storyId,
		member_id: null,
		session_key: newId(),
		kind: "chat",
		created_at: at,
	});
}

/** 2026-09-07 15:30Z: today is Sep 7, the last 7 days start Sep 1, the last 30 days start Aug 9. */
const NOW = new Date("2026-09-07T15:30:00.000Z");

describe.skipIf(!databaseReady)(
	"views and play starts within the window",
	() => {
		test("counts only inside the boundary — views by date, plays by time, at the same midnight", async () => {
			const owner = await createTestMember(EMAIL_PREFIX);
			const storyId = await seedStory(owner.memberId);

			/** Views: today, first day inside the window (9/1), last day outside (8/31). */
			await seedView(storyId, "2026-09-07");
			await seedView(storyId, "2026-09-01");
			await seedView(storyId, "2026-08-31");
			/** Plays: exactly midnight (in), 1ms before midnight (out), now (in). */
			await seedPlay(storyId, new Date("2026-09-01T00:00:00.000Z"));
			await seedPlay(storyId, new Date("2026-08-31T23:59:59.999Z"));
			await seedPlay(storyId, NOW);
			await db
				.update(story)
				.set({ views: 3, play_starts: 3 })
				.where(eq(story.id, storyId));

			const week = await readCreatorAnalytics({
				ownerId: owner.memberId,
				window: "week",
				page: 1,
				pageSize: 24,
				now: NOW,
			});
			expect(week.since?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
			expect(week.summary).toEqual({
				views: 3,
				favorites: 0,
				comments: 0,
				playStarts: 3,
				windowViews: 2,
				windowPlayStarts: 2,
			});
			expect(week.items[0]).toMatchObject({
				id: storyId,
				views: 3,
				playStarts: 3,
				windowViews: 2,
				windowPlayStarts: 2,
			});

			const day = await readCreatorAnalytics({
				ownerId: owner.memberId,
				window: "day",
				page: 1,
				pageSize: 24,
				now: NOW,
			});
			expect(day.summary.windowViews).toBe(1);
			expect(day.summary.windowPlayStarts).toBe(1);

			const month = await readCreatorAnalytics({
				ownerId: owner.memberId,
				window: "month",
				page: 1,
				pageSize: 24,
				now: NOW,
			});
			expect(month.summary.windowViews).toBe(3);
			expect(month.summary.windowPlayStarts).toBe(3);
		});

		test("the all-time window's values equal the cumulative counters — the ledgers are not recounted", async () => {
			const owner = await createTestMember(EMAIL_PREFIX);
			const storyId = await seedStory(owner.memberId);
			/** Only the counter is bumped, with nothing in the ledger; legacy data looks like that. */
			await db
				.update(story)
				.set({ views: 12, play_starts: 5 })
				.where(eq(story.id, storyId));

			const all = await readCreatorAnalytics({
				ownerId: owner.memberId,
				window: "all",
				page: 1,
				pageSize: 24,
				now: NOW,
			});
			expect(all.since).toBeNull();
			expect(all.summary.windowViews).toBe(12);
			expect(all.summary.windowPlayStarts).toBe(5);
			expect(all.items[0]?.windowViews).toBe(12);
		});

		test("someone else's story ledger doesn't come into my window", async () => {
			const owner = await createTestMember(EMAIL_PREFIX);
			const other = await createTestMember(EMAIL_PREFIX);
			const mine = await seedStory(owner.memberId);
			const theirs = await seedStory(other.memberId);
			await seedView(theirs, "2026-09-07");
			await seedPlay(theirs, NOW);
			await seedView(mine, "2026-09-07");

			const week = await readCreatorAnalytics({
				ownerId: owner.memberId,
				window: "week",
				page: 1,
				pageSize: 24,
				now: NOW,
			});
			expect(week.summary.windowViews).toBe(1);
			expect(week.summary.windowPlayStarts).toBe(0);
			expect(week.items.map((item) => item.id)).toEqual([mine]);
		});

		test("choosing a window orders by that window's numbers", async () => {
			const owner = await createTestMember(EMAIL_PREFIX);
			const oldHit = await seedStory(owner.memberId, "Old hit");
			const fresh = await seedStory(owner.memberId, "This week's story");
			await db.update(story).set({ views: 100 }).where(eq(story.id, oldHit));
			await seedView(fresh, "2026-09-06");
			await db.update(story).set({ views: 1 }).where(eq(story.id, fresh));

			const all = await readCreatorAnalytics({
				ownerId: owner.memberId,
				window: "all",
				page: 1,
				pageSize: 24,
				now: NOW,
			});
			expect(all.items.map((item) => item.id)).toEqual([oldHit, fresh]);

			const week = await readCreatorAnalytics({
				ownerId: owner.memberId,
				window: "week",
				page: 1,
				pageSize: 24,
				now: NOW,
			});
			expect(week.items.map((item) => item.id)).toEqual([fresh, oldHit]);
		});
	},
);

describe.skipIf(!databaseReady)("route", () => {
	const get = (cookie: string, query: string) =>
		app.request(`/v2/me/creator-analytics${query}`, {
			headers: { Cookie: cookie },
		});

	test("echoes the window and carries since", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		await seedStory(owner.memberId);
		const body = (await (await get(owner.cookie, "?window=week")).json()) as {
			window: string;
			since: string | null;
		};
		expect(body.window).toBe("week");
		expect(body.since).toMatch(/T00:00:00\.000Z$/);

		const all = (await (await get(owner.cookie, "")).json()) as {
			window: string;
			since: string | null;
		};
		expect(all).toMatchObject({ window: "all", since: null });
	});

	test("a window outside the vocabulary is a 400 — it doesn't fold to the default", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		expect((await get(owner.cookie, "?window=year")).status).toBe(400);
	});
});
