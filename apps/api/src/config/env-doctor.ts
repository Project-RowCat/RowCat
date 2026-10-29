import { type ResolvedEnvironment, resolveEnvironment } from "./env-resolve.ts";

/**
 * What works and what does not under this configuration. `env:check` asks whether the repository
 * agrees with itself (no secrets, CI); `env:doctor` reads real values right before a deploy.
 *
 * - The unit is a capability, not a variable: "the key is set" is something the operator already
 *   knows; what they need is whether managed generation works and what that means for the product.
 * - Secrets are never put in, rather than scrubbed out. `detail` holds public values only
 *   (origins, rpID, scheme and host); secrets enter only after being folded into a verdict.
 *   Redacting known literals after formatting misses secrets not in the inventory, typos and error
 *   messages.
 * - No live connections (SMTP, provider, PortOne, DB). The report can say "configured", never
 *   "reachable" — blurring the two makes the operator believe they verified something they did not.
 */

export type CapabilityStatus =
	| "ready"
	| "disabled"
	| "degraded"
	| "blocked"
	| "invalid"
	| "n/a";

export type CapabilityGroup =
	| "core"
	| "auth"
	| "infra"
	| "mail"
	| "push"
	| "identity"
	| "generation"
	| "membership";

export interface CapabilityFact {
	id: string;
	group: CapabilityGroup;
	label: string;
	status: CapabilityStatus;
	/** A classification, not a value. */
	summary: string;
	/** Public values and product consequences. Never secrets. */
	detail: string[];
	/**
	 * Whether this state blocks a release under `--mode production`. A different axis from boot
	 * validation (which already shows as `invalid`): states that are fine in development but do not
	 * hold in a real production deployment.
	 */
	blocksRelease?: true;
}

export type DoctorMode = "development" | "production";

export interface DoctorReport {
	mode: DoctorMode;
	/** Where values were read from. Never file contents. */
	source: string;
	valid: boolean;
	/** The same sentence boot prints for an invalid configuration. */
	invalidMessage: string | null;
	warnings: string[];
	capabilities: CapabilityFact[];
	blockers: string[];
}

export interface DoctorInput {
	env: Record<string, unknown>;
	mode?: DoctorMode;
	source?: string;
}

/**
 * The non-credential parts of a connection string. A printer that calls `new URL(...)` itself will
 * eventually print the userinfo and put the password on stdout; exposing only these three fields is
 * the guarantee.
 */
export interface DatabaseIdentity {
	scheme: string;
	host: string;
	/** `null` for an empty path — no invented empty name. */
	database: string | null;
}

export function databaseIdentity(url: string): DatabaseIdentity | null {
	try {
		const parsed = new URL(url);
		const database = parsed.pathname.replace(/^\//, "");
		return {
			scheme: parsed.protocol.replace(/:$/, ""),
			host: parsed.hostname,
			database: database || null,
		};
	} catch {
		return null;
	}
}

/** A rendering of `databaseIdentity`, not a second parser. */
function describeDatabase(url: string): string[] {
	const identity = databaseIdentity(url);
	if (!identity) return [];
	return [
		`scheme ${identity.scheme}`,
		`host ${identity.host}`,
		...(identity.database ? [`database ${identity.database}`] : []),
	];
}

const hostOf = (origin: string): string | null => {
	try {
		return new URL(origin).hostname;
	} catch {
		return null;
	}
};

function coreCapabilities(
	config: ResolvedEnvironment,
	mode: DoctorMode,
): CapabilityFact[] {
	const loopbackOnly = config.corsOrigins.every((origin) => {
		const host = hostOf(origin);
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "::1" ||
			(host?.endsWith(".localhost") ?? false)
		);
	});

	return [
		{
			id: "database",
			group: "core",
			label: "Database",
			status: "ready",
			summary: "configured",
			detail: [
				...describeDatabase(config.env.DATABASE_URL),
				`connection cap per instance ${config.env.DATABASE_POOL_MAX}`,
				"does not try to connect — all it can say here is that it is configured",
			],
		},
		{
			id: "apiOrigin",
			group: "core",
			label: "Public API address",
			status: "ready",
			summary: config.publicApiUrl,
			detail: [],
		},
		{
			id: "browserOrigins",
			group: "core",
			label: "Browser origins",
			status: loopbackOnly && mode === "production" ? "degraded" : "ready",
			summary: `${config.corsOrigins.length} allowed`,
			detail: [
				...config.corsOrigins,
				...(loopbackOnly && mode === "production"
					? [
							"a production deployment with only loopback — every browser request from the public domain is blocked by CORS",
							"the operations console (apps/admin) origin must be in this list too",
						]
					: []),
			],
			...(loopbackOnly && mode === "production"
				? { blocksRelease: true as const }
				: {}),
		},
	];
}

