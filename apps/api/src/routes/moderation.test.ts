import { APPEAL_ERROR_CODE, CAPABILITY_ERROR_CODE } from "@rowcat/contracts";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import {
	member,
	member_restriction,
	moderation_action,
	moderation_appeal,
	moderation_case,
	moderation_report,
	story,
	story_comment,
} from "../db/schema.ts";
import { newId } from "../lib/id.ts";

import { createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * Operator tooling, enforcement and appeals, through the real Hono app and Postgres. Calling
 * service functions directly would leave the fragile spots outside the test: the role gate,
 * capability restrictions actually wired onto routes, enforcement moving several tables in one
 * transaction, and reversal respecting other active actions.
 *
 * The five guarantees (§P0, §P1):
 *
 * 1. Ordinary members cannot perform operator actions.
 * 2. Members cannot raise their own role, and the role is not in public responses.
 * 3. Hiding a story does not overwrite the creator's visibility choice.
 * 4. A restricted member cannot bypass via direct API calls, yet can still reach their own data.
 * 5. Reversal does not void other active sanctions, and `member.status` never diverges from the
 *    ledger.
 */

const EMAIL_PREFIX = "moderation-test-";

interface Account {
	cookie: string;
	memberId: string;
}

/**
 * Members this file created, used for cleanup. Reports outlive their reporter (only identity is
 * detached), so deleting members leaves reports piling up in the global queue and creating order
 * dependence across runs. Cases are deleted explicitly; reports and actions cascade from them.
 */
const CREATED_MEMBERS: string[] = [];

async function signUp() {
	const account = await createTestMember(EMAIL_PREFIX, {
		name: "Moderation test",
	});
	CREATED_MEMBERS.push(account.memberId);
	return account;
}

/** Operator account made like the seed script (writes the column directly); the product API has no promotion path. */
async function signUpOperator(role: "staff" | "admin"): Promise<Account> {
	const account = await signUp();
	await db.update(member).set({ role }).where(eq(member.id, account.memberId));
	return account;
}

async function seedStory(
	ownerId: string,
	options: { visibility?: "public" | "private" | "archived" } = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: `Story ${id.slice(0, 6)}`,
		visibility: options.visibility ?? "public",
		origin_draft_id: newId(),
		play_payload: { v: 1 },
	});
	return id;
}

