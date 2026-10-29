import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { member } from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import { TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { cookieFromResponse } from "../test/http.ts";
import { NATIVE_AUTH_ORIGIN } from "./trusted-origins.ts";

/**
 * Whether native requests really pass through, and whether their session resolves to a product
 * member. `trusted-origins.test.ts` only proves the list was written, not that the request path
 * uses it; native requests carry no `Origin`, so what the check sees is itself the question.
 *
 * It runs the app as-is and mimics what the mobile client sends (`@better-auth/expo`'s `init`):
 *
 * ```text
 * Origin        absent; native fetch does not create it
 * expo-origin   `rowcat://`; the server's expo plugin moves it into origin
 * Cookie        the value taken from SecureStore, attached by hand (no browser cookie jar)
 * ```
 *
 * These three lines are all this slice added to the server. Missing any one gives a bare 403,
 * indistinguishable on screen from "wrong password".
 */

/**
 * Sends `expo-origin` instead of `Origin`. Writing `Origin` ourselves would do the server plugin's
 * job in the test and pass even with the plugin missing.
 */
const nativeAuthRequest = async (
	path: string,
	body: unknown,
	origin: string = NATIVE_AUTH_ORIGIN,
): Promise<Response> =>
	app.request(`/v2/auth${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"expo-origin": origin,
		},
		body: JSON.stringify(body),
	});

const me = async (cookie?: string): Promise<Response> =>
	app.request("/v2/me", { headers: cookie ? { Cookie: cookie } : {} });

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

const EMAIL_PREFIX = "expo-session-test-";
const testEmail = () => `${EMAIL_PREFIX}${newId()}@example.test`;

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("native session → viewer", () => {
	test("a sign-up from the native scheme creates a session", async () => {
		const signUp = await nativeAuthRequest("/sign-up/email", {
			name: "Native member",
			email: testEmail(),
			password: TEST_PASSWORD,
		});

		expect(signUp.status).toBe(200);
		expect(cookieFromResponse(signUp)).toContain("session_token");
	});

	/**
	 * The P0 of this file. The identity the app uses to pick its local SQLite file is `/me`'s id and
	 * must differ from the auth account id; if they coincided, changing login methods would change the
	 * file holding the user's conversations and drafts.
	 */
	test("a native session's /me is the member id, not the auth account id", async () => {
		const signUp = await nativeAuthRequest("/sign-up/email", {
			name: "Native identity",
			email: testEmail(),
			password: TEST_PASSWORD,
		});
		const authUserId = (await readJson<AuthUserBody>(signUp)).user.id;

		const viewer = await readJson<ViewerBody | null>(
			await me(cookieFromResponse(signUp)),
		);

		expect(viewer).not.toBeNull();
		expect(viewer?.nickname).toBe("Native identity");
		expect(viewer?.status).toBe("approved");
		expect(viewer?.id).not.toBe(authUserId);

		const [row] = await db
			.select({ id: member.id })
			.from(member)
			.where(eq(member.user_id, authUserId));
		expect(row?.id).toBe(viewer?.id);
	});

	test("signing in again with the same account gives the same member", async () => {
		const email = testEmail();
		const signUp = await nativeAuthRequest("/sign-up/email", {
			name: "Sign in again",
			email,
			password: TEST_PASSWORD,
		});
		const first = await readJson<ViewerBody | null>(
			await me(cookieFromResponse(signUp)),
		);

		const signIn = await nativeAuthRequest("/sign-in/email", {
			email,
			password: TEST_PASSWORD,
		});
		expect(signIn.status).toBe(200);

		const second = await readJson<ViewerBody | null>(
			await me(cookieFromResponse(signIn)),
		);
		expect(second?.id).toBe(first?.id);
		expect(second?.id).toBeTruthy();
	});

	/**
	 * The origin check really runs on cookie-carrying requests. This pair is the most valuable
	 * assertion here: the passes above cannot tell "our scheme is trusted" from "native requests pass
	 * anything", and in the latter case any app could drive our auth through its own deep link.
	 * Sign-out is used because Better Auth compares Origin only on state-changing requests that carry
	 * cookies.
	 */
	test("a request from another scheme cannot touch the session", async () => {
		const signUp = await nativeAuthRequest("/sign-up/email", {
			name: "Impersonation target",
			email: testEmail(),
			password: TEST_PASSWORD,
		});
		const cookie = cookieFromResponse(signUp);

		const impersonated = await app.request("/v2/auth/sign-out", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"expo-origin": "evilrowcat://",
				Cookie: cookie,
			},
			body: "{}",
		});
		expect(impersonated.status).toBe(403);

		// The session is still alive; the rejection must not quietly end in a sign-out.
		expect(await readJson<ViewerBody | null>(await me(cookie))).not.toBeNull();

		const own = await app.request("/v2/auth/sign-out", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"expo-origin": NATIVE_AUTH_ORIGIN,
				Cookie: cookie,
			},
			body: "{}",
		});
		expect(own.status).toBe(200);
	});

	/**
	 * Deep-link callbacks are judged by the same list (where Google sign-in actually passes). Needs no
	 * provider config: the trust check is front-stage middleware, so an untrusted callback is a 403
	 * before any provider lookup while a trusted one proceeds to it. That the two responses differ
	 * proves the check ran.
	 */
	test("does not accept an untrusted deep link as a callback", async () => {
		const rejected = await nativeAuthRequest("/sign-in/social", {
			provider: "google",
			callbackURL: "evilrowcat://steal",
		});
		expect(rejected.status).toBe(403);
		expect((await readJson<{ code?: string }>(rejected)).code).toBe(
			"INVALID_CALLBACK_URL",
		);

		const accepted = await nativeAuthRequest("/sign-in/social", {
			provider: "google",
			callbackURL: `${NATIVE_AUTH_ORIGIN}expo-development-client/`,
		});
		expect(accepted.status).not.toBe(403);
	});

	/**
	 * The web path is unchanged. Loosening the check to admit native would still pass this but break
	 * the rejections above, so the pair cannot be fixed from one side.
	 */
	test("the browser origin path did not change", async () => {
		const fromWeb = await app.request("/v2/auth/sign-up/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:3000",
			},
			body: JSON.stringify({
				name: "Web member",
				email: testEmail(),
				password: TEST_PASSWORD,
			}),
		});

		expect(fromWeb.status).toBe(200);
		expect(cookieFromResponse(fromWeb)).toContain("session_token");
	});
});
