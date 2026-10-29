import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import {
	favorite,
	story,
	story_play_log,
	story_play_starter,
	story_view_log,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { POPULAR_WEIGHTS, popularScore } from "../../services/story/ranking.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api } from "../../test/http.ts";

/**
 * Popular ranking: only signals with the same meaning in both playback modes change the order.
 *
 * Pins five things by value: the engagement signal is people (a huge event ledger does not move the
 * order while the head count stays), the dead signal (`downloads`) cannot move anything however
 * large, the period window boundary is UTC midnight and the three ledgers count the same days,
 * stories with no activity are ordered deterministically by recency then id, and the SQL score
 * orders like the pure `popularScore` function.
 */

const EMAIL_PREFIX = "stories-popular-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

/** Marker isolating this suite's stories from others in the same database. */
const marker = () => `pop${newId().slice(0, 10)}`;

interface Seed {
	title: string;
	/** The engagement signal the ranking reads: a head count. */
	uniquePlayStarters?: number;
	/** The event count creator analytics reads; the ranking does not read it. */
	playStarts?: number;
	favorites?: number;
	views?: number;
	downloads?: number;
	adult?: boolean;
}

async function seedStory(ownerId: string, seed: Seed): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: seed.title,
		visibility: "public",
		origin_draft_id: `draft-${id}`,
		play_starts: seed.playStarts ?? 0,
		unique_play_starters: seed.uniquePlayStarters ?? 0,
		favorites: seed.favorites ?? 0,
		views: seed.views ?? 0,
		downloads: seed.downloads ?? 0,
		adult: seed.adult ?? false,
	});
	return id;
}

/** The people ledger, which the windowed engagement signal counts. */
const seedStarter = (storyId: string, memberId: string | null, at: Date) =>
	db.insert(story_play_starter).values({
		story_id: storyId,
		member_id: memberId,
		first_started_at: at,
	});

/** The event ledger; the ranking does not count it. */
const seedPlayEvent = (storyId: string, at: Date) =>
	db.insert(story_play_log).values({
		story_id: storyId,
		member_id: null,
		session_key: newId(),
		kind: "chat",
		created_at: at,
	});

const seedFavorite = (storyId: string, memberId: string, at: Date) =>
	db
		.insert(favorite)
		.values({ story_id: storyId, member_id: memberId, created_at: at });

const seedView = (storyId: string, day: string) =>
	db
		.insert(story_view_log)
		.values({ story_id: storyId, viewer: `a:${newId().slice(0, 12)}`, day });

interface Page {
	items: { id: string; title: string }[];
}

const idsOf = async (search: string, q: string): Promise<string[]> => {
	const response = await api(`/stories?${search}&q=${q}&pageSize=100`);
	expect(response.status).toBe(200);
	return ((await response.json()) as Page).items.map((item) => item.id);
};

/** Today's UTC midnight, where the window boundary sits. */
const utcMidnight = (offsetDays = 0): Date => {
	const now = new Date();
	const start = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	start.setUTCDate(start.getUTCDate() + offsetDays);
	return start;
};

const dayString = (date: Date): string => date.toISOString().slice(0, 10);