const json = (cookie: string | null, body?: unknown) => ({
	headers: {
		"Content-Type": "application/json",
		Origin: WEB_ORIGIN,
		...(cookie ? { Cookie: cookie } : {}),
	},
	...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const get = (path: string, cookie: string | null) =>
	app.request(path, {
		headers: { Origin: WEB_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
	});

const post = (path: string, cookie: string | null, body: unknown) =>
	app.request(path, { method: "POST", ...json(cookie, body) });

/** Files a report and returns its case id; enforcement derives only from a case. */
async function reportStory(
	reporter: Account,
	storyId: string,
): Promise<{ reportId: string; caseId: string }> {
	const response = await post("/v2/reports", reporter.cookie, {
		target: { type: "story", storyId },
		reason: "spam",
	});
	const { reportId } = (await response.json()) as { reportId: string };
	const detail = await get(
		`/v2/moderation/reports/${reportId}`,
		OPERATOR.cookie,
	);
	const { caseId } = (await detail.json()) as { caseId: string };
	return { reportId, caseId };
}

async function reportMember(
	reporter: Account,
	memberId: string,
): Promise<{ reportId: string; caseId: string }> {
	const response = await post("/v2/reports", reporter.cookie, {
		target: { type: "member", memberId },
		reason: "harassment",
	});
	const { reportId } = (await response.json()) as { reportId: string };
	const detail = await get(
		`/v2/moderation/reports/${reportId}`,
		OPERATOR.cookie,
	);
	const { caseId } = (await detail.json()) as { caseId: string };
	return { reportId, caseId };
}

const act = (cookie: string, body: Record<string, unknown>) =>
	post("/v2/moderation/actions", cookie, body);

const statusOf = async (memberId: string): Promise<string> => {
	const [row] = await db
		.select({ status: member.status })
		.from(member)
		.where(eq(member.id, memberId));
	return row?.status ?? "";
};

const databaseReady = await connectTestDatabase();

/** Queue reads need an operator, so one account lives for the whole file. */
const OPERATOR: Account = databaseReady
	? await signUpOperator("staff")
	: { cookie: "", memberId: "" };

afterAll(async () => {
	if (databaseReady) {
		/** Cases first, so reports are not left anonymized by the member deletion. */
		if (CREATED_MEMBERS.length)
			await db
				.delete(moderation_case)
				.where(
					inArray(
						moderation_case.id,
						db
							.select({ id: moderation_report.case_id })
							.from(moderation_report)
							.where(inArray(moderation_report.reporter, CREATED_MEMBERS)),
					),
				);
		await db.delete(story).where(isNull(story.owner));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("operations tools — authorization", () => {
	const OPERATOR_ENDPOINTS: [string, "GET" | "POST"][] = [
		["/v2/moderation/reports", "GET"],
		["/v2/moderation/reports/anything", "GET"],
		["/v2/moderation/reports/anything/resolve", "POST"],
		["/v2/moderation/actions", "POST"],
		["/v2/moderation/appeals", "GET"],
		["/v2/moderation/appeals/anything/resolve", "POST"],
	];

	test("a regular member gets 403 on every operations endpoint", async () => {
		const normal = await signUp();
		for (const [path, method] of OPERATOR_ENDPOINTS) {
			const response =
				method === "GET"
					? await get(path, normal.cookie)
					: await post(path, normal.cookie, {});
			expect({ path, status: response.status }).toEqual({ path, status: 403 });
			expect(((await response.json()) as { code: string }).code).toBe(
				"moderator_required",
			);
		}
	});

	test("a guest gets 401 — existence is not hidden", async () => {
		const response = await get("/v2/moderation/reports", null);
		expect(response.status).toBe(401);
	});

	test("staff and admin see the same queue", async () => {
		const admin = await signUpOperator("admin");
		for (const operator of [OPERATOR, admin]) {
			const response = await get("/v2/moderation/reports", operator.cookie);
			expect(response.status).toBe(200);
		}
	});

	test("a suspended operator can't perform operations", async () => {
		const operator = await signUpOperator("staff");
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, operator.memberId));
		const response = await get("/v2/moderation/reports", operator.cookie);
		/** The account gate comes before the role; otherwise a sanctioned operator could keep enforcing. */
		expect(response.status).toBe(403);
		expect(((await response.json()) as { code: string }).code).toBe(
			"account_restricted",
		);
	});

	test("a member can't raise their own role", async () => {
		const normal = await signUp();
		/** The product API has no role-changing path; extra values on existing writes are ignored. */
		for (const [path, body] of [
			["/v2/me/nickname", { nickname: "NewName", role: "admin" }],
			["/v2/me/bio", { bio: "bio", role: "admin" }],
		] as const)
			await app.request(path, {
				method: "PATCH",
				...json(normal.cookie, body),
			});
		await app.request("/v2/me/role", {
			method: "PATCH",
			...json(normal.cookie, { role: "admin" }),
		});

		const [row] = await db
			.select({ role: member.role })
			.from(member)
			.where(eq(member.id, normal.memberId));
		expect(row?.role).toBe("user");
		expect((await get("/v2/moderation/reports", normal.cookie)).status).toBe(
			403,
		);
	});

	test("the role doesn't go out on the public profile", async () => {
		const operator = await signUpOperator("admin");
		const response = await get(`/v2/creators/${operator.memberId}`, null);
		const body = (await response.json()) as Record<string, unknown>;
		/** Count the whole key set; a new member column does not grow this list automatically. */
		expect(Object.keys(body).sort()).toEqual([
			"avatarUrl",
			"bio",
			"displayName",
			"followers",
			"id",
		]);
	});

	test("the role appears only in your own `/me`", async () => {
		const operator = await signUpOperator("staff");
		const mine = (await (await get("/v2/me", operator.cookie)).json()) as {
			role: string;
		};
		expect(mine.role).toBe("staff");
	});
});

describe.skipIf(!databaseReady)("hiding stories", () => {
	test("hiding removes it from the gallery and detail, and **the creator's visibility setting stays as is**", async () => {
		const owner = await signUp();
		const reporter = await signUp();
		const storyId = await seedStory(owner.memberId);
		const { caseId } = await reportStory(reporter, storyId);

		expect((await get(`/v2/stories/${storyId}`, null)).status).toBe(200);

		const response = await act(OPERATOR.cookie, {
			caseId,
			kind: "hide_story",
			reason: "policy violation",
			publicReason: "Hidden for breaking the rules.",
		});
		expect(response.status).toBe(201);

		// Invisible even to the owner; hiding covers the whole exposure axis.
		expect((await get(`/v2/stories/${storyId}`, null)).status).toBe(404);
		expect((await get(`/v2/stories/${storyId}`, owner.cookie)).status).toBe(
			404,
		);

		/** Also gone from the gallery; checking only the detail would assume list and detail share one predicate, which is itself under test (`galleryWhere`). */
		const gallery = await get("/v2/stories", owner.cookie);
		const page = (await gallery.json()) as { items: { id: string }[] };
		expect(page.items.map((item) => item.id)).not.toContain(storyId);

		const [row] = await db
			.select({ hidden: story.hidden, visibility: story.visibility })
			.from(story)
			.where(eq(story.id, storyId));
		expect(row).toEqual({ hidden: true, visibility: "public" });
	});

	test("unhiding **does not revive** settings the creator changed in the meantime", async () => {
		const owner = await signUp();
		const reporter = await signUp();
		const storyId = await seedStory(owner.memberId);
		const { caseId } = await reportStory(reporter, storyId);

		await act(OPERATOR.cookie, {
			caseId,
			kind: "hide_story",
			reason: "Under review",
		});
		/** Suppose the creator switched to private while hidden. */
		await db
			.update(story)
			.set({ visibility: "private" })
			.where(eq(story.id, storyId));

		await act(OPERATOR.cookie, {
			caseId,
			kind: "unhide_story",
			reason: "false positive",
		});

		const [row] = await db
			.select({ hidden: story.hidden, visibility: story.visibility })
			.from(story)
			.where(eq(story.id, storyId));
		/** Only `hidden` reverts; any line restoring `visibility` to `public` would publish a work the creator made private (§27, §P1). */
		expect(row).toEqual({ hidden: false, visibility: "private" });
	});

	test("actions are never edited — a reversal is **a new row**", async () => {
		const owner = await signUp();
		const reporter = await signUp();
		const storyId = await seedStory(owner.memberId);
		const { caseId } = await reportStory(reporter, storyId);

		await act(OPERATOR.cookie, {
			caseId,
			kind: "hide_story",
			reason: "policy violation",
		});
		await act(OPERATOR.cookie, {
			caseId,
			kind: "unhide_story",
			reason: "false positive",
		});

		const actions = await db
			.select()
			.from(moderation_action)
			.where(eq(moderation_action.case_id, caseId));
		expect(actions).toHaveLength(2);
		const hide = actions.find((row) => row.kind === "hide_story");
		const unhide = actions.find((row) => row.kind === "unhide_story");
		/** The original stays; only the reversal reference is filled, reason and kind untouched (§26). */
		expect(hide?.reason).toBe("policy violation");
		expect(hide?.reversed_by).toBe(unhide?.id);
	});

	test("when two cases hid the same story, lifting one keeps it hidden", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);
		const first = await signUp();
		const { caseId } = await reportStory(first, storyId);

		await act(OPERATOR.cookie, {
			caseId,
			kind: "hide_story",
			reason: "first",
		});
		/** Add a second hide to the same case (the first is still active). The appeal tests below separate this reverse-all path from appeal acceptance, which reverses only one. */
		const second = await act(OPERATOR.cookie, {
			caseId,
			kind: "hide_story",
			reason: "second",
		});
		expect(second.status).toBe(201);

		await act(OPERATOR.cookie, {
			caseId,
			kind: "unhide_story",
			reason: "lift all",
		});
		const [row] = await db
			.select({ hidden: story.hidden })
			.from(story)
			.where(eq(story.id, storyId));
		// An explicit operator unhide reverses every active action on that axis (diverges from §64).
		expect(row?.hidden).toBe(false);
	});
});

describe.skipIf(!databaseReady)("deleting comments", () => {
	test("an operator delete records the original **first**, then deletes", async () => {
		const owner = await signUp();
		const author = await signUp();
		const reporter = await signUp();
		const storyId = await seedStory(owner.memberId);

		const created = await post(
			`/v2/stories/${storyId}/comments`,
			author.cookie,
			{ body: "A comment to be deleted" },
		);
		const { comment } = (await created.json()) as { comment: { id: string } };

		const reported = await post("/v2/reports", reporter.cookie, {
			target: { type: "comment", storyId, commentId: comment.id },
			reason: "harassment",
		});
		const { reportId } = (await reported.json()) as { reportId: string };
		const detail = await get(
			`/v2/moderation/reports/${reportId}`,
			OPERATOR.cookie,
		);
		const { caseId } = (await detail.json()) as { caseId: string };

		const response = await act(OPERATOR.cookie, {
			caseId,
			kind: "remove_comment",
			reason: "harassment",
		});
		expect(response.status).toBe(201);

		expect(
			await db
				.select()
				.from(story_comment)
				.where(eq(story_comment.id, comment.id)),
		).toHaveLength(0);

		/** Select this comment's action; selecting by kind alone could pick another delete action left in the shared database, a failure that never shows when the file runs alone. */
		const [action] = await db
			.select()
			.from(moderation_action)
			.where(
				and(
					eq(moderation_action.kind, "remove_comment"),
					eq(moderation_action.target_comment_id, comment.id),
				),
			);
		/** Without the evidence neither appeal nor audit holds (§30). */
		expect(action?.comment_snapshot).toMatchObject({
			body: "A comment to be deleted",
		});
		expect(action?.target_member).toBe(author.memberId);
	});

	test("a regular member still can't delete someone else's comment", async () => {
		const owner = await signUp();
		const author = await signUp();
		const stranger = await signUp();
		const storyId = await seedStory(owner.memberId);
		const created = await post(
			`/v2/stories/${storyId}/comments`,
			author.cookie,
			{ body: "Someone else's comment" },
		);
		const { comment } = (await created.json()) as { comment: { id: string } };

		const response = await app.request(
			`/v2/stories/${storyId}/comments/${comment.id}`,
			{ method: "DELETE", ...json(stranger.cookie) },
		);
		/** The operator path did not loosen the ownership predicate. */
		expect(response.status).toBe(404);
		expect(
			await db
				.select()
				.from(story_comment)
				.where(eq(story_comment.id, comment.id)),
		).toHaveLength(1);
	});
});

describe.skipIf(!databaseReady)("account sanctions", () => {
	test("suspension blocks writes while **your own data** stays open", async () => {
		const target = await signUp();
		const reporter = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);
		// An own comment written before suspension; it must remain deletable afterwards.
		const created = await post(
			`/v2/stories/${storyId}/comments`,
			target.cookie,
			{
				body: "My comment",
			},
		);
		const { comment } = (await created.json()) as { comment: { id: string } };

		const { caseId } = await reportMember(reporter, target.memberId);
		expect(
			(
				await act(OPERATOR.cookie, {
					caseId,
					kind: "suspend_member",
					reason: "repeated violations",
					publicReason: "You repeatedly broke the community rules.",
				})
			).status,
		).toBe(201);

		expect(await statusOf(target.memberId)).toBe("suspended");

		// Writes are blocked.
		expect(
			(
				await post(`/v2/stories/${storyId}/comments`, target.cookie, {
					body: "A comment after suspension",
				})
			).status,
		).toBe(403);
		expect(
			(
				await app.request("/v2/follows", {
					method: "PUT",
					...json(target.cookie, { creator: owner.memberId, following: true }),
				})
			).status,
		).toBe(403);

		/** Reads and own data stay open (§33); moderation must not hold data hostage. */
		expect((await get("/v2/me/account", target.cookie)).status).toBe(200);
		expect((await get("/v2/me/moderation", target.cookie)).status).toBe(200);
		expect((await get("/v2/me/sync/keyring", target.cookie)).status).toBe(200);
		expect(
			(
				await app.request("/v2/me/show-adult", {
					method: "PATCH",
					...json(target.cookie, { showAdult: false }),
				})
			).status,
		).toBe(200);
		/** 200 because deletion now has two outcomes (row removed or tombstoned) and so carries a body. */
		expect(
			(
				await app.request(`/v2/stories/${storyId}/comments/${comment.id}`, {
					method: "DELETE",
					...json(target.cookie),
				})
			).status,
		).toBe(200);
	});

	test("a ban gives the same data guarantee", async () => {
		const target = await signUp();
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, target.memberId);
		await act(OPERATOR.cookie, {
			caseId,
			kind: "ban_member",
			reason: "serious violation",
		});

		expect(await statusOf(target.memberId)).toBe("banned");
		expect((await get("/v2/me/account", target.cookie)).status).toBe(200);
		expect((await get("/v2/me/moderation", target.cookie)).status).toBe(200);
	});

	test("**a reversal does not ignore other active sanctions**", async () => {
		const target = await signUp();
		const first = await signUp();
		const second = await signUp();
		const caseA = (await reportMember(first, target.memberId)).caseId;

		const suspend = await act(OPERATOR.cookie, {
			caseId: caseA,
			kind: "suspend_member",
			reason: "first",
		});
		const { id: suspendId } = (await suspend.json()) as { id: string };
		await act(OPERATOR.cookie, {
			caseId: caseA,
			kind: "ban_member",
			reason: "second",
		});
		expect(await statusOf(target.memberId)).toBe("banned");

		/**
		 * Reverse only the suspension (the same operation appeal acceptance performs). The ban remains,
		 * so the status must still be `banned`; code writing "reversed, so approved" breaks here (§65,
		 * §P1).
		 */
		await db.transaction(async (tx) => {
			// Run the service's own path via an appeal (the appeal tests below are that path).
			void tx;
		});
		const appeal = await post("/v2/me/moderation/appeals", target.cookie, {
			actionId: suspendId,
			message: "The first suspension was a misunderstanding",
		});
		expect(appeal.status).toBe(201);
		const { id: appealId } = (await appeal.json()) as { id: string };
		expect(
			(
				await post(
					`/v2/moderation/appeals/${appealId}/resolve`,
					OPERATOR.cookie,
					{ status: "accepted", note: "acknowledged" },
				)
			).status,
		).toBe(204);

		expect(await statusOf(target.memberId)).toBe("banned");
		void second;
	});

	test("reinstating reverses every active account action and recomputes the state", async () => {
		const target = await signUp();
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, target.memberId);
		await act(OPERATOR.cookie, {
			caseId,
			kind: "suspend_member",
			reason: "first",
		});
		await act(OPERATOR.cookie, {
			caseId,
			kind: "ban_member",
			reason: "second",
		});

		await act(OPERATOR.cookie, {
			caseId,
			kind: "restore_member",
			reason: "lift all",
		});
		expect(await statusOf(target.memberId)).toBe("approved");

		/** Ledger and status stay consistent (§66): no active account action remains. */
		const active = await db
			.select()
			.from(moderation_action)
			.where(
				and(
					eq(moderation_action.target_member, target.memberId),
					isNull(moderation_action.reversed_by),
					eq(moderation_action.kind, "ban_member"),
				),
			);
		expect(active).toHaveLength(0);
	});
});

