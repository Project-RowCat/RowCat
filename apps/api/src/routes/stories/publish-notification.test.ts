import type { NotificationDto } from "@rowcat/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	block,
	follow,
	notification,
	push_delivery,
	push_registration,
	session,
	story,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * A followed creator publishing a new work, run through real Postgres and the real Hono app.
 * Calling the service directly would leave the fragile spots outside the test, because every
 * invariant here is held by the database:
 *
 * ```text
 * one follower + one story = at most one row   unique(recipient, source_key)
 * blockers do not receive                      exists inside the set INSERT's where
 * the creator does not receive                 follower <> actor (the API refuses self-follow, so the row is inserted by hand)
 * a rolled-back publish leaves no notification same transaction
 * ```
 *
 * Three paths lead to public (first publish, update publish, lifecycle transition) and half of this
 * file walks all three; if one is left open, works published that way notify nobody, silently.
 */

const EMAIL_PREFIX = "story-publish-notification-test-";

interface Person {
	cookie: string;
	memberId: string;
	authUserId: string;
}

const signUp = (name = "Publish notification test") =>
	createTestMember(EMAIL_PREFIX, { name });

const headers = (cookie: string) => ({
	"Content-Type": "application/json",
	Origin: WEB_ORIGIN,
	Cookie: cookie,
});

interface PublishInput {
	originDraftId: string;
	visibility: "public" | "unlisted" | "private";
	title?: string;
}

const publishBody = (input: PublishInput) => ({
	originDraftId: input.originDraftId,
	metadata: {
		title: input.title ?? "The Convenience Store That Rewinds the Night",
		visibility: input.visibility,
	},
	play: { scenario: "Every midnight the same day comes back." },
});

const publish = (cookie: string, input: PublishInput): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/stories", {
			method: "POST",
			headers: headers(cookie),
			body: JSON.stringify(publishBody(input)),
		}),
	);

const update = (
	cookie: string,
	storyId: string,
	input: PublishInput,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}`, {
			method: "PUT",
			headers: headers(cookie),
			body: JSON.stringify(publishBody(input)),
		}),
	);

type Lifecycle = "publish" | "unlist" | "unpublish" | "archive" | "restore";

const act = (
	cookie: string,
	storyId: string,
	action: Lifecycle,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/${action}`, {
			method: "POST",
			headers: { Origin: WEB_ORIGIN, Cookie: cookie },
		}),
	);

async function publishStory(
	person: Person,
	input: PublishInput,
): Promise<string> {
	const response = await publish(person.cookie, input);
	expect(response.status).toBe(201);
	const body = (await response.json()) as { story: { id: string } };
	return body.story.id;
}

/**
 * Follows go through the product API. Inserting the row by hand would make this file define which
 * relationships deserve a notification, and it alone would go stale when those rules change.
 */
async function followCreator(follower: Person, creator: Person): Promise<void> {
	const response = await app.request("/v2/follows", {
		method: "PUT",
		headers: headers(follower.cookie),
		body: JSON.stringify({ creator: creator.memberId, following: true }),
	});
	expect(response.status).toBe(200);
}

async function blockCreator(blocker: Person, creator: Person): Promise<void> {
	const response = await app.request("/v2/blocks", {
		method: "PUT",
		headers: headers(blocker.cookie),
		body: JSON.stringify({ creator: creator.memberId, blocked: true }),
	});
	expect(response.status).toBe(200);
}

const publishedRows = (recipientId: string, storyId: string) =>
	db
		.select({ id: notification.id, sourceKey: notification.source_key })
		.from(notification)
		.where(
			and(
				eq(notification.recipient, recipientId),
				eq(notification.kind, "creator_story_published"),
				eq(notification.story_id, storyId),
			),
		);

const countPublished = async (
	recipientId: string,
	storyId: string,
): Promise<number> => (await publishedRows(recipientId, storyId)).length;

