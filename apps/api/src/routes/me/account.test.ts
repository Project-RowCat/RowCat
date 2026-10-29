import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { account, member } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";

/**
 * Boundary of `GET /v2/me/account`:
 *
 * 1. Identity comes only from the request; nothing in the path can say whose account to read.
 * 2. Nothing internal leaves (auth account id, provider account id, password, tokens, session
 *    values). The whole body is scanned, because once such a value leaks it spreads to the screen,
 *    logs and caches at once.
 * 3. Restricted accounts can still read their own details; reading is not an outward write.
 *
 * Runs against real Postgres and the real Hono app: Better Auth's session and account lookups are
 * half of what is verified, and a mock would only check the shape we imitated.
 */

const EMAIL_PREFIX = "me-account-test-";

/**
 * Creates a member and returns the cookie, member id and auth account id. The final `/me` call
 * matters: the member row is created on the first request, not at signup (`ensureMember` in
 * auth/viewer.ts), and without it the status updates below hit 0 rows.
 */
const signUp = (name = "Account test") =>
	createTestMember(EMAIL_PREFIX, { name });

/**
 * Builds what social sign-in leaves behind, since the real Google OAuth round trip cannot run here.
 * That result is one account row, and our code reads it through Better Auth's `listUserAccounts`,
 * so seeding the row yields the shape a real deployment returns. `issuer` must match the format
 * Better Auth gives social accounts, which is how it finds them.
 */
const linkAccount = (
	authUserId: string,
	providerId: string,
	options: { accountId?: string; createdAt?: Date; issuer?: string } = {},
) => {
	const at = options.createdAt ?? new Date();
	return db.insert(account).values({
		id: newId(),
		accountId: options.accountId ?? `${providerId}-${authUserId}`,
		providerId,
		issuer: options.issuer ?? `local:oauth:${providerId}`,
		userId: authUserId,
		accessToken: "should-never-be-returned-access",
		refreshToken: "should-never-be-returned-refresh",
		idToken: "should-never-be-returned-id",
		createdAt: at,
		updatedAt: at,
	});
};

const setStatus = (memberId: string, status: string) =>
	db.update(member).set({ status }).where(eq(member.id, memberId));

const getAccount = (cookie?: string): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/me/account", {
			headers: cookie ? { Cookie: cookie } : {},
		}),
	);

