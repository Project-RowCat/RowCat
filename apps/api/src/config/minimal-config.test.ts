import { describe, expect, test } from "vitest";
import {
	type ComposeAssignment,
	findComposeService,
	parseComposeFile,
} from "./compose-config.ts";
import { readEnvCheckSources } from "./env-check-files.ts";
import {
	buildDoctorReport,
	type CapabilityStatus,
	doctorExitCode,
} from "./env-doctor.ts";
import { resolveEnvironment } from "./env-resolve.ts";

/**
 * The minimum a production deployment needs, pinned by value (`docs/ops/CONFIGURATION.md`, minimal configuration section).
 *
 * The open-source release has no operator behind it, so the first deployment of a fork is usually
 * this: a database, a session key, and the two addresses a browser reaches. Everything the shut-down
 * hosted service filled in (mail, push, Redis, OAuth, identity verification, the provider key) must
 * then read as *off* — `disabled` or `degraded`, never a release blocker. A rule that quietly turns
 * one of those into a blocker makes every fork's first `env:doctor` red, and the next person learns
 * to ignore it.
 *
 * The reverse is pinned too: the two origins really are part of the minimum (loopback-only origins
 * block a production release), so dropping them from the docs would be the lie.
 */

/** Synthetic; RFC 2606 names, and a key and password that exist nowhere. */
const MINIMAL_PRODUCTION: Record<string, string> = {
	DATABASE_URL:
		"postgres://rowcat:0d6f2b9e4a1c7e3b5f8a2d6c9e1b4f70@db.example.internal:5432/rowcat",
	BETTER_AUTH_SECRET: "minimal-config-test-secret-0123456789abcdef",
	API_ORIGIN: "https://api.example.com",
	WEB_ORIGIN: "https://example.com",
};

const minimal = () =>
	buildDoctorReport({ env: MINIMAL_PRODUCTION, mode: "production" });

const statusOf = (id: string): CapabilityStatus | undefined =>
	minimal().capabilities.find((capability) => capability.id === id)?.status;

describe("minimal production setup — DB · session key · two origins", () => {
	test("valid with no release blocker", () => {
		const report = minimal();
		expect(report.valid).toBe(true);
		expect(report.blockers).toEqual([]);
		expect(doctorExitCode(report)).toBe(0);
	});

	test("the core is ready", () => {
		expect(statusOf("database")).toBe("ready");
		expect(statusOf("apiOrigin")).toBe("ready");
		expect(statusOf("browserOrigins")).toBe("ready");
		expect(statusOf("sessionSecret")).toBe("ready");
	});

	/**
	 * Each line is one feature group a fork has not set up yet. `degraded` means "runs, with a cost";
	 * `disabled` means "deliberately off". Neither is `invalid`, and none blocks a release.
	 */
	test("unfilled features are reported as off or degraded and do not block", () => {
		expect(statusOf("transactionalMail")).toBe("disabled");
		expect(statusOf("nativePush")).toBe("disabled");
		expect(statusOf("googleOAuth")).toBe("disabled");
		expect(statusOf("appleSignIn")).toBe("disabled");
		expect(statusOf("kakaoSignIn")).toBe("disabled");
		expect(statusOf("managedGeneration")).toBe("disabled");
		expect(statusOf("mobileUpdateCi")).toBe("disabled");
		expect(statusOf("ageGate")).toBe("disabled");
		expect(statusOf("redisRateLimit")).toBe("degraded");
		expect(statusOf("backgroundJobs")).toBe("degraded");
		expect(statusOf("legalRetention")).toBe("n/a");
	});

	/**
	 * Identity verification stays `blocked` (fail-closed: the adult check answers 503) — that is the
	 * honest state and `env-doctor.test.ts` pins it. What matters here is that it is a capability
	 * state, not a release blocker.
	 */
	test("no identity verification is fail-closed but does not block a release", () => {
		expect(statusOf("identityVerification")).toBe("blocked");
		expect(minimal().blockers).not.toContain("identityVerification");
	});

	/** Web on example.com and API on api.example.com: the cookie domain is the one cost worth reading. */
	test("when web and API hosts differ, the cookie domain is reported as degraded", () => {
		expect(statusOf("sessionCookieDomain")).toBe("degraded");
		const withCookie = buildDoctorReport({
			env: { ...MINIMAL_PRODUCTION, AUTH_COOKIE_DOMAIN: ".example.com" },
			mode: "production",
		});
		expect(
			withCookie.capabilities.find(
				(entry) => entry.id === "sessionCookieDomain",
			)?.status,
		).toBe("ready");
	});

	test("without the two origins it is not minimal — loopback origins block a release", () => {
		const {
			API_ORIGIN: _api,
			WEB_ORIGIN: _web,
			...dbAndSecret
		} = MINIMAL_PRODUCTION;
		const report = buildDoctorReport({ env: dbAndSecret, mode: "production" });
		expect(report.valid).toBe(true);
		expect(report.blockers).toEqual(["browserOrigins"]);
	});

	test("without the session key boot is blocked", () => {
		const { BETTER_AUTH_SECRET: _secret, ...rest } = MINIMAL_PRODUCTION;
		const report = buildDoctorReport({ env: rest, mode: "production" });
		expect(report.valid).toBe(false);
		expect(report.invalidMessage).toContain("BETTER_AUTH_SECRET");
	});
});