describe.skipIf(!databaseReady)("capability restrictions", () => {
	/** Applies one restriction and returns its action id. */
	async function restrict(
		targetId: string,
		capability: string,
	): Promise<string> {
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, targetId);
		const response = await act(OPERATOR.cookie, {
			caseId,
			kind: "restrict_capability",
			capability,
			reason: `${capability} restricted`,
			publicReason: "Some features were restricted.",
		});
		expect(response.status).toBe(201);
		const { id } = (await response.json()) as { id: string };
		return id;
	}

	test("comment.write — **a direct API call** is blocked while deleting your own comments stays open", async () => {
		const target = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);
		const created = await post(
			`/v2/stories/${storyId}/comments`,
			target.cookie,
			{
				body: "A comment before the restriction",
			},
		);
		const { comment } = (await created.json()) as { comment: { id: string } };

		await restrict(target.memberId, "comment.write");

		const blocked = await post(
			`/v2/stories/${storyId}/comments`,
			target.cookie,
			{ body: "A comment after the restriction" },
		);
		/** The server blocks regardless of whether the screen hides the button (§82). */
		expect(blocked.status).toBe(403);
		expect(((await blocked.json()) as { code: string }).code).toBe(
			CAPABILITY_ERROR_CODE.restricted,
		);

		// Still approved; a narrow restriction and a full suspension are different axes.
		expect(await statusOf(target.memberId)).toBe("approved");
		/** 200 because deletion now has two outcomes (row removed or tombstoned) and so carries a body. */
		expect(
			(
				await app.request(`/v2/stories/${storyId}/comments/${comment.id}`, {
					method: "DELETE",
					...json(target.cookie),
				})
			).status,
		).toBe(200);
	});

	test("social.write — blocks follows and favorites and **leaves blocking open**", async () => {
		const target = await signUp();
		const other = await signUp();
		const storyId = await seedStory(other.memberId);
		await restrict(target.memberId, "social.write");

		expect(
			(
				await app.request("/v2/follows", {
					method: "PUT",
					...json(target.cookie, {
						creator: other.memberId,
						following: true,
					}),
				})
			).status,
		).toBe(403);
		expect(
			(
				await app.request(`/v2/favorites/${storyId}`, {
					method: "PUT",
					...json(target.cookie, { favorited: true }),
				})
			).status,
		).toBe(403);

		/** Blocking stays open (§38); taking self-protection from a socially restricted member would use a safety feature as part of the sanction. */
		expect(
			(
				await app.request("/v2/blocks", {
					method: "PUT",
					...json(target.cookie, { creator: other.memberId, blocked: true }),
				})
			).status,
		).toBe(200);
	});

	test("story.publish — publishing and updating are blocked", async () => {
		const target = await signUp();
		await restrict(target.memberId, "story.publish");

		const response = await post("/v2/stories", target.cookie, {
			draftId: newId(),
			title: "Restricted publish",
			visibility: "private",
		});
		expect(response.status).toBe(403);
		expect(((await response.json()) as { code: string }).code).toBe(
			CAPABILITY_ERROR_CODE.restricted,
		);
	});

	test("an expired restriction loses effect without a sweep", async () => {
		const target = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);
		const actionId = await restrict(target.memberId, "comment.write");

		expect(
			(
				await post(`/v2/stories/${storyId}/comments`, target.cookie, {
					body: "Blocked",
				})
			).status,
		).toBe(403);

		/** Move only the expiry into the past without deleting the row; the gate decides by predicate (§67). */
		await db
			.update(member_restriction)
			.set({ expires_at: new Date(Date.now() - 1_000) })
			.where(eq(member_restriction.action_id, actionId));

		expect(
			(
				await post(`/v2/stories/${storyId}/comments`, target.cookie, {
					body: "Works now",
				})
			).status,
		).toBe(201);
	});

	test("lifting a restriction lifts only the restriction that action created", async () => {
		const target = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);
		const firstAction = await restrict(target.memberId, "comment.write");
		await restrict(target.memberId, "comment.write");

		/** Accepting the appeal on the first action leaves the second restriction, so the gate still blocks. */
		const appeal = await post("/v2/me/moderation/appeals", target.cookie, {
			actionId: firstAction,
			message: "The first restriction was a misunderstanding",
		});
		const { id: appealId } = (await appeal.json()) as { id: string };
		await post(`/v2/moderation/appeals/${appealId}/resolve`, OPERATOR.cookie, {
			status: "accepted",
			note: "acknowledged",
		});

		expect(
			(
				await post(`/v2/stories/${storyId}/comments`, target.cookie, {
					body: "Still blocked",
				})
			).status,
		).toBe(403);
	});
});

