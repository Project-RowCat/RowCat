import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	buildDoctorReport,
	type CapabilityStatus,
	type DoctorMode,
	doctorExitCode,
} from "./env-doctor.ts";
import { renderDoctorJson, renderDoctorText } from "./env-doctor-render.ts";
import { resolveEnvironment } from "./env-resolve.ts";

/**
 * Checks three things: capability states are right, deliberately disabled features are not reported
 * as errors, and secrets never reach the output. The last is not a snapshot — a snapshot catches
 * "output changed", not "a secret leaked", and the commit approving new copy would approve the
 * secret too — so each planted value is searched for individually.
 */

/** Boots, but enables nothing. */
const MINIMAL: Record<string, string> = {
	NODE_ENV: "development",
	WEB_ORIGIN: "http://localhost:3000",
	API_ORIGIN: "http://localhost:3001",
	DATABASE_URL: "postgres://rowcat:rowcat@localhost:5432/rowcat",
};

/** All synthetic; none exist anywhere real. */
const SECRETS = {
	BETTER_AUTH_SECRET: "super-secret-auth-value",
	OPENROUTER_API_KEY: "sk-rowcat-secret",
	SMTP_PASSWORD: "smtp-secret-password",
	PORTONE_V2_API_SECRET: "portone-secret",
	GOOGLE_CLIENT_SECRET: "google-secret-value",
	APPLE_SIGN_IN_PRIVATE_KEY: "apple-p8-secret-value",
	DATABASE_URL: "postgres://user:db-secret@example.internal/rowcat",
};

const PRODUCTION: Record<string, string> = {
	...MINIMAL,
	NODE_ENV: "production",
	WEB_ORIGIN: "https://example.com,https://admin.example.com",
	API_ORIGIN: "https://api.example.com",
	BETTER_AUTH_SECRET: SECRETS.BETTER_AUTH_SECRET,
	DATABASE_URL: SECRETS.DATABASE_URL,
	REDIS_URL: "redis://redis:6379",
	BACKGROUND_JOBS_ENABLED: "on",
};

const report = (env: Record<string, string>, mode?: DoctorMode) =>
	buildDoctorReport({ env, mode });

const statusOf = (
	env: Record<string, string>,
	id: string,
	mode?: DoctorMode,
): CapabilityStatus | "none" =>
	report(env, mode).capabilities.find((capability) => capability.id === id)
		?.status ?? "none";

describe("minimal development config", () => {
	const built = report(MINIMAL);

	test("valid, and blocks nothing", () => {
		expect(built.valid).toBe(true);
		expect(built.blockers).toEqual([]);
		expect(doctorExitCode(built)).toBe(0);
	});

	/** A diagnostic that reports deliberately disabled features as errors soon gets ignored. */
	test("an optional feature turned off is disabled, not invalid", () => {
		expect(statusOf(MINIMAL, "googleOAuth")).toBe("disabled");
		expect(statusOf(MINIMAL, "appleSignIn")).toBe("disabled");
		expect(statusOf(MINIMAL, "managedGeneration")).toBe("disabled");
		expect(statusOf(MINIMAL, "transactionalMail")).toBe("disabled");
		expect(statusOf(MINIMAL, "nativePush")).toBe("disabled");
		expect(statusOf(MINIMAL, "ageGate")).toBe("disabled");
	});

	test("the mode derives from NODE_ENV", () => {
		expect(report(MINIMAL).mode).toBe("development");
		expect(report({ ...MINIMAL, NODE_ENV: "production" }).mode).toBe(
			"production",
		);
	});
});