/**
 * What `docker compose up` hands the api container when the operator's `.env` holds only the given
 * values. Compose semantics for the three forms the file uses: `${X:-d}` (unset **or empty** → d),
 * `${X:?m}` (unset or empty → compose refuses to start), `${X}`.
 */
function composeApiEnvironment(
	operator: Record<string, string>,
): Record<string, string> {
	const api = findComposeService(
		parseComposeFile(readEnvCheckSources().compose),
		"api",
	);
	if (!api) throw new Error("docker-compose.yml has no api service");
	const interpolate = (raw: string): string =>
		raw.replace(
			/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([^}]*))?\}/g,
			(_match, name: string, kind?: string, rest?: string) => {
				const value = operator[name] ?? "";
				if (value) return value;
				if (kind === "?")
					throw new Error(`compose does not come up without ${name}: ${rest}`);
				return kind === "-" ? (rest ?? "") : "";
			},
		);
	return Object.fromEntries(
		api.environment.map((assignment: ComposeAssignment) => [
			assignment.key,
			interpolate(assignment.raw),
		]),
	);
}

/** Synthetic hex, the shape `openssl rand -hex 24` gives. */
const COMPOSE_DB_PASSWORD = "3c9e1f7a2b5d8e0c4a6f9b1d3e7c2a5f8b0d4e6a9c1f3b7e";

const COMPOSE_SECRETS: Record<string, string> = {
	BETTER_AUTH_SECRET: MINIMAL_PRODUCTION.BETTER_AUTH_SECRET as string,
	POSTGRES_PASSWORD: COMPOSE_DB_PASSWORD,
};

describe("docker compose — does the api service come up with a minimal .env", () => {
	/**
	 * Both are secrets the operator generates; neither has a value this public repository could
	 * supply (`deployment-secrets.ts`).
	 */
	test("compose requires exactly the session key and the database password", () => {
		expect(() =>
			composeApiEnvironment({ POSTGRES_PASSWORD: COMPOSE_DB_PASSWORD }),
		).toThrow("BETTER_AUTH_SECRET");
		expect(() =>
			composeApiEnvironment({
				BETTER_AUTH_SECRET: MINIMAL_PRODUCTION.BETTER_AUTH_SECRET as string,
			}),
		).toThrow("POSTGRES_PASSWORD");
		expect(() => composeApiEnvironment(COMPOSE_SECRETS)).not.toThrow();
	});

	/**
	 * Boot is the authority, not the doctor: the same `resolveEnvironment` `env.ts` calls. A local
	 * `docker compose up` with only the secret boots (loopback origins only warn at boot).
	 */
	test("the api passes boot validation with just the two secrets", () => {
		const resolution = resolveEnvironment(
			composeApiEnvironment(COMPOSE_SECRETS),
		);
		expect(resolution.ok).toBe(true);
	});

	/** An `.env` copied from an older example still holds the old development password. */
	test("the api refuses to boot on the old development database password", () => {
		const resolution = resolveEnvironment(
			composeApiEnvironment({
				...COMPOSE_SECRETS,
				POSTGRES_PASSWORD: "rowcat",
			}),
		);
		expect(resolution.ok).toBe(false);
	});

	test("a public deployment has no release blocker once the two origins are added", () => {
		const env = composeApiEnvironment({
			...COMPOSE_SECRETS,
			API_ORIGIN: "https://api.example.com",
			WEB_ORIGIN: "https://example.com,https://admin.example.com",
		});
		expect(env.NODE_ENV).toBe("production");
		const report = buildDoctorReport({ env, mode: "production" });
		expect(report.valid).toBe(true);
		expect(report.blockers).toEqual([]);
		/** compose fills these two itself, so the in-process fallbacks do not apply there. */
		expect(
			report.capabilities.find((entry) => entry.id === "redisRateLimit")
				?.status,
		).toBe("ready");
		expect(
			report.capabilities.find((entry) => entry.id === "backgroundJobs")
				?.status,
		).toBe("ready");
	});
});
