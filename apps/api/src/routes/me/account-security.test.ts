import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { account, session } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember, TEST_PASSWORD } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import {
	apiGet,
	apiPost,
	authPost,
	cookieFromResponse,
} from "../../test/http.ts";

/**
 * Account security: can a forbidden state be created?
 *
 * What is locked here is not the screen's disabled button (a courtesy) but whether a direct API
 * call gets the same answer. Four things are checked:
 *
 * ```text
 * 1. can an account with zero login methods be created   (it must not)
 * 2. is the password trimmed or normalized               (it must not)
 * 3. do session tokens leave in a response               (they must not)
 * 4. can someone else's session, method or password be touched   (it must not)
 * ```
 *
 * It runs against real Postgres and the real Hono app: half of what is verified is Better Auth's
 * session and account lifecycle, and mocks would only confirm a shape we imitated.
 */

const EMAIL_PREFIX = "me-account-security-test-";

interface AccountBody {
	email: string;
	hasPassword: boolean;
	methods: { provider: string; linkedAt: string }[];
}

interface SessionsBody {
	sessions: {
		id: string;
		current: boolean;
		createdAt: string;
		expiresAt: string;
	}[];
}

/**
 * One member. The final `/me` call matters: the member row is created on the first request, not at
 * signup (auth/viewer.ts `ensureMember`), and without it the assertions below would confirm
 * "nothing exists yet" instead of "no duplicate".
 */
const signUp = () => createTestMember(EMAIL_PREFIX, { name: "Security test" });

/** Signs in to the same account from a second device, creating one more session. */
async function signIn(
	email: string,
	password = TEST_PASSWORD,
): Promise<Response> {
	return authPost("/sign-in/email", { email, password });
}

/**
 * Creates what the OAuth round trip leaves behind.
 *
 * The real Google round trip cannot run here (it needs a browser and Google), so the resulting
 * account row is inserted, as `credentials.test.ts` does. The issuer format must match what Better
 * Auth puts on social accounts, or the library would not treat the row as its own.
 */
async function linkGoogle(authUserId: string): Promise<void> {
	const now = new Date();
	await db.insert(account).values({
		id: newId(),
		accountId: `google-${authUserId}`,
		providerId: "google",
		issuer: "local:oauth:google",
		userId: authUserId,
		createdAt: now,
		updatedAt: now,
	});
}