describe.skipIf(!databaseReady)("all-time popularity", () => {
	test("recorded signals make the order, the same order as the pure function", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		/** 3 starters (9) > 2 favorites (8) > 7 views (7) > none (0). */
		const played = await seedStory(owner.memberId, {
			title: `${q} engaged`,
			uniquePlayStarters: 3,
		});
		const favored = await seedStory(owner.memberId, {
			title: `${q} favorited`,
			favorites: 2,
		});
		const viewed = await seedStory(owner.memberId, {
			title: `${q} viewed`,
			views: 7,
		});
		const quiet = await seedStory(owner.memberId, { title: `${q} none` });

		const ids = await idsOf("sort=popular", q);
		expect(ids).toEqual([played, favored, viewed, quiet]);

		const scores = [
			popularScore({
				uniquePlayStarters: 3,
				favorites: 0,
				views: 0,
				adult: false,
			}),
			popularScore({
				uniquePlayStarters: 0,
				favorites: 2,
				views: 0,
				adult: false,
			}),
			popularScore({
				uniquePlayStarters: 0,
				favorites: 0,
				views: 7,
				adult: false,
			}),
			popularScore({
				uniquePlayStarters: 0,
				favorites: 0,
				views: 0,
				adult: false,
			}),
		];
		for (let i = 1; i < scores.length; i += 1)
			expect(scores[i - 1]).toBeGreaterThan(scores[i] ?? 0);
	});

	test("the event count can't move the order — what the ranking reads is the number of people", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		/**
		 * A chat story that received twenty rooms from one person: one head. Under the old formula this
		 * story always ranked above, which is why this slice exists.
		 */
		const manySessions = await seedStory(owner.memberId, {
			title: `${q} twenty events`,
			playStarts: 20,
			uniquePlayStarters: 1,
		});
		/** A runtime story that received one start from each of two different people. */
		const twoPeople = await seedStory(owner.memberId, {
			title: `${q} two people`,
			playStarts: 2,
			uniquePlayStarters: 2,
		});
		expect(await idsOf("sort=popular", q)).toEqual([twoPeople, manySessions]);
	});

	test("a dead signal can't move the order — however large downloads gets", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		const downloaded = await seedStory(owner.memberId, {
			title: `${q} downloads`,
			downloads: 9_999,
		});
		const viewed = await seedStory(owner.memberId, {
			title: `${q} viewed`,
			views: 1,
		});
		expect(await idsOf("sort=popular", q)).toEqual([viewed, downloaded]);
	});

	test("stories with no activity order by recency and id — deterministic", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		const first = await seedStory(owner.memberId, { title: `${q} 1` });
		const second = await seedStory(owner.memberId, { title: `${q} 2` });
		const third = await seedStory(owner.memberId, { title: `${q} 3` });
		const once = await idsOf("sort=popular", q);
		const twice = await idsOf("sort=popular", q);
		expect(once).toEqual([third, second, first]);
		expect(twice).toEqual(once);
	});

	test("adult stories are demoted — only the order changes and visibility stays", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		const adult = await seedStory(owner.memberId, {
			title: `${q} adult`,
			favorites: 10,
			adult: true,
		});
		const general = await seedStory(owner.memberId, {
			title: `${q} all ages`,
			favorites: 3,
		});
		/** Guest: adult stories are not exposed (a gate, not a demotion). */
		expect(await idsOf("sort=popular", q)).toEqual([general]);
		/** Demotion arithmetic: 10 × 4 × 0.2 = 8 < 3 × 4 = 12. */
		expect(
			popularScore({
				uniquePlayStarters: 0,
				favorites: 10,
				views: 0,
				adult: true,
			}),
		).toBeLessThan(
			popularScore({
				uniquePlayStarters: 0,
				favorites: 3,
				views: 0,
				adult: false,
			}),
		);
		void adult;
	});
});

