import {
	STORY_PUBLISH_ERROR_CODE,
	StoryChatSeedDto,
	type StoryPublishRequestInput,
	type StoryVisibility,
} from "@rowcat/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { member, story } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Server authority over publishing: only what the server decides may be stored, whatever the client
 * sends. Any HTTP client can call this boundary without our assembler (@rowcat/authoring), so it
 * can send owner, counters, story id and rating directly.
 *
 * Runs through the real Hono app and real Postgres. Calling service functions directly would skip
 * the route reading the member from the session and the unique index folding concurrent requests;
 * idempotency is a DB constraint that mocks cannot check.
 */

const EMAIL_PREFIX = "story-publish-test-";

interface Account {
	cookie: string;
	memberId: string;
}

/**
 * Member rows are created on the first request, not at signup (`ensureMember` in auth/viewer.ts);
 * without that `/me` call the member updates below would hit 0 rows and the test would silently run
 * on defaults.
 */
const signUp = () => createTestMember(EMAIL_PREFIX, { name: "Publish test" });

/**
 * Grants adult publishing eligibility (identity verified and 19+) without the display opt-in.
 * Display is a viewing axis separate from eligibility; if the read-back after publishing used the
 * viewing gate it would 404 here (the write succeeds, the response fails).
 */
const grantAdultEligibility = (memberId: string) =>
	db
		.update(member)
		.set({ verified: true, adult: true, show_adult: false })
		.where(eq(member.id, memberId));

/** Turns on the display opt-in, the viewing axis. */
const enableAdultDisplay = (memberId: string) =>
	db.update(member).set({ show_adult: true }).where(eq(member.id, memberId));

const suspend = (memberId: string) =>
	db.update(member).set({ status: "suspended" }).where(eq(member.id, memberId));

/** Minimal valid publish request; contract defaults fill the rest. */
function publishRequest(
	overrides: Partial<StoryPublishRequestInput> = {},
): StoryPublishRequestInput {
	return {
		originDraftId: newId(),
		metadata: { title: "The Library at Night", visibility: "private" },
		play: { scenario: "A library where the books talk to you." },
		...overrides,
	};
}

const publish = (cookie: string | null, body: unknown): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/stories", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const update = (
	cookie: string,
	storyId: string,
	body: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	);

/**
 * Archives through the product path to reach a state publishing cannot create. The row is not
 * UPDATEd directly so the "how does publishing react to an archived work" question matches real
 * conditions (lifecycle behavior itself is `story-lifecycle.test.ts`'s job).
 */
const archive = async (cookie: string, storyId: string): Promise<void> => {
	const response = await app.request(`/v2/stories/${storyId}/archive`, {
		method: "POST",
		headers: { Origin: WEB_ORIGIN, Cookie: cookie },
	});
	if (response.status !== 200)
		throw new Error(`couldn't archive: ${response.status}`);
};

/** Reads the stored row from the DB, not the response, which is our own value and no evidence. */
const readRow = async (storyId: string) => {
	const [row] = await db.select().from(story).where(eq(story.id, storyId));
	if (!row) throw new Error(`no story row: ${storyId}`);
	return row;
};

interface PublishBody {
	created: boolean;
	story: {
		id: string;
		title: string;
		adult: boolean;
		visibility: StoryVisibility;
	};
}
interface ErrorBody {
	code: string;
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("publishing — authorization", () => {
	test("a signed-out publish is a 401", async () => {
		const response = await publish(null, publishRequest());
		expect(response.status).toBe(401);
	});

	test("a suspended member can't publish", async () => {
		// A suspended account that could keep publishing to the catalogue would make suspension
		// meaningless.
		const account = await signUp();
		await suspend(account.memberId);

		const response = await publish(account.cookie, publishRequest());
		expect(response.status).toBe(403);
		expect(((await response.json()) as ErrorBody).code).toBe(
			"account_restricted",
		);
	});

	test("the owner is always the member who sent the request", async () => {
		const owner = await signUp();
		const stranger = await signUp();

		/**
		 * Sends an owner directly. The contract has no such field so zod strips it and the server uses
		 * the session's member: inexpressible, not "received and ignored".
		 */
		const response = await publish(owner.cookie, {
			...publishRequest(),
			owner: stranger.memberId,
		});
		expect(response.status).toBe(201);

		const body = (await response.json()) as PublishBody;
		expect((await readRow(body.story.id)).owner).toBe(owner.memberId);
	});

	test("the client can't set the counters or operator hiding", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			...publishRequest(),
			views: 9999,
			favorites: 9999,
			downloads: 9999,
			hidden: true,
			id: "an-id-i-chose",
		});
		expect(response.status).toBe(201);

		const body = (await response.json()) as PublishBody;
		const row = await readRow(body.story.id);
		expect(row.id).not.toBe("an-id-i-chose");
		expect(row.views).toBe(0);
		expect(row.favorites).toBe(0);
		expect(row.downloads).toBe(0);
		expect(row.hidden).toBe(false);
	});
});