/** Removes the credential row to make an account that signed up with Google only. */
async function dropCredential(authUserId: string): Promise<void> {
	await db
		.delete(account)
		.where(
			and(eq(account.userId, authUserId), eq(account.providerId, "credential")),
		);
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("password", () => {
	test("a credential account can change its password, and the old password is blocked", async () => {
		const alice = await signUp();
		const next = "brand-new-passphrase-01";

		const changed = await authPost(
			"/change-password",
			{ currentPassword: TEST_PASSWORD, newPassword: next },
			alice.cookie,
		);
		expect(changed.status).toBe(200);

		expect((await signIn(alice.email, TEST_PASSWORD)).status).not.toBe(200);
		expect((await signIn(alice.email, next)).status).toBe(200);
	});

	/**
	 * After a rejection for a wrong current password, the original password must still work. A failed
	 * change that damaged the credential would leave the account unable to sign in with anything.
	 */
	test("a wrong current password changes nothing", async () => {
		const bob = await signUp();

		const rejected = await authPost(
			"/change-password",
			{
				currentPassword: "not-the-password",
				newPassword: "another-passphrase",
			},
			bob.cookie,
		);
		expect(rejected.status).not.toBe(200);

		expect((await signIn(bob.email, TEST_PASSWORD)).status).toBe(200);
		expect((await signIn(bob.email, "another-passphrase")).status).not.toBe(
			200,
		);
	});

	test("a Google-only account can set a password", async () => {
		const carol = await signUp();
		await linkGoogle(carol.authUserId);
		await dropCredential(carol.authUserId);

		const before = (await (
			await apiGet("/me/account", carol.cookie)
		).json()) as AccountBody;
		expect(before.hasPassword).toBe(false);
		expect(before.methods.map((m) => m.provider)).toEqual(["google"]);

		const set = await apiPost(
			"/me/account/password",
			{ newPassword: "set-by-oauth-user-01" },
			carol.cookie,
		);
		expect(set.status).toBe(200);

		const after = (await set.json()) as AccountBody;
		expect(after.hasPassword).toBe(true);
		expect(after.methods.map((m) => m.provider)).toEqual([
			"credential",
			"google",
		]);

		// Can that password actually sign in? This, not the response boolean, is the evidence.
		expect((await signIn(carol.email, "set-by-oauth-user-01")).status).toBe(
			200,
		);
	});

	/**
	 * Calling set on an account that already has a password is rejected. Quietly turning it into a
	 * change would replace the password without confirming the current one, and someone holding a
	 * stolen session would take the account that way.
	 */
	test("setting is refused when a password already exists", async () => {
		const dave = await signUp();
		const response = await apiPost(
			"/me/account/password",
			{ newPassword: "should-not-be-applied" },
			dave.cookie,
		);
		expect(response.status).toBe(400);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "password_already_set",
		});
		// The original password is unchanged.
		expect((await signIn(dave.email, TEST_PASSWORD)).status).toBe(200);
		expect((await signIn(dave.email, "should-not-be-applied")).status).not.toBe(
			200,
		);
	});

	/** A second submission does not corrupt state; the first one stays the winner. */
	test("sending a set twice does not break the state", async () => {
		const erin = await signUp();
		await linkGoogle(erin.authUserId);
		await dropCredential(erin.authUserId);

		const [first, second] = await Promise.all([
			apiPost(
				"/me/account/password",
				{ newPassword: "first-attempt-secret" },
				erin.cookie,
			),
			apiPost(
				"/me/account/password",
				{ newPassword: "second-attempt-secret" },
				erin.cookie,
			),
		]);
		// Exactly one succeeds (the race decides which).
		expect([first.status, second.status].sort()).toEqual([200, 400]);

		const winner =
			first.status === 200 ? "first-attempt-secret" : "second-attempt-secret";
		const loser =
			first.status === 200 ? "second-attempt-secret" : "first-attempt-secret";
		expect((await signIn(erin.email, winner)).status).toBe(200);
		expect((await signIn(erin.email, loser)).status).not.toBe(200);

		const rows = await db
			.select({ id: account.id })
			.from(account)
			.where(
				and(
					eq(account.userId, erin.authUserId),
					eq(account.providerId, "credential"),
				),
			);
		// With two credential rows it would be unknown which one verification uses.
		expect(rows).toHaveLength(1);
	});

	/**
	 * The password is not trimmed. If this assertion broke, the form would still work and most tests
	 * would pass; the only symptom would be someone who created a password starting with whitespace
	 * being unable to sign in.
	 */
	test("leading and trailing spaces are preserved", async () => {
		const frank = await signUp();
		await linkGoogle(frank.authUserId);
		await dropCredential(frank.authUserId);

		const padded = "  padded-secret-value  ";
		expect(
			(
				await apiPost(
					"/me/account/password",
					{ newPassword: padded },
					frank.cookie,
				)
			).status,
		).toBe(200);

		expect((await signIn(frank.email, padded)).status).toBe(200);
		expect((await signIn(frank.email, padded.trim())).status).not.toBe(200);
	});

	test("a password that fails the length policy is refused", async () => {
		const grace = await signUp();
		await linkGoogle(grace.authUserId);
		await dropCredential(grace.authUserId);

		for (const bad of ["short", "x".repeat(129)]) {
			const response = await apiPost(
				"/me/account/password",
				{ newPassword: bad },
				grace.cookie,
			);
			expect(response.status).toBe(400);
		}
		// Nothing was attached.
		const body = (await (
			await apiGet("/me/account", grace.cookie)
		).json()) as AccountBody;
		expect(body.hasPassword).toBe(false);
	});

	test("a guest can't set a password", async () => {
		const response = await apiPost("/me/account/password", {
			newPassword: "guest-should-not-pass",
		});
		expect(response.status).toBe(401);
	});
});

