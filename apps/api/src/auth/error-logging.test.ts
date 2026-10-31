import { APIError } from "better-auth/api";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, test, vi } from "vitest";
import { app } from "../app.ts";
import { db } from "../db/client.ts";
import { connectTestDatabase } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";
import { auth } from "./index.ts";

/**
 * `/v2/auth/*` is answered by the library's router, so its failures never pass `app.onError`. A
 * failed query there — a pool timeout during sign-in — used to reach the log whole, session token
 * and all. Both of the library's doors now go through the same scrubber.
 */

/** Only the case that goes through the API needs Postgres (sign-up reads the user table first). */
const databaseReady = await connectTestDatabase();

const failedSignIn = (): DrizzleQueryError =>
	new DrizzleQueryError(
		'insert into "session" ("token", "user_id") values ($1, $2)',
		["SESSION-TOKEN-VALUE", "user-1"],
		Object.assign(new Error("timeout exceeded when trying to connect"), {
			code: "57P01",
		}),
	);

const printed = (spy: ReturnType<typeof vi.spyOn>): string =>
	JSON.stringify(spy.mock.calls);

afterEach(() => {
	vi.restoreAllMocks();
});

test("the router's error hook logs the query, not its values, and answers with a 500", () => {
	const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
	// Thrown as an APIError so the HTTP router underneath answers instead of printing it raw.
	expect(() => auth.options.onAPIError?.onError?.(failedSignIn())).toThrow(
		APIError,
	);
	expect(printed(spy)).toContain("insert into");
	expect(printed(spy)).not.toContain("SESSION-TOKEN-VALUE");
});

describe.skipIf(!databaseReady)("through the API", () => {
	/**
	 * Through the API: a query failing inside a sign-up is caught by the library and logged through its
	 * logger. Not every print path is covered — the adapter's fallback join still calls
	 * `console.error` itself (`docs/oss/SECURITY-REVIEW.md`, 남은 것).
	 */
	test("a query failing inside a sign-up reaches the log without its values", async () => {
		const errors = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const warnings = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
		vi.spyOn(db, "insert").mockImplementation(() => {
			throw new DrizzleQueryError(
				'insert into "user" ("email", "password") values ($1, $2)',
				["leak-probe@example.test", "PASSWORD-HASH-VALUE"],
				Object.assign(new Error("timeout exceeded when trying to connect"), {
					code: "57P01",
				}),
			);
		});

		const response = await app.request("/v2/auth/sign-up/email", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
			body: JSON.stringify({
				email: `leak-probe-${Date.now()}@example.test`,
				password: "correct-horse-battery",
				name: "Leak probe",
			}),
		});

		// Sign-up catches the failure itself and logs it through the library's logger (a 422).
		expect(response.ok).toBe(false);
		expect(printed(errors)).toContain("insert into");
		for (const spy of [errors, warnings, logs])
			expect(printed(spy)).not.toContain("PASSWORD-HASH-VALUE");
	});
});

test("the library's own logger is scrubbed the same way", () => {
	const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
	auth.options.logger?.log?.(
		"error",
		"Failed to create session",
		failedSignIn(),
	);
	expect(printed(spy)).not.toContain("SESSION-TOKEN-VALUE");
});

test("an error passed as the logger's message is scrubbed too", () => {
	const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
	auth.options.logger?.log?.("error", failedSignIn() as unknown as string);
	expect(printed(spy)).toContain("insert into");
	expect(printed(spy)).not.toContain("SESSION-TOKEN-VALUE");
});

test("an ordinary refusal is the library's answer, not a log line", () => {
	const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
	auth.options.onAPIError?.onError?.(
		new APIError("UNAUTHORIZED", { message: "Invalid password" }),
	);
	expect(spy).not.toHaveBeenCalled();
});
