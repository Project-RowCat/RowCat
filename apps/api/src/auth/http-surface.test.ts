import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb } from "../db/client.ts";
import { createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";
import { authSurfaceRefusal, EXPO_PROXY_TARGETS } from "./http-surface.ts";

const EMAIL_PREFIX = "auth-surface-test-";
const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

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
	])("%s is closed", (path) => {
		expect(authSurfaceRefusal(path, new URLSearchParams())).toBe("closed");
	});

	test.each([
		"/sign-in/email",
		"/get-session",
		"/change-password",
		"/delete-user",
	])("%s stays open", (path) => {
		expect(authSurfaceRefusal(path, new URLSearchParams())).toBeNull();
	});
});

describe("the Expo authorization relay goes only to a provider", () => {
	test.each([...EXPO_PROXY_TARGETS])("%s passes", (target) => {
		expect(
			authSurfaceRefusal(
				"/expo-authorization-proxy",
				proxy(`${target}?client_id=x&state=s`),
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
		expect(authSurfaceRefusal("/expo-authorization-proxy", proxy(target))).toBe(
			"proxy-target",
		);
	});

	test("a relay request with no target is refused", () => {
		expect(
			authSurfaceRefusal("/expo-authorization-proxy", new URLSearchParams()),
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

	test("the relay refuses a foreign target and sets no cookie", async () => {
		const response = await app.request(
			`/v2/auth/expo-authorization-proxy?${proxy("https://evil.example/?state=planted")}`,
		);
		expect(response.status).toBe(400);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("location")).toBeNull();
	});
});