describe.skipIf(!databaseReady)("unlinking a sign-in method", () => {
	test("with two methods Google can be unlinked, and the credential still signs in", async () => {
		const alice = await signUp();
		await linkGoogle(alice.authUserId);

		const response = await apiPost(
			"/me/account/login-methods/disconnect",
			{ provider: "google" },
			alice.cookie,
		);
		expect(response.status).toBe(200);
		expect(
			((await response.json()) as AccountBody).methods.map((m) => m.provider),
		).toEqual(["credential"]);

		expect((await signIn(alice.email, TEST_PASSWORD)).status).toBe(200);
	});

	/**
	 * The most important assertion in this file. A directly called API, not the disabled button, must
	 * refuse; if this is breached, a state that locks the account is actually reachable.
	 */
	test("the last method can't be unlinked even by a direct call", async () => {
		const bob = await signUp();
		await linkGoogle(bob.authUserId);
		await dropCredential(bob.authUserId);

		const response = await apiPost(
			"/me/account/login-methods/disconnect",
			{ provider: "google" },
			bob.cookie,
		);
		expect(response.status).toBe(400);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "last_login_method",
		});

		// The row is still there: the rejection did not run partially.
		const rows = await db
			.select({ id: account.id })
			.from(account)
			.where(eq(account.userId, bob.authUserId));
		expect(rows).toHaveLength(1);
	});

	test("a credential-only account can't unlink it either", async () => {
		const carol = await signUp();
		const response = await apiPost(
			"/me/account/login-methods/disconnect",
			{ provider: "credential" },
			carol.cookie,
		);
		expect(response.status).toBe(400);
		expect((await signIn(carol.email, TEST_PASSWORD)).status).toBe(200);
	});

	test("unlinking a method that isn't linked has its own reason", async () => {
		const dave = await signUp();
		const response = await apiPost(
			"/me/account/login-methods/disconnect",
			{ provider: "google" },
			dave.cookie,
		);
		expect(response.status).toBe(400);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "login_method_not_linked",
		});
	});

	/**
	 * Unlinking the credential removes that account's password. If it reported success, signing in
	 * must actually be blocked; a screen that changed while the password stayed alive would be a lie.
	 */
	test("after unlinking the credential, password sign-in no longer works", async () => {
		const erin = await signUp();
		await linkGoogle(erin.authUserId);

		expect(
			(
				await apiPost(
					"/me/account/login-methods/disconnect",
					{ provider: "credential" },
					erin.cookie,
				)
			).status,
		).toBe(200);
		expect((await signIn(erin.email, TEST_PASSWORD)).status).not.toBe(200);
	});

	/**
	 * This value was `kakao` for a while: a provider outside the vocabulary, used as a sample. Once
	 * Kakao became a real provider, `naver` took its place. What is needed is a value outside the
	 * vocabulary, not a specific provider (a commit adding a method should look here too).
	 */
	test("a provider outside the vocabulary is a 400", async () => {
		const frank = await signUp();
		const response = await apiPost(
			"/me/account/login-methods/disconnect",
			{ provider: "naver" },
			frank.cookie,
		);
		expect(response.status).toBe(400);
	});

	test("a guest can't unlink a method", async () => {
		expect(
			(
				await apiPost("/me/account/login-methods/disconnect", {
					provider: "google",
				})
			).status,
		).toBe(401);
	});
});