function authCapabilities(config: ResolvedEnvironment): CapabilityFact[] {
	const apiHost = hostOf(config.env.API_ORIGIN);
	const webHost = hostOf(config.webOrigin);
	const crossHost = Boolean(apiHost && webHost && apiHost !== webHost);
	const cookieDomain = config.env.AUTH_COOKIE_DOMAIN;

	return [
		{
			id: "sessionSecret",
			group: "auth",
			label: "Session signing key",
			status: config.env.BETTER_AUTH_SECRET ? "ready" : "degraded",
			summary: config.env.BETTER_AUTH_SECRET ? "configured" : "not configured",
			detail: config.env.BETTER_AUTH_SECRET
				? []
				: [
						"production does not boot in this state — it is the only thing that stops session cookies from being forged",
					],
		},
		{
			id: "googleOAuth",
			group: "auth",
			label: "Google sign-in",
			status: config.googleEnabled ? "ready" : "disabled",
			summary: config.googleEnabled ? "configured" : "not configured",
			detail: config.googleEnabled
				? []
				: [
						"turns on only when both credentials are present — half a config becomes a runtime 500",
					],
		},
		{
			id: "appleSignIn",
			group: "auth",
			label: "Apple sign-in",
			status: config.appleSignIn ? "ready" : "disabled",
			summary: config.appleSignIn ? "configured" : "not configured",
			detail: config.appleSignIn
				? [
						`Services ID ${config.appleSignIn.clientId}`,
						`the callback ${config.publicApiUrl.replace(/\/$/, "")}/auth/callback/apple must be registered as a Return URL of that Services ID`,
						"the client secret is signed at request time — no value made at boot is carried around",
					]
				: [
						"the four go together — boot is blocked with any one missing (all empty simply means off)",
					],
		},
		{
			id: "kakaoSignIn",
			group: "auth",
			label: "Kakao sign-in",
			/**
			 * No `degraded`: that would require knowing whether Client Secret is enabled in the Kakao
			 * console, which this process cannot see. An enabled deployment always gets the line telling the
			 * operator to match the pair instead.
			 */
			status: config.kakaoEnabled ? "ready" : "disabled",
			summary: config.kakaoEnabled
				? config.kakaoClientSecretSet
					? "configured · Client Secret present"
					: "configured · no Client Secret"
				: "not configured",
			detail: config.kakaoEnabled
				? [
						`the callback ${config.publicApiUrl.replace(/\/$/, "")}/auth/callback/kakao must be registered as a Redirect URI of the Kakao app`,
						/**
						 * Kakao also checks the Web platform's site domain, separately from the Redirect URI. Here
						 * the callback lives on the API domain, so registering only the web domain looks complete and
						 * still fails with KOE006.
						 */
						`${new URL(config.publicApiUrl).origin} must also be in Platform > Web's site domains — in this deployment the callback sits on the **API domain**, not the web, so registering only the web domain gives KOE006 (unregistered Redirect URI)`,
						config.kakaoClientSecretSet
							? "this value is used only when the Kakao console's Client Secret is set to 'enabled'"
							: "if the Kakao console's Client Secret is set to 'enabled', KAKAO_CLIENT_SECRET is mandatory — without it, the token exchange fails after the user finishes Kakao sign-in",
						"the consent items must include Kakao account (email) — if the user declines that consent, no account is created",
					]
				: [
						"one REST API key turns this method on (the Client Secret is an optional setting in the Kakao console)",
					],
		},
		{
			id: "sessionCookieDomain",
			group: "auth",
			label: "Session cookie domain",
			status: cookieDomain ? "ready" : crossHost ? "degraded" : "n/a",
			summary: cookieDomain
				? cookieDomain
				: crossHost
					? "not set"
					: "same origin — not needed",
			detail:
				!cookieDomain && crossHost
					? [
							`web (${webHost}) and API (${apiHost}) have different hosts, but AUTH_COOKIE_DOMAIN is empty`,
							"without a cookie on the parent domain, the browser does not send the session to the API",
						]
					: [],
		},
		{
			id: "webauthn",
			group: "auth",
			label: "Passkeys (WebAuthn)",
			status: "ready",
			summary: config.webauthnRpIdDerived
				? "derived from the web origin"
				: "set explicitly",
			detail: [
				`rpID ${config.webauthnConfig.rpId}`,
				`verified origins ${config.webauthnConfig.origins.join(", ")}${
					config.webauthnOriginsDerived ? " (derived from WEB_ORIGIN)" : ""
				}`,
			],
		},
	];
}

