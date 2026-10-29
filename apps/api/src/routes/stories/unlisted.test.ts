import type { StoryChatSeedInput } from "@rowcat/contracts";
import type { StoryVisibility } from "@rowcat/domain";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { member, story } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { api } from "../../test/http.ts";

/**
 * Unlisted (`unlisted`): not discoverable, but it opens.
 *
 * Pins that the discovery axis and the viewing axis are split. They used to share one answer
 * (`visibility = 'public'`), so a single predicate left on the old answer is now a defect, and the
 * two directions differ: a leak into discovery lists a work the creator withheld (irreversible once
 * seen), while a miss on viewing gives link recipients a 404 (silent; the sharer cannot tell). Both
 * look like normal success responses, so only integration tests catch them.
 *
 * Also pins that this is not a security boundary: anyone with the address opens it, guests
 * included.
 *
 * Runs against real Postgres and the real Hono app because the exposure decision lives in a SQL
 * predicate (`galleryWhere`); mocking the service would leave it untested.
 */

const EMAIL_PREFIX = "story-unlisted-test-";

const signUp = (name = "Unlisted test") =>
	createTestMember(EMAIL_PREFIX, { name });

interface SeedStory {
	visibility?: StoryVisibility;
	title?: string;
	adult?: boolean;
	hidden?: boolean;
}

/**
 * Playback snapshot; must pass the real contract. The route re-parses the jsonb, so a malformed
 * fixture would yield a 500 and the playback assertions would test the fixture, not the exposure
 * axis.
 */
