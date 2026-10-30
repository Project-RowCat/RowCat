import { describe, expect, test } from "vitest";
import { CAPABILITY_VARIABLES } from "./capability-variables.ts";
import { buildDoctorReport } from "./env-doctor.ts";
import { ENV_SCHEMA_KEYS } from "./env-schema.ts";

/**
 * The table and the doctor must name the same capabilities. A capability added to the doctor with no
 * row here would reach the console's readiness list with nothing to set, and a stale row would sit
 * unread; neither raises an error on its own.
 *
 * Capability ids vary by branch only in status, not in id, but some appear only under some configs,
 * so the union is taken over a spread: minimal, everything on, and production.
 */

const MINIMAL: Record<string, string> = {
	NODE_ENV: "development",
	WEB_ORIGIN: "http://localhost:3000",
	API_ORIGIN: "http://localhost:3001",
	DATABASE_URL: "postgres://rowcat:rowcat@localhost:5432/rowcat",
};

const LOADED: Record<string, string> = {
	...MINIMAL,
	BETTER_AUTH_SECRET: "synthetic",
	REDIS_URL: "redis://redis:6379",
	BACKGROUND_JOBS_ENABLED: "on",
	MAIL_TRANSPORT: "dev",
	PUSH_TRANSPORT: "expo",
	OPENROUTER_API_KEY: "synthetic",
	IDENTITY_VERIFICATION_PROVIDER: "dev",
	MEMBERSHIP_AGE_GATE: "on",
	GOOGLE_CLIENT_ID: "synthetic",
	GOOGLE_CLIENT_SECRET: "synthetic",
	KAKAO_REST_API_KEY: "synthetic",
};

const PRODUCTION: Record<string, string> = {
	...MINIMAL,
	NODE_ENV: "production",
	WEB_ORIGIN: "https://example.com",
	API_ORIGIN: "https://api.example.com",
	BETTER_AUTH_SECRET: "synthetic",
};

function emittedIds(): Set<string> {
	const ids = new Set<string>();
	for (const env of [MINIMAL, LOADED, PRODUCTION]) {
		const report = buildDoctorReport({ env });
		expect(report.valid, report.invalidMessage ?? "").toBe(true);
		for (const capability of report.capabilities) ids.add(capability.id);
	}
	return ids;
}

describe("capability variables", () => {
	test("every capability the doctor emits has a row, and no row is stale", () => {
		const emitted = emittedIds();
		expect([...emitted].sort()).toEqual(
			Object.keys(CAPABILITY_VARIABLES).sort(),
		);
	});

	test("every name is a variable the runtime knows", () => {
		const known = new Set(ENV_SCHEMA_KEYS);
		for (const [id, names] of Object.entries(CAPABILITY_VARIABLES)) {
			expect(names.length, id).toBeGreaterThan(0);
			for (const name of names)
				expect(known.has(name), `${id}: ${name}`).toBe(true);
		}
	});
});
