import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { guardian_consent, member, story, user } from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import {
	resetDevIdentityOutcome,
	setDevIdentityOutcome,
} from "../services/identity/provider.ts";

import { createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * Under-14 membership eligibility, from age declaration to guardian consent, over real HTTP. Each
 * target is a defect whose success response looks identical:
 *
 * 1. A child cannot create their own consent. A session can create only a request; consent is
 *    confirmed only after identity verification. If this fails the whole procedure is a formality.
 * 2. Replay and races do not flip state: a second approval of one token, an old link invalidated
 *    by a new request, two concurrent requests.
 * 3. Child restrictions hold against direct calls; hiding a button is not authorization.
 * 4. Private values do not leak. The guardian response's whole key set is counted, because
 *    `not.toHaveProperty` would keep passing the day a column is added.
 * 5. Account deletion removes consent records and open links together.
 *
 * Runs against real Postgres and the real Hono app: the partial unique index and conditional UPDATE
 * are the final authority here, and calling service functions alone would leave the fragile spots
 * outside the test. The age gate switch is off (`vitest.config.ts`); its priority is covered by the
 * pure-function matrix in `@rowcat/domain`'s `membership.test.ts`, so this file covers what is
 * switch-independent: the declaration endpoint, the guardian procedure and child restrictions.
 */

const EMAIL_PREFIX = "membership-test-";

/** The key set the guardian screen actually receives; this test breaks first if one is added. */
const GUARDIAN_VIEW_KEYS = ["expiresAt", "status", "verified"];

interface Person {
	cookie: string;
	memberId: string;
	email: string;
}

interface ViewerBody {
	id: string;
	ageStatus: string;
	membershipGate: string | null;
	verified: boolean;
	adult: boolean;
	showAdult: boolean;
}

const signUp = (name = "Membership test") =>
	createTestMember(EMAIL_PREFIX, { name });

const post = (
	path: string,
	cookie?: string | null,
	body?: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(path, {
			method: "POST",
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}),
	);

const readViewer = async (cookie: string): Promise<ViewerBody> =>
	(await (
		await app.request("/v2/me", {
			headers: { Origin: WEB_ORIGIN, Cookie: cookie },
		})
	).json()) as ViewerBody;

/** A date N years before today, the shortest way to make a child or an adult. */
const yearsAgo = (years: number): string => {
	const now = new Date(Date.now() + 9 * 60 * 60_000);
	return new Date(
		Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
	)
		.toISOString()
		.slice(0, 10);
};

const declareAge = (cookie: string, birthDate: string) =>
	post("/v2/me/membership/age", cookie, { birthDate });

interface CreatedRequest {
	consentPath: string;
	expiresAt: string;
	state: { status: string | null; required: boolean };
}

/** A child member plus the guardian consent link that member created. */
async function childWithRequest(): Promise<{
	person: Person;
	token: string;
	created: CreatedRequest;
}> {
	const person = await signUp();
	expect((await declareAge(person.cookie, yearsAgo(10))).status).toBe(200);
	const response = await post("/v2/me/membership/guardian", person.cookie);
	expect(response.status).toBe(200);
	const created = (await response.json()) as CreatedRequest;
	const token = created.consentPath.replace("/guardian/", "");
	return { person, token, created };
}

/**
 * Walks the guardian procedure end to end through the same two endpoints production uses (there is
 * no dev-only route). The dev verifier returns the redirect-back address instead of opening a
 * window, and the confirm request has no body: the server stored which verification attempt it is
 * at the start step.
 */
async function verifyGuardian(token: string): Promise<Response> {
	const started = await post(`/v2/guardian/${token}/verification`);
	expect(started.status).toBe(200);
	const handoff = (await started.json()) as { kind: string };
	expect(handoff.kind).toBe("redirect");
	return post(`/v2/guardian/${token}/verify`);
}

const approveGuardian = (token: string) =>
	post(`/v2/guardian/${token}/consent`, null, { agreed: true });

const databaseReady = await connectTestDatabase();

afterEach(() => resetDevIdentityOutcome());

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("age declaration", () => {
	test("14 and over become standard on declaration and keep no transition date", async () => {
		const person = await signUp();
		const response = await declareAge(person.cookie, yearsAgo(30));
		expect(response.status).toBe(200);

		const viewer = (await response.json()) as ViewerBody;
		expect(viewer.ageStatus).toBe("standard");

		const [row] = await db
			.select({
				status: member.age_status,
				threshold: member.age_threshold_date,
				recordedAt: member.age_recorded_at,
			})
			.from(member)
			.where(eq(member.id, person.memberId))
			.limit(1);
		expect(row?.status).toBe("standard");
		/** Members 14 and over keep nothing: neither the birth date nor the transition date. */
		expect(row?.threshold).toBeNull();
		expect(row?.recordedAt).toBeInstanceOf(Date);
	});

	test("under 14 become child and keep only the transition date", async () => {
		const person = await signUp();
		const viewer = (await (
			await declareAge(person.cookie, yearsAgo(9))
		).json()) as ViewerBody;
		expect(viewer.ageStatus).toBe("child");
		expect(viewer.membershipGate).toBe("guardian_consent_required");

		const [row] = await db
			.select({ threshold: member.age_threshold_date })
			.from(member)
			.where(eq(member.id, person.memberId))
			.limit(1);
		expect(row?.threshold).toBe(yearsAgo(-5));
	});

	test("future dates and malformed values are a 400", async () => {
		const person = await signUp();
		for (const value of ["2999-01-01", "2026-02-30", "not-a-date", ""])
			expect((await declareAge(person.cookie, value)).status).toBe(400);
	});

	test("a guest gets 401", async () => {
		expect((await declareAge("", yearsAgo(30))).status).toBe(401);
	});

	/**
	 * Verifies the gate is `requireViewer`: a suspended member must still be able to declare age, or a
	 * sanctioned person is trapped at the entry gate and can neither appeal nor delete the account.
	 */
	test("a suspended member can still declare their age", async () => {
		const person = await signUp();
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, person.memberId));
		expect((await declareAge(person.cookie, yearsAgo(30))).status).toBe(200);
	});

	/** A mistaken declaration can be corrected by the person, and that includes the direction that adds protection. */
	test("declaring again can correct it to child", async () => {
		const person = await signUp();
		await declareAge(person.cookie, yearsAgo(30));
		const viewer = (await (
			await declareAge(person.cookie, yearsAgo(8))
		).json()) as ViewerBody;
		expect(viewer.ageStatus).toBe("child");
	});
});

