import { desc, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { session } from "../db/schema.ts";
import { AUTH_CLIENT_IP_HEADER } from "../lib/client-ip.ts";
import { createTestMember, TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";
import { authSurfaceRefusal, EXPO_PROXY_TARGETS } from "./http-surface.ts";

const EMAIL_PREFIX = "auth-surface-test-";
const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

/** Every case below but the local-only one is decided without asking where the request came from. */
const remote = () => false;

const proxy = (authorizationURL: string) =>
	new URLSearchParams({ authorizationURL });

describe("which library endpoints stay closed", () => {
	test.each([
		"/list-sessions",
		"/list-sessions/",
		"//list-sessions",
		"/LIST-SESSIONS",
		"/list%2Dsessions",
		"/revoke-session",
		"/revoke-other-sessions",
		"/list-accounts",
		"/unlink-account",
		"/get-access-token",
		"/passkey/list-user-passkeys",
		"/passkey/delete-passkey",
		"/verify-password",
		"/update-session",
		"/two-factor/send-otp",
		"/two-factor/verify-otp",
	])("%s is closed", (path) => {
		expect(authSurfaceRefusal(path, new URLSearchParams(), remote)).toBe(
			"closed",
		);
	});

	test.each([
		"/sign-in/email",
		"/get-session",
		"/change-password",
		"/delete-user",
		/** The sign-in challenge both apps answer; closing `/two-factor/*` by prefix would lock 2FA accounts out. */
		"/two-factor/verify-totp",
		"/two-factor/verify-backup-code",
	])("%s stays open", (path) => {
		expect(authSurfaceRefusal(path, new URLSearchParams(), remote)).toBeNull();
	});
});

describe("the local owner's sign-in opens only to this computer", () => {
	test.each([
		"/local-sign-in",
		"/local-sign-in/",
		"//LOCAL-SIGN-IN",
	])("%s is closed to a remote request", (path) => {
		expect(authSurfaceRefusal(path, new URLSearchParams(), remote)).toBe(
			"closed",
		);
	});

	test("a local request reaches the library", () => {
		expect(
			authSurfaceRefusal("/local-sign-in", new URLSearchParams(), () => true),
		).toBeNull();
	});

	test("other paths never ask where the request came from", () => {
		const asked = { count: 0 };
		authSurfaceRefusal("/sign-in/email", new URLSearchParams(), () => {
			asked.count += 1;
			return true;
		});
		expect(asked.count).toBe(0);
	});
});

describe("the Expo authorization relay goes only to a provider", () => {
	test.each([...EXPO_PROXY_TARGETS])("%s passes", (target) => {
		expect(
			authSurfaceRefusal(
				"/expo-authorization-proxy",
				proxy(`${target}?client_id=x&state=s`),
				remote,
			),
		).toBeNull();
	});

	test.each([
		"https://evil.example/?state=s",
		"https://accounts.google.com.evil.example/o/oauth2/v2/auth?state=s",
		"https://accounts.google.com/ServiceLogin?continue=https://evil.example",
		"https://user:pass@accounts.google.com/o/oauth2/v2/auth?state=s",
		"http://accounts.google.com/o/oauth2/v2/auth?state=s",
		"not a url",
	])("%s is refused", (target) => {
		expect(
			authSurfaceRefusal("/expo-authorization-proxy", proxy(target), remote),
		).toBe("proxy-target");
	});

	test("a relay request with no target is refused", () => {
		expect(
			authSurfaceRefusal(
				"/expo-authorization-proxy",
				new URLSearchParams(),
				remote,
			),
		).toBe("proxy-target");
	});
});

/** The edge really answers before the library: a signed-in request to a closed path is a 404, not the session list. */
describe.skipIf(!databaseReady)("over HTTP", () => {
	test("a session cookie does not open the raw session list", async () => {
		const alice = await createTestMember(EMAIL_PREFIX);
		const response = await app.request("/v2/auth/list-sessions", {
			headers: { Cookie: alice.cookie, Origin: WEB_ORIGIN },
		});
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain("token");
	});

	test("a session cannot ask whether a password is right", async () => {
		const alice = await createTestMember(EMAIL_PREFIX);
		const response = await app.request("/v2/auth/verify-password", {
			method: "POST",
			headers: {
				Cookie: alice.cookie,
				Origin: WEB_ORIGIN,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});
		expect(response.status).toBe(404);
	});

	test("the relay refuses a foreign target and sets no cookie", async () => {
		const response = await app.request(
			`/v2/auth/expo-authorization-proxy?${proxy("https://evil.example/?state=planted")}`,
		);
		expect(response.status).toBe(400);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("location")).toBeNull();
	});

	/**
	 * The library counts and records the address `app.ts` decided from the socket
	 * (`lib/client-ip.ts`), never one the client wrote — neither a forged `X-Forwarded-For` nor our own
	 * header name sent from outside. The session row's `ipAddress` is where that decision is visible.
	 */
	test("a forged client address is not what the library sees", async () => {
		const alice = await createTestMember(EMAIL_PREFIX);
		const response = await app.request(
			"/v2/auth/sign-in/email",
			{
				method: "POST",
				headers: {
					Origin: WEB_ORIGIN,
					"Content-Type": "application/json",
					"X-Forwarded-For": "198.51.100.1",
					[AUTH_CLIENT_IP_HEADER]: "198.51.100.2",
				},
				body: JSON.stringify({ email: alice.email, password: TEST_PASSWORD }),
			},
			{ incoming: { socket: { remoteAddress: "203.0.113.7" } } },
		);
		expect(response.status).toBe(200);
		const [row] = await db
			.select({ ipAddress: session.ipAddress })
			.from(session)
			.where(eq(session.userId, alice.authUserId))
			.orderBy(desc(session.createdAt))
			.limit(1);
		expect(row?.ipAddress).toBe("203.0.113.7");
	});
});