describe.skipIf(!databaseReady)("publishing — policy gate", () => {
	test("a private publish succeeds", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, publishRequest());

		expect(response.status).toBe(201);
		const body = (await response.json()) as PublishBody;
		expect(body.created).toBe(true);
		expect(body.story.visibility).toBe("private");
	});

	test("a public publish succeeds immediately and goes through no review stage", async () => {
		/**
		 * There is no pre-review or pending state, so once the request passes the gate a `public` row
		 * must commit on the spot. It must not be silently lowered to private either (the creator would
		 * share a link that 404s for recipients).
		 */
		const owner = await signUp();
		const request = publishRequest({
			metadata: { title: "A public story", visibility: "public" },
		});

		const response = await publish(owner.cookie, request);
		expect(response.status).toBe(201);
		const body = (await response.json()) as PublishBody;
		expect(body.story.visibility).toBe("public");

		const row = await readRow(body.story.id);
		expect(row.visibility).toBe("public");
		// Publishing does not touch the operator axis: a new work is born unhidden.
		expect(row.hidden).toBe(false);
	});

	/**
	 * Unlisted is also a publish destination, not only a transition. Otherwise a creator who wants
	 * link-only would have to publish public and then withdraw, exposing the work in the catalogue for
	 * a few seconds, which cannot be undone. It must not be silently lowered to private either, since
	 * sharing the link is exactly what that creator chose.
	 */
	test("an unlisted publish succeeds and isn't lowered to private", async () => {
		const owner = await signUp();
		const response = await publish(
			owner.cookie,
			publishRequest({
				metadata: { title: "An unlisted story", visibility: "unlisted" },
			}),
		);

		expect(response.status).toBe(201);
		const body = (await response.json()) as PublishBody;
		expect(body.story.visibility).toBe("unlisted");

		const row = await readRow(body.story.id);
		expect(row.visibility).toBe("unlisted");
		expect(row.hidden).toBe(false);
	});

	test("a public publish is visible to others and appears in the gallery", async () => {
		const owner = await signUp();
		const stranger = await signUp();
		const title = `public-${newId()}`;
		const response = await publish(
			owner.cookie,
			publishRequest({ metadata: { title, visibility: "public" } }),
		);
		const storyId = ((await response.json()) as PublishBody).story.id;

		const detail = await app.request(`/v2/stories/${storyId}`, {
			headers: { Cookie: stranger.cookie },
		});
		expect(detail.status).toBe(200);

		const gallery = await app.request(
			`/v2/stories?q=${encodeURIComponent(title)}`,
			{ headers: { Cookie: stranger.cookie } },
		);
		const items = ((await gallery.json()) as { items: { id: string }[] }).items;
		expect(items.map((item) => item.id)).toContain(storyId);
	});

	test("a public publish is visible to guests too", async () => {
		// What "the catalogue is public" means: it opens without a session.
		const owner = await signUp();
		const response = await publish(
			owner.cookie,
			publishRequest({
				metadata: { title: "Guests see it too", visibility: "public" },
			}),
		);
		const storyId = ((await response.json()) as PublishBody).story.id;

		const detail = await app.request(`/v2/stories/${storyId}`);
		expect(detail.status).toBe(200);
	});

	test("can't publish in the archived state", async () => {
		/**
		 * Uses a code different from the public refusal. Public opens once a review boundary exists, but
		 * archived is a state transition of a published work, not a publish destination; folding them
		 * would make the screen say "public publishing is being prepared" and the creator would wait. If
		 * it passed, a work absent from both the gallery and the creator's list would be created while
		 * the screen shows success.
		 */
		const owner = await signUp();
		const request = publishRequest({
			metadata: { title: "Archive attempt", visibility: "archived" },
		});

		const response = await publish(owner.cookie, request);
		expect(response.status).toBe(403);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.archivedUnavailable,
		);

		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(eq(story.origin_draft_id, request.originDraftId));
		expect(rows).toHaveLength(0);
	});

	test("an adult publish by an ineligible member is refused", async () => {
		const owner = await signUp();
		const request = publishRequest({
			metadata: { title: "Adult attempt", visibility: "private", adult: true },
		});

		const response = await publish(owner.cookie, request);
		expect(response.status).toBe(403);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.adultNotPermitted,
		);

		// Not silently lowered to all-ages: the row must not exist.
		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(eq(story.origin_draft_id, request.originDraftId));
		expect(rows).toHaveLength(0);
	});

	test("an eligible member can publish adult content privately", async () => {
		/**
		 * Display opt-in stays off. If the read-back after publishing used the viewing gate this would
		 * 404: the write succeeds and only the response fails, the hardest kind of mismatch to find.
		 */
		const owner = await signUp();
		await grantAdultEligibility(owner.memberId);

		const response = await publish(
			owner.cookie,
			publishRequest({
				metadata: { title: "Adult", visibility: "private", adult: true },
			}),
		);
		expect(response.status).toBe(201);
		const body = (await response.json()) as PublishBody;
		expect(body.story.adult).toBe(true);
	});
});