describe("production core", () => {
	test("a config with everything in place does not block a release", () => {
		const built = report(PRODUCTION, "production");
		expect(built.valid).toBe(true);
		expect(built.blockers).toEqual([]);
		expect(doctorExitCode(built)).toBe(0);
	});

	test("reads with production rules even under a development NODE_ENV", () => {
		const built = report(
			{ ...PRODUCTION, NODE_ENV: "development", BETTER_AUTH_SECRET: "" },
			"production",
		);
		expect(built.valid).toBe(false);
		expect(built.invalidMessage).toContain("BETTER_AUTH_SECRET");
		expect(doctorExitCode(built)).toBe(1);
	});

	test("does not modify the input object", () => {
		const input = { ...PRODUCTION, NODE_ENV: "development" };
		report(input, "production");
		expect(input.NODE_ENV).toBe("development");
	});

	test("blocks a release when production has only loopback origins", () => {
		const built = report(
			{ ...PRODUCTION, WEB_ORIGIN: "http://localhost:3000" },
			"production",
		);
		expect(built.blockers).toContain("browserOrigins");
		expect(doctorExitCode(built)).toBe(1);
	});

	test("shows the allowed origins as they are", () => {
		const detail = report(PRODUCTION, "production").capabilities.find(
			(capability) => capability.id === "browserOrigins",
		)?.detail;
		expect(detail).toContain("https://admin.example.com");
	});

	test("the database states only scheme, host and name", () => {
		const detail =
			report(PRODUCTION, "production").capabilities.find(
				(capability) => capability.id === "database",
			)?.detail ?? [];
		expect(detail).toContain("host example.internal");
		expect(detail.join(" ")).not.toContain("db-secret");
		expect(detail.join(" ")).not.toContain("user");
	});
});

describe("Redis fallback", () => {
	test("missing is degraded, not an error", () => {
		expect(statusOf({ ...PRODUCTION, REDIS_URL: "" }, "redisRateLimit")).toBe(
			"degraded",
		);
		expect(
			doctorExitCode(report({ ...PRODUCTION, REDIS_URL: "" }, "production")),
		).toBe(0);
	});

	test("present means distributed", () => {
		expect(statusOf(PRODUCTION, "redisRateLimit")).toBe("ready");
	});
});

describe("periodic jobs", () => {
	test("the off state is visible", () => {
		expect(
			statusOf(
				{ ...PRODUCTION, BACKGROUND_JOBS_ENABLED: "" },
				"backgroundJobs",
			),
		).toBe("degraded");
		expect(statusOf(MINIMAL, "backgroundJobs")).toBe("disabled");
	});

	test("says so when the destruction dry-run is on", () => {
		expect(
			statusOf(
				{ ...PRODUCTION, LEGAL_RETENTION_DRY_RUN: "on" },
				"legalRetention",
			),
		).toBe("degraded");
	});

	test("with jobs off, the destruction axis is not applicable", () => {
		expect(statusOf(MINIMAL, "legalRetention")).toBe("n/a");
	});
});

describe("Native push", () => {
	/**
	 * The three states must stay distinct — especially transport-without-jobs, where registration and
	 * notifications succeed while nothing goes out, with no symptom.
	 */
	test("no transport means off, not an error", () => {
		const capability = report(MINIMAL).capabilities.find(
			(entry) => entry.id === "nativePush",
		);
		expect(capability?.status).toBe("disabled");
		expect(capability?.detail.join(" ")).toContain(
			"the in-app inbox works as is",
		);
	});

	test("transport without jobs is not ready", () => {
		const env = { ...MINIMAL, PUSH_TRANSPORT: "expo" };
		expect(statusOf(env, "nativePush")).toBe("degraded");
		const capability = report(env).capabilities.find(
			(entry) => entry.id === "nativePush",
		);
		expect(capability?.detail.join(" ")).toContain("BACKGROUND_JOBS_ENABLED");
	});

	test("transport and jobs together are ready", () => {
		expect(
			statusOf(
				{
					...MINIMAL,
					PUSH_TRANSPORT: "expo",
					BACKGROUND_JOBS_ENABLED: "on",
				},
				"nativePush",
			),
		).toBe("ready");
	});

	/** Prevents a deployment that filled a value and believes push is on. */
	test("an unknown transport blocks boot", () => {
		const built = report({ ...MINIMAL, PUSH_TRANSPORT: "fcm" });
		expect(built.valid).toBe(false);
		expect(built.invalidMessage).toContain("PUSH_TRANSPORT");
	});

	test("the access token's value appears nowhere", () => {
		const env = {
			...MINIMAL,
			PUSH_TRANSPORT: "expo",
			BACKGROUND_JOBS_ENABLED: "on",
			EXPO_ACCESS_TOKEN: "expo-access-secret-value",
		};
		const built = report(env);
		const rendered = `${renderDoctorText(built)}\n${renderDoctorJson(built)}`;
		expect(rendered).not.toContain("expo-access-secret-value");
		expect(rendered).toContain("access token present");
	});
});

