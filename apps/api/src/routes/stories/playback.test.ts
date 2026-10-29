import {
	STORY_PLAY_ERROR_CODE,
	type StoryChatSeedInput,
} from "@rowcat/contracts";
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { member, story } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { deleteAccountForUser } from "../../services/account/deletion.ts";
import { setBlock } from "../../services/social.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";

/**
 * Who `GET /v2/stories/:id/play` opens for. There are two entitlements
 * (`services/story/playback.ts`):
 *
 * ```text
 * creator  story.owner = viewer                          independent of exposure
 * viewer   public/unlisted + adult gate + blocks         if the detail opens, playback does
 * ```
 *
 * This file's first section used to be "payment bypass of public stories": while stories were paid,
 * using catalogue visibility as entitlement leaked the body to non-payers. With ownership gone that
 * equation holds again, and the file now pins four things.
 *
 * 1. A guest gets no body. The detail is public but the playback snapshot is the story's body.
 * 2. A story the viewer cannot see is the same 404 as a missing one; the refusal does not say
 *    whether private, archived, operator hiding, a block or the adult gate stopped it.
 * 3. The creator opens their own story regardless of exposure, except operator hiding.
 * 4. A public story whose owner was erased by account deletion stays playable, and a block list
 *    does not erase it (`NULL NOT IN (...)` is NULL, not false).
 *
 * Runs against real Postgres and the real Hono app: the decision is inside SQL predicates, so
 * mocking the service would leave everything under test outside the test.
 */

const EMAIL_PREFIX = "story-playback-test-";

let ready = false;

beforeAll(async () => {
	ready = await connectTestDatabase();
});