describe.skipIf(!databaseReady)("publishing — playback payload", () => {
	test("the stored payload satisfies the playback contract as is", async () => {
		const owner = await signUp();
		const response = await publish(
			owner.cookie,
			publishRequest({
				play: {
					scenario: "A library where the books talk to you.",
					firstScene: "The door opens.",
					characters: [{ name: "Librarian", personality: "curt" }],
					lore: [
						{
							keys: ["library"],
							content: "Opens only at night",
							constant: true,
						},
					],
					startScenes: [{ title: "dawn", content: "The door opens." }],
				},
			}),
		);
		expect(response.status).toBe(201);

		const body = (await response.json()) as PublishBody;
		const row = await readRow(body.story.id);
		expect(StoryChatSeedDto.safeParse(row.play_payload).success).toBe(true);
	});

	test("the payload's story id equals the row's id", async () => {
		/**
		 * This assertion is the whole decision that the server assembles the snapshot. A client-supplied
		 * id could diverge from the row's at any time, with no way to tell which is true.
		 */
		const owner = await signUp();
		const response = await publish(owner.cookie, publishRequest());
		const body = (await response.json()) as PublishBody;

		const row = await readRow(body.story.id);
		const payload = StoryChatSeedDto.parse(row.play_payload);
		expect(payload.storyId).toBe(row.id);
	});

	test("the payload's title, rating and protection match the story metadata", async () => {
		const owner = await signUp();
		const response = await publish(
			owner.cookie,
			publishRequest({
				metadata: {
					title: "The Library at Night",
					visibility: "private",
					promptProtected: true,
				},
			}),
		);
		const body = (await response.json()) as PublishBody;

		const row = await readRow(body.story.id);
		const payload = StoryChatSeedDto.parse(row.play_payload);
		expect(payload.title).toBe(row.title);
		expect(payload.adult).toBe(row.adult);
		expect(payload.promptProtected).toBe(row.prompt_protected);
	});
});