function infraCapabilities(
	config: ResolvedEnvironment,
	mode: DoctorMode,
): CapabilityFact[] {
	const jobs = config.backgroundJobsEnabled;
	return [
		{
			id: "redisRateLimit",
			group: "infra",
			label: "Rate-limit counters",
			status: config.redisUrl ? "ready" : "degraded",
			summary: config.redisUrl ? "distributed (Redis)" : "in-process",
			detail: config.redisUrl
				? []
				: [
						"accurate on a single instance — with two or more replicas the ceiling is multiplied by the replica count",
						"REDIS_URL is optional, which is why this state is not folded into an error",
					],
		},
		{
			id: "backgroundJobs",
			group: "infra",
			label: "periodic jobs",
			status: jobs ? "ready" : mode === "production" ? "degraded" : "disabled",
			summary: jobs
				? `on · daily jobs at ${String(config.backgroundJobsDailyAt.hour).padStart(2, "0")}:${String(config.backgroundJobsDailyAt.minute).padStart(2, "0")} ${config.backgroundJobsTimeZone}`
				: "off",
			detail: jobs
				? ["orphan media cleanup · retention destruction"]
				: [
						"orphan media cleanup and retention destruction do not run",
						...(mode === "production"
							? [
									"normal for a deployment where this process has no scheduler (a dedicated worker) — the diagnosis does not turn it on instead",
								]
							: []),
					],
		},
		{
			id: "mobileUpdateCi",
			group: "infra",
			label: "Mobile OTA publish jobs",
			/**
			 * Off is `disabled`, not an error: the console still reads, rolls out, pauses and resumes, and
			 * publishing goes through the CLI. On without background jobs is `degraded`.
			 */
			status: !config.mobileUpdateCi ? "disabled" : jobs ? "ready" : "degraded",
			summary: config.mobileUpdateCi
				? `${config.mobileUpdateCi.repository} · ${config.mobileUpdateCi.channels.join(", ")}`
				: "not configured",
			detail: config.mobileUpdateCi
				? [
						"the operations console starts the GitHub Actions workflow (mobile-ota.yml) — signing is done by that workflow's environment secrets",
						...(jobs
							? []
							: [
									"periodic jobs are off — if a CI report is lost, that channel's job never finishes",
								]),
					]
				: [
						"the operations console can read releases and roll out, pause and resume — publish and rollback go through the CLI (pnpm mobile:update)",
					],
		},
		{
			id: "legalRetention",
			group: "infra",
			label: "Retention destruction",
			status: !jobs
				? "n/a"
				: config.legalRetentionDryRun
					? "degraded"
					: "ready",
			summary: !jobs
				? "periodic jobs are off"
				: config.legalRetentionDryRun
					? "counting only (dry-run)"
					: "actually destroys",
			detail:
				jobs && config.legalRetentionDryRun
					? [
							"left on and forgotten, expired records are never destroyed — a violation with no symptom",
						]
					: [],
		},
	];
}

function mailCapability(config: ResolvedEnvironment): CapabilityFact {
	const transport = config.mailTransportConfig;
	/**
	 * Reset has its own switch (`PASSWORD_RESET_ENABLED`) even with a transport. Both transport
	 * branches state it, or the operator reads "mail configured" as "reset open".
	 */
	const resetLine = config.passwordResetEnabled
		? "password reset is open"
		: "password reset is closed — PASSWORD_RESET_ENABLED is not on";
	if (transport === null)
		return {
			id: "transactionalMail",
			group: "mail",
			label: "Transactional mail",
			status: "disabled",
			summary: "no way to send",
			detail: [
				"email ownership verification is not required — sign-up has no verification step",
				"email change and password reset do not open",
			],
		};

	if (transport.kind === "dev")
		return {
			id: "transactionalMail",
			group: "mail",
			label: "Transactional mail",
			status: "degraded",
			summary: "development transport (writes to the log)",
			detail: [
				"no mail goes out, and verification links are printed to the server console",
				"production does not boot with this value",
				"email ownership verification is required",
				resetLine,
			],
		};

	return {
		id: "transactionalMail",
		group: "mail",
		label: "Transactional mail",
		status: "ready",
		summary: `SMTP configured · ${transport.smtp.host}:${transport.smtp.port}`,
		detail: [
			transport.smtp.secure
				? "TLS from connection time"
				: "upgraded via STARTTLS",
			transport.smtp.auth ? "authenticated" : "unauthenticated relay",
			"email ownership verification is required",
			resetLine,
			"does not try to connect — all it can say here is that it is configured",
		],
	};
}