/** Counts by kind only, so rows with a severed story reference (after story deletion) are included. */
const countPublishedAnywhere = async (recipientId: string): Promise<number> =>
	(
		await db
			.select({ id: notification.id })
			.from(notification)
			.where(
				and(
					eq(notification.recipient, recipientId),
					eq(notification.kind, "creator_story_published"),
				),
			)
	).length;

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("who receives it", () => {
	test("publishing publicly gives followers one row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});

		expect(await countPublished(follower.memberId, storyId)).toBe(1);
	});

	test("with several followers, each gets their own row", async () => {
		const creator = await signUp("Creator");
		const [a, b, c] = await Promise.all([
			signUp("Follower A"),
			signUp("Follower B"),
			signUp("Follower C"),
		]);
		for (const follower of [a, b, c]) await followCreator(follower, creator);

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});

		const rows = await db
			.select({ recipient: notification.recipient })
			.from(notification)
			.where(
				and(
					eq(notification.kind, "creator_story_published"),
					eq(notification.story_id, storyId),
				),
			);
		expect(rows.map((row) => row.recipient).sort()).toEqual(
			[a.memberId, b.memberId, c.memberId].sort(),
		);
	});

	test("people who don't follow don't receive it", async () => {
		const creator = await signUp("Creator");
		const stranger = await signUp("Other");

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});

		expect(await countPublished(stranger.memberId, storyId)).toBe(0);
	});

	/**
	 * The API refuses self-follow, so the row is inserted by hand. Without the predicate's `follower
	 * <> actor` nothing breaks today, but the day it disappears creators start receiving notifications
	 * about their own works.
	 */
	test("the creator doesn't receive it", async () => {
		const creator = await signUp("Creator");
		await db
			.insert(follow)
			.values({ follower: creator.memberId, creator: creator.memberId });

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});

		expect(await countPublished(creator.memberId, storyId)).toBe(0);
	});

	/**
	 * Blocking also stops future notifications. A block severs the follow so the relationship normally
	 * disappears; here the relationship is kept with only the block standing, to check that the
	 * predicate itself runs.
	 */
	test("a follower you blocked doesn't receive it", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Blocked follower");
		await followCreator(follower, creator);
		// Re-create the follow that the block severed.
		await blockCreator(follower, creator);
		await db
			.insert(follow)
			.values({ follower: follower.memberId, creator: creator.memberId })
			.onConflictDoNothing();

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});

		expect(await countPublished(follower.memberId, storyId)).toBe(0);
		// The relationship is still there, so the block predicate really ran over that row.
		const [live] = await db
			.select({ follower: follow.follower })
			.from(follow)
			.where(
				and(
					eq(follow.follower, follower.memberId),
					eq(follow.creator, creator.memberId),
				),
			);
		expect(live).toBeDefined();
	});
});