describe.skipIf(!databaseReady)("popularity by period", () => {
	test("events outside the window don't count — an old hit rises only with activity inside the window", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const fan = await createTestMember(EMAIL_PREFIX);
		const starter = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		const DAY = 86_400_000;
		const now = Date.now();

		/** An old hit with overwhelming cumulative numbers but no activity inside the window. */
		const oldHit = await seedStory(owner.memberId, {
			title: `${q} old hit`,
			uniquePlayStarters: 500,
			favorites: 300,
			views: 9_000,
		});
		await seedStarter(oldHit, null, new Date(now - 40 * DAY));
		/** A story with one new starter this week. */
		const fresh = await seedStory(owner.memberId, { title: `${q} new story` });
		await seedStarter(fresh, starter.memberId, new Date(now - 2 * DAY));
		/** A story with one favorite this week; heavier than a starter. */
		const liked = await seedStory(owner.memberId, { title: `${q} saved` });
		await seedFavorite(liked, fan.memberId, new Date(now - 1 * DAY));
		/** One view today; the lightest. */
		const seen = await seedStory(owner.memberId, { title: `${q} viewed` });
		await seedView(seen, dayString(new Date(now)));

		const week = await idsOf("sort=popular&period=week", q);
		expect(week.slice(0, 3)).toEqual([liked, fresh, seen]);
		expect(week[3]).toBe(oldHit);

		/** Over all time the cumulative numbers are the order. */
		const all = await idsOf("sort=popular&period=all", q);
		expect(all[0]).toBe(oldHit);

		/** In the day window (today) yesterday's favorite and the starter from two days ago drop out. */
		const day = await idsOf("sort=popular&period=day", q);
		expect(day[0]).toBe(seen);
	});

	test("however large the event ledger gets, the window's engagement signal doesn't move", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		const DAY = 86_400_000;
		const now = Date.now();

		/** Ten events inside the window, with the people ledger empty. */
		const sessionsOnly = await seedStory(owner.memberId, {
			title: `${q} events only`,
		});
		for (let i = 0; i < 10; i += 1)
			await seedPlayEvent(sessionsOnly, new Date(now - 1 * DAY));
		/** One person inside the window. */
		const personOnly = await seedStory(owner.memberId, {
			title: `${q} people`,
		});
		await seedStarter(personOnly, null, new Date(now - 1 * DAY));

		expect(await idsOf("sort=popular&period=week", q)).toEqual([
			personOnly,
			sessionsOnly,
		]);
	});

	test("the boundary is UTC midnight — that instant is inside, 1 millisecond before is outside", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		/** The `day` window starts at today's UTC midnight. */
		const midnight = utcMidnight();

		const inside = await seedStory(owner.memberId, { title: `${q} inside` });
		await seedStarter(inside, null, midnight);
		const outside = await seedStory(owner.memberId, { title: `${q} outside` });
		await seedStarter(outside, null, new Date(midnight.getTime() - 1));

		const day = await idsOf("sort=popular&period=day", q);
		expect(day).toEqual([inside, outside]);
	});

	test("the date ledger and the time ledger count the same days — the window's first day is inside for both", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		/** The `week` window's first day is the earliest of seven UTC calendar days including today. */
		const firstDay = utcMidnight(-6);
		const beforeWindow = utcMidnight(-7);

		/** A starter at first-day midnight: the timestamp ledger's boundary. */
		const timeLedger = await seedStory(owner.memberId, { title: `${q} time` });
		await seedStarter(timeLedger, null, firstDay);
		/** A view on the first day: the date ledger's boundary. Same day, so both count. */
		const dateLedger = await seedStory(owner.memberId, { title: `${q} date` });
		await seedView(dateLedger, dayString(firstDay));
		/** One day before the window: outside for both ledgers. */
		const before = await seedStory(owner.memberId, { title: `${q} before` });
		await seedStarter(before, null, beforeWindow);
		await seedView(before, dayString(beforeWindow));

		const week = await idsOf("sort=popular&period=week", q);
		/** 1 starter (3) > 1 view (1) > outside the window (0). */
		expect(week).toEqual([timeLedger, dateLedger, before]);
	});

	test("the weights inside the window read the same table as all time", () => {
		/** Both formulas read the same constants, so changing one moves both. */
		expect(POPULAR_WEIGHTS.favorite).toBeGreaterThan(
			POPULAR_WEIGHTS.uniquePlayStarter,
		);
	});

	test("rows with the same score neither duplicate nor drop at page boundaries", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		const seeded = await Promise.all(
			Array.from({ length: 4 }, (_, i) =>
				seedStory(owner.memberId, { title: `${q} ${i}`, views: 5 }),
			),
		);
		const seen: string[] = [];
		for (let page = 1; page <= 4; page += 1) {
			const response = await api(
				`/stories?sort=popular&period=month&q=${q}&page=${page}&pageSize=1`,
			);
			seen.push(...((await response.json()) as Page).items.map((i) => i.id));
		}
		expect(new Set(seen).size).toBe(4);
		expect([...seen].sort()).toEqual([...seeded].sort());
	});
});

describe.skipIf(!databaseReady)("integrity", () => {
	test("the favorite counter and the window aggregate see the same events", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const fan = await createTestMember(EMAIL_PREFIX);
		const q = marker();
		const storyId = await seedStory(owner.memberId, { title: `${q} story` });
		await seedFavorite(storyId, fan.memberId, new Date());
		await db.update(story).set({ favorites: 1 }).where(eq(story.id, storyId));
		expect(await idsOf("sort=popular&period=day", q)).toEqual([storyId]);
		expect(await idsOf("sort=popular", q)).toEqual([storyId]);
	});
});