describe.skipIf(!databaseReady)("publishing — idempotency", () => {
	test("publishing again from the same draft is still one story", async () => {
		/** Reproduces a lost response: the first request succeeded but the browser never recorded it, and the user presses `Publish` again. */
		const owner = await signUp();
		const request = publishRequest();

		const first = await publish(owner.cookie, request);
		expect(first.status).toBe(201);
		const firstBody = (await first.json()) as PublishBody;
		expect(firstBody.created).toBe(true);

		const second = await publish(owner.cookie, request);
		expect(second.status).toBe(200);
		const secondBody = (await second.json()) as PublishBody;
		expect(secondBody.created).toBe(false);
		expect(secondBody.story.id).toBe(firstBody.story.id);

		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(eq(story.origin_draft_id, request.originDraftId));
		expect(rows).toHaveLength(1);
	});

	test("a retry reflects what was changed in between", async () => {
		/**
		 * An update, not "return it if it exists": if the user edited the draft after losing the
		 * response, pressing `Publish` again means "publish the current content".
		 */
		const owner = await signUp();
		const request = publishRequest();

		const first = await publish(owner.cookie, request);
		const firstBody = (await first.json()) as PublishBody;

		const second = await publish(owner.cookie, {
			...request,
			metadata: { title: "The fixed title", visibility: "private" },
		});
		const secondBody = (await second.json()) as PublishBody;

		expect(secondBody.story.id).toBe(firstBody.story.id);
		const row = await readRow(firstBody.story.id);
		expect(row.title).toBe("The fixed title");
		expect(StoryChatSeedDto.parse(row.play_payload).title).toBe(
			"The fixed title",
		);
		// The payload's story id must be the surviving row's id on the update path too.
		expect(StoryChatSeedDto.parse(row.play_payload).storyId).toBe(row.id);
	});

	test("two concurrent publishes of the same draft fold into one story", async () => {
		/**
		 * Split into `SELECT` then `INSERT`, both requests would read an empty SELECT and both create.
		 * The unique index is the final authority, so the race ends inside the DB.
		 */
		const owner = await signUp();
		const request = publishRequest();

		const [a, b] = await Promise.all([
			publish(owner.cookie, request),
			publish(owner.cookie, request),
		]);
		const bodyA = (await a.json()) as PublishBody;
		const bodyB = (await b.json()) as PublishBody;

		expect(bodyA.story.id).toBe(bodyB.story.id);
		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(eq(story.origin_draft_id, request.originDraftId));
		expect(rows).toHaveLength(1);
	});

	test("another member using the same draft id doesn't block each other", async () => {
		/**
		 * Draft ids are device-made, not issued by us. A global unique constraint would let anyone block
		 * another person's publish just by sending their string first.
		 */
		const alice = await signUp();
		const bob = await signUp();
		const originDraftId = newId();

		const first = await publish(
			alice.cookie,
			publishRequest({ originDraftId }),
		);
		const second = await publish(bob.cookie, publishRequest({ originDraftId }));

		expect(first.status).toBe(201);
		expect(second.status).toBe(201);
		expect(((await first.json()) as PublishBody).story.id).not.toBe(
			((await second.json()) as PublishBody).story.id,
		);
	});
});