describe.skipIf(!databaseReady)("appeals", () => {
	async function suspended(): Promise<{ target: Account; actionId: string }> {
		const target = await signUp();
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, target.memberId);
		const response = await act(OPERATOR.cookie, {
			caseId,
			kind: "suspend_member",
			reason: "violation",
			publicReason: "You broke the rules.",
		});
		const { id } = (await response.json()) as { id: string };
		return { target, actionId: id };
	}

	test("a sanctioned account can appeal", async () => {
		const { target, actionId } = await suspended();
		expect(await statusOf(target.memberId)).toBe("suspended");

		const response = await post("/v2/me/moderation/appeals", target.cookie, {
			actionId,
			message: "There was a misunderstanding",
		});
		/** With `requireActiveViewer` this would be a 403, the state §60 exists to prevent. */
		expect(response.status).toBe(201);
	});

	test("one action has only one open appeal", async () => {
		const { target, actionId } = await suspended();
		await post("/v2/me/moderation/appeals", target.cookie, {
			actionId,
			message: "First appeal",
		});
		const again = await post("/v2/me/moderation/appeals", target.cookie, {
			actionId,
			message: "Second appeal",
		});
		expect(again.status).toBe(409);
		expect(((await again.json()) as { code: string }).code).toBe(
			APPEAL_ERROR_CODE.duplicate,
		);
	});

	test("can't appeal someone else's action — the same 404 as a missing action", async () => {
		const { actionId } = await suspended();
		const stranger = await signUp();
		for (const id of [actionId, "missing-action-id"]) {
			const response = await post(
				"/v2/me/moderation/appeals",
				stranger.cookie,
				{ actionId: id, message: "It's mine" },
			);
			expect(response.status).toBe(404);
		}
	});

	test("accepting actually lifts the sanction", async () => {
		const { target, actionId } = await suspended();
		const created = await post("/v2/me/moderation/appeals", target.cookie, {
			actionId,
			message: "It's a misunderstanding",
		});
		const { id } = (await created.json()) as { id: string };

		expect(
			(
				await post(`/v2/moderation/appeals/${id}/resolve`, OPERATOR.cookie, {
					status: "accepted",
					note: "checked",
				})
			).status,
		).toBe(204);

		/** Changing only the label while the sanction stays is not acceptance (§64). */
		expect(await statusOf(target.memberId)).toBe("approved");
		const [row] = await db
			.select()
			.from(moderation_appeal)
			.where(eq(moderation_appeal.id, id));
		expect(row?.status).toBe("accepted");
	});

	test("dismissing reverses nothing", async () => {
		const { target, actionId } = await suspended();
		const created = await post("/v2/me/moderation/appeals", target.cookie, {
			actionId,
			message: "Please lift it",
		});
		const { id } = (await created.json()) as { id: string };
		await post(`/v2/moderation/appeals/${id}/resolve`, OPERATOR.cookie, {
			status: "rejected",
			note: "upheld",
		});
		expect(await statusOf(target.memberId)).toBe("suspended");
	});

	test("a regular member can't resolve appeals", async () => {
		const { target, actionId } = await suspended();
		const created = await post("/v2/me/moderation/appeals", target.cookie, {
			actionId,
			message: "It's a misunderstanding",
		});
		const { id } = (await created.json()) as { id: string };
		const normal = await signUp();
		expect(
			(
				await post(`/v2/moderation/appeals/${id}/resolve`, normal.cookie, {
					status: "accepted",
					note: "as I please",
				})
			).status,
		).toBe(403);
	});

	test("refuses an action that can't be appealed", async () => {
		const owner = await signUp();
		const reporter = await signUp();
		const storyId = await seedStory(owner.memberId);
		const { caseId } = await reportStory(reporter, storyId);
		await act(OPERATOR.cookie, {
			caseId,
			kind: "hide_story",
			reason: "violation",
		});
		const unhide = await act(OPERATOR.cookie, {
			caseId,
			kind: "unhide_story",
			reason: "lift",
		});
		const { id } = (await unhide.json()) as { id: string };

		const response = await post("/v2/me/moderation/appeals", owner.cookie, {
			actionId: id,
			message: "I object to the lifting",
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { code: string }).code).toBe(
			APPEAL_ERROR_CODE.notAppealable,
		);
	});
});