interface AccountBody {
	email: string;
	emailVerified: boolean;
	hasPassword: boolean;
	methods: { provider: string; linkedAt: string }[];
	createdAt: string;
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady)
		// Deleting the user cascades to member, session and account.
		await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("GET /v2/me/account", () => {
	test("a guest gets 401", async () => {
		const response = await getAccount();
		expect(response.status).toBe(401);
		// Unlike `/me` (null), a guest gets no empty account.
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "login_required",
		});
	});

	test("returns a credential account's email, creation date and methods", async () => {
		const alice = await signUp();

		const response = await getAccount(alice.cookie);
		expect(response.status).toBe(200);
		const body = (await response.json()) as AccountBody;

		expect(body.email).toBe(alice.email);
		// No mailer, so nobody can complete verification; a true value means configuration changed.
		expect(body.emailVerified).toBe(false);
		expect(body.hasPassword).toBe(true);
		expect(body.methods).toEqual([
			{ provider: "credential", linkedAt: expect.any(String) },
		]);
		// Creation time of the auth account, ISO 8601 so clients parse it directly.
		expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
	});

	test("attaching a social account adds a method, in a fixed order", async () => {
		const bob = await signUp();
		await linkAccount(bob.authUserId, "google");

		const body = (await (await getAccount(bob.cookie)).json()) as AccountBody;

		/** Asserting order is the point: the DB guarantees none, so without sorting the list reshuffles on refresh. */
		expect(body.methods.map((m) => m.provider)).toEqual([
			"credential",
			"google",
		]);
		// Linking a social account does not remove the password.
		expect(body.hasPassword).toBe(true);
	});

	test("several rows of the same method fold into one and keep the earlier time", async () => {
		const carol = await signUp();
		const older = new Date("2026-01-01T00:00:00.000Z");
		const newer = new Date("2026-06-01T00:00:00.000Z");
		await linkAccount(carol.authUserId, "google", {
			accountId: `google-a-${carol.authUserId}`,
			issuer: "local:oauth:google",
			createdAt: newer,
		});
		await linkAccount(carol.authUserId, "google", {
			accountId: `google-b-${carol.authUserId}`,
			issuer: "local:oauth:google:alt",
			createdAt: older,
		});

		const body = (await (await getAccount(carol.cookie)).json()) as AccountBody;

		const google = body.methods.filter((m) => m.provider === "google");
		expect(google).toHaveLength(1);
		// What the user wants to know is since when they have had this method.
		expect(google[0]?.linkedAt).toBe(older.toISOString());
	});

	/**
	 * A provider outside the contract vocabulary must not break the whole account screen. A 500 would
	 * stop users from confirming their email or signing out because of deployment drift. The list is
	 * read-only guidance, so the dropped entry breaks nothing, and the entitlement check
	 * (`hasPassword`) reads the raw data and stays accurate.
	 *
	 * The value used here was `kakao` for a while, until Kakao entered the vocabulary; `naver`
	 * replaced it. What matters is a `providerId` outside the vocabulary, not a particular provider:
	 * when a method is added, check this test too, or it silently stops testing anything.
	 */
	test("a provider not in the vocabulary drops out of the list and the rest stay", async () => {
		const dave = await signUp();
		await linkAccount(dave.authUserId, "naver");

		const body = (await (await getAccount(dave.cookie)).json()) as AccountBody;

		expect(body.methods.map((m) => m.provider)).toEqual(["credential"]);
		expect(body.hasPassword).toBe(true);
	});

	/**
	 * Scans the whole body as a string. Checking field names would miss values nested elsewhere; the
	 * actual secret values must appear nowhere.
	 */
	test("no auth internals anywhere in the response", async () => {
		const erin = await signUp();
		await linkAccount(erin.authUserId, "google", {
			accountId: `google-secret-${erin.authUserId}`,
		});

		const response = await getAccount(erin.cookie);
		const raw = await response.text();
		const body = JSON.parse(raw) as AccountBody;

		for (const secret of [
			erin.authUserId,
			`google-secret-${erin.authUserId}`,
			"should-never-be-returned-access",
			"should-never-be-returned-refresh",
			"should-never-be-returned-id",
			"local:oauth:google",
		])
			expect(raw).not.toContain(secret);

		// Likewise the session token: a value that came in by cookie must not come back in the body.
		const sessionToken = erin.cookie.split("session_token=")[1]?.split(";")[0];
		expect(sessionToken).toBeTruthy();
		expect(raw).not.toContain(decodeURIComponent(sessionToken ?? "x"));

		// Nothing beyond the contract's fields.
		expect(Object.keys(body).sort()).toEqual([
			"createdAt",
			"email",
			"emailVerified",
			"hasPassword",
			"methods",
			"twoFactorEnabled",
		]);
		for (const method of body.methods)
			expect(Object.keys(method).sort()).toEqual(["linkedAt", "provider"]);
	});

	/**
	 * If restricted accounts cannot reach their own account screen, a suspended person can neither
	 * check their status nor see their personal data. That was a real legacy defect, so both states
	 * are pinned.
	 */
	test.each([
		"suspended",
		"banned",
	])("a %s member can read it too", async (status) => {
		const frank = await signUp();
		await setStatus(frank.memberId, status);

		const response = await getAccount(frank.cookie);
		expect(response.status).toBe(200);
		expect(((await response.json()) as AccountBody).email).toBe(frank.email);
	});

	/**
	 * Actually tries to name another account to confirm there is no place to do so. The query string
	 * is ignored and the result is always the requester's.
	 */
	test("naming someone else in the query still returns your own account", async () => {
		const [alice, bob] = await Promise.all([signUp(), signUp()]);

		const response = await app.request(
			`/v2/me/account?userId=${encodeURIComponent(bob.authUserId)}&memberId=${encodeURIComponent(bob.memberId)}&email=${encodeURIComponent(bob.email)}`,
			{ headers: { Cookie: alice.cookie } },
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as AccountBody;
		expect(body.email).toBe(alice.email);
		expect(body.email).not.toBe(bob.email);
	});

	/** Member row and auth account are different identities, and the contract leaks neither id. */
	test("the response has neither a member id nor an auth account id", async () => {
		const grace = await signUp();
		const raw = await (await getAccount(grace.cookie)).text();
		expect(raw).not.toContain(grace.memberId);
		expect(raw).not.toContain(grace.authUserId);

		// The two ids differ (if equal, product ownership would be tied to the auth implementation).
		const [row] = await db
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.user_id, grace.authUserId),
					eq(member.id, grace.memberId),
				),
			);
		expect(row?.id).toBe(grace.memberId);
		expect(grace.memberId).not.toBe(grace.authUserId);
	});
});