describe("mail and email verification", () => {
	const smtp = {
		...MINIMAL,
		MAIL_TRANSPORT: "smtp",
		MAIL_FROM: "RowCat <no-reply@example.com>",
		SMTP_HOST: "smtp.example.com",
		SMTP_USER: "rowcat",
		SMTP_PASSWORD: SECRETS.SMTP_PASSWORD,
	};

	test("says email verification is not required when there is no way to send", () => {
		const capability = report(MINIMAL).capabilities.find(
			(entry) => entry.id === "transactionalMail",
		);
		expect(capability?.status).toBe("disabled");
		expect(capability?.detail.join(" ")).toContain("not required");
	});

	test("verification is required once SMTP is in place", () => {
		const capability = report(smtp).capabilities.find(
			(entry) => entry.id === "transactionalMail",
		);
		expect(capability?.status).toBe("ready");
		expect(capability?.detail.join(" ")).toContain("required");
	});

	/** No connection is attempted, so the report may say "configured", never "reachable". */
	test("does not claim to have checked the connection", () => {
		const capability = report(smtp).capabilities.find(
			(entry) => entry.id === "transactionalMail",
		);
		expect(capability?.detail.join(" ")).toContain("does not try to connect");
	});

	test("half an SMTP config blocks boot itself", () => {
		const built = report({ ...smtp, SMTP_PASSWORD: "" });
		expect(built.valid).toBe(false);
		expect(built.invalidMessage).toContain("SMTP_USER");
	});

	test("the development transport is degraded, and read as production it blocks boot", () => {
		expect(
			statusOf({ ...MINIMAL, MAIL_TRANSPORT: "dev" }, "transactionalMail"),
		).toBe("degraded");
		expect(
			report({ ...PRODUCTION, MAIL_TRANSPORT: "dev" }, "production").valid,
		).toBe(false);
	});
});

/**
 * Reset opens only with both a transport and the switch. The switch exists for a deployment's own
 * documents: a privacy policy may list the mail the company sends as a closed list, and a
 * deployment whose policy does not list the reset mail must stay closed. Mail alone opening reset
 * is the key failure this block guards.
 */
describe("password reset", () => {
	const resetOf = (env: Record<string, string>) => {
		const resolution = resolveEnvironment(env);
		if (!resolution.ok) throw new Error(resolution.message);
		return resolution;
	};

	test("closed with mail alone", () => {
		expect(
			resetOf({ ...MINIMAL, MAIL_TRANSPORT: "dev" }).config
				.passwordResetEnabled,
		).toBe(false);
	});

	test("opens only with both mail and the switch", () => {
		expect(
			resetOf({
				...MINIMAL,
				MAIL_TRANSPORT: "dev",
				PASSWORD_RESET_ENABLED: "on",
			}).config.passwordResetEnabled,
		).toBe(true);
	});

	/** Only `"on"` enables, so a typo folds neither way silently. */
	test.each(["true", "1", "yes", "ON"])("%s does not turn it on", (value) => {
		expect(
			resetOf({
				...MINIMAL,
				MAIL_TRANSPORT: "dev",
				PASSWORD_RESET_ENABLED: value,
			}).config.passwordResetEnabled,
		).toBe(false);
	});

	test("with the switch alone it comes up closed and warns", () => {
		const resolution = resetOf({ ...MINIMAL, PASSWORD_RESET_ENABLED: "on" });
		expect(resolution.config.passwordResetEnabled).toBe(false);
		expect(resolution.warnings.join("\n")).toContain("PASSWORD_RESET_ENABLED");
	});
});

describe("Identity verification", () => {
	const portone = {
		...MINIMAL,
		IDENTITY_VERIFICATION_PROVIDER: "portone",
		PORTONE_STORE_ID: "store-abc",
		PORTONE_IDENTITY_CHANNEL_KEY: "channel-abc",
		PORTONE_V2_API_SECRET: SECRETS.PORTONE_V2_API_SECRET,
	};

	test("with no means, says the two consumers are blocked", () => {
		const capability = report(MINIMAL).capabilities.find(
			(entry) => entry.id === "identityVerification",
		);
		expect(capability?.status).toBe("blocked");
		expect(capability?.detail.join(" ")).toContain("guardian consent");
		expect(capability?.detail.join(" ")).toContain("adult verification");
	});

	test("ready when all three are present", () => {
		expect(statusOf(portone, "identityVerification")).toBe("ready");
	});

	test("half a config is invalid", () => {
		expect(
			statusOf(
				{ ...portone, PORTONE_V2_API_SECRET: "" },
				"identityVerification",
			),
		).toBe("invalid");
	});

	test("read as production, the development verifier blocks boot", () => {
		expect(
			statusOf(
				{ ...MINIMAL, IDENTITY_VERIFICATION_PROVIDER: "dev" },
				"identityVerification",
			),
		).toBe("degraded");
		expect(
			report(
				{ ...PRODUCTION, IDENTITY_VERIFICATION_PROVIDER: "dev" },
				"production",
			).valid,
		).toBe(false);
	});
});