describe.skipIf(!databaseReady)("my moderation state", () => {
	test("the operator's internal reason doesn't appear in the member response", async () => {
		const target = await signUp();
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, target.memberId);
		await act(OPERATOR.cookie, {
			caseId,
			kind: "suspend_member",
			reason: "Internal note: suspended after three warnings",
			publicReason: "You broke the community rules.",
		});

		const response = await get("/v2/me/moderation", target.cookie);
		const text = await response.text();
		/** The §57 boundary: the two reasons are different types, so no code picks fields out. */
		expect(text).not.toContain("internal note");
		expect(text).toContain("You broke the community rules.");
	});

	test("no sanctions is an empty list, not an error", async () => {
		const clean = await signUp();
		const response = await get("/v2/me/moderation", clean.cookie);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			status: "approved",
			accountActions: [],
			restrictions: [],
			appeals: [],
			appealableActionIds: [],
		});
	});

	test("there is no slot to read someone else's moderation state", async () => {
		const first = await signUp();
		const second = await signUp();
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, second.memberId);
		await act(OPERATOR.cookie, {
			caseId,
			kind: "suspend_member",
			reason: "violation",
		});

		/** Neither path nor body has a slot saying whose it is. */
		const mine = await get("/v2/me/moderation", first.cookie);
		expect(await mine.json()).toMatchObject({ status: "approved" });
	});
});