describe.skipIf(!databaseReady)("sessions", () => {
	test("own sessions are visible and the current session is marked", async () => {
		const alice = await signUp();
		const second = await signIn(alice.email);
		expect(second.status).toBe(200);

		const body = (await (
			await apiGet("/me/account/sessions", alice.cookie)
		).json()) as SessionsBody;

		expect(body.sessions.length).toBeGreaterThanOrEqual(2);
		expect(body.sessions.filter((s) => s.current)).toHaveLength(1);
		// The current session comes first; a reordered list would move the revoke button to another row.
		expect(body.sessions[0]?.current).toBe(true);
	});

	/**
	 * No session token appears anywhere in the response. Checking field names would miss a value mixed
	 * into a nested spot, so the whole body is scanned as a string for the actual token value.
	 */
	test("session tokens do not go out in the response", async () => {
		const bob = await signUp();
		await signIn(bob.email);

		const raw = await (await apiGet("/me/account/sessions", bob.cookie)).text();
		const rows = await db
			.select({ token: session.token, id: session.id })
			.from(session)
			.where(eq(session.userId, bob.authUserId));

		expect(rows.length).toBeGreaterThanOrEqual(2);
		for (const row of rows) {
			expect(raw).not.toContain(row.token);
			// Conversely the row id must go out; revocation points at it.
			expect(raw).toContain(row.id);
		}
		// The auth account identity does not go out either.
		expect(raw).not.toContain(bob.authUserId);

		const body = JSON.parse(raw) as SessionsBody;
		for (const entry of body.sessions)
			expect(Object.keys(entry).sort()).toEqual([
				"createdAt",
				"current",
				"expiresAt",
				"id",
			]);
	});

	test("revoking another session keeps the current one alive", async () => {
		const carol = await signUp();
		const otherCookie = cookieFromResponse(await signIn(carol.email));

		const before = (await (
			await apiGet("/me/account/sessions", carol.cookie)
		).json()) as SessionsBody;
		const other = before.sessions.find((s) => !s.current);
		expect(other).toBeTruthy();

		const revoked = await apiPost(
			"/me/account/sessions/revoke",
			{ sessionId: other?.id },
			carol.cookie,
		);
		expect(revoked.status).toBe(200);
		expect(
			((await revoked.json()) as SessionsBody).sessions.some(
				(s) => s.id === other?.id,
			),
		).toBe(false);

		// The revoked side is no longer a member; this side is unchanged.
		expect(await (await apiGet("/me", otherCookie)).json()).toBeNull();
		expect(await (await apiGet("/me", carol.cookie)).json()).not.toBeNull();
	});

	/** A retry that only lost its response must not look like a failure: revocation is idempotent. */
	test("revoking an already-revoked session again succeeds", async () => {
		const dave = await signUp();
		await signIn(dave.email);
		const listed = (await (
			await apiGet("/me/account/sessions", dave.cookie)
		).json()) as SessionsBody;
		const target = listed.sessions.find((s) => !s.current)?.id;

		for (const _attempt of [1, 2]) {
			const response = await apiPost(
				"/me/account/sessions/revoke",
				{ sessionId: target },
				dave.cookie,
			);
			expect(response.status).toBe(200);
		}
	});

	/**
	 * A missing session id is not an error either; distinguishing would make the response a detector
	 * for "that session exists".
	 */
	test("an unknown session id does not reveal existence", async () => {
		const erin = await signUp();
		const response = await apiPost(
			"/me/account/sessions/revoke",
			{ sessionId: newId() },
			erin.cookie,
		);
		expect(response.status).toBe(200);
	});

	/**
	 * The current session is not ended through this path: that is signing out, which carries local
	 * cache cleanup.
	 */
	test("the current session can't be revoked through this path", async () => {
		const frank = await signUp();
		const listed = (await (
			await apiGet("/me/account/sessions", frank.cookie)
		).json()) as SessionsBody;
		const current = listed.sessions.find((s) => s.current)?.id;

		const response = await apiPost(
			"/me/account/sessions/revoke",
			{ sessionId: current },
			frank.cookie,
		);
		expect(response.status).toBe(400);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "current_session_revoke",
		});
		expect(await (await apiGet("/me", frank.cookie)).json()).not.toBeNull();
	});

	test("revoking all leaves only the current session", async () => {
		const grace = await signUp();
		const cookies = [
			cookieFromResponse(await signIn(grace.email)),
			cookieFromResponse(await signIn(grace.email)),
		];

		const response = await apiPost(
			"/me/account/sessions/revoke-others",
			undefined,
			grace.cookie,
		);
		expect(response.status).toBe(200);

		const body = (await response.json()) as SessionsBody;
		expect(body.sessions).toHaveLength(1);
		expect(body.sessions[0]?.current).toBe(true);

		for (const cookie of cookies)
			expect(await (await apiGet("/me", cookie)).json()).toBeNull();
		expect(await (await apiGet("/me", grace.cookie)).json()).not.toBeNull();
	});

	test("a guest can neither see nor revoke sessions", async () => {
		expect((await apiGet("/me/account/sessions")).status).toBe(401);
		expect(
			(await apiPost("/me/account/sessions/revoke", { sessionId: newId() }))
				.status,
		).toBe(401);
		expect(
			(await apiPost("/me/account/sessions/revoke-others", undefined)).status,
		).toBe(401);
	});
});