afterAll(async () => {
	/** A story whose owner was erased is out of reach of member cleanup, so delete it directly. */
	if (ready) {
		await db.delete(story).where(isNull(story.owner));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

const signUp = (name = "Playback entitlement test") =>
	createTestMember(EMAIL_PREFIX, { name });

/** Only the contract's minimum: the file tests access, not seed content. */
const seedPayload = (storyId: string, adult: boolean): StoryChatSeedInput => ({
	version: 1,
	storyId,
	title: `Playback story ${storyId.slice(0, 6)}`,
	adult,
	promptProtected: false,
	scenario: "Background for the playback entitlement test.",
	firstScene: "This is the first scene.",
	characters: [
		{
			name: "Counterpart",
			description: "The fixed fixture's counterpart.",
			personality: "Concise.",
			speechStyle: "Speaks briefly.",
			exampleDialogue: "This is where it starts.",
		},
	],
});

interface SeedStory {
	visibility?: "public" | "unlisted" | "private" | "archived";
	adult?: boolean;
	hidden?: boolean;
	payload?: boolean;
}

/**
 * Inserts a story directly, bypassing the publish path. This file tests playback entitlement, not
 * publishing, and setting state by hand is more exact (publishing cannot produce an `archived`
 * story).
 */
async function seedStory(
	ownerId: string,
	options: SeedStory = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: `Playback story ${id.slice(0, 6)}`,
		visibility: options.visibility ?? "public",
		adult: options.adult ?? false,
		hidden: options.hidden ?? false,
		play_payload:
			options.payload === false
				? null
				: seedPayload(id, options.adult ?? false),
	});
	return id;
}

/** Turns on adult entitlement and the display opt-in; the viewer axis (`canViewAdult`) reads both. */
const allowAdult = (memberId: string) =>
	db
		.update(member)
		.set({ verified: true, adult: true, show_adult: true })
		.where(eq(member.id, memberId));

const get = (cookie: string | null, path: string): Promise<Response> =>
	Promise.resolve(
		app.request(path, { headers: cookie ? { Cookie: cookie } : {} }),
	);

const play = (cookie: string | null, storyId: string) =>
	get(cookie, `/v2/stories/${storyId}/play`);

const codeOf = async (response: Response): Promise<string> =>
	((await response.json()) as { code?: string }).code ?? "";

/* 1. Viewer: playable if viewable */

describe.skipIf(!process.env.DATABASE_URL)("viewer playback", () => {
	/**
	 * Public and unlisted give the same answer. Unlisted is only absent from lists and opens by
	 * address (`isStoryDirectlyViewable`); if the detail opens but playback is closed, `Start conversation` becomes
	 * a button that is always refused.
	 */
	test.each([
		["public"],
		["unlisted"],
	] as const)("someone else plays a %s story", async (visibility) => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const reader = await signUp("Viewer");
		const storyId = await seedStory(creator.memberId, { visibility });

		expect((await get(reader.cookie, `/v2/stories/${storyId}`)).status).toBe(
			200,
		);
		const response = await play(reader.cookie, storyId);
		expect(response.status).toBe(200);
		expect(((await response.json()) as { storyId: string }).storyId).toBe(
			storyId,
		);
	});

	/**
	 * No reason is given. Missing, private, archived and operator-hidden stories all share one status
	 * and code; splitting any of them would let an id sweep confirm another member's private story
	 * exists.
	 */
	test("missing, private, archived and hidden stories are all the same 404", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const reader = await signUp("Viewer");
		const closed = await Promise.all([
			seedStory(creator.memberId, { visibility: "private" }),
			seedStory(creator.memberId, { visibility: "archived" }),
			seedStory(creator.memberId, { hidden: true }),
		]);

		const missing = await play(reader.cookie, newId());
		expect(missing.status).toBe(404);
		const code = await codeOf(missing);
		for (const storyId of closed) {
			const response = await play(reader.cookie, storyId);
			expect(response.status).toBe(404);
			expect(await codeOf(response)).toBe(code);
		}
	});

	/**
	 * A blocked creator's story does not open. Discovery and detail already remove it, and with
	 * playback open, knowing the address would defeat the block. Unblocking reopens it.
	 */
	test("a blocked creator's story is a 404, and opens again when unblocked", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const reader = await signUp("Viewer");
		const storyId = await seedStory(creator.memberId);

		await setBlock(reader.memberId, creator.memberId, true);
		expect((await play(reader.cookie, storyId)).status).toBe(404);

		await setBlock(reader.memberId, creator.memberId, false);
		expect((await play(reader.cookie, storyId)).status).toBe(200);
	});

	/**
	 * The viewer's adult gate also reads the display opt-in (`canViewAdult`). Without entitlement the
	 * story is a missing story, as in the detail.
	 */
	test("an adult story opens only with adult eligibility and the display opt-in", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const reader = await signUp("Viewer");
		const storyId = await seedStory(creator.memberId, { adult: true });

		expect((await play(reader.cookie, storyId)).status).toBe(404);

		await db
			.update(member)
			.set({ verified: true, adult: true, show_adult: false })
			.where(eq(member.id, reader.memberId));
		expect((await play(reader.cookie, storyId)).status).toBe(404);

		await allowAdult(reader.memberId);
		expect((await play(reader.cookie, storyId)).status).toBe(200);
	});

	/** A missing playback payload means awaiting migration; no empty seed is invented. */
	test("someone else's story without a payload splits off as awaiting migration", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const reader = await signUp("Viewer");
		const storyId = await seedStory(creator.memberId, { payload: false });

		const response = await play(reader.cookie, storyId);
		expect(response.status).toBe(409);
		expect(await codeOf(response)).toBe(STORY_PLAY_ERROR_CODE.unavailable);
	});

	/**
	 * `/play` is a GET: repeated calls give the same answer and leave nothing on the story row. With
	 * ownership it used to mean "repeat playback creates no second charge"; idempotency is the
	 * property left (play starts are reported separately once the device stands up a session).
	 */
	test("repeated playback gives the same answer and doesn't change the story row", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const reader = await signUp("Viewer");
		const storyId = await seedStory(creator.memberId);
		const snapshot = () =>
			db
				.select({
					updatedAt: story.updated_at,
					playStarts: story.play_starts,
				})
				.from(story)
				.where(eq(story.id, storyId));
		const before = await snapshot();

		const first = await play(reader.cookie, storyId);
		const second = await play(reader.cookie, storyId);
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual(await first.json());
		expect(await snapshot()).toEqual(before);
	});
});

/* 2. Guest */