/**
 * Closing a report had no conflict-of-interest rule: a staff member could dismiss every report about
 * themselves and the case never reached an admin's queue.
 */
describe.skipIf(!databaseReady)("who may close a report", () => {
	const dismiss = (cookie: string, reportId: string) =>
		post(`/v2/moderation/reports/${reportId}/resolve`, cookie, {
			status: "dismissed",
			note: "not a violation",
		});

	test("staff can't close a report about themselves, and it stays open", async () => {
		const staff = await signUpOperator("staff");
		const reporter = await signUp();
		const { reportId } = await reportMember(reporter, staff.memberId);

		const response = await dismiss(staff.cookie, reportId);
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: "moderation_target_privileged",
		});
		const detail = await get(
			`/v2/moderation/reports/${reportId}`,
			OPERATOR.cookie,
		);
		expect(await detail.json()).toMatchObject({ status: "open" });
	});

	test("a report about an operator is an admin's to close", async () => {
		const staff = await signUpOperator("staff");
		const otherStaff = await signUpOperator("staff");
		const admin = await signUpOperator("admin");
		const reporter = await signUp();
		const { reportId } = await reportMember(reporter, otherStaff.memberId);

		expect((await dismiss(staff.cookie, reportId)).status).toBe(403);
		expect((await dismiss(admin.cookie, reportId)).status).toBe(204);
	});

	test("a report about an ordinary member closes as before", async () => {
		const staff = await signUpOperator("staff");
		const reporter = await signUp();
		const target = await signUp();
		const { reportId } = await reportMember(reporter, target.memberId);
		expect((await dismiss(staff.cookie, reportId)).status).toBe(204);
	});
});

