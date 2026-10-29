import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { member, push_registration, session } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember, TEST_PASSWORD } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { cookieFromResponse, WEB_ORIGIN } from "../../test/http.ts";

/**
 * Push registration through the real Hono app and Postgres. Four things are checked, three of them
 * absences:
 *
 * ```text
 * 1. registration is bound to the authenticated session, and sign-out takes it away
 * 2. the request has no slot to choose a target
 * 3. the same installation always yields one row
 * 4. no surface answers with a list
 * ```
 *
 * The service is not called directly because the fragile spots are the gate and the contract;
 * whether ownership is pinned in the predicate is only observable over HTTP.
 */

const EMAIL_PREFIX = "me-push-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

const request = (
	method: string,
	cookie: string | null,
	body?: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/me/push/registration", {
			method,
			headers: {
				Origin: WEB_ORIGIN,
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);

const registration = (patch: Record<string, unknown> = {}) => ({
	installationId: newId(),
	platform: "ios",
	provider: "expo",
	token: `ExponentPushToken[${newId()}]`,
	...patch,
});

const rowsFor = (memberId: string) =>
	db
		.select({
			id: push_registration.id,
			sessionId: push_registration.session_id,
			installationId: push_registration.installation_id,
			token: push_registration.token,
			disabledAt: push_registration.disabled_at,
		})
		.from(push_registration)
		.where(eq(push_registration.member_id, memberId));

describe.skipIf(!databaseReady)("registration", () => {
	test("can't register without signing in", async () => {
		const response = await request("PUT", null, registration());
		expect(response.status).toBe(401);
	});

	test("registering binds it to this session", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		const body = registration();
		const response = await request("PUT", account.cookie, body);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ registered: true });

		const rows = await rowsFor(account.memberId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.installationId).toBe(body.installationId);

		const [sessionRow] = await db
			.select({ id: session.id })
			.from(session)
			.where(eq(session.id, rows[0]?.sessionId ?? ""));
		expect(sessionRow).toBeDefined();
	});

	/** A new token changes the row's value; it does not add a row. */
	test("the same install coming several times is one row", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		const installationId = newId();
		const last = `ExponentPushToken[${newId()}]`;

		await request("PUT", account.cookie, registration({ installationId }));
		await request("PUT", account.cookie, registration({ installationId }));
		await request(
			"PUT",
			account.cookie,
			registration({ installationId, token: last }),
		);

		const rows = await rowsFor(account.memberId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.token).toBe(last);
	});

	/** A turned-off registration is marked, not deleted; the same installation returning clears the mark. */
	test("a refresh revives a registration that was off", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		const installationId = newId();
		await request("PUT", account.cookie, registration({ installationId }));
		await db
			.update(push_registration)
			.set({ disabled_at: new Date() })
			.where(eq(push_registration.member_id, account.memberId));

		await request("PUT", account.cookie, registration({ installationId }));
		const rows = await rowsFor(account.memberId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.disabledAt).toBeNull();
	});
});

describe.skipIf(!databaseReady)("the request can't pick the target", () => {
	/** The `.strict()` contract rejects rather than ignores; a silent ignore would let the client believe it chose a target. */
	test("a request carrying a member or session is a 400", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		for (const extra of [
			{ memberId: "someone-else" },
			{ userId: "someone-else" },
			{ sessionId: "another-session" },
			{ recipient: "someone-else" },
		]) {
			const response = await request(
				"PUT",
				account.cookie,
				registration(extra),
			);
			expect(response.status, JSON.stringify(extra)).toBe(400);
		}
		expect(await rowsFor(account.memberId)).toHaveLength(0);
	});

	test("a malformed token never reaches storage", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		for (const token of ["", "not-a-token", "Bearer abc"]) {
			const response = await request(
				"PUT",
				account.cookie,
				registration({ token }),
			);
			expect(response.status, token).toBe(400);
		}
		expect(await rowsFor(account.memberId)).toHaveLength(0);
	});

	test("the contract filters the install id's shape too", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		const response = await request(
			"PUT",
			account.cookie,
			registration({ installationId: "my-phone" }),
		);
		expect(response.status).toBe(400);
	});
});