/**
 * Native push distinguishes three states: off (no transport; the inbox still works), ready
 * (transport and delivery job), and configured-but-not-sending (transport, but this process runs no
 * jobs). The last is the quietest failure in this layer — registration succeeds and notifications
 * are created while nothing goes out — so it is never folded into `ready`.
 *
 * Whether the mobile app ships `expo-notifications` does not enter this verdict; the question is
 * whether the server can use the token.
 */
function pushCapability(config: ResolvedEnvironment): CapabilityFact {
	const transport = config.pushTransportConfig;
	if (transport === null)
		return {
			id: "nativePush",
			group: "push",
			label: "Native push",
			status: "disabled",
			summary: "no transport",
			detail: [
				"pushes do not go out — the in-app inbox works as is (read state, history and destinations)",
				"registrations and delivery records keep being created, and expire when their lifetime passes",
			],
		};

	if (!config.backgroundJobsEnabled)
		return {
			id: "nativePush",
			group: "push",
			label: "Native push",
			status: "degraded",
			summary: "transport configured · the delivery job does not run",
			detail: [
				"BACKGROUND_JOBS_ENABLED is off, so this process sends no deliveries",
				"registration succeeds and notifications are created — a state with no symptom, which is why it is said here",
			],
		};

	return {
		id: "nativePush",
		group: "push",
		label: "Native push",
		status: "ready",
		summary: `Expo configured${transport.accessToken ? " · access token present" : " · no access token"}`,
		detail: [
			transport.accessToken
				? "sending is authenticated as this project"
				: "sends without auth — if push security is on in the Expo account, a token is needed",
			"does not try to connect — all it can say here is that it is configured",
			"a delivery failure does not roll back the notification — the inbox is still the authority",
		],
	};
}

function identityCapability(config: ResolvedEnvironment): CapabilityFact {
	const consumers = [
		"guardian consent (sign-up under 14)",
		"the member's own adult verification",
	];

	if (!config.identityVerificationProvider)
		return {
			id: "identityVerification",
			group: "identity",
			label: "Identity verification",
			status: "blocked",
			summary: "no verification means",
			detail: [
				`both procedures are blocked with 503 — ${consumers.join(" · ")}`,
				"fail-closed. There is no path that records consent without verification",
			],
		};

	if (config.identityVerificationProvider === "dev")
		return {
			id: "identityVerification",
			group: "identity",
			label: "Identity verification",
			status: "degraded",
			summary: "development verifier (lets anyone through)",
			detail: [
				"production does not boot with this value",
				`procedures that open: ${consumers.join(" · ")}`,
			],
		};

	if (config.identityVerificationProvider === "portone")
		return config.portOneIdentityConfig
			? {
					id: "identityVerification",
					group: "identity",
					label: "Identity verification",
					status: "ready",
					summary: "PortOne configured",
					detail: [
						`procedures that open: ${consumers.join(" · ")}`,
						"the store id and channel key are public values that go to the browser; only the API secret stays on the server",
						"does not query the verification authority — whether the contract and channel are active can't be known here",
					],
				}
			: {
					id: "identityVerification",
					group: "identity",
					label: "Identity verification",
					status: "invalid",
					summary: "half a PortOne config",
					detail: [
						"PORTONE_STORE_ID · PORTONE_IDENTITY_CHANNEL_KEY · PORTONE_V2_API_SECRET must all be present",
						`with a value missing, it folds to having no verifier — ${consumers.join(" · ")} are 503`,
					],
				};

	return {
		id: "identityVerification",
		group: "identity",
		label: "Identity verification",
		status: "invalid",
		summary: "a name is set but there is no adapter",
		detail: [
			"an unknown verifier name is not let through — so one typo cannot create unverified consent",
		],
	};
}