describe.skipIf(!databaseReady)("updating", () => {
	async function published(account: Account) {
		const request = publishRequest();
		const response = await publish(account.cookie, request);
		const body = (await response.json()) as PublishBody;
		return { storyId: body.story.id, originDraftId: request.originDraftId };
	}

	test("the owner updates the story from their draft", async () => {
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);

		const response = await update(owner.cookie, storyId, {
			originDraftId,
			metadata: { title: "A rewritten title", visibility: "private" },
			play: { scenario: "A new world", firstScene: "It starts again." },
		});
		expect(response.status).toBe(200);

		const row = await readRow(storyId);
		expect(row.title).toBe("A rewritten title");
		const payload = StoryChatSeedDto.parse(row.play_payload);
		// Metadata and play content change together; there is no state where only one is the new version.
		expect(payload.title).toBe("A rewritten title");
		expect(payload.scenario).toBe("A new world");
		expect(payload.storyId).toBe(storyId);
	});

	test("can't update someone else's story, and the response is the same as for a missing story", async () => {
		const owner = await signUp();
		const stranger = await signUp();
		const { storyId, originDraftId } = await published(owner);

		const response = await update(stranger.cookie, storyId, {
			originDraftId,
			metadata: { title: "Hijack", visibility: "private" },
			play: { scenario: "Hijack" },
		});
		/**
		 * 404, not 403: a distinction would itself reveal that the id exists, undoing the existence
		 * hiding kept on detail reads.
		 */
		expect(response.status).toBe(404);
		expect((await readRow(storyId)).title).toBe("The Library at Night");
	});

	test("another draft can't overwrite someone else's story", async () => {
		const owner = await signUp();
		const { storyId } = await published(owner);

		const response = await update(owner.cookie, storyId, {
			originDraftId: newId(),
			metadata: { title: "Another draft", visibility: "private" },
			play: { scenario: "Another draft" },
		});
		expect(response.status).toBe(409);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.originMismatch,
		);
		expect((await readRow(storyId)).title).toBe("The Library at Night");
	});

	test("an update preserves the counters, the owner and the creation time", async () => {
		/**
		 * Viewers accumulated these values, so a creator's edit must not reset them; otherwise popularity
		 * ranking restarts from 0 on every edit.
		 */
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);
		await db
			.update(story)
			.set({ views: 12, favorites: 5, downloads: 3 })
			.where(eq(story.id, storyId));
		const before = await readRow(storyId);

		await update(owner.cookie, storyId, {
			originDraftId,
			metadata: { title: "Edit", visibility: "private" },
			play: { scenario: "Edit" },
		});

		const after = await readRow(storyId);
		expect(after.views).toBe(12);
		expect(after.favorites).toBe(5);
		expect(after.downloads).toBe(3);
		expect(after.owner).toBe(before.owner);
		expect(after.created_at.getTime()).toBe(before.created_at.getTime());
	});

	test("an update can make a private story public, with the identity unchanged", async () => {
		/**
		 * The whole assertion is that `private → public` happens on the same story id. A new row would
		 * strand the views, favorites, comments and cover accumulated on that work.
		 */
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);

		const response = await update(owner.cookie, storyId, {
			originDraftId,
			metadata: { title: "Going public", visibility: "public" },
			play: { scenario: "Going public" },
		});
		expect(response.status).toBe(200);
		expect(
			(
				(await response.json()) as {
					story: { id: string; visibility: StoryVisibility };
				}
			).story,
		).toMatchObject({ id: storyId, visibility: "public" });
		expect((await readRow(storyId)).visibility).toBe("public");
	});

	/**
	 * The work stays the same across visibility moves: identity and what accumulated on it (views,
	 * favorites, registration time) must survive wherever an update moves the state. Unlisted added
	 * one value to that round trip, and an implementation that creates a new row only on that value
	 * escapes the other assertions.
	 */
	test("switching to and from unlisted through updates happens on the same story id", async () => {
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);
		await db
			.update(story)
			.set({ views: 8, favorites: 2 })
			.where(eq(story.id, storyId));
		const before = await readRow(storyId);

		const move = (visibility: StoryVisibility) =>
			update(owner.cookie, storyId, {
				originDraftId,
				metadata: { title: "Round trip", visibility },
				play: { scenario: "Round trip" },
			});

		for (const visibility of [
			"unlisted",
			"public",
			"unlisted",
			"private",
		] as const) {
			expect((await move(visibility)).status).toBe(200);
			expect((await readRow(storyId)).visibility).toBe(visibility);
		}

		const after = await readRow(storyId);
		expect(after.id).toBe(before.id);
		expect(after.owner).toBe(before.owner);
		expect(after.created_at.getTime()).toBe(before.created_at.getTime());
		expect(after.views).toBe(8);
		expect(after.favorites).toBe(2);
	});

	test("an update can take a public story back to private", async () => {
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);
		const meta = (visibility: "public" | "private") => ({
			originDraftId,
			metadata: { title: "Round trip", visibility },
			play: { scenario: "Round trip" },
		});

		expect((await update(owner.cookie, storyId, meta("public"))).status).toBe(
			200,
		);
		expect((await update(owner.cookie, storyId, meta("private"))).status).toBe(
			200,
		);

		const row = await readRow(storyId);
		expect(row.id).toBe(storyId);
		expect(row.visibility).toBe("private");
	});

	test("republishing doesn't lift operator hiding", async () => {
		/**
		 * The most expensive defect this repository could have: if the creator pressing `Publish` again lifts
		 * enforcement, it is not enforcement (§13). The guarantee is not discipline but that `hidden` is
		 * not named in the upsert's `set`.
		 */
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);
		await db.update(story).set({ hidden: true }).where(eq(story.id, storyId));

		const response = await update(owner.cookie, storyId, {
			originDraftId,
			metadata: { title: "Update after hiding", visibility: "public" },
			play: { scenario: "Update after hiding" },
		});
		expect(response.status).toBe(200);

		const row = await readRow(storyId);
		expect(row.hidden).toBe(true);
		// The creator's chosen visibility applies, yet the work stays invisible to others.
		expect(row.visibility).toBe("public");

		const stranger = await signUp();
		const detail = await app.request(`/v2/stories/${storyId}`, {
			headers: { Cookie: stranger.cookie },
		});
		expect(detail.status).toBe(404);
	});

	test("republishing from the same draft doesn't lift operator hiding", async () => {
		// The same guarantee must hold on the idempotent publish (POST) path, not only update (PUT).
		const owner = await signUp();
		const request = publishRequest();
		const first = await publish(owner.cookie, request);
		const storyId = ((await first.json()) as PublishBody).story.id;
		await db.update(story).set({ hidden: true }).where(eq(story.id, storyId));

		const second = await publish(owner.cookie, request);
		expect(second.status).toBe(200);
		expect((await readRow(storyId)).hidden).toBe(true);
	});

	test("an update can't move it to archived either", async () => {
		/**
		 * Blocking only the publish path and leaving update open reaches the same place in two presses:
		 * publish private, then request archived through update.
		 */
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);

		const response = await update(owner.cookie, storyId, {
			originDraftId,
			metadata: { title: "Switch to archived", visibility: "archived" },
			play: { scenario: "Switch to archived" },
		});
		expect(response.status).toBe(403);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.archivedUnavailable,
		);

		const row = await readRow(storyId);
		expect(row.visibility).toBe("private");
		// The title is unchanged too: the gate stands before the write.
		expect(row.title).toBe("The Library at Night");
	});

	test("an update publish doesn't touch an archived story", async () => {
		/**
		 * One of three places enforcing §15's `archived → public` ban. If open here, one request returns
		 * the work to the catalogue without going through `Restore`.
		 */
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);
		await archive(owner.cookie, storyId);

		const response = await update(owner.cookie, storyId, {
			originDraftId,
			metadata: { title: "Public after archiving", visibility: "public" },
			play: { scenario: "Public after archiving" },
		});
		expect(response.status).toBe(409);
		expect(((await response.json()) as ErrorBody).code).toBe("story_archived");

		const row = await readRow(storyId);
		expect(row.visibility).toBe("archived");
		// The title is unchanged too: the gate stands before the write.
		expect(row.title).toBe("The Library at Night");
	});

	test("an archived story doesn't accept an idempotent publish of the same draft either", async () => {
		/**
		 * Blocking only update (PUT) and leaving publish (POST) open reaches the same place in two
		 * presses; the editor's `Publish again` is exactly that path.
		 */
		const owner = await signUp();
		const request = publishRequest();
		const first = await publish(owner.cookie, request);
		const storyId = ((await first.json()) as PublishBody).story.id;
		await archive(owner.cookie, storyId);

		const second = await publish(owner.cookie, {
			...request,
			metadata: { title: "Republish after archiving", visibility: "public" },
		});
		expect(second.status).toBe(409);
		expect(((await second.json()) as ErrorBody).code).toBe("story_archived");

		const row = await readRow(storyId);
		expect(row.visibility).toBe("archived");
		expect(row.title).toBe("The Library at Night");
		// The second request did not create a second work either.
		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(eq(story.origin_draft_id, request.originDraftId));
		expect(rows).toHaveLength(1);
	});

	test("after restoring it can be published again", async () => {
		// What is blocked is the archived state, not the work: after restoring, the original path opens
		// as before.
		const owner = await signUp();
		const { storyId, originDraftId } = await published(owner);
		await archive(owner.cookie, storyId);
		expect(
			(
				await app.request(`/v2/stories/${storyId}/restore`, {
					method: "POST",
					headers: { Origin: WEB_ORIGIN, Cookie: owner.cookie },
				})
			).status,
		).toBe(200);

		const response = await update(owner.cookie, storyId, {
			originDraftId,
			metadata: { title: "Public after restoring", visibility: "public" },
			play: { scenario: "Public after restoring" },
		});
		expect(response.status).toBe(200);

		const row = await readRow(storyId);
		expect(row.visibility).toBe("public");
		expect(row.title).toBe("Public after restoring");
	});

	test("a published story gives its owner the playback payload", async () => {
		/**
		 * Verifies publish → detail → `Start conversation` is connected; if broken here the creator cannot start a
		 * conversation with the work they just published.
		 */
		const owner = await signUp();
		const { storyId } = await published(owner);

		const response = await app.request(`/v2/stories/${storyId}/play`, {
			headers: { Cookie: owner.cookie },
		});
		expect(response.status).toBe(200);
		const payload = StoryChatSeedDto.parse(await response.json());
		expect(payload.storyId).toBe(storyId);
	});

	test("a private publish isn't visible to others", async () => {
		const owner = await signUp();
		const stranger = await signUp();
		const { storyId } = await published(owner);

		const response = await app.request(`/v2/stories/${storyId}`, {
			headers: { Cookie: stranger.cookie },
		});
		expect(response.status).toBe(404);
	});
});