describe("managed generation", () => {
	test("ready when there is a key", () => {
		expect(
			statusOf(
				{ ...MINIMAL, OPENROUTER_API_KEY: SECRETS.OPENROUTER_API_KEY },
				"managedGeneration",
			),
		).toBe("ready");
	});

	/** The model is not deployment configuration; no `CHAT_MODEL` axis is invented. */
	test("does not invent a model setting", () => {
		const capability = report({
			...MINIMAL,
			OPENROUTER_API_KEY: SECRETS.OPENROUTER_API_KEY,
		}).capabilities.find((entry) => entry.id === "managedGeneration");
		expect(capability?.detail.join(" ")).toContain("not deployment config");
	});

	const WITH_KEY = {
		...PRODUCTION,
		OPENROUTER_API_KEY: SECRETS.OPENROUTER_API_KEY,
	};

	/** With no metering, closed is the default: an unset deployment is not open to everyone. */
	test("empty means allowlist, and it says that is the code default", () => {
		const resolution = resolveEnvironment(WITH_KEY);
		expect(resolution.ok && resolution.config.managedGenerationAccess).toBe(
			"allowlist",
		);
		const capability = report(WITH_KEY, "production").capabilities.find(
			(entry) => entry.id === "managedGeneration",
		);
		expect(capability?.status).toBe("ready");
		expect(capability?.summary).toContain("allowlist");
		expect(capability?.detail.join(" ")).toContain("(code default)");
	});

	test("opening it to everyone in production is reported as degraded but does not block a release", () => {
		const env = { ...WITH_KEY, MANAGED_GENERATION_ACCESS: "everyone" };
		const built = report(env, "production");
		expect(statusOf(env, "managedGeneration", "production")).toBe("degraded");
		expect(built.blockers).toEqual([]);
		expect(doctorExitCode(built)).toBe(0);
		expect(doctorExitCode(built, true)).toBe(1);
	});

	test("opening it to everyone in development is normal", () => {
		expect(
			statusOf(
				{
					...MINIMAL,
					OPENROUTER_API_KEY: SECRETS.OPENROUTER_API_KEY,
					MANAGED_GENERATION_ACCESS: "everyone",
				},
				"managedGeneration",
			),
		).toBe("ready");
	});

	test("an unknown value blocks boot", () => {
		const built = report({ ...MINIMAL, MANAGED_GENERATION_ACCESS: "all" });
		expect(built.valid).toBe(false);
		expect(built.invalidMessage).toContain("MANAGED_GENERATION_ACCESS");
	});
});

describe("passkeys", () => {
	test("tells derived from explicit", () => {
		expect(
			report(PRODUCTION).capabilities.find((entry) => entry.id === "webauthn")
				?.summary,
		).toContain("derived");
		expect(
			report({
				...PRODUCTION,
				WEBAUTHN_RP_ID: "example.com",
			}).capabilities.find((entry) => entry.id === "webauthn")?.summary,
		).toContain("explicit");
	});

	test("blocks boot when the rpID does not cover the origin", () => {
		const built = report({ ...PRODUCTION, WEBAUTHN_RP_ID: "evil.com" });
		expect(built.valid).toBe(false);
		expect(built.invalidMessage).toContain("WEBAUTHN_RP_ID");
	});
});

describe("--strict", () => {
	test("by default a degraded state does not count as failure", () => {
		const built = report({ ...PRODUCTION, REDIS_URL: "" }, "production");
		expect(doctorExitCode(built)).toBe(0);
		expect(doctorExitCode(built, true)).toBe(1);
	});
});