/**
 * A long-signed-in session, the most common failure path in this deployment.
 *
 * Better Auth requires a session created within `freshAge` (default 24 hours) for the session list
 * and method unlinking, while our session lifetime is 30 days, so hitting that requirement is
 * normal state, not an exception. The requirement is not turned off because the same value guards
 * identity verification for account deletion (turning it off removes protection for an irreversible
 * operation). So three things are locked: the code is exact, nothing changes, and the failure does
 * not drag other lookups along.
 *
 * 24 hours cannot be waited out, so the session row's `createdAt` is pushed back, which is the
 * value the library actually reads.
 */
describe.skipIf(!databaseReady)("old session", () => {
	/** Pushes all of this member's sessions outside the fresh window. */
	async function makeStale(authUserId: string): Promise<void> {
		const long = new Date(Date.now() - 1000 * 60 * 60 * 48);
		await db
			.update(session)
			.set({ createdAt: long })
			.where(eq(session.userId, authUserId));
	}

	test("the session list says to sign in again", async () => {
		const alice = await signUp();
		await makeStale(alice.authUserId);

		const response = await apiGet("/me/account/sessions", alice.cookie);
		expect(response.status).toBe(403);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "recent_login_required",
		});
	});

	/**
	 * The failure does not drag the neighbouring cell along. Had account info and the session list
	 * been merged into one lookup, a long-signed-in person could see neither their email nor their
	 * login methods; this assertion is why the two lookups are separate.
	 */
	test("account details are still readable", async () => {
		const bob = await signUp();
		await makeStale(bob.authUserId);

		const response = await apiGet("/me/account", bob.cookie);
		expect(response.status).toBe(200);
		expect(((await response.json()) as AccountBody).email).toBe(bob.email);
	});

	/**
	 * When unlinking is rejected the method must remain. A partially executed unlink would leave an
	 * account whose screen and actual state diverge.
	 */
	test("unlinking a method is refused and nothing changes", async () => {
		const carol = await signUp();
		await linkGoogle(carol.authUserId);
		await makeStale(carol.authUserId);

		const response = await apiPost(
			"/me/account/login-methods/disconnect",
			{ provider: "google" },
			carol.cookie,
		);
		expect(response.status).toBe(403);
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "recent_login_required",
		});

		const rows = await db
			.select({ providerId: account.providerId })
			.from(account)
			.where(eq(account.userId, carol.authUserId));
		expect(rows.map((r) => r.providerId).sort()).toEqual([
			"credential",
			"google",
		]);
	});

	/**
	 * Revocation is blocked too, and that is correct.
	 *
	 * Revoking itself does not require freshness, but the lookup that resolves the opaque reference
	 * back to a token does, and it runs before any write, so a rejected request changes nothing. If
	 * the order flipped, the revocation would happen while the response was a 403: the screen draws
	 * failure while the other device is already cut off (irreversibly).
	 *
	 * The screen is consistent too: someone who cannot see the list gets no revoke button.
	 */
	test("revoking is refused too, and other sessions survive", async () => {
		const dave = await signUp();
		const otherCookie = cookieFromResponse(await signIn(dave.email));
		await makeStale(dave.authUserId);

		expect(
			(
				await apiPost(
					"/me/account/sessions/revoke-others",
					undefined,
					dave.cookie,
				)
			).status,
		).toBe(403);
		// The other session is still alive: the rejection did not run partially.
		expect(await (await apiGet("/me", otherCookie)).json()).not.toBeNull();
	});

	/**
	 * Setting a password still works. That path requires an authoritative session, not a fresh one;
	 * the asymmetry is the library's and we neither imitate nor match it. Adding a freshness check to
	 * match would stop a passwordless account from creating one just because it has been signed in for
	 * a long time.
	 */
	test("setting a password does not require freshness", async () => {
		const erin = await signUp();
		await linkGoogle(erin.authUserId);
		await dropCredential(erin.authUserId);
		await makeStale(erin.authUserId);

		expect(
			(
				await apiPost(
					"/me/account/password",
					{ newPassword: "stale-session-secret" },
					erin.cookie,
				)
			).status,
		).toBe(200);
		expect((await signIn(erin.email, "stale-session-secret")).status).toBe(200);
	});
});