describe.skipIf(!databaseReady)("viewing — adult display setting", () => {
	/**
	 * Publishing eligibility and viewing settings are different axes. `isAdultVerified` (identity
	 * verified and 19+) is the legal requirement and gates publishing; `show_adult` is a taste about
	 * what shows in my gallery and is unrelated to publishing. Merged, a member with display off would
	 * succeed at publishing their adult work and then get 404 opening or playing it: the write works,
	 * only the read fails, and the creator cannot guess why.
	 */

	const get = (cookie: string, path: string): Promise<Response> =>
		Promise.resolve(app.request(path, { headers: { Cookie: cookie } }));

	/** Publishes one adult work as private and returns its id, leaving the display setting alone. */
	async function publishedAdult(account: Account, title: string) {
		const response = await publish(
			account.cookie,
			publishRequest({
				metadata: { title, visibility: "private", adult: true },
			}),
		);
		expect(response.status).toBe(201);
		return ((await response.json()) as PublishBody).story.id;
	}

	test("an owner with the display off still opens and plays their own adult story", async () => {
		const owner = await signUp();
		await grantAdultEligibility(owner.memberId);
		const storyId = await publishedAdult(owner, "Adult with the display off");

		const detail = await get(owner.cookie, `/v2/stories/${storyId}`);
		expect(detail.status).toBe(200);

		const play = await get(owner.cookie, `/v2/stories/${storyId}/play`);
		expect(play.status).toBe(200);
		expect(StoryChatSeedDto.parse(await play.json()).storyId).toBe(storyId);
	});

	test("an ineligible member can't publish adult content publicly", async () => {
		/**
		 * Opening public does not loosen adult eligibility; the gate now actually guards the catalogue.
		 * Not silently lowered to all-ages either, so the row must not exist.
		 */
		const owner = await signUp();
		const request = publishRequest({
			metadata: {
				title: "Ineligible public adult",
				visibility: "public",
				adult: true,
			},
		});

		const response = await publish(owner.cookie, request);
		expect(response.status).toBe(403);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.adultNotPermitted,
		);
		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(eq(story.origin_draft_id, request.originDraftId));
		expect(rows).toHaveLength(0);
	});

	test("a public adult story is visible only to viewers with **both** eligibility and the display setting", async () => {
		/**
		 * Public adult works can now be made through the publish path, so no row is inserted by hand: the
		 * question is how a real creator's work passes the viewing gate. Four viewers in one place:
		 * guest, plain member, eligible with display off, eligible with display on.
		 */
		const creator = await signUp();
		await grantAdultEligibility(creator.memberId);
		const reader = await signUp();
		const plain = await signUp();

		const response = await publish(
			creator.cookie,
			publishRequest({
				metadata: { title: "Public adult", visibility: "public", adult: true },
			}),
		);
		expect(response.status).toBe(201);
		const storyId = ((await response.json()) as PublishBody).story.id;

		// Guest: no session, so it cannot pass the adult gate.
		expect((await app.request(`/v2/stories/${storyId}`)).status).toBe(404);
		// Unverified member.
		expect((await get(plain.cookie, `/v2/stories/${storyId}`)).status).toBe(
			404,
		);

		// Eligible but display off: still invisible.
		await grantAdultEligibility(reader.memberId);
		expect((await get(reader.cookie, `/v2/stories/${storyId}`)).status).toBe(
			404,
		);

		// Turning display on makes it visible, so the blocker was that setting, not verification.
		await enableAdultDisplay(reader.memberId);
		expect((await get(reader.cookie, `/v2/stories/${storyId}`)).status).toBe(
			200,
		);
	});

	test("an adult story you can't see doesn't leak its existence through comments, reports or favorites either", async () => {
		/**
		 * Hiding existence behind a 404 is useless if it holds only on detail: if someone who knows the
		 * id can learn "that work exists" through another path, that path is a detector.
		 */
		const creator = await signUp();
		await grantAdultEligibility(creator.memberId);
		const reader = await signUp();

		const response = await publish(
			creator.cookie,
			publishRequest({
				metadata: { title: "Doesn't leak", visibility: "public", adult: true },
			}),
		);
		const storyId = ((await response.json()) as PublishBody).story.id;

		const post = (path: string, body: unknown, method = "POST") =>
			app.request(path, {
				method,
				headers: {
					"Content-Type": "application/json",
					Origin: WEB_ORIGIN,
					Cookie: reader.cookie,
				},
				body: JSON.stringify(body),
			});

		expect(
			(await get(reader.cookie, `/v2/stories/${storyId}/comments`)).status,
		).toBe(404);
		expect(
			(await post(`/v2/stories/${storyId}/comments`, { body: "Hi" })).status,
		).toBe(404);
		expect(
			(
				await post("/v2/reports", {
					target: { type: "story", storyId },
					reason: "spam",
				})
			).status,
		).toBe(404);
		expect(
			(await post(`/v2/favorites/${storyId}`, { favorited: true }, "PUT"))
				.status,
		).toBe(404);
	});

	test("when adult verification lapses it closes again, even on your own story", async () => {
		// Ownership does not replace verification; the display setting is the only thing it opened.
		const owner = await signUp();
		await grantAdultEligibility(owner.memberId);
		const storyId = await publishedAdult(owner, "After verification lapses");

		await db
			.update(member)
			.set({ verified: false, adult: false })
			.where(eq(member.id, owner.memberId));

		const response = await get(owner.cookie, `/v2/stories/${storyId}`);
		expect(response.status).toBe(404);
	});

	test("in lists, your own adult stories follow the display setting too", async () => {
		/**
		 * The gallery is where unrequested ratings would be pushed first, so it differs from single
		 * reads; opening it here would make the display opt-in effectively void.
		 */
		const owner = await signUp();
		await grantAdultEligibility(owner.memberId);
		const title = `list-${newId()}`;
		const storyId = await publishedAdult(owner, title);
		const listed = async (): Promise<string[]> => {
			const response = await get(
				owner.cookie,
				`/v2/stories?q=${encodeURIComponent(title)}`,
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { items: { id: string }[] };
			return body.items.map((item) => item.id);
		};

		expect(await listed()).not.toContain(storyId);

		await enableAdultDisplay(owner.memberId);
		expect(await listed()).toContain(storyId);
	});
});

