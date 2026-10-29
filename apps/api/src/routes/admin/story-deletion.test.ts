import type { StoryChatSeedInput } from "@rowcat/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	admin_audit_log,
	favorite,
	media,
	member,
	moderation_action,
	moderation_case,
	moderation_report,
	story,
	story_comment,
	story_media,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember, type TestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `POST /v2/admin/stories/:id/delete`: operator deletion of a published story.
 *
 * Creators have no self-service story deletion; requests arrive through the operator's contact
 * channel, and this operation is that channel's hand. It cannot be undone, so this file asserts by value what disappears and what
 * stays:
 *
 * ```text
 * gate      admin only · reason required · body is the reason alone
 * refuse    any moderation action on the story means nothing is written
 * deleted   row, comments, favorites and media references together
 * kept      media bytes (a draft may still point at them) · reports (the reporter's history)
 * ```
 *
 * Runs against real Postgres and the real app. A second branch ("detach if someone owns a copy")
 * once existed; it left with story purchases, so the outcome is `deleted` alone (`docs/oss/PLAN.md`
 * stage 3).
 */

const EMAIL_PREFIX = "admin-story-delete-test-";

const hasDb = await connectTestDatabase();

/** Stories this file created; ones left standing (refused deletions etc.) are removed directly at the end. */
const seeded: string[] = [];