const seedPayload = (storyId: string, adult: boolean): StoryChatSeedInput => ({
	version: 1,
	storyId,
	title: `Unlisted story ${storyId.slice(0, 6)}`,
	adult,
	promptProtected: false,
	scenario: "Background for the unlisted test.",
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

/**
 * Inserts a story directly, bypassing publication, because the subject is the exposure predicate.
 * Publication accepting unlisted is covered by `stories-publish.test.ts`.
 */
async function seedStory(
	ownerId: string,
	options: SeedStory = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: options.title ?? `Unlisted story ${id.slice(0, 6)}`,
		visibility: options.visibility ?? "unlisted",
		adult: options.adult ?? false,
		hidden: options.hidden ?? false,
		origin_draft_id: `draft-${id}`,
		play_payload: seedPayload(id, options.adult ?? false),
	});
	return id;
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

interface Page {
	items: { id: string }[];
	total: number;
}

const idsOf = async (response: Response): Promise<string[]> => {
	expect(response.status).toBe(200);
	return ((await response.json()) as Page).items.map((item) => item.id);
};

describe.skipIf(!databaseReady)("discovery surfaces", () => {
	/**
	 * One query covers five surfaces (list, search, popular, favorites, following) through `GET
	 * /v2/stories`; a leak in that predicate leaks into all five.
	 */
	test("the gallery has no unlisted stories and has public ones", async () => {
		const owner = await signUp();
		const marker = `unlisted-gallery-${newId().slice(0, 8)}`;
		const publicId = await seedStory(owner.memberId, {
			visibility: "public",
			title: `${marker} public`,
		});
		const unlistedId = await seedStory(owner.memberId, {
			visibility: "unlisted",
			title: `${marker} link`,
		});

		const ids = await idsOf(
			await api(`/stories?q=${encodeURIComponent(marker)}`, {
				cookie: owner.cookie,
			}),
		);
		expect(ids).toContain(publicId);
		expect(ids).not.toContain(unlistedId);
	});

	/**
	 * Not listed for the owner either. The gallery includes the owner's private works
	 * (`ownPrivateVisible`) and unlisted could ride that exception, leaving the creator unable to
	 * check how the work looks from outside.
	 */
	test("unlisted stories don't come even in the owner's gallery — where it differs from private", async () => {
		const owner = await signUp();
		const marker = `unlisted-own-${newId().slice(0, 8)}`;
		const privateId = await seedStory(owner.memberId, {
			visibility: "private",
			title: `${marker} private`,
		});
		const unlistedId = await seedStory(owner.memberId, {
			visibility: "unlisted",
			title: `${marker} link`,
		});

		const ids = await idsOf(
			await api(`/stories?q=${encodeURIComponent(marker)}`, {
				cookie: owner.cookie,
			}),
		);
		/** Own private works are included (existing rule). */
		expect(ids).toContain(privateId);
		expect(ids).not.toContain(unlistedId);
	});

	/** Search uses the list predicate; a title match does not surface it. */
	test("knowing the exact title still doesn't find it in search", async () => {
		const owner = await signUp();
		const title = `UnlistedSearch${newId().slice(0, 8)}`;
		await seedStory(owner.memberId, { visibility: "unlisted", title });

		const ids = await idsOf(
			await api(`/stories?q=${encodeURIComponent(title)}`, {
				cookie: owner.cookie,
			}),
		);
		expect(ids).toEqual([]);
	});

	/** The total uses the same predicate; a split would leak that more hidden works exist. */
	test("it isn't counted in the total either", async () => {
		const owner = await signUp();
		const marker = `unlisted-total-${newId().slice(0, 8)}`;
		await seedStory(owner.memberId, {
			visibility: "unlisted",
			title: `${marker} link`,
		});

		const response = await api(`/stories?q=${encodeURIComponent(marker)}`, {
			cookie: owner.cookie,
		});
		expect(response.status).toBe(200);
		expect(((await response.json()) as Page).total).toBe(0);
	});

	/**
	 * Not in the public profile grid either, even for the owner. That grid shows what the person
	 * listed, identically for every viewer: showing it to the owner hides the outside view, and
	 * showing it to others makes unlisted discoverable through the profile.
	 */
	test("the public profile grid has no unlisted stories — even when the owner opens it", async () => {
		const owner = await signUp();
		const stranger = await signUp("Other");
		const publicId = await seedStory(owner.memberId, { visibility: "public" });
		const unlistedId = await seedStory(owner.memberId, {
			visibility: "unlisted",
		});

		for (const cookie of [owner.cookie, stranger.cookie, null]) {
			const ids = await idsOf(
				await api(`/creators/${owner.memberId}/stories`, { cookie }),
			);
			expect(ids).toContain(publicId);
			expect(ids).not.toContain(unlistedId);
		}
	});
});

describe.skipIf(!databaseReady)("single-item viewing", () => {
	/**
	 * Ownership is not required. Narrowing this to the owner makes unlisted a second name for private,
	 * and the share button would hand recipients a link that returns 404.
	 */
	test("opens even when someone else opens it", async () => {
		const owner = await signUp();
		const stranger = await signUp("Other");
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		const response = await api(`/stories/${storyId}`, {
			cookie: stranger.cookie,
		});
		expect(response.status).toBe(200);
		expect(((await response.json()) as { id: string }).id).toBe(storyId);
	});

	/**
	 * Opens for guests as well, like a public work's detail. Moving it behind sign-in would add a
	 * promise (members who know the link) the feature never made.
	 */
	test("guests open it with the address alone too", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		expect((await api(`/stories/${storyId}`, { cookie: null })).status).toBe(
			200,
		);
	});

	/** The canonical value is returned as-is; the badge and the share decision read it. */
	test("carries the canonical visibility state as is", async () => {
		const owner = await signUp();
		const stranger = await signUp("Other");
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		const body = (await (
			await api(`/stories/${storyId}`, { cookie: stranger.cookie })
		).json()) as { visibility: string };
		expect(body.visibility).toBe("unlisted");
	});

	/** Private stays owner-only: the change that opens unlisted must not open private. */
	test("private is still owner-only, and the same 404 as a missing story to others", async () => {
		const owner = await signUp();
		const stranger = await signUp("Other");
		const storyId = await seedStory(owner.memberId, { visibility: "private" });

		expect(
			(await api(`/stories/${storyId}`, { cookie: owner.cookie })).status,
		).toBe(200);
		expect(
			(await api(`/stories/${storyId}`, { cookie: stranger.cookie })).status,
		).toBe(404);
		expect((await api(`/stories/${storyId}`, { cookie: null })).status).toBe(
			404,
		);
	});

	/** Archived opens for no one, the owner included. */
	test("archived is a 404 even to the owner", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "archived" });

		expect(
			(await api(`/stories/${storyId}`, { cookie: owner.cookie })).status,
		).toBe(404);
	});

	/**
	 * Operator hiding also closes unlisted. It is an independent axis, so the combination can exist,
	 * and opening here would let a link bypass enforcement.
	 */
	test("an operator-hidden unlisted story is closed even to those who know the address", async () => {
		const owner = await signUp();
		const stranger = await signUp("Other");
		const storyId = await seedStory(owner.memberId, {
			visibility: "unlisted",
			hidden: true,
		});

		expect(
			(await api(`/stories/${storyId}`, { cookie: stranger.cookie })).status,
		).toBe(404);
	});

	/**
	 * The adult gate still applies: unlisted opens only the catalogue axis, and the viewer axes
	 * (rating, blocks, account) apply as for public works.
	 */
	test("an adult unlisted story is closed to ineligible viewers", async () => {
		const owner = await signUp();
		await db
			.update(member)
			.set({ verified: true, adult: true, show_adult: true })
			.where(eq(member.id, owner.memberId));
		const stranger = await signUp("Other");
		const storyId = await seedStory(owner.memberId, {
			visibility: "unlisted",
			adult: true,
		});

		expect(
			(await api(`/stories/${storyId}`, { cookie: stranger.cookie })).status,
		).toBe(404);
		expect((await api(`/stories/${storyId}`, { cookie: null })).status).toBe(
			404,
		);
	});
});