describe.skipIf(!databaseReady)("guardian consent — the normal path", () => {
	test("verification → consent opens the account", async () => {
		const { person, token } = await childWithRequest();

		expect((await verifyGuardian(token)).status).toBe(200);
		const approved = await approveGuardian(token);
		expect(approved.status).toBe(200);
		expect((await approved.json()) as { status: string }).toMatchObject({
			status: "approved",
		});

		const viewer = await readViewer(person.cookie);
		expect(viewer.membershipGate).toBeNull();
	});

	test("the token is in the response that created the request only, not in status lookups", async () => {
		const { person, created } = await childWithRequest();
		expect(created.consentPath).toMatch(/^\/guardian\/.+/);

		const state = await app.request("/v2/me/membership/guardian", {
			headers: { Origin: WEB_ORIGIN, Cookie: person.cookie },
		});
		const body = (await state.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual([
			"approvedAt",
			"expiresAt",
			"required",
			"status",
		]);
		expect(JSON.stringify(body)).not.toContain(
			created.consentPath.replace("/guardian/", ""),
		);
	});

	/** The server keeps only the hash, so one DB dump is not every open consent link. */
	test("the raw token is not stored in the DB", async () => {
		const { person, created } = await childWithRequest();
		const token = created.consentPath.replace("/guardian/", "");
		const [row] = await db
			.select({ hash: guardian_consent.token_hash })
			.from(guardian_consent)
			.where(eq(guardian_consent.member_id, person.memberId))
			.limit(1);
		expect(row?.hash).toBeTruthy();
		expect(row?.hash).not.toBe(token);
		expect(row?.hash).toMatch(/^[0-9a-f]{64}$/);
	});

	/** The guardian screen's projection boundary: no value identifies the child. */
	test("the guardian response has neither the child nor the guardian's identity", async () => {
		const { token } = await childWithRequest();
		await verifyGuardian(token);
		const view = await app.request(`/v2/guardian/${token}`, {
			headers: { Origin: WEB_ORIGIN },
		});
		const body = (await view.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(GUARDIAN_VIEW_KEYS);
	});
});

describe.skipIf(!databaseReady)("guardian consent — refusals and races", () => {
	test("consenting without verification is a 409", async () => {
		const { token } = await childWithRequest();
		const response = await approveGuardian(token);
		expect(response.status).toBe(409);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "guardian_verification_required",
		});
	});

	/** Even the child's own session cannot confirm their consent; the path has no slot for it. */
	test("even with the child's cookie, consent doesn't happen without verification", async () => {
		const { person, token } = await childWithRequest();
		const response = await post(
			`/v2/guardian/${token}/consent`,
			person.cookie,
			{ agreed: true },
		);
		expect(response.status).toBe(409);
	});

	/**
	 * The client cannot choose the verification attempt. Whatever the body carries, the server looks
	 * up only the reference it stored; otherwise someone else's attempt could be attached to this
	 * request.
	 */
	test("the verification request's body is ignored", async () => {
		const { token } = await childWithRequest();
		await post(`/v2/guardian/${token}/verification`);

		const response = await post(`/v2/guardian/${token}/verify`, null, {
			result: "dev-someone-elses-request",
			identityVerificationId: "someone-elses-verification",
		});
		expect(response.status).toBe(200);
		expect((await response.json()) as { verified: boolean }).toMatchObject({
			verified: true,
		});
	});

	/** A request that skipped the start step cannot be confirmed: with no stored reference there is nothing to re-ask. */
	test("submitting only verification without starting is refused", async () => {
		const { token } = await childWithRequest();
		const response = await post(`/v2/guardian/${token}/verify`);
		expect(response.status).toBe(400);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "guardian_verification_failed",
		});
	});

	test("a second consent with the same token is a 409 (replay defence)", async () => {
		const { token } = await childWithRequest();
		await verifyGuardian(token);
		expect((await approveGuardian(token)).status).toBe(200);

		const replay = await approveGuardian(token);
		expect(replay.status).toBe(409);
		expect((await replay.json()) as { code: string }).toMatchObject({
			code: "guardian_request_already_resolved",
		});
	});

	test("an unknown token is a 404", async () => {
		expect(
			(
				await app.request("/v2/guardian/not-a-real-token", {
					headers: { Origin: WEB_ORIGIN },
				})
			).status,
		).toBe(404);
	});

	test("repeating an unknown token creates no key in the rate-limit store", async () => {
		for (let attempt = 0; attempt < 11; attempt++) {
			const response = await post("/v2/guardian/not-a-real-token/verify");
			expect(response.status).toBe(404);
		}
	});

	test("only valid attempts that call the real provider are blocked after 10, with Retry-After", async () => {
		const { token } = await childWithRequest();
		await post(`/v2/guardian/${token}/verification`);
		setDevIdentityOutcome("failed");

		for (let attempt = 0; attempt < 10; attempt++)
			expect((await post(`/v2/guardian/${token}/verify`)).status).toBe(400);

		const blocked = await post(`/v2/guardian/${token}/verify`);
		expect(blocked.status).toBe(429);
		expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
	});

	test("an expired request is a 410 with its own reason", async () => {
		const { person, token } = await childWithRequest();
		await db
			.update(guardian_consent)
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where(eq(guardian_consent.member_id, person.memberId));

		const response = await post(`/v2/guardian/${token}/verification`);
		expect(response.status).toBe(410);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "guardian_request_expired",
		});
	});

	/**
	 * A new request kills the old link. The server keeps only the hash and cannot show the old link
	 * again, so telling someone who lost it "one already exists, use that" would be a dead end.
	 */
	test("creating a new request kills the previous link", async () => {
		const { person, token: first } = await childWithRequest();
		const second = (await (
			await post("/v2/me/membership/guardian", person.cookie)
		).json()) as CreatedRequest;

		expect(
			(
				await app.request(`/v2/guardian/${first}`, {
					headers: { Origin: WEB_ORIGIN },
				})
			).status,
		).toBe(200);
		const revoked = (await (
			await app.request(`/v2/guardian/${first}`, {
				headers: { Origin: WEB_ORIGIN },
			})
		).json()) as { status: string };
		expect(revoked.status).toBe("revoked");

		const alive = second.consentPath.replace("/guardian/", "");
		expect((await verifyGuardian(alive)).status).toBe(200);
	});

	/** One open request per member; the partial unique index is the final authority. */
	test("creating two requests at once still leaves only one open request", async () => {
		const person = await signUp();
		await declareAge(person.cookie, yearsAgo(10));

		await Promise.allSettled([
			post("/v2/me/membership/guardian", person.cookie),
			post("/v2/me/membership/guardian", person.cookie),
		]);

		const open = await db
			.select({ id: guardian_consent.id })
			.from(guardian_consent)
			.where(
				and(
					eq(guardian_consent.member_id, person.memberId),
					eq(guardian_consent.status, "pending"),
				),
			);
		expect(open.length).toBeLessThanOrEqual(1);
	});

	test("when the guardian declines the account stays and a new request can be made", async () => {
		const { person, token } = await childWithRequest();
		await verifyGuardian(token);
		expect((await post(`/v2/guardian/${token}/decline`)).status).toBe(200);

		const viewer = await readViewer(person.cookie);
		expect(viewer.membershipGate).toBe("guardian_consent_required");
		expect(
			(await post("/v2/me/membership/guardian", person.cookie)).status,
		).toBe(200);
	});

	test("14 and over can't create a guardian request", async () => {
		const person = await signUp();
		await declareAge(person.cookie, yearsAgo(30));
		const response = await post("/v2/me/membership/guardian", person.cookie);
		expect(response.status).toBe(409);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "guardian_consent_not_required",
		});
	});

	/**
	 * An approval after the account is gone opens nothing: the FK cascade already deleted the row, so
	 * the token gets the same 404 as an unknown one (existence hiding holds).
	 */
	test("when the account is deleted the open link becomes a 404", async () => {
		const { person, token } = await childWithRequest();
		await verifyGuardian(token);
		await db.delete(user).where(eq(user.email, person.email));

		expect(
			(
				await app.request(`/v2/guardian/${token}`, {
					headers: { Origin: WEB_ORIGIN },
				})
			).status,
		).toBe(404);
		expect((await approveGuardian(token)).status).toBe(404);
	});
});