/**
 * Managed generation puts "is there a key" and "who may use it" on one card. With no metering, the
 * next question after filling the key is who can grow its bill; split apart, operators check the
 * key and stop.
 */
function generationCapability(
	config: ResolvedEnvironment,
	mode: DoctorMode,
): CapabilityFact {
	const open = config.managedGenerationAccess === "everyone";
	/**
	 * Open to everyone in production is `degraded`: a legitimate choice, but one whose only remaining
	 * defence is the rate limit, and that should be read once before deploying.
	 */
	const openInProduction =
		mode === "production" && config.chatProviderEnabled && open;
	const accessLine = open
		? "MANAGED_GENERATION_ACCESS=everyone — any signed-in member generates with the operator's key. The only defence left is the per-member rate limit"
		: `MANAGED_GENERATION_ACCESS=allowlist${
				config.managedGenerationAccessDerived ? " (code default)" : ""
			} — only listed members and staff/admin use it. Everyone else gets 403 chat_managed_not_allowed and goes BYO`;
	return {
		id: "managedGeneration",
		group: "generation",
		label: "managed generation",
		status: !config.chatProviderEnabled
			? "disabled"
			: openInProduction
				? "degraded"
				: "ready",
		summary: config.chatProviderEnabled
			? `configured · ${config.managedGenerationAccess}`
			: "no provider key",
		detail: [
			`provider endpoint ${config.openRouterBaseUrl}${
				config.openRouterBaseUrlDerived ? " (code default)" : ""
			}`,
			...(config.chatProviderEnabled
				? [
						accessLine,
						"there is no metering — every generation cost goes to this key's bill",
						"the model is not deployment config — the code holds the catalogue and users choose",
					]
				: [
						"only generation requests become 503 — the gallery, auth and sync come up as is",
						"BYO generation never passes through this server, so it is unaffected by this value",
					]),
		],
	};
}

function membershipCapability(config: ResolvedEnvironment): CapabilityFact {
	return {
		id: "ageGate",
		group: "membership",
		label: "Age gate",
		status: config.ageGateEnabled ? "ready" : "disabled",
		summary: config.ageGateEnabled ? "on" : "off",
		detail: config.ageGateEnabled
			? [
					"an entry gate stands in front of members whose age has not been checked",
				]
			: [
					"age is not asked yet — this switch does not apply to members already confirmed as under 14",
				],
	};
}

/**
 * Read-only. `--mode production` overrides `NODE_ENV` because the question is "what happens if this
 * boots in production" — on a dev machine "boot is blocked" is a normal answer worth knowing early.
 * The input object is copied, never mutated.
 */
export function buildDoctorReport(input: DoctorInput): DoctorReport {
	const mode: DoctorMode =
		input.mode ??
		(input.env.NODE_ENV === "production" ? "production" : "development");

	const effective =
		mode === "production"
			? { ...input.env, NODE_ENV: "production" }
			: input.env;

	const resolution = resolveEnvironment(effective);
	const source = input.source ?? "process environment";

	if (!resolution.ok)
		return {
			mode,
			source,
			valid: false,
			invalidMessage: resolution.message,
			warnings: resolution.warnings,
			capabilities: [],
			blockers: [],
		};

	const config = resolution.config;
	const capabilities: CapabilityFact[] = [
		...coreCapabilities(config, mode),
		...authCapabilities(config),
		...infraCapabilities(config, mode),
		mailCapability(config),
		pushCapability(config),
		identityCapability(config),
		generationCapability(config, mode),
		membershipCapability(config),
	];

	return {
		mode,
		source,
		valid: true,
		invalidMessage: null,
		warnings: resolution.warnings,
		capabilities,
		blockers: capabilities
			.filter((capability) => capability.blocksRelease)
			.map((capability) => capability.id),
	};
}

/** Deliberately disabled features are not failures. */
export function doctorExitCode(report: DoctorReport, strict = false): 0 | 1 {
	if (!report.valid) return 1;
	if (report.blockers.length > 0) return 1;
	if (
		strict &&
		(report.warnings.length > 0 ||
			report.capabilities.some(
				(capability) =>
					capability.status === "degraded" ||
					capability.status === "invalid" ||
					capability.status === "blocked",
			))
	)
		return 1;
	return 0;
}