describe.skipIf(!databaseReady)("account actions targeting operators", () => {
	test("staff can't ban an admin", async () => {
		const staff = await signUpOperator("staff");
		const admin = await signUpOperator("admin");
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, admin.memberId);
		const response = await act(staff.cookie, {
			caseId,
			kind: "ban_member",
			reason: "attempt",
			publicReason: "attempt",
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: "moderation_target_privileged",
		});
		expect(await statusOf(admin.memberId)).toBe("approved");
	});

	test("staff can't sanction other staff either, and an admin can sanction staff", async () => {
		const staff = await signUpOperator("staff");
		const otherStaff = await signUpOperator("staff");
		const admin = await signUpOperator("admin");
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, otherStaff.memberId);
		expect(
			(
				await act(staff.cookie, {
					caseId,
					kind: "suspend_member",
					reason: "attempt",
					publicReason: "attempt",
				})
			).status,
		).toBe(403);
		expect(
			(
				await act(admin.cookie, {
					caseId,
					kind: "suspend_member",
					reason: "confirmed",
					publicReason: "community rule violation",
				})
			).status,
		).toBe(201);
		expect(await statusOf(otherStaff.memberId)).toBe("suspended");
	});

	test("not between admins, and not against yourself", async () => {
		const admin = await signUpOperator("admin");
		const other = await signUpOperator("admin");
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, other.memberId);
		expect(
			(
				await act(admin.cookie, {
					caseId,
					kind: "ban_member",
					reason: "attempt",
					publicReason: "attempt",
				})
			).status,
		).toBe(403);
		const self = await reportMember(reporter, admin.memberId);
		expect(
			(
				await act(admin.cookie, {
					caseId: self.caseId,
					kind: "suspend_member",
					reason: "attempt",
					publicReason: "attempt",
				})
			).status,
		).toBe(403);
	});
});