/**
 * Boundary between accounts: what can Alice do to Bob?
 *
 * The request contract has no slot for a target (neither member id nor auth account id), so the
 * only request that can point at someone else's thing is session revocation. Even that is blocked
 * as not-found, because ownership is in the predicate, rather than as found-then-rejected.
 */
describe.skipIf(!databaseReady)("boundaries between accounts", () => {
	test("Alice can't revoke Bob's session", async () => {
		const alice = await signUp();
		const bob = await signUp();

		const bobSessions = (await (
			await apiGet("/me/account/sessions", bob.cookie)
		).json()) as SessionsBody;
		const bobSessionId = bobSessions.sessions[0]?.id;
		expect(bobSessionId).toBeTruthy();

		const response = await apiPost(
			"/me/account/sessions/revoke",
			{ sessionId: bobSessionId },
			alice.cookie,
		);
		/**
		 * 200, not 404: a missing session and someone else's must get the same result, or the response
		 * becomes an existence detector. What matters is the two lines below, not the status code.
		 */
		expect(response.status).toBe(200);
		expect(
			((await response.json()) as SessionsBody).sessions.some(
				(s) => s.id === bobSessionId,
			),
		).toBe(false);

		// Bob is still signed in.
		expect(await (await apiGet("/me", bob.cookie)).json()).not.toBeNull();
	});

	test("Alice's revoke-all does not touch Bob's sessions", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await signIn(alice.email);

		expect(
			(
				await apiPost(
					"/me/account/sessions/revoke-others",
					undefined,
					alice.cookie,
				)
			).status,
		).toBe(200);
		expect(await (await apiGet("/me", bob.cookie)).json()).not.toBeNull();
	});

	test("Alice's unlink does not touch Bob's methods", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await linkGoogle(alice.authUserId);
		await linkGoogle(bob.authUserId);

		expect(
			(
				await apiPost(
					"/me/account/login-methods/disconnect",
					{ provider: "google" },
					alice.cookie,
				)
			).status,
		).toBe(200);

		const bobAccount = (await (
			await apiGet("/me/account", bob.cookie)
		).json()) as AccountBody;
		expect(bobAccount.methods.map((m) => m.provider)).toEqual([
			"credential",
			"google",
		]);
	});

	test("Alice setting a password does not reach Bob's account", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await linkGoogle(alice.authUserId);
		await dropCredential(alice.authUserId);

		expect(
			(
				await apiPost(
					"/me/account/password",
					{ newPassword: "alice-only-secret-1" },
					alice.cookie,
				)
			).status,
		).toBe(200);

		// Bob's password is unchanged.
		expect((await signIn(bob.email, TEST_PASSWORD)).status).toBe(200);
		expect((await signIn(bob.email, "alice-only-secret-1")).status).not.toBe(
			200,
		);
	});

	test("Bob's sessions are not in Alice's session list", async () => {
		const alice = await signUp();
		const bob = await signUp();

		const raw = await (
			await apiGet("/me/account/sessions", alice.cookie)
		).text();
		const bobRows = await db
			.select({ id: session.id, token: session.token })
			.from(session)
			.where(eq(session.userId, bob.authUserId));

		expect(bobRows.length).toBeGreaterThan(0);
		for (const row of bobRows) {
			expect(raw).not.toContain(row.id);
			expect(raw).not.toContain(row.token);
		}
	});
});