describe.skipIf(!process.env.DATABASE_URL)("guest", () => {
	/**
	 * The detail is public (story pages read without login). The playback snapshot is the story's
	 * body, so it requires membership.
	 */
	test("can't receive a public story's playback snapshot", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const storyId = await seedStory(creator.memberId);

		expect((await get(null, `/v2/stories/${storyId}`)).status).toBe(200);

		const denied = await play(null, storyId);
		expect(denied.status).toBe(401);
		const body = (await denied.json()) as Record<string, unknown>;
		expect(body.scenario).toBeUndefined();
		expect(body.storyId).toBeUndefined();
	});

	/**
	 * A missing story is the same 401. The authentication refusal stands before the lookup, and that
	 * order is this path's existence hiding; splitting would let a guest tell 401 from 404 and confirm
	 * another member's private story.
	 */
	test("a missing story and an invisible story give a guest the same response", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const hidden = await seedStory(creator.memberId, { visibility: "private" });

		const missing = await play(null, newId());
		const secret = await play(null, hidden);
		expect(missing.status).toBe(401);
		expect(secret.status).toBe(401);
		expect(await codeOf(missing)).toBe(await codeOf(secret));
	});
});

/* 3. Creator: independent of exposure */

describe.skipIf(!process.env.DATABASE_URL)("creator playback", () => {
	/** The creator opens their own story regardless of exposure; replaying a private story is the normal pre-publication check. */
	test.each([
		["public"],
		["private"],
	] as const)("plays a %s story", async (visibility) => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const storyId = await seedStory(creator.memberId, { visibility });

		const response = await play(creator.cookie, storyId);
		expect(response.status).toBe(200);
		expect(((await response.json()) as { storyId: string }).storyId).toBe(
			storyId,
		);
	});

	/**
	 * The creator plays their archived story too. Exposure does not change at all: it is still absent
	 * from the gallery and the detail (archived is a 404 even for the owner).
	 */
	test("plays your own archived story — visibility stays closed", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const storyId = await seedStory(creator.memberId, {
			visibility: "archived",
		});

		expect((await play(creator.cookie, storyId)).status).toBe(200);
		expect((await get(creator.cookie, `/v2/stories/${storyId}`)).status).toBe(
			404,
		);
	});

	/** Operator hiding closes even on one's own story; ownership cannot undo enforcement. */
	test("operator hiding is closed to the creator too", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const storyId = await seedStory(creator.memberId, { hidden: true });
		expect((await play(creator.cookie, storyId)).status).toBe(404);
	});

	/**
	 * The creator's adult axis reads only the legal requirement (`isAdultVerified`). If a verified
	 * member with the display opt-in off could publish their adult story but got a 404 on playback,
	 * writing would work while reading did not. Conversely, without verification ownership does not
	 * substitute for the age check.
	 */
	test("a creator opens their own adult story with verification alone — the display opt-in isn't checked", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const storyId = await seedStory(creator.memberId, { adult: true });
		expect((await play(creator.cookie, storyId)).status).toBe(404);

		await db
			.update(member)
			.set({ verified: true, adult: true, show_adult: false })
			.where(eq(member.id, creator.memberId));
		expect((await play(creator.cookie, storyId)).status).toBe(200);
	});

	/** A missing playback payload means awaiting migration regardless of entitlement. */
	test("your own story without a payload splits off as awaiting migration", async () => {
		if (!ready) return;
		const creator = await signUp("Creator");
		const storyId = await seedStory(creator.memberId, { payload: false });
		const response = await play(creator.cookie, storyId);
		expect(response.status).toBe(409);
		expect(await codeOf(response)).toBe(STORY_PLAY_ERROR_CODE.unavailable);
	});
});

/* 4. Ownerless story */

describe.skipIf(!process.env.DATABASE_URL)(
	"public stories whose owner is gone",
	() => {
		/**
		 * Account deletion leaves public stories with only the identity detached. If a story still in the
		 * catalogue had playback closed, the detail's `Start conversation` would be a button that is always refused.
		 *
		 * A block list does not erase it. With a predicate of only `owner NOT IN (block list)`, the
		 * expression is NULL, not false, for rows whose owner is NULL, and a member with any block list
		 * loses every ownerless story; that failure has no symptom.
		 */
		test("a deleted creator's public story opens, regardless of block lists", async () => {
			if (!ready) return;
			const creator = await signUp("Creator");
			const reader = await signUp("Viewer");
			const someone = await signUp("Another member");
			const storyId = await seedStory(creator.memberId);

			await deleteAccountForUser(creator.authUserId);
			const [row] = await db
				.select({ owner: story.owner })
				.from(story)
				.where(eq(story.id, storyId));
			expect(row?.owner).toBeNull();

			expect((await play(reader.cookie, storyId)).status).toBe(200);

			await setBlock(reader.memberId, someone.memberId, true);
			expect((await play(reader.cookie, storyId)).status).toBe(200);
		});
	},
);