describe.skipIf(!databaseReady)("operations attached to an open story", () => {
	/**
	 * Public discussion works. The gate asks whether anyone with the address can open it, which is
	 * true for unlisted; only private fails (it would be a public comment on owner-only content).
	 */
	test("comments open on unlisted stories", async () => {
		const owner = await signUp();
		const stranger = await signUp("Other");
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		expect(
			(await api(`/stories/${storyId}/comments`, { cookie: stranger.cookie }))
				.status,
		).toBe(200);
	});

	/**
	 * Members with the address can play. If detail opens but playback closes, `Start conversation` becomes a button
	 * that is always refused.
	 */
	test("others play unlisted stories too", async () => {
		const owner = await signUp();
		const stranger = await signUp("Other");
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		const response = await api(`/stories/${storyId}/play`, {
			cookie: stranger.cookie,
		});
		expect(response.status).toBe(200);
		expect(((await response.json()) as { storyId: string }).storyId).toBe(
			storyId,
		);
	});

	/** The creator plays their own unlisted work. */
	test("the creator plays their own unlisted story", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		expect(
			(await api(`/stories/${storyId}/play`, { cookie: owner.cookie })).status,
		).toBe(200);
	});
});

describe.skipIf(!databaseReady)("the creator's management surfaces", () => {
	/**
	 * Leaving discovery is no reason to leave management: this list skips `galleryWhere` and filters
	 * on the session member alone, so dropping unlisted would take away the creator's controls.
	 */
	test("the `Published` list has the unlisted story with its canonical state", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		const body = (await (
			await api("/me/stories", { cookie: owner.cookie })
		).json()) as { items: { id: string; visibility: string }[] };
		expect(body.items.find((item) => item.id === storyId)?.visibility).toBe(
			"unlisted",
		);
	});

	/** Analytics uses the same predicate; views on an unlisted work still belong to its creator. */
	test("creator analytics have the unlisted story too", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { visibility: "unlisted" });

		const body = (await (
			await api("/me/creator-analytics", { cookie: owner.cookie })
		).json()) as { items: { id: string; visibility: string }[] };
		expect(body.items.find((item) => item.id === storyId)?.visibility).toBe(
			"unlisted",
		);
	});
});