describe.skipIf(!databaseReady)("Disable", () => {
	test("deletes only this device's registration", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		await request("PUT", account.cookie, registration());
		expect(await rowsFor(account.memberId)).toHaveLength(1);

		const response = await request("DELETE", account.cookie);
		expect(response.status).toBe(200);
		expect(await rowsFor(account.memberId)).toHaveLength(0);
	});

	/** A retry that only lost its response must not look like a failure. */
	test("succeeds even without a registration", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		expect((await request("DELETE", account.cookie)).status).toBe(200);
		expect((await request("DELETE", account.cookie)).status).toBe(200);
	});

	test("can't turn it off without signing in", async () => {
		expect((await request("DELETE", null)).status).toBe(401);
	});
});

describe.skipIf(!databaseReady)("account switching doesn't leak", () => {
	/**
	 * The costliest defect in this slice: when Bob signs in on a device Alice signed out of, there
	 * must be no path by which that registration becomes Bob's even with the same physical token. The
	 * session cascade makes that guarantee the database's, not our code's diligence.
	 */
	test("signing out removes that device's registration", async () => {
		const alice = await createTestMember(EMAIL_PREFIX);
		await request("PUT", alice.cookie, registration());
		expect(await rowsFor(alice.memberId)).toHaveLength(1);

		const signOut = await app.request("/v2/auth/sign-out", {
			method: "POST",
			headers: { Origin: WEB_ORIGIN, Cookie: alice.cookie },
		});
		expect(signOut.status).toBe(200);

		expect(await rowsFor(alice.memberId)).toHaveLength(0);
	});

	test("another account registering with the same token doesn't become the previous person's row", async () => {
		const alice = await createTestMember(EMAIL_PREFIX);
		const bob = await createTestMember(EMAIL_PREFIX);
		const shared = registration();

		await request("PUT", alice.cookie, shared);
		await request("PUT", bob.cookie, shared);

		const aliceRows = await rowsFor(alice.memberId);
		const bobRows = await rowsFor(bob.memberId);
		expect(aliceRows).toHaveLength(1);
		expect(bobRows).toHaveLength(1);
		expect(aliceRows[0]?.id).not.toBe(bobRows[0]?.id);
		expect(aliceRows[0]?.sessionId).not.toBe(bobRows[0]?.sessionId);
	});

	/** Signing in again is a new session and so a new registration; the earlier session's row is not inherited. */
	test("signing in again is a new registration", async () => {
		const account = await createTestMember(EMAIL_PREFIX);
		const installationId = newId();
		await request("PUT", account.cookie, registration({ installationId }));
		const before = await rowsFor(account.memberId);

		await app.request("/v2/auth/sign-out", {
			method: "POST",
			headers: { Origin: WEB_ORIGIN, Cookie: account.cookie },
		});
		const signIn = await app.request("/v2/auth/sign-in/email", {
			method: "POST",
			headers: { Origin: WEB_ORIGIN, "Content-Type": "application/json" },
			body: JSON.stringify({
				email: account.email,
				password: TEST_PASSWORD,
			}),
		});
		const cookie = cookieFromResponse(signIn);
		await request("PUT", cookie, registration({ installationId }));

		const after = await rowsFor(account.memberId);
		expect(after).toHaveLength(1);
		expect(after[0]?.sessionId).not.toBe(before[0]?.sessionId);
	});
});

describe.skipIf(!databaseReady)(
	"a sanctioned member still configures their own delivery",
	() => {
		/** Why the gate is `requireViewer`: a suspended member's inbox holds the sanction reason, and receiving it on a device is not an outward interaction. */
		test("a suspended member can still register", async () => {
			const account = await createTestMember(EMAIL_PREFIX);
			await db
				.update(member)
				.set({ status: "suspended" })
				.where(eq(member.id, account.memberId));

			const response = await request("PUT", account.cookie, registration());
			expect(response.status).toBe(200);
		});
	},
);

describe.skipIf(!databaseReady)(
	"there is no surface that answers a list",
	() => {
		test("there is no GET", async () => {
			const account = await createTestMember(EMAIL_PREFIX);
			const response = await request("GET", account.cookie);
			expect(response.status).toBe(404);
		});
	},
);
