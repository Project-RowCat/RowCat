import { randomBytes } from "node:crypto";
import { expo } from "@better-auth/expo";
import {
	APP_SESSION_HANDOFF_BINDING_PARAM,
	APP_SESSION_HANDOFF_CODE_PARAM,
	APP_SESSION_HANDOFF_INVALID,
} from "@rowcat/contracts";
import { desc, eq } from "drizzle-orm";
import { afterAll, describe, expect, test, vi } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { session } from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import { saveAppSessionHandoff } from "../services/app-session-handoff.ts";
import { TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { cookieFromResponse } from "../test/http.ts";
import {
	handNativeRedirect,
	handoffBindingOf,
	nativeExpoPlugin,
	rewriteNativeRedirect,
} from "./app-session-handoff.ts";
import { NATIVE_AUTH_ORIGIN } from "./trusted-origins.ts";

/**
 * The browser sign-in's last hop to the app carries a one-time code, never the session.
 *
 * What these pin is the regression a custom scheme invites: the session cookie written into a
 * `rowcat://` URL that another installed app may receive (Android lets any app claim the scheme, and
 * the email-verification link goes through the system's routing on both platforms). A redirect that
 * fails one of these checks would sign in whoever receives the link.
 */

const token = () => randomBytes(32).toString("base64url");
const CALLBACK = `${NATIVE_AUTH_ORIGIN}account?email=changed`;

const withBinding = (url: string, binding: string) => {
	const next = new URL(url);
	next.searchParams.set(APP_SESSION_HANDOFF_BINDING_PARAM, binding);
	return next.toString();
};

describe("the library's cookie-in-URL hook is gone", () => {
	/**
	 * Proves the removal still removes something: if the library renames or moves that hook, the left
	 * half stops holding and this test says so before a release ships the cookie in a URL again.
	 */
	test("expo() has the after-hook, the plugin this server mounts does not", () => {
		expect(expo().hooks?.after?.length).toBeGreaterThan(0);
		const mounted = nativeExpoPlugin();
		expect(mounted.hooks).toBeUndefined();
		expect(Object.keys(mounted.endpoints ?? {})).toContain(
			"expoAuthorizationProxy",
		);
		expect(typeof mounted.onRequest).toBe("function");
	});
});

/** The same vector the app's test pins (`apps/mobile/src/lib/app-session-handoff.test.ts`). */
test("the binding derivation matches the app's", () => {
	expect(handoffBindingOf("rowcat-handoff-vector-000000000000000000000")).toBe(
		"kVe-8O8aO_XML_891NDAxPQetGGbese5IqpcOZvaeys",
	);
});

describe("rewriteNativeRedirect — pure", () => {
	test("web destinations are left alone", () => {
		expect(rewriteNativeRedirect("https://web.rowcat.test/account")).toBeNull();
		expect(rewriteNativeRedirect("http://localhost:3000/")).toBeNull();
		expect(rewriteNativeRedirect("not a url")).toBeNull();
	});

	test("strips cookie, binding and any planted code, keeps the rest", () => {
		const binding = token();
		const planted = new URL(withBinding(CALLBACK, binding));
		planted.searchParams.set("cookie", "better-auth.session_token=stolen");
		planted.searchParams.set(APP_SESSION_HANDOFF_CODE_PARAM, "planted");
		const rewrite = rewriteNativeRedirect(planted.toString());
		expect(rewrite?.binding).toBe(binding);
		const out = new URL(rewrite?.location ?? "");
		expect(out.searchParams.get("cookie")).toBeNull();
		expect(out.searchParams.get(APP_SESSION_HANDOFF_BINDING_PARAM)).toBeNull();
		expect(out.searchParams.get(APP_SESSION_HANDOFF_CODE_PARAM)).toBeNull();
		expect(out.searchParams.get("email")).toBe("changed");
	});

	test("a malformed binding is no binding", () => {
		expect(
			rewriteNativeRedirect(withBinding(CALLBACK, "short"))?.binding,
		).toBeNull();
	});
});

describe("handNativeRedirect — the hook", () => {
	const headersFor = (location: string) =>
		new Headers({
			location,
			"set-cookie": "better-auth.session_token=abc.def; Path=/; HttpOnly",
		});

	test("a session and a binding become a code — and nothing else leaves", async () => {
		const binding = token();
		const headers = headersFor(withBinding(CALLBACK, binding));
		const save = vi.fn(async () => {});
		await handNativeRedirect({
			headers,
			isTrusted: () => true,
			sessionToken: "session-token-1",
			save,
			newCode: () => "one-time-code",
		});
		const location = headers.get("location") ?? "";
		expect(
			new URL(location).searchParams.get(APP_SESSION_HANDOFF_CODE_PARAM),
		).toBe("one-time-code");
		expect(location).not.toContain("cookie");
		expect(location).not.toContain("session_token");
		expect(location).not.toContain(binding);
		expect(headers.get("set-cookie")).toBeNull();
		expect(save).toHaveBeenCalledWith("one-time-code", {
			binding,
			sessionToken: "session-token-1",
		});
	});

	/** No fallback: the old client shape gets no session at all, rather than one in the URL. */
	test("a session without a binding hands over nothing", async () => {
		const headers = headersFor(CALLBACK);
		const save = vi.fn(async () => {});
		await handNativeRedirect({
			headers,
			isTrusted: () => true,
			sessionToken: "session-token-1",
			save,
		});
		expect(headers.get("location")).toBe(CALLBACK);
		expect(headers.get("set-cookie")).toBeNull();
		expect(save).not.toHaveBeenCalled();
	});

	test("no session (a verification link, a linking round trip) carries no code", async () => {
		const headers = headersFor(withBinding(CALLBACK, token()));
		const save = vi.fn(async () => {});
		await handNativeRedirect({
			headers,
			isTrusted: () => true,
			sessionToken: null,
			save,
		});
		expect(
			new URL(headers.get("location") ?? "").searchParams.has(
				APP_SESSION_HANDOFF_CODE_PARAM,
			),
		).toBe(false);
		expect(save).not.toHaveBeenCalled();
	});

	test("web redirects keep their cookie; untrusted ones are not touched", async () => {
		const web = headersFor("https://web.rowcat.test/account");
		await handNativeRedirect({
			headers: web,
			isTrusted: () => true,
			sessionToken: "s",
			save: vi.fn(),
		});
		expect(web.get("set-cookie")).not.toBeNull();

		const untrusted = headersFor("evilrowcat://steal");
		await handNativeRedirect({
			headers: untrusted,
			isTrusted: () => false,
			sessionToken: "s",
			save: vi.fn(),
		});
		expect(untrusted.get("location")).toBe("evilrowcat://steal");
	});
});

const EMAIL_PREFIX = "app-handoff-test-";
const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

const nativePost = (path: string, body: unknown, cookie?: string) =>
	app.request(`/v2/auth${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"expo-origin": NATIVE_AUTH_ORIGIN,
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify(body),
	});

/** A real session to hand off: what a social callback would have created. */
async function freshSessionToken(): Promise<string> {
	const signUp = await nativePost("/sign-up/email", {
		name: "Handoff",
		email: `${EMAIL_PREFIX}${newId()}@example.test`,
		password: TEST_PASSWORD,
	});
	const { user } = (await signUp.json()) as { user: { id: string } };
	const [row] = await db
		.select({ token: session.token })
		.from(session)
		.where(eq(session.userId, user.id))
		.orderBy(desc(session.createdAt))
		.limit(1);
	if (!row) throw new Error("no session");
	return row.token;
}

const redeem = (code: string, verifier: string) =>
	nativePost("/app-session/redeem", { code, verifier });

const codeOf = async (response: Response) =>
	((await response.json()) as { code?: string }).code;

describe.skipIf(!databaseReady)(
	"redeem — the app trades code + verifier for the session",
	() => {
		test("the verifier the app kept gets the session cookie, and /me answers", async () => {
			const verifier = token();
			const code = token();
			await saveAppSessionHandoff(code, {
				binding: handoffBindingOf(verifier),
				sessionToken: await freshSessionToken(),
			});
			const response = await redeem(code, verifier);
			expect(response.status).toBe(200);
			const cookie = cookieFromResponse(response);
			expect(cookie).toContain("session_token");
			const me = await app.request("/v2/me", { headers: { Cookie: cookie } });
			expect(await me.json()).toMatchObject({ nickname: "Handoff" });
		});

		test("a code works once", async () => {
			const verifier = token();
			const code = token();
			await saveAppSessionHandoff(code, {
				binding: handoffBindingOf(verifier),
				sessionToken: await freshSessionToken(),
			});
			expect((await redeem(code, verifier)).status).toBe(200);
			const again = await redeem(code, verifier);
			expect(again.status).toBe(400);
			expect(await codeOf(again)).toBe(APP_SESSION_HANDOFF_INVALID);
		});

		/** The interception case: the code without the verifier gets nothing, and spends the code. */
		test("an intercepted code without the verifier gets nothing", async () => {
			const verifier = token();
			const code = token();
			await saveAppSessionHandoff(code, {
				binding: handoffBindingOf(verifier),
				sessionToken: await freshSessionToken(),
			});
			const stolen = await redeem(code, token());
			expect(stolen.status).toBe(400);
			expect(cookieFromResponse(stolen)).not.toContain("session_token");
			expect((await redeem(code, verifier)).status).toBe(400);
		});

		test("an expired code is refused", async () => {
			const verifier = token();
			const code = token();
			await saveAppSessionHandoff(
				code,
				{
					binding: handoffBindingOf(verifier),
					sessionToken: await freshSessionToken(),
				},
				new Date(Date.now() - 10 * 60_000),
			);
			expect((await redeem(code, verifier)).status).toBe(400);
		});

		test("the request carries a code and a verifier and nothing else", async () => {
			const response = await nativePost("/app-session/redeem", {
				code: token(),
				verifier: token(),
				sessionToken: "x",
			});
			expect(response.status).toBe(400);
		});
	},
);