describe("no secret in the output", () => {
	const FULL: Record<string, string> = {
		...PRODUCTION,
		...SECRETS,
		MAIL_TRANSPORT: "smtp",
		MAIL_FROM: "RowCat <no-reply@example.com>",
		SMTP_HOST: "smtp.example.com",
		SMTP_USER: "rowcat-smtp",
		GOOGLE_CLIENT_ID: "1234.apps.googleusercontent.com",
		IDENTITY_VERIFICATION_PROVIDER: "portone",
		PORTONE_STORE_ID: "store-abc",
		PORTONE_IDENTITY_CHANNEL_KEY: "channel-abc",
		APPLE_SIGN_IN_CLIENT_ID: "com.projectrowcat.web",
		APPLE_SIGN_IN_TEAM_ID: "ABCDE12345",
		APPLE_SIGN_IN_KEY_ID: "KEYID12345",
		MEMBERSHIP_AGE_GATE: "on",
	};

	/**
	 * The private key must be a real PEM, or boot fails, no capabilities are drawn, and this test
	 * checks nothing.
	 */
	const withRealKey = () => {
		const { privateKey } = generateKeyPairSync("ec", {
			namedCurve: "P-256",
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		return { ...FULL, APPLE_SIGN_IN_PRIVATE_KEY: privateKey };
	};

	const secretLiterals = [
		SECRETS.BETTER_AUTH_SECRET,
		SECRETS.OPENROUTER_API_KEY,
		SECRETS.SMTP_PASSWORD,
		SECRETS.PORTONE_V2_API_SECRET,
		SECRETS.GOOGLE_CLIENT_SECRET,
		"db-secret",
		"BEGIN PRIVATE KEY",
	];

	test("neither in the human-readable output nor in the JSON", () => {
		const env = withRealKey();
		const built = buildDoctorReport({ env, mode: "production" });
		expect(built.valid).toBe(true);

		const text = renderDoctorText(built);
		const json = renderDoctorJson(built);
		for (const secret of secretLiterals) {
			expect(text, `${secret} is in the text output`).not.toContain(secret);
			expect(json, `${secret} is in the JSON output`).not.toContain(secret);
		}
	});

	/** Public values must appear, or the secret check above passes for free. */
	test("public values show as they are", () => {
		const built = buildDoctorReport({
			env: withRealKey(),
			mode: "production",
		});
		const text = renderDoctorText(built);
		expect(text).toContain("https://admin.example.com");
		expect(text).toContain("com.projectrowcat.web");
	});

	test("not in the output for an invalid config either", () => {
		const built = buildDoctorReport({
			env: { ...withRealKey(), WEBAUTHN_RP_ID: "evil.com" },
			mode: "production",
		});
		expect(built.valid).toBe(false);
		const text = renderDoctorText(built);
		const json = renderDoctorJson(built);
		for (const secret of secretLiterals) {
			expect(text).not.toContain(secret);
			expect(json).not.toContain(secret);
		}
	});

	test("the JSON carries capabilities as ids, not values", () => {
		const parsed = JSON.parse(
			renderDoctorJson(
				buildDoctorReport({ env: withRealKey(), mode: "production" }),
			),
		) as {
			mode: string;
			capabilities: Record<string, { status: string }>;
		};
		expect(parsed.mode).toBe("production");
		expect(parsed.capabilities.redisRateLimit?.status).toBe("ready");
		expect(parsed.capabilities.identityVerification?.status).toBe("ready");
	});
});

describe("the IP basis of the sign-in limiter", () => {
	test("an invalid CIDR blocks boot — the library quietly drops that entry", () => {
		const built = report({
			...MINIMAL,
			AUTH_TRUSTED_PROXIES: "10.0.0.0/8, not-an-ip",
		});
		expect(built.valid).toBe(false);
		expect(JSON.stringify(built)).toContain("AUTH_TRUSTED_PROXIES");
	});

	test("a valid list and header name pass", () => {
		const built = report({
			...MINIMAL,
			AUTH_TRUSTED_PROXIES: "10.0.0.0/8,2400:cb00::/32,203.0.113.7",
			AUTH_IP_HEADER: "CF-Connecting-IP",
		});
		expect(built.valid).toBe(true);
	});

	test("both empty in production is a warning", () => {
		const built = report(PRODUCTION);
		expect(
			built.warnings.some((warning) =>
				warning.includes("AUTH_TRUSTED_PROXIES"),
			),
		).toBe(true);
		const withHeader = report({
			...PRODUCTION,
			AUTH_IP_HEADER: "cf-connecting-ip",
		});
		expect(
			withHeader.warnings.some((warning) =>
				warning.includes("AUTH_TRUSTED_PROXIES"),
			),
		).toBe(false);
	});
});
