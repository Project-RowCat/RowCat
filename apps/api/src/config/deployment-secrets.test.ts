import { describe, expect, test } from "vitest";
import {
	authSecretProblem,
	DEVELOPMENT_DATABASE_PASSWORD,
	databaseUrlPassword,
	databaseUrlProblem,
	MIN_AUTH_SECRET_LENGTH,
	PUBLISHED_AUTH_SECRETS,
} from "./deployment-secrets.ts";
import { resolveEnvironment } from "./env-resolve.ts";
import { EnvSchema } from "./env-schema.ts";

/** Synthetic; RFC 2606 names and a key that exists nowhere. */
const PRODUCTION: Record<string, string> = {
	NODE_ENV: "production",
	API_ORIGIN: "https://api.example.com",
	WEB_ORIGIN: "https://example.com",
	DATABASE_URL:
		"postgres://rowcat:5f0c3e9a1b7d2c4e8a6f0b3d9c1e7a52@db.example.internal:5432/rowcat",
	BETTER_AUTH_SECRET: "deployment-secrets-test-key-0123456789abcdef",
};

const boot = (overrides: Record<string, string>) =>
	resolveEnvironment({ ...PRODUCTION, ...overrides });

describe("session key", () => {
	test("a generated key passes", () => {
		expect(authSecretProblem(PRODUCTION.BETTER_AUTH_SECRET as string)).toBe(
			null,
		);
	});

	test("a short key is refused, and the floor is exact", () => {
		expect(authSecretProblem("x".repeat(MIN_AUTH_SECRET_LENGTH - 1))).toContain(
			"at least 32",
		);
		expect(authSecretProblem("x".repeat(MIN_AUTH_SECRET_LENGTH))).toBe(null);
	});

	test("a key this repository publishes is refused even though it is long enough", () => {
		for (const published of PUBLISHED_AUTH_SECRETS) {
			expect(published.length).toBeGreaterThanOrEqual(MIN_AUTH_SECRET_LENGTH);
			expect(authSecretProblem(published)).toContain("published");
		}
	});

	/** Absence has its own, older message in env-resolve; this rule does not answer it twice. */
	test("an empty key is not this rule's to judge", () => {
		expect(authSecretProblem("")).toBe(null);
	});
});

describe("database password", () => {
	test("the password is read from a postgres URL, decoded", () => {
		expect(databaseUrlPassword("postgres://u:p%40ss@db/x")).toBe("p@ss");
		expect(databaseUrlPassword("postgres://u@db/x")).toBe(null);
		expect(databaseUrlPassword("host=db password=rowcat")).toBe(null);
	});

	test("the development password is refused wherever the database is", () => {
		expect(
			databaseUrlProblem(
				`postgres://rowcat:${DEVELOPMENT_DATABASE_PASSWORD}@db:5432/rowcat`,
			),
		).toContain("development password");
		expect(
			databaseUrlProblem("postgres://someone:rowcat@db.example.internal/app"),
		).toContain("development password");
	});

	test("a generated or absent password passes", () => {
		expect(databaseUrlProblem(PRODUCTION.DATABASE_URL as string)).toBe(null);
		expect(databaseUrlProblem("postgres://rowcat@/rowcat?host=/run/pg")).toBe(
			null,
		);
	});

	/** The schema default is the development URL: production with no DATABASE_URL lands on this rule. */
	test("the schema's default URL carries the development password", () => {
		const defaults = EnvSchema.parse({});
		expect(databaseUrlPassword(defaults.DATABASE_URL)).toBe(
			DEVELOPMENT_DATABASE_PASSWORD,
		);
	});
});

describe("boot", () => {
	test("production with generated secrets boots", () => {
		expect(boot({}).ok).toBe(true);
	});

	test("production refuses a short session key", () => {
		const resolution = boot({ BETTER_AUTH_SECRET: "change-me" });
		expect(resolution.ok).toBe(false);
		if (!resolution.ok)
			expect(resolution.message).toContain("BETTER_AUTH_SECRET");
	});

	test("production refuses the development database password", () => {
		const resolution = boot({
			DATABASE_URL: "postgres://rowcat:rowcat@db:5432/rowcat",
		});
		expect(resolution.ok).toBe(false);
		if (!resolution.ok) expect(resolution.message).toContain("DATABASE_URL");
	});

	test("production without DATABASE_URL is refused, not run on the default", () => {
		const { DATABASE_URL: _url, ...rest } = PRODUCTION;
		expect(resolveEnvironment(rest).ok).toBe(false);
	});

	test("development keeps running on the local values", () => {
		expect(
			resolveEnvironment({
				NODE_ENV: "development",
				DATABASE_URL: "postgres://rowcat:rowcat@localhost:5432/rowcat",
				BETTER_AUTH_SECRET: "short",
			}).ok,
		).toBe(true);
	});
});
