import type { StoryChatSeedInput } from "@rowcat/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { story, story_play_log, story_play_starter } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `POST /v2/stories/:id/play-starts`.
 *
 * Pins five things: an unentitled caller cannot push another story's metrics, a resent session is
 * not counted twice, the owner's own play is not counted, a `/play` 200 counts nothing (that is the
 * ledger's definition), and the two ledgers one request moves count different units.
 *
 * ```text
 * story_play_log      (story, session key)   event    creator analytics' `playStarts`
 * story_play_starter  (story, member)        person   the popular ranking's engagement signal
 * ```
 *
 * Runs against real Postgres: the primary key is the final authority for idempotency and
 * entitlement is a SQL predicate, so a mock would verify neither.
 */

const EMAIL_PREFIX = "story-play-start-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

const SEED_TITLE = "Play start test story";

const seedPayload = (storyId: string): StoryChatSeedInput => ({
	version: 1,
	storyId,
	title: SEED_TITLE,
	adult: false,
	promptProtected: false,
	scenario: "Background.",
	firstScene: "First scene.",
	characters: [
		{
			name: "Counterpart",
			description: "Fixture.",
			personality: "Concise.",
			speechStyle: "Briefly.",
			exampleDialogue: "Hi.",
		},
	],
});

/**
 * A public story: the default under which a non-creator member is entitled to playback
 * (`services/story/playback.ts`).
 */
async function seedStory(
	ownerId: string,
	visibility: "public" | "private" = "public",
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: SEED_TITLE,
		visibility,
		origin_draft_id: `draft-${id}`,
		play_payload: seedPayload(id),
	});
	return id;
}

const record = (
	cookie: string | null,
	storyId: string,
	body: unknown = { sessionKey: newId(), kind: "chat" },
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/play-starts`, {
			method: "POST",
			headers: {
				Origin: WEB_ORIGIN,
				"Content-Type": "application/json",
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const playStartsOf = async (storyId: string): Promise<number> => {
	const [row] = await db
		.select({ n: story.play_starts })
		.from(story)
		.where(eq(story.id, storyId));
	return row?.n ?? -1;
};

const logRows = (storyId: string) =>
	db.select().from(story_play_log).where(eq(story_play_log.story_id, storyId));

const startersOf = async (storyId: string): Promise<number> => {
	const [row] = await db
		.select({ n: story.unique_play_starters })
		.from(story)
		.where(eq(story.id, storyId));
	return row?.n ?? -1;
};

const starterRows = (storyId: string) =>
	db
		.select()
		.from(story_play_starter)
		.where(eq(story_play_starter.story_id, storyId));

describe.skipIf(!databaseReady)("recording play starts", () => {
	test("a viewer's first record counts, and a resend with the same key doesn't", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const buyer = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);
		const key = newId();

		const first = await record(buyer.cookie, storyId, {
			sessionKey: key,
			kind: "chat",
		});
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ recorded: true });
		expect(await playStartsOf(storyId)).toBe(1);

		/** A retry that only lost its response is neither an error nor a second row. */
		const again = await record(buyer.cookie, storyId, {
			sessionKey: key,
			kind: "chat",
		});
		expect(again.status).toBe(200);
		expect(await again.json()).toEqual({ recorded: false });
		expect(await playStartsOf(storyId)).toBe(1);
		expect(await logRows(storyId)).toHaveLength(1);

		/**
		 * A different room is a different event but the same person. This is where the two ledgers split:
		 * the old formula read the ranking signal as 2 here, which counted chat works more per person.
		 */
		const other = await record(buyer.cookie, storyId);
		expect(await other.json()).toEqual({ recorded: true });
		expect(await playStartsOf(storyId)).toBe(2);
		expect(await startersOf(storyId)).toBe(1);
		expect(await starterRows(storyId)).toHaveLength(1);
	});

	test("different people count separately", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const first = await createTestMember(EMAIL_PREFIX);
		const second = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);

		await record(first.cookie, storyId);
		await record(second.cookie, storyId);
		expect(await playStartsOf(storyId)).toBe(2);
		expect(await startersOf(storyId)).toBe(2);
	});

	test("reopening the runtime is still one person — because the session key is the same", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const buyer = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);
		const key = `runtime-conversation:${storyId}:default`;

		await record(buyer.cookie, storyId, { sessionKey: key, kind: "runtime" });
		await record(buyer.cookie, storyId, { sessionKey: key, kind: "runtime" });
		expect(await playStartsOf(storyId)).toBe(1);
		expect(await startersOf(storyId)).toBe(1);
	});

	test("the same person opening it two ways is still one person", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const buyer = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);

		await record(buyer.cookie, storyId, {
			sessionKey: newId(),
			kind: "chat",
		});
		await record(buyer.cookie, storyId, {
			sessionKey: `runtime-conversation:${storyId}:default`,
			kind: "runtime",
		});
		expect(await playStartsOf(storyId)).toBe(2);
		expect(await startersOf(storyId)).toBe(1);
	});

	test("the owner's own play doesn't count — recorded:false, not an error", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);

		const response = await record(owner.cookie, storyId);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ recorded: false });
		expect(await playStartsOf(storyId)).toBe(0);
		expect(await startersOf(storyId)).toBe(0);
		expect(await logRows(storyId)).toHaveLength(0);
		expect(await starterRows(storyId)).toHaveLength(0);
	});

	test("an ineligible member gets the same 404 as a missing story — someone else's private story", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const stranger = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId, "private");

		expect((await record(stranger.cookie, storyId)).status).toBe(404);
		expect((await record(stranger.cookie, newId())).status).toBe(404);
		expect(await playStartsOf(storyId)).toBe(0);
	});

	test("a guest gets 401 before any lookup", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);
		expect((await record(null, storyId)).status).toBe(401);
		expect((await record(null, newId())).status).toBe(401);
	});

	test("a kind outside the vocabulary, a key outside the shape and an unknown field are a 400", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const buyer = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);

		for (const body of [
			{ sessionKey: newId(), kind: "video" },
			{ sessionKey: "has space", kind: "chat" },
			{ sessionKey: "", kind: "chat" },
			{ sessionKey: newId(), kind: "chat", memberId: "someone-else" },
			{ sessionKey: newId(), kind: "chat", storyId: "another" },
			null,
		])
			expect((await record(buyer.cookie, storyId, body)).status).toBe(400);
		expect(await playStartsOf(storyId)).toBe(0);
	});

	test("the runtime kind accepts the library row's id shape as is", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const buyer = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);

		const response = await record(buyer.cookie, storyId, {
			sessionKey: `runtime-conversation:${storyId}:default`,
			kind: "runtime",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ recorded: true });
		const [row] = await logRows(storyId);
		expect(row?.kind).toBe("runtime");
		expect(row?.member_id).toBe(buyer.memberId);
	});

	test("a `/play` 200 counts nothing — the device reports the start", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const buyer = await createTestMember(EMAIL_PREFIX);
		const storyId = await seedStory(owner.memberId);

		const play = await app.request(`/v2/stories/${storyId}/play`, {
			headers: { Cookie: buyer.cookie },
		});
		expect(play.status).toBe(200);
		expect(await playStartsOf(storyId)).toBe(0);
		expect(
			await db
				.select()
				.from(story_play_log)
				.where(
					and(
						eq(story_play_log.story_id, storyId),
						eq(story_play_log.member_id, buyer.memberId),
					),
				),
		).toHaveLength(0);
	});
});