describe.skipIf(!databaseReady)("only on first entering public", () => {
	test("publishing privately notifies nobody", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "private",
		});

		expect(await countPublished(follower.memberId, storyId)).toBe(0);
	});

	// Unlisted works are not in the catalogue, so "a new work is out" is not true of them.
	test("publishing as unlisted notifies nobody", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "unlisted",
		});

		expect(await countPublished(follower.memberId, storyId)).toBe(0);
	});

	test("private → public (lifecycle transition) creates one row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "private",
		});
		expect(await countPublished(follower.memberId, storyId)).toBe(0);

		expect((await act(creator.cookie, storyId, "publish")).status).toBe(200);

		expect(await countPublished(follower.memberId, storyId)).toBe(1);
	});

	test("unlisted → public (lifecycle transition) creates one row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "unlisted",
		});

		expect((await act(creator.cookie, storyId, "publish")).status).toBe(200);

		expect(await countPublished(follower.memberId, storyId)).toBe(1);
	});

	test("private → public (update publish) creates one row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const draftId = newId();
		const storyId = await publishStory(creator, {
			originDraftId: draftId,
			visibility: "private",
		});

		expect(
			(
				await update(creator.cookie, storyId, {
					originDraftId: draftId,
					visibility: "public",
				})
			).status,
		).toBe(200);

		expect(await countPublished(follower.memberId, storyId)).toBe(1);
	});

	/**
	 * The most important assertion in this file. Editing an already-public work is a normal path, and
	 * a fan-out there would be deduplicated only for people who already received it, not for someone
	 * who followed in between. Hence the follow happens after publishing.
	 */
	test("updating an already public story doesn't reach new followers", async () => {
		const creator = await signUp("Creator");
		const draftId = newId();
		const storyId = await publishStory(creator, {
			originDraftId: draftId,
			visibility: "public",
		});

		const latecomer = await signUp("A later follower");
		await followCreator(latecomer, creator);

		expect(
			(
				await update(creator.cookie, storyId, {
					originDraftId: draftId,
					visibility: "public",
					title: "Fixed the title",
				})
			).status,
		).toBe(200);
		// Re-running the first-publish path with the same draft must give the same result.
		expect(
			(
				await publish(creator.cookie, {
					originDraftId: draftId,
					visibility: "public",
					title: "Fixed it once more",
				})
			).status,
		).toBe(200);
		// A lifecycle `publish` retry too (already public, so it succeeds idempotently).
		expect((await act(creator.cookie, storyId, "publish")).status).toBe(200);

		expect(await countPublished(latecomer.memberId, storyId)).toBe(0);
	});

	test("a follower who already received it doesn't get a second row from an update publish", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const draftId = newId();
		const storyId = await publishStory(creator, {
			originDraftId: draftId,
			visibility: "public",
		});

		await update(creator.cookie, storyId, {
			originDraftId: draftId,
			visibility: "public",
			title: "The fixed title",
		});

		expect(await countPublished(follower.memberId, storyId)).toBe(1);
	});

	/** Re-`POST`ing the same draft is the normal path of a client that lost its response; a second row would turn retries into spam. */
	test("sending the same publish request again is still one row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const draftId = newId();
		const input = {
			originDraftId: draftId,
			visibility: "public",
		} as const;

		const storyId = await publishStory(creator, input);
		expect((await publish(creator.cookie, input)).status).toBe(200);
		expect((await publish(creator.cookie, input)).status).toBe(200);

		expect(await countPublished(follower.memberId, storyId)).toBe(1);
	});

	/** Withdrawing and republishing is normal; the per-story key keeps the same work from piling up in one inbox. */
	test("public → private → public is still one row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});

		expect((await act(creator.cookie, storyId, "unpublish")).status).toBe(200);
		expect((await act(creator.cookie, storyId, "publish")).status).toBe(200);
		expect((await act(creator.cookie, storyId, "unpublish")).status).toBe(200);
		expect((await act(creator.cookie, storyId, "publish")).status).toBe(200);

		expect(await countPublished(follower.memberId, storyId)).toBe(1);
	});

	// Both archive and restore end private, so neither is an event.
	test("archiving and restoring create no rows", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "private",
		});

		expect((await act(creator.cookie, storyId, "archive")).status).toBe(200);
		expect((await act(creator.cookie, storyId, "restore")).status).toBe(200);

		expect(await countPublished(follower.memberId, storyId)).toBe(0);
	});

	/** A rejected publish leaves nothing: the public transition on an archived work is a 409, and a notification outside the transaction would leave a row in someone's inbox. */
	test("a refused public transition leaves no row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "private",
		});
		await act(creator.cookie, storyId, "archive");

		expect((await act(creator.cookie, storyId, "publish")).status).toBe(409);

		expect(await countPublished(follower.memberId, storyId)).toBe(0);
	});
});