afterAll(async () => {
	if (hasDb) {
		/**
		 * Leftover stories hold media references; raw-deleting the member would try to remove that media
		 * with it and be blocked by the references, so stories go first.
		 */
		if (seeded.length) await db.delete(story).where(inArray(story.id, seeded));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

const signUp = (name = "Deletion test") =>
	createTestMember(EMAIL_PREFIX, { name });

async function operator(role: "staff" | "admin"): Promise<TestMember> {
	const account = await signUp(`Operator ${role}`);
	await db.update(member).set({ role }).where(eq(member.id, account.memberId));
	return account;
}

const request = (
	cookie: string | null,
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<Response> =>
	Promise.resolve(
		app.request(path, {
			method: init.method ?? "GET",
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
				...(init.body === undefined
					? {}
					: { "Content-Type": "application/json" }),
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		}),
	);

const deleteStory = (
	cookie: string | null,
	storyId: string,
	body: unknown = { reason: "The creator's deletion request (inquiry #1234)" },
) =>
	request(cookie, `/v2/admin/stories/${storyId}/delete`, {
		method: "POST",
		body,
	});

const seedPayload = (storyId: string): StoryChatSeedInput => ({
	version: 1,
	storyId,
	title: `Deleted story ${storyId.slice(0, 6)}`,
	adult: false,
	promptProtected: false,
	scenario: "Background for the deletion test.",
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

async function seedStory(
	ownerId: string,
	options: { title?: string; originDraftId?: string } = {},
): Promise<string> {
	const id = newId();
	seeded.push(id);
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: options.title ?? `Deleted story ${id.slice(0, 6)}`,
		visibility: "public",
		origin_draft_id: options.originDraftId ?? newId(),
		play_payload: seedPayload(id),
	});
	return id;
}

async function seedComment(storyId: string, authorId: string) {
	const root = newId();
	await db.insert(story_comment).values({
		id: root,
		story_id: storyId,
		author: authorId,
		body: "A comment",
	});
	await db.insert(story_comment).values({
		id: newId(),
		story_id: storyId,
		author: authorId,
		body: "A reply",
		parent_id: root,
	});
	return root;
}

async function seedSceneImage(ownerId: string, storyId: string) {
	const id = newId();
	await db.insert(media).values({
		id,
		owner: ownerId,
		kind: "scene_image",
		mime: "image/webp",
		width: 10,
		height: 10,
		byte_size: 4,
		storage_key: `media/scene_image/${ownerId}/${id}.webp`,
	});
	await db
		.insert(story_media)
		.values({ story_id: storyId, media_id: id, role: "scene_image" });
	return id;
}

const storyRow = async (storyId: string) =>
	(
		await db
			.select({
				owner: story.owner,
				originDraftId: story.origin_draft_id,
				visibility: story.visibility,
			})
			.from(story)
			.where(eq(story.id, storyId))
	)[0] ?? null;

const countOf = async (
	rows: Promise<unknown[]> | { then: Promise<unknown[]>["then"] },
) => (await rows).length;

describe.skipIf(!hasDb)("door", () => {
	test("guests get 401, regular members and staff get 403, and nothing is deleted", async () => {
		const creator = await signUp();
		const storyId = await seedStory(creator.memberId);
		const staff = await operator("staff");

		expect((await deleteStory(null, storyId)).status).toBe(401);
		expect((await deleteStory(creator.cookie, storyId)).status).toBe(403);
		expect((await deleteStory(staff.cookie, storyId)).status).toBe(403);
		expect(await storyRow(storyId)).not.toBeNull();
	});

	test.each([
		["no reason", {}],
		["empty reason", { reason: "   " }],
		/** No axis for choosing the outcome is expressible; the body is the reason alone (`.strict()`). */
		[
			"an axis that picks the outcome",
			{ reason: "request", keepForBuyers: false },
		],
	])("body rule: %s is a 400", async (_name, body) => {
		const admin = await operator("admin");
		const storyId = await seedStory((await signUp()).memberId);
		expect((await deleteStory(admin.cookie, storyId, body)).status).toBe(400);
		expect(await storyRow(storyId)).not.toBeNull();
	});

	test("an unknown story is 404", async () => {
		const admin = await operator("admin");
		expect((await deleteStory(admin.cookie, newId())).status).toBe(404);
	});
});

describe.skipIf(!hasDb)("deletes", () => {
	test("the row is deleted, and the catalogue, detail, playback and comments disappear together", async () => {
		const admin = await operator("admin");
		const creator = await signUp("Creator");
		const reader = await signUp("Reader");
		const storyId = await seedStory(creator.memberId, {
			title: "Story to be deleted UniqueTitle",
		});
		await seedComment(storyId, reader.memberId);
		await db
			.insert(favorite)
			.values({ member_id: reader.memberId, story_id: storyId });

		const response = await deleteStory(admin.cookie, storyId);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ outcome: "deleted" });

		expect(await storyRow(storyId)).toBeNull();
		expect(
			await countOf(
				db
					.select({ id: story_comment.id })
					.from(story_comment)
					.where(eq(story_comment.story_id, storyId)),
			),
		).toBe(0);
		expect(
			await countOf(
				db
					.select({ m: favorite.member_id })
					.from(favorite)
					.where(eq(favorite.story_id, storyId)),
			),
		).toBe(0);

		for (const path of [
			`/v2/stories/${storyId}`,
			`/v2/stories/${storyId}/play`,
			`/v2/stories/${storyId}/comments`,
		])
			expect((await request(creator.cookie, path)).status).toBe(404);

		const search = (await (
			await request(null, `/v2/stories?q=${encodeURIComponent("UniqueTitle")}`)
		).json()) as { items: { id: string }[] };
		expect(search.items.map((item) => item.id)).not.toContain(storyId);
		const profile = (await (
			await request(null, `/v2/creators/${creator.memberId}/stories`)
		).json()) as { items: { id: string }[] };
		expect(profile.items.map((item) => item.id)).not.toContain(storyId);
	});

	/**
	 * Media bytes stay. The reference (`story_media`) goes with the row, but a device draft may still
	 * point at the image and republishing that draft needs it.
	 */
	test("media references disappear and the media remains", async () => {
		const admin = await operator("admin");
		const creator = await signUp();
		const storyId = await seedStory(creator.memberId);
		const mediaId = await seedSceneImage(creator.memberId, storyId);

		expect((await deleteStory(admin.cookie, storyId)).status).toBe(200);
		expect(
			await countOf(
				db
					.select({ id: story_media.media_id })
					.from(story_media)
					.where(eq(story_media.media_id, mediaId)),
			),
		).toBe(0);
		expect(
			await countOf(
				db.select({ id: media.id }).from(media).where(eq(media.id, mediaId)),
			),
		).toBe(1);
	});

	/** Re-sending for a deleted story is 404; the screen reads that as "already gone". */
	test("the second request is 404 and the audit has one row", async () => {
		const admin = await operator("admin");
		const storyId = await seedStory((await signUp()).memberId);
		expect((await deleteStory(admin.cookie, storyId)).status).toBe(200);
		expect((await deleteStory(admin.cookie, storyId)).status).toBe(404);
		const audits = await db
			.select({
				action: admin_audit_log.action,
				metadata: admin_audit_log.metadata,
			})
			.from(admin_audit_log)
			.where(
				and(
					eq(admin_audit_log.target_type, "story"),
					eq(admin_audit_log.target_id, storyId),
				),
			);
		expect(audits).toHaveLength(1);
		expect(audits[0]?.action).toBe("admin.story.delete");
		expect(audits[0]?.metadata).toMatchObject({
			outcome: "deleted",
			reason: "The creator's deletion request (inquiry #1234)",
			hadOwner: true,
		});
	});
});

describe.skipIf(!hasDb)("with an action ledger — refuses", () => {
	/**
	 * `moderation_action.target_story` cascades, so deleting would erase the enforcement record and
	 * appeals with it. A reversed action is still ledger, so activity does not matter.
	 */
	test("409 when any action points at the story, and nothing changes", async () => {
		const admin = await operator("admin");
		const creator = await signUp();
		const storyId = await seedStory(creator.memberId);
		const caseId = newId();
		await db.insert(moderation_case).values({
			id: caseId,
			target_type: "story",
			target_id: storyId,
			status: "resolved",
		});
		await db.insert(moderation_action).values({
			id: newId(),
			case_id: caseId,
			actor: admin.memberId,
			kind: "hide_story",
			reason: "test action",
			public_reason: "",
			target_story: storyId,
		});

		const response = await deleteStory(admin.cookie, storyId);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			code: "story_delete_has_enforcement",
		});
		expect(await storyRow(storyId)).toMatchObject({
			owner: creator.memberId,
			visibility: "public",
		});
		expect(
			await countOf(
				db
					.select({ id: moderation_action.id })
					.from(moderation_action)
					.where(eq(moderation_action.target_story, storyId)),
			),
		).toBe(1);
	});

	/**
	 * A report with no action neither blocks deletion nor is deleted: the reporter's `My reports` does not
	 * re-query the target, so that record must remain.
	 */
	test("reports without an action do not block deletion and remain", async () => {
		const admin = await operator("admin");
		const reporter = await signUp("Reporter");
		const storyId = await seedStory((await signUp()).memberId);
		const caseId = newId();
		await db.insert(moderation_case).values({
			id: caseId,
			target_type: "story",
			target_id: storyId,
		});
		await db.insert(moderation_report).values({
			id: newId(),
			case_id: caseId,
			reporter: reporter.memberId,
			target_type: "story",
			target_id: storyId,
			reason: "spam",
			evidence: { title: "snapshot" },
		});

		expect((await deleteStory(admin.cookie, storyId)).status).toBe(200);
		expect(
			await countOf(
				db
					.select({ id: moderation_report.id })
					.from(moderation_report)
					.where(eq(moderation_report.case_id, caseId)),
			),
		).toBe(1);
	});
});