describe.skipIf(!databaseReady)("publishing — input validation", () => {
	test("no title is a 400", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			originDraftId: newId(),
			metadata: { title: "" },
			play: { scenario: "Content" },
		});
		expect(response.status).toBe(400);
	});

	test("a broken body is a 400, not a 500", async () => {
		const owner = await signUp();
		const response = await app.request("/v2/stories", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: owner.cookie,
			},
			body: "{",
		});
		expect(response.status).toBe(400);
	});

	test("no draft id is a 400", async () => {
		// Without an origin there is no basis for idempotency: a retry becomes a duplicate work.
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			metadata: { title: "Title", visibility: "private" },
			play: { scenario: "Content" },
		});
		expect(response.status).toBe(400);
	});
});

describe.skipIf(!databaseReady)("schema", () => {
	test("an existing story is valid without an origin draft", async () => {
		/**
		 * Migrated rows and fixtures have no corresponding draft. Inventing an id would later collide
		 * with a real draft, so NULL is correct, and several NULLs must not trip the unique index.
		 */
		const owner = await signUp();
		const ids = [newId(), newId()];
		await db.insert(story).values(
			ids.map((id) => ({
				id,
				owner: owner.memberId,
				title: "A migrated story",
				origin_draft_id: null,
			})),
		);

		const rows = await db
			.select({ id: story.id })
			.from(story)
			.where(and(eq(story.owner, owner.memberId)));
		expect(rows).toHaveLength(2);
	});
});
