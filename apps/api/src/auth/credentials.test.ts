import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { account, member, user } from "../db/schema.ts";
import { newId } from "../lib/id.ts";

import { TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { cookieFromResponse, WEB_ORIGIN } from "../test/http.ts";

/**
 * Whether credential login carries through to the product identity: once a session exists, RowCat
 * must resolve it to one member regardless of login method. Whether Better Auth returned 200 is the
 * library's test, not this one.
 *
 * Goes through the real Hono app via `app.request()` because the middleware (`withViewer`) and the
 * Better Auth mount are the fragile wiring under test.
 */

/**
 * Better Auth only accepts requests from trusted origins (CSRF). We add the header a browser would;
 * without it everything is a 403 that looks like "wrong password". `app.request()` may return a
 * Response or a Promise, so `async` normalizes it.
 */
const authRequest = async (path: string, body: unknown): Promise<Response> =>
	app.request(`/v2/auth${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
		body: JSON.stringify(body),
	});

/**
 * `Response.json()` is `unknown`; narrowing at each call site would bury what the assertions check
 * under casts. If the shape is really different, the assertions below fail there.
 */
const readJson = async <T>(response: Response): Promise<T> =>
	(await response.json()) as T;

interface ViewerBody {
	id: string;
	nickname: string;
	status: string;
}

interface AuthUserBody {
	user: { id: string };
}

const me = async (cookie?: string): Promise<Response> =>
	app.request("/v2/me", {
		headers: cookie ? { Cookie: cookie } : {},
	});

/** Fixed prefix so cleanup deletes only accounts this test created, never a developer's own. */
const EMAIL_PREFIX = "credentials-test-";
const testEmail = () => `${EMAIL_PREFIX}${newId()}@example.test`;

/**
 * Skipped when there is no DB. Decided by top-level await because `describe.skipIf` is evaluated at
 * collection time; deciding in `beforeAll` would fail everything instead of skipping.
 */
const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady)
		// Deleting the user cascades to member, session and account.
		await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("credential auth → viewer", () => {
	test("signing up creates a session and /me returns the member", async () => {
		const email = testEmail();

		const signUp = await authRequest("/sign-up/email", {
			name: "Test member",
			email,
			password: TEST_PASSWORD,
		});
		expect(signUp.status).toBe(200);

		const cookie = cookieFromResponse(signUp);
		// Checking only the 200 would miss `autoSignIn` being turned off.
		expect(cookie).toContain("session_token");

		const viewer = await readJson<ViewerBody | null>(await me(cookie));
		expect(viewer).not.toBeNull();
		expect(viewer?.nickname).toBe("Test member");
		expect(viewer?.status).toBe("approved");

		/**
		 * The key assertion: `/me` returns the member id, not the auth account id. If the two coincided,
		 * product ownership (works, favorites, local DB scope) would be tied to the auth implementation's
		 * identifier and changing login methods would change authorization.
		 */
		const authUserId = (await readJson<AuthUserBody>(signUp)).user.id;
		expect(viewer?.id).not.toBe(authUserId);

		const [row] = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.user_id, authUserId));
		expect(row?.id).toBe(viewer?.id);
	});

	test("signing in with the right password gives the same member as at sign-up", async () => {
		const email = testEmail();
		await authRequest("/sign-up/email", {
			name: "Sign in again",
			email,
			password: TEST_PASSWORD,
		});

		const signIn = await authRequest("/sign-in/email", {
			email,
			password: TEST_PASSWORD,
		});
		expect(signIn.status).toBe(200);

		const viewer = await readJson<ViewerBody | null>(
			await me(cookieFromResponse(signIn)),
		);
		expect(viewer).not.toBeNull();

		// Sign-in creates no new member; there is one member per account.
		const rows = await db
			.select({ id: member.id })
			.from(member)
			.where(
				eq(member.user_id, (await readJson<AuthUserBody>(signIn)).user.id),
			);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(viewer?.id);
	});

	test("a wrong password creates no session", async () => {
		const email = testEmail();
		await authRequest("/sign-up/email", {
			name: "Failure",
			email,
			password: TEST_PASSWORD,
		});

		const signIn = await authRequest("/sign-in/email", {
			email,
			password: "wrong-password-entirely",
		});
		expect(signIn.status).not.toBe(200);
		expect(cookieFromResponse(signIn)).not.toContain("session_token");

		// `/me` without a cookie is a guest (null), not an error, so public browsing still passes.
		expect(await readJson<ViewerBody | null>(await me())).toBeNull();
	});

	test("an unknown email and a wrong password are indistinguishable", async () => {
		const email = testEmail();
		await authRequest("/sign-up/email", {
			name: "Enumeration guard",
			email,
			password: TEST_PASSWORD,
		});

		const wrongPassword = await authRequest("/sign-in/email", {
			email,
			password: "wrong-password-entirely",
		});
		const unknownEmail = await authRequest("/sign-in/email", {
			email: testEmail(),
			password: TEST_PASSWORD,
		});

		/**
		 * The two failures must not differ in status or code; otherwise the login form becomes a member
		 * directory lookup.
		 */
		expect(unknownEmail.status).toBe(wrongPassword.status);
		expect((await readJson<{ code?: string }>(unknownEmail)).code).toBe(
			(await readJson<{ code?: string }>(wrongPassword)).code,
		);
	});

	test("signing up twice with the same email does not add a member", async () => {
		const email = testEmail();
		const first = await authRequest("/sign-up/email", {
			name: "Duplicate",
			email,
			password: TEST_PASSWORD,
		});
		expect(first.status).toBe(200);
		const authUserId = (await readJson<AuthUserBody>(first)).user.id;

		/**
		 * The member row is created on the first request, not at signup (`ensureMember` in
		 * `auth/viewer.ts`). This `/me` call is needed or the assertions below would verify "nothing
		 * exists yet" and always pass.
		 */
		const viewer = await readJson<ViewerBody | null>(
			await me(cookieFromResponse(first)),
		);
		expect(viewer).not.toBeNull();

		const second = await authRequest("/sign-up/email", {
			name: "Duplicate",
			email,
			password: TEST_PASSWORD,
		});
		// Better Auth rejects by its own rule; we do not compare emails and merge.
		expect(second.status).not.toBe(200);

		const users = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		expect(users).toHaveLength(1);

		const members = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.user_id, authUserId));
		expect(members).toHaveLength(1);
		expect(members[0]?.id).toBe(viewer?.id);
	});

	/**
	 * The product identity stays one as login methods grow. A real Google OAuth round trip cannot run
	 * here, so we create what it leaves behind: a second account row on the same auth user. Had member
	 * resolution looked at the provider or account id, a second member or a different viewer would
	 * appear; keyed on `user.id`, nothing happens.
	 */
	test("more social accounts on the same account still mean one member", async () => {
		const email = testEmail();
		const signUp = await authRequest("/sign-up/email", {
			name: "Several methods",
			email,
			password: TEST_PASSWORD,
		});
		const cookie = cookieFromResponse(signUp);
		const authUserId = (await readJson<AuthUserBody>(signUp)).user.id;
		const before = await readJson<ViewerBody | null>(await me(cookie));

		const now = new Date();
		await db.insert(account).values({
			id: newId(),
			accountId: `google-${authUserId}`,
			providerId: "google",
			// Must match the issuer format Better Auth attaches to social accounts.
			issuer: "local:oauth:google",
			userId: authUserId,
			createdAt: now,
			updatedAt: now,
		});

		const after = await readJson<ViewerBody | null>(await me(cookie));
		expect(after?.id).toBe(before?.id);
		expect(after?.id).toBeTruthy();

		const members = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.user_id, authUserId));
		expect(members).toHaveLength(1);
	});
});
