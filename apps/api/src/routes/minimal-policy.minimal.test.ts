import {
	ADULT_VERIFICATION_ERROR_CODE,
	GUARDIAN_ERROR_CODE,
} from "@rowcat/contracts";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import {
	identity_verification,
	member,
	moderation_case,
	story,
} from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import { createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * The deployment a fork gets from the two required secrets alone: no identity verifier and the age
 * gate off (`vitest.minimal.config.ts`). The default config always runs with the `dev` verifier, so
 * without this file the configuration most self-hosted instances actually run had no route test.
 *
 * What each case pins is a fail-closed promise that would otherwise only hold by reading code:
 * nobody becomes verified, adult or guardian-approved without a verifier; adult works stay hidden;
 * and what does not depend on verification (sign-up, all-ages content, reporting, moderation, the
 * operator's manual adult grant) still works.
 */

const EMAIL_PREFIX = "minimal-policy-test-";

const request = (
	path: string,
	cookie: string | null,
	init: { method?: string; body?: unknown; origin?: string } = {},
) =>
	Promise.resolve(
		app.request(path, {
			method: init.method ?? (init.body === undefined ? "GET" : "POST"),
			headers: {
				Origin: init.origin ?? WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
				...(init.body === undefined
					? {}
					: { "Content-Type": "application/json" }),
			},
			...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
		}),
	);

const signUp = (name = "Minimal") => createTestMember(EMAIL_PREFIX, { name });
const operator = async (role: "staff" | "admin") => {
	const account = await signUp(`Operator ${role}`);
	await db.update(member).set({ role }).where(eq(member.id, account.memberId));
	return account;
};

const viewerOf = async (cookie: string) =>
	(await (await request("/v2/me", cookie)).json()) as {
		id: string;
		verified: boolean;
		adult: boolean;
		showAdult: boolean;
		membershipGate: string | null;
	};

const yearsAgo = (years: number): string => {
	const now = new Date(Date.now() + 9 * 60 * 60_000);
	return new Date(
		Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
	)
		.toISOString()
		.slice(0, 10);
};

const created: string[] = [];
const cases: string[] = [];
async function seedStory(ownerId: string, adult: boolean): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: adult ? "Minimal adult" : "Minimal all-ages",
		author: "Test",
		description: "",
		visibility: "public",
		adult,
	});
	created.push(id);
	return id;
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) {
		if (cases.length)
			await db
				.delete(moderation_case)
				.where(inArray(moderation_case.id, cases));
		if (created.length)
			await db.delete(story).where(inArray(story.id, created));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("minimal configuration — no verifier", () => {
	test("sign-up opens the account with no gate, unverified and not adult", async () => {
		const { cookie } = await signUp();
		const viewer = await viewerOf(cookie);
		expect(viewer).toMatchObject({
			membershipGate: null,
			verified: false,
			adult: false,
			showAdult: false,
		});
	});

	test("a member's own adult check is a 503 and leaves no attempt behind", async () => {
		const { cookie, memberId } = await signUp();
		const response = await request("/v2/me/adult-verification", cookie, {
			body: {},
		});
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			code: ADULT_VERIFICATION_ERROR_CODE.unavailable,
		});
		const attempts = await db
			.select({ id: identity_verification.id })
			.from(identity_verification)
			.where(eq(identity_verification.member_id, memberId));
		expect(attempts).toEqual([]);
		expect(await viewerOf(cookie)).toMatchObject({
			verified: false,
			adult: false,
		});
	});

	/**
	 * Refused at the first step: no consent link is issued at all, so there is no half-finished
	 * request for a guardian to open and no path that records consent without verification.
	 */
	test("an under-14 member cannot start a guardian consent request — 503, no link issued", async () => {
		const { cookie } = await signUp();
		expect(
			(
				await request("/v2/me/membership/age", cookie, {
					body: { birthDate: yearsAgo(10) },
				})
			).status,
		).toBe(200);
		const started = await request("/v2/me/membership/guardian", cookie, {
			body: {},
		});
		expect(started.status).toBe(503);
		const body = (await started.json()) as Record<string, unknown>;
		expect(body).toMatchObject({
			code: GUARDIAN_ERROR_CODE.verifierUnavailable,
		});
		expect(body).not.toHaveProperty("consentPath");
	});

	test("adult works stay hidden from an unverified member, all-ages ones are served", async () => {
		const owner = await signUp();
		const viewer = await signUp();
		const adultId = await seedStory(owner.memberId, true);
		const allAgesId = await seedStory(owner.memberId, false);

		expect(
			(await request(`/v2/stories/${allAgesId}`, viewer.cookie)).status,
		).toBe(200);
		expect(
			(await request(`/v2/stories/${adultId}`, viewer.cookie)).status,
		).toBe(404);
		expect((await request(`/v2/stories/${adultId}`, null)).status).toBe(404);
		const showAdult = await request("/v2/me/show-adult", viewer.cookie, {
			method: "PATCH",
			body: { showAdult: true },
		});
		expect(showAdult.ok).toBe(false);
	});

	/**
	 * With no verifier the one path to adult viewing is an operator's grant, recorded in the audit
	 * log — the deployment's own responsibility, and the reason FORKING.md says so.
	 */
	test("an admin's manual grant is the one path to adult viewing", async () => {
		const owner = await signUp();
		const viewer = await signUp();
		const admin = await operator("admin");
		const adultId = await seedStory(owner.memberId, true);

		const granted = await request(
			`/v2/admin/members/${viewer.memberId}/adult-verification`,
			admin.cookie,
			{
				body: { verified: true, adult: true, reason: "checked in person" },
			},
		);
		expect(granted.status).toBe(200);
		expect(
			(
				await request("/v2/me/show-adult", viewer.cookie, {
					method: "PATCH",
					body: { showAdult: true },
				})
			).ok,
		).toBe(true);
		expect(
			(await request(`/v2/stories/${adultId}`, viewer.cookie)).status,
		).toBe(200);
	});

	test("reporting and moderation do not depend on verification", async () => {
		const owner = await signUp();
		const reporter = await signUp();
		const staff = await operator("staff");
		const storyId = await seedStory(owner.memberId, false);

		const filed = await request("/v2/reports", reporter.cookie, {
			body: { target: { type: "story", storyId }, reason: "spam" },
		});
		expect(filed.status).toBe(201);
		const { reportId } = (await filed.json()) as { reportId: string };
		const detail = await request(
			`/v2/moderation/reports/${reportId}`,
			staff.cookie,
		);
		const { caseId } = (await detail.json()) as { caseId: string };
		cases.push(caseId);

		const hidden = await request("/v2/moderation/actions", staff.cookie, {
			body: {
				caseId,
				kind: "hide_story",
				reason: "test",
				publicReason: "Hidden for breaking the rules.",
			},
		});
		expect(hidden.status).toBe(201);
		expect((await request(`/v2/stories/${storyId}`, null)).status).toBe(404);
	});
});