describe.skipIf(!databaseReady)(
	"child restriction — a direct call doesn't get through either",
	() => {
		/** Makes a child with all three adult axes on, the worst representable combination. */
		async function corruptChild(): Promise<Person> {
			const person = await signUp();
			await declareAge(person.cookie, yearsAgo(10));
			await db
				.update(member)
				.set({ verified: true, adult: true, show_adult: true })
				.where(eq(member.id, person.memberId));
			return person;
		}

		test("the adult filter refuses even with all three adult axes on", async () => {
			const person = await corruptChild();
			const response = await app.request("/v2/stories?rating=adult", {
				headers: { Origin: WEB_ORIGIN, Cookie: person.cookie },
			});
			expect(response.status).toBe(403);
			expect((await response.json()) as { code: string }).toMatchObject({
				code: "minor_adult_restricted",
			});
		});

		test("an adult story's detail is a 404", async () => {
			const person = await corruptChild();
			const owner = await signUp();
			const storyId = newId();
			await db.insert(story).values({
				id: storyId,
				owner: owner.memberId,
				title: "Adult test",
				author: "Test",
				description: "",
				visibility: "public",
				adult: true,
			});

			const response = await app.request(`/v2/stories/${storyId}`, {
				headers: { Origin: WEB_ORIGIN, Cookie: person.cookie },
			});
			expect(response.status).toBe(404);
		});

		test("can't turn on the adult display opt-in", async () => {
			const person = await corruptChild();
			const response = await app.request("/v2/me/show-adult", {
				method: "PATCH",
				headers: {
					Origin: WEB_ORIGIN,
					Cookie: person.cookie,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ showAdult: true }),
			});
			expect(response.status).toBe(403);
			expect((await response.json()) as { code: string }).toMatchObject({
				code: "minor_adult_restricted",
			});
		});

		/** Turning it off is always open; it only reduces what the person sees. */
		test("turning the adult display off is allowed", async () => {
			const person = await corruptChild();
			const response = await app.request("/v2/me/show-adult", {
				method: "PATCH",
				headers: {
					Origin: WEB_ORIGIN,
					Cookie: person.cookie,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ showAdult: false }),
			});
			expect(response.status).toBe(200);
		});

		/** A child loses only two things (adult, BYO); managed conversation and public browsing stay. */
		test("the all-ages gallery and personalized lookups work as is", async () => {
			const person = await corruptChild();
			for (const path of ["/v2/stories", "/v2/me/state", "/v2/me/account"])
				expect(
					(
						await app.request(path, {
							headers: { Origin: WEB_ORIGIN, Cookie: person.cookie },
						})
					).status,
				).toBe(200);
		});
	},
);

describe.skipIf(!databaseReady)("deletion", () => {
	test("in-progress requests and confirmed consents disappear together", async () => {
		for (const stage of ["pending", "verified", "approved"] as const) {
			const { person, token } = await childWithRequest();
			if (stage !== "pending") await verifyGuardian(token);
			if (stage === "approved") await approveGuardian(token);

			await db.delete(user).where(eq(user.email, person.email));

			const rows = await db
				.select({ id: guardian_consent.id })
				.from(guardian_consent)
				.where(eq(guardian_consent.member_id, person.memberId));
			expect(rows, `a consent record remained at stage ${stage}`).toEqual([]);
		}
	});

	test("expired requests disappear too", async () => {
		const { person } = await childWithRequest();
		await db
			.update(guardian_consent)
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where(eq(guardian_consent.member_id, person.memberId));

		await db.delete(user).where(eq(user.email, person.email));
		const rows = await db
			.select({ id: guardian_consent.id })
			.from(guardian_consent)
			.where(eq(guardian_consent.member_id, person.memberId));
		expect(rows).toEqual([]);
	});
});