describe.skipIf(!databaseReady)("the values sent in the inbox", () => {
	test("actor and story are joined from the current rows", async () => {
		const creator = await signUp("Cat creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
			title: "The Convenience Store That Rewinds the Night",
		});

		const response = await app.request("/v2/me/notifications", {
			headers: { Cookie: follower.cookie },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { items: NotificationDto[] };
		const row = body.items.find(
			(item) => item.kind === "creator_story_published",
		);
		expect(row).toBeDefined();
		if (row?.kind !== "creator_story_published")
			throw new Error("the kind differs");
		expect(row.actor).toEqual({
			id: creator.memberId,
			displayName: "Cat creator",
			avatarUrl: null,
		});
		expect(row.story).toEqual({
			id: storyId,
			title: "The Convenience Store That Rewinds the Night",
		});
		expect(row.readAt).toBeNull();
		// The idempotency key is the server's and does not go out in the response.
		expect(JSON.stringify(row)).not.toContain("story-published");
	});

	/**
	 * The row survives story deletion. The reference is `set null`, so only the destination goes away;
	 * filtering it out would make the cursor's count differ from what is delivered and misalign page
	 * boundaries.
	 */
	test("the row stays after the story disappears, with only story null", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});
		await db.delete(story).where(eq(story.id, storyId));

		const response = await app.request("/v2/me/notifications", {
			headers: { Cookie: follower.cookie },
		});
		const body = (await response.json()) as { items: NotificationDto[] };
		const row = body.items.find(
			(item) => item.kind === "creator_story_published",
		);
		expect(row).toBeDefined();
		if (row?.kind !== "creator_story_published")
			throw new Error("the kind differs");
		expect(row.story).toBeNull();
		expect(row.actor).not.toBeNull();
		expect(await countPublishedAnywhere(follower.memberId)).toBe(1);
	});

	/**
	 * Push deliveries are created as a set in the same transaction as the notification. A loop would
	 * cost one round trip per follower, and moving it outside the transaction opens a window where the
	 * notification is committed but its delivery is missing.
	 */
	test("a follower with a push registration also gets a delivery row", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const registrationId = newId();
		const [live] = await db
			.select({ id: session.id })
			.from(session)
			.where(eq(session.userId, follower.authUserId))
			.limit(1);
		// A registration is bound to the session, so signing out is unregistering.
		if (!live) throw new Error("there is no session");
		await db.insert(push_registration).values({
			id: registrationId,
			member_id: follower.memberId,
			session_id: live.id,
			installation_id: newId(),
			platform: "ios",
			provider: "expo",
			token: `ExponentPushToken[${registrationId}]`,
		});

		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});

		const [row] = await publishedRows(follower.memberId, storyId);
		expect(row).toBeDefined();
		const deliveries = await db
			.select({ id: push_delivery.id })
			.from(push_delivery)
			.where(inArray(push_delivery.notification_id, [row?.id ?? ""]));
		expect(deliveries).toHaveLength(1);
	});
});

describe.skipIf(!databaseReady)("the key is per story", () => {
	/** A per-creator key would swallow the second work silently (same key, dropped by `onConflictDoNothing`). */
	test("two stories by the same creator are two rows", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);

		const first = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
			title: "First story",
		});
		const second = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
			title: "Second story",
		});

		expect(await countPublished(follower.memberId, first)).toBe(1);
		expect(await countPublished(follower.memberId, second)).toBe(1);
		const [row] = await publishedRows(follower.memberId, first);
		expect(row?.sourceKey).toBe(`story-published:${first}`);
	});

	/** Blocking also sweeps rows already delivered (social notifications have an actor); following again does not revive them because that publish is a past event. */
	test("a block sweeps away rows already received, and following again doesn't revive them", async () => {
		const creator = await signUp("Creator");
		const follower = await signUp("Follower");
		await followCreator(follower, creator);
		const storyId = await publishStory(creator, {
			originDraftId: newId(),
			visibility: "public",
		});
		expect(await countPublished(follower.memberId, storyId)).toBe(1);

		await blockCreator(follower, creator);
		expect(await countPublished(follower.memberId, storyId)).toBe(0);

		await db
			.delete(block)
			.where(
				and(
					eq(block.blocker, follower.memberId),
					eq(block.creator, creator.memberId),
				),
			);
		await followCreator(follower, creator);
		expect(await countPublished(follower.memberId, storyId)).toBe(0);
	});
});