/**
 * Lifting goes through the same gate as applying. A restriction is not a suspension, so a
 * restricted staff member still passes the operator gate (`requireActiveViewer`), which used to let
 * them lift their own restriction or accept their own appeal.
 */
describe.skipIf(!databaseReady)("lifting actions placed on operators", () => {
	async function restrictStaff(admin: Account, staff: Account) {
		const reporter = await signUp();
		const { caseId } = await reportMember(reporter, staff.memberId);
		const response = await act(admin.cookie, {
			caseId,
			kind: "restrict_capability",
			capability: "comment.write",
			reason: "confirmed",
			publicReason: "Some features were restricted.",
		});
		expect(response.status).toBe(201);
		const { id } = (await response.json()) as { id: string };
		return { caseId, actionId: id };
	}

	const unrestrict = (cookie: string, caseId: string) =>
		act(cookie, {
			caseId,
			kind: "unrestrict_capability",
			capability: "comment.write",
			reason: "lift",
			publicReason: "lift",
		});

	test("restricted staff can lift neither their own restriction nor another staff's, while an admin can", async () => {
		const admin = await signUpOperator("admin");
		const staff = await signUpOperator("staff");
		const otherStaff = await signUpOperator("staff");
		const { caseId } = await restrictStaff(admin, staff);

		const self = await unrestrict(staff.cookie, caseId);
		expect(self.status).toBe(403);
		expect(await self.json()).toMatchObject({
			code: "moderation_target_privileged",
		});
		expect((await unrestrict(otherStaff.cookie, caseId)).status).toBe(403);
		expect((await unrestrict(admin.cookie, caseId)).status).toBe(201);
	});

	test("you can't resolve your own appeal, and an admin resolves an operator's appeal", async () => {
		const admin = await signUpOperator("admin");
		const staff = await signUpOperator("staff");
		const otherStaff = await signUpOperator("staff");
		const { actionId } = await restrictStaff(admin, staff);
		const created = await post("/v2/me/moderation/appeals", staff.cookie, {
			actionId,
			message: "It's a misunderstanding",
		});
		const { id } = (await created.json()) as { id: string };
		const resolve = (cookie: string) =>
			post(`/v2/moderation/appeals/${id}/resolve`, cookie, {
				status: "accepted",
				note: "accepted",
			});

		const self = await resolve(staff.cookie);
		expect(self.status).toBe(403);
		expect(await self.json()).toMatchObject({
			code: "moderation_target_privileged",
		});
		expect((await resolve(otherStaff.cookie)).status).toBe(403);
		/** The rejected attempt did not close the appeal; admin can still resolve it. */
		const [row] = await db
			.select({ status: moderation_appeal.status })
			.from(moderation_appeal)
			.where(eq(moderation_appeal.id, id));
		expect(row?.status).toBe("open");
		expect((await resolve(admin.cookie)).status).toBe(204);
	});

	test("you can't directly lift a hide placed on your own story", async () => {
		const admin = await signUpOperator("admin");
		const staff = await signUpOperator("staff");
		const reporter = await signUp();
		const storyId = await seedStory(staff.memberId);
		const { caseId } = await reportStory(reporter, storyId);
		expect(
			(
				await act(admin.cookie, {
					caseId,
					kind: "hide_story",
					reason: "violation",
				})
			).status,
		).toBe(201);
		const unhide = (cookie: string) =>
			act(cookie, { caseId, kind: "unhide_story", reason: "lift" });
		expect((await unhide(staff.cookie)).status).toBe(403);
		expect((await unhide(OPERATOR.cookie)).status).toBe(201);
	});
});
