import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	app,
	DEFAULT_BODY_LIMIT_BYTES,
	ROUTES_WITH_OWN_BODY_LIMIT,
} from "./app.ts";
import { requestLogTarget } from "./lib/request-logger.ts";
import { GUARDIAN_CONSENT_MAX_BODY_BYTES } from "./routes/guardian.ts";
import { WEB_ORIGIN } from "./test/http.ts";

/**
 * A public, sessionless POST (the guardian consent link); the Origin gate stands in front of it
 * even without cookies. The token does not exist, so past the gate the contract validation rejects
 * it before touching the DB.
 */
const PUBLIC_POST = "/v2/guardian/not-a-real-token/consent";
const publicPostBody = JSON.stringify({ agreed: false });

describe("Origin boundary for unsafe requests", () => {
	test.each([
		"https://evil.example.com",
		"null",
	])("rejects a simple POST from the disallowed Origin %s with 403", async (origin) => {
		const response = await app.request(PUBLIC_POST, {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "text/plain" },
			body: publicPostBody,
		});
		expect(response.status).toBe(403);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect((await response.json()) as { code: string }).toMatchObject({
			code: "untrusted_origin",
		});
	});

	test("rejects a body-less cookie write before the handler too", async () => {
		const response = await app.request(
			"/v2/me/account/sessions/revoke-others",
			{
				method: "POST",
				headers: { Origin: "https://evil.example.com" },
			},
		);
		expect(response.status).toBe(403);
	});

	test("native and server requests with no Origin, and allowed web requests, reach the existing route", async () => {
		const headerSets: Record<string, string>[] = [
			{ "Content-Type": "text/plain" },
			{ Origin: WEB_ORIGIN, "Content-Type": "text/plain" },
		];
		for (const headers of headerSets) {
			const response = await app.request(PUBLIC_POST, {
				method: "POST",
				headers,
				body: "null",
			});
			/** Rejected by contract validation, not the Origin gate. */
			expect(response.status).toBe(400);
		}
	});

	test("safe methods and preflights keep their existing behaviour", async () => {
		expect(
			(
				await app.request("/v2/health", {
					headers: { Origin: "https://evil.example.com" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await app.request(PUBLIC_POST, {
					method: "OPTIONS",
					headers: { Origin: "https://evil.example.com" },
				})
			).status,
		).toBe(204);
	});

	test("Better Auth paths are left to their own trust list and CSRF check", async () => {
		const response = await app.request("/v2/auth/not-a-real-operation", {
			method: "POST",
			headers: { Origin: "https://auth-only.example.test" },
		});
		const body = (await response.json().catch(() => null)) as {
			code?: string;
		} | null;
		expect(body?.code).not.toBe("untrusted_origin");
	});
});

describe("request target in the access log", () => {
	afterEach(() => vi.restoreAllMocks());

	test("drops the query and folds the guardian token into the route template", () => {
		expect(
			requestLogTarget(
				"https://api.example.test/v2/guardian/raw-secret/verify?token=query-secret&code=oauth",
			),
		).toBe("/v2/guardian/:token/verify");
		expect(
			requestLogTarget(
				"https://api.example.test/v2/auth/verify-email?token=query-secret",
			),
		).toBe("/v2/auth/verify-email");
		expect(requestLogTarget("not a URL")).toBe("(invalid-url)");
	});

	test("no token appears in either the incoming or outgoing log line of a real request", async () => {
		const lines: string[] = [];
		vi.spyOn(console, "log").mockImplementation((line) => {
			lines.push(String(line));
		});

		await app.request(
			"/v2/guardian/raw-secret/decline?token=query-secret&code=oauth",
			{
				method: "POST",
				headers: { Origin: "https://evil.example.com" },
			},
		);

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.join("\n")).toContain("/v2/guardian/:token/decline");
		expect(lines.join("\n")).not.toContain("raw-secret");
		expect(lines.join("\n")).not.toContain("query-secret");
		expect(lines.join("\n")).not.toContain("oauth");
	});
});

const oversizedRequest = (
	path: string,
	bytes: number,
	streamed: boolean,
): Request => {
	const chunk = new TextEncoder().encode("x".repeat(bytes));
	const body = streamed
		? new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(chunk);
					controller.close();
				},
			})
		: chunk;
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: {
			Origin: WEB_ORIGIN,
			"Content-Type": "application/json",
			...(streamed ? {} : { "Content-Length": String(bytes) }),
		},
		body,
		...(streamed ? { duplex: "half" } : {}),
	} as RequestInit & { duplex?: "half" });
};

describe("public JSON body limit", () => {
	test.each([
		["/v2/guardian/not-a-real-token/consent", GUARDIAN_CONSENT_MAX_BODY_BYTES],
	] as const)("%s cuts an over-limit Content-Length with 413 before parsing", async (path, max) => {
		const response = await app.request(oversizedRequest(path, max + 1, false));
		expect(response.status).toBe(413);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			WEB_ORIGIN,
		);
	});

	test("a stream with no Content-Length is cut with 413 at the limit too", async () => {
		const response = await app.request(
			oversizedRequest(PUBLIC_POST, GUARDIAN_CONSENT_MAX_BODY_BYTES + 1, true),
		);
		expect(response.status).toBe(413);
	});
});

describe("security headers and the default body limit", () => {
	test.each([
		false,
		true,
	])("the browser reads the 413 even when a generation body exceeds the default limit (streamed=%s)", async (streamed) => {
		const response = await app.request(
			oversizedRequest(
				"/v2/chat/generate",
				DEFAULT_BODY_LIMIT_BYTES + 1,
				streamed,
			),
		);
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ code: "payload_too_large" });
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			WEB_ORIGIN,
		);
		expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
			"true",
		);
		expect(response.headers.get("Vary")).toContain("Origin");
	});

	test("JSON responses carry the security headers too, and CORP is off", async () => {
		const response = await app.request("/v2/health");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		/** The web on another origin loads media via `<img>`, which this header would block. */
		expect(response.headers.get("cross-origin-resource-policy")).toBeNull();
		/** No HSTS in development and tests (http origin). */
		expect(response.headers.get("strict-transport-security")).toBeNull();
	});

	test("a JSON route with no limit of its own is cut with 413 at the default limit", async () => {
		const response = await app.request(
			oversizedRequest(
				"/v2/auth/sign-in/email",
				DEFAULT_BODY_LIMIT_BYTES + 1,
				false,
			),
		);
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ code: "payload_too_large" });
	});

	test("the list of paths with their own limit equals the routes that actually call bodyLimit", () => {
		/**
		 * Too wide a list drops the default cap from that path; too narrow cuts large uploads at 16MiB.
		 * Both are silent.
		 */
		const routesDir = join(import.meta.dirname, "routes");
		const files: Record<string, string> = {
			"/v2/me/avatar": "me/avatar.ts",
			"/v2/me/scene-images": "me/scene-images.ts",
			"/v2/me/runtime-assets": "me/runtime-assets.ts",
			"/v2/me/runtime-audio": "me/runtime-audio.ts",
			"/v2/guardian/": "guardian.ts",
		};
		expect([...ROUTES_WITH_OWN_BODY_LIMIT].sort()).toEqual(
			Object.keys(files).sort(),
		);
		for (const [prefix, file] of Object.entries(files))
			expect(
				readFileSync(join(routesDir, file), "utf8").includes("bodyLimit("),
				prefix,
			).toBe(true);
		expect(
			readFileSync(join(routesDir, "stories", "cover.ts"), "utf8").includes(
				"bodyLimit(",
			),
		).toBe(true);
	});
});
