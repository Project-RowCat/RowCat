import type { ComposeOwnership } from "./compose-config.ts";

/**
 * Ownership table for environment variables: which deployment surface sets a value, where it is
 * documented, and whether it may reach a browser.
 *
 * `env-schema.ts` says what the API runtime knows, but not four things: whether compose passes,
 * fixes or assembles a value; which example file documents it; whether it ships in a browser
 * bundle; whether it is secret. Those used to live in people's memory, which is where drift leaked.
 *
 * Values never go here (default ports, provider endpoints, model names, secrets) — they keep their
 * own sources (runtime parser, `managed-models.ts`, compose). This table holds classification only;
 * adding values would create a second source for them.
 *
 * The three example files have different jobs and stay separate: `.env.example` is the compose
 * deployment, `apps/api/.env.example` runs the API without compose (`pnpm dev:api`), and
 * `apps/web/.env.example` holds local web overrides (no server settings). The rule is not "every
 * key in every file" but "each value has exactly one intended deployment path".
 */

/** What a leak would cost. Never guessed from the prefix — PortOne has two public values and one secret. */
export type EnvSensitivity = "secret" | "public" | "non-secret";

/**
 * `documented` means the key appears in that file, as an active or commented-out assignment.
 * Whether it has a value is not asked: values with defaults are left commented by convention, and
 * both mean "a value this deployment may choose".
 */
export type ExamplePresence = "documented" | "absent";

export type EnvGroup =
	| "core"
	| "database"
	| "redis"
	| "jobs"
	| "auth"
	| "mail"
	| "push"
	| "webauthn"
	| "generation"
	| "identity"
	| "membership"
	| "mobile-updates"
	| "client"
	| "tooling";

export interface EnvComposeSurface {
	in: "environment" | "build-args";
	services: readonly string[];
	ownership: ComposeOwnership;
}

export interface EnvironmentVariableDefinition {
	key: string;
	group: EnvGroup;
	sensitivity: EnvSensitivity;

	surfaces: {
		/** Cross-checked against `env-schema.ts` in both directions. */
		apiRuntime?: true;
		compose?: EnvComposeSurface;
		rootExample?: ExamplePresence;
		apiExample?: ExamplePresence;
		webExample?: ExamplePresence;
		/** Baked into a browser bundle; a secret can never have this. */
		webBuild?: true;
		adminBuild?: true;
		mobileBuild?: true;
	};

	/**
	 * A secret that may be committed with a value in an example file. Named exceptions only
	 * (`DATABASE_URL`, `POSTGRES_PASSWORD`), and the checker verifies the value is a loopback
	 * connection string or exactly the compose default — anything else is a new credential, not a
	 * placeholder.
	 */
	allowsLocalExampleValue?: true;

	operator?: {
		/** Whether the value changes outcomes in production; the doctor sorts on this. */
		productionRelevant?: boolean;
		description?: string;
	};
}

const api = (ownership: ComposeOwnership): EnvComposeSurface => ({
	in: "environment",
	services: ["api"],
	ownership,
});

/** Fixed by the container; api and web each pin the same key. */
const fixedRuntime: EnvComposeSurface = {
	in: "environment",
	services: ["api", "web"],
	ownership: "fixed",
};

export const ENVIRONMENT_INVENTORY: readonly EnvironmentVariableDefinition[] = [
	{
		key: "NODE_ENV",
		group: "core",
		sensitivity: "non-secret",
		surfaces: { apiRuntime: true, compose: fixedRuntime },
		operator: {
			productionRelevant: true,
			description:
				"fixed by the container. In a direct run the runner decides it, so the examples do not list it",
		},
	},
	{
		key: "HOST",
		group: "core",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: fixedRuntime,
			apiExample: "documented",
		},
		operator: {
			description: "the container opens on 0.0.0.0 — compose fixes it",
		},
	},
	{
		key: "PORT",
		group: "core",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: fixedRuntime,
			apiExample: "documented",
		},
		operator: {
			description:
				"compose fixes the ports (3000/3001/3002) — not changed through .env",
		},
	},
	{
		key: "WEB_ORIGIN",
		group: "core",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"origins whose browsers call the API directly (CSV). The operations console origin must be here too",
		},
	},
	{
		key: "API_ORIGIN",
		group: "core",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description: "the origin at which this API is seen from outside",
		},
	},
	{
		key: "DATABASE_URL",
		group: "database",
		sensitivity: "secret",
		allowsLocalExampleValue: true,
		surfaces: {
			apiRuntime: true,
			compose: api("derived"),
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"compose assembles it from POSTGRES_* — the root example has those",
		},
	},
	{
		key: "DATABASE_POOL_MAX",
		group: "database",
		sensitivity: "non-secret",
		surfaces: { apiRuntime: true, apiExample: "documented" },
		operator: {
			description:
				"compose does not pass this value — the code default is used. Tuning is for direct runs and orchestrators",
		},
	},
	{
		key: "POSTGRES_USER",
		group: "database",
		sensitivity: "non-secret",
		surfaces: {
			compose: { in: "environment", services: ["db"], ownership: "operator" },
			rootExample: "documented",
		},
		operator: {
			description:
				"compose's db init values. DATABASE_URL is assembled from them",
		},
	},
	{
		key: "POSTGRES_PASSWORD",
		group: "database",
		sensitivity: "secret",
		allowsLocalExampleValue: true,
		surfaces: {
			compose: { in: "environment", services: ["db"], ownership: "operator" },
			rootExample: "documented",
		},
		operator: { productionRelevant: true },
	},
	{
		key: "POSTGRES_DB",
		group: "database",
		sensitivity: "non-secret",
		surfaces: {
			compose: { in: "environment", services: ["db"], ownership: "operator" },
			rootExample: "documented",
		},
	},

	{
		key: "REDIS_URL",
		group: "redis",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"empty makes rate limiting fall back to an in-process counter — with two or more replicas the ceiling is multiplied by that many",
		},
	},

	{
		key: "BACKGROUND_JOBS_ENABLED",
		group: "jobs",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"scheduler for orphan media cleanup, retention destruction and push delivery",
		},
	},
	{
		key: "BACKGROUND_JOBS_DAILY_AT",
		group: "jobs",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "BACKGROUND_JOBS_TIMEZONE",
		group: "jobs",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "LEGAL_RETENTION_DRY_RUN",
		group: "jobs",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description: "left on and forgotten, expired records are never destroyed",
		},
	},

	{
		key: "BETTER_AUTH_SECRET",
		group: "auth",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the only thing that stops session cookies from being forged",
		},
	},
	{
		key: "AUTH_TRUSTED_ORIGINS",
		group: "auth",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "AUTH_COOKIE_DOMAIN",
		group: "auth",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { productionRelevant: true },
	},
	{
		key: "AUTH_TRUSTED_PROXIES",
		group: "auth",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { productionRelevant: true },
	},
	{
		key: "AUTH_IP_HEADER",
		group: "auth",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { productionRelevant: true },
	},
	{
		key: "GOOGLE_CLIENT_ID",
		group: "auth",
		sensitivity: "public",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "GOOGLE_CLIENT_SECRET",
		group: "auth",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	/*
	 * Sign in with Apple: four values as one unit — any one missing blocks boot — so all four share
	 * the same operator-filled surface.
	 */
	{
		key: "APPLE_SIGN_IN_CLIENT_ID",
		group: "auth",
		sensitivity: "public",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the Services ID. Apple sign-in turns on only when all four are filled",
		},
	},
	{
		key: "APPLE_SIGN_IN_TEAM_ID",
		group: "auth",
		sensitivity: "public",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { productionRelevant: true },
	},
	{
		key: "APPLE_SIGN_IN_KEY_ID",
		group: "auth",
		sensitivity: "public",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { productionRelevant: true },
	},
	{
		/**
		 * The raw `.p8` contents. It alone can impersonate our app to Apple, so it must never appear in
		 * logs, examples or diagnostics.
		 */
		key: "APPLE_SIGN_IN_PRIVATE_KEY",
		group: "auth",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the contents of the `.p8` file (not a path). Newlines may be written as \\n",
		},
	},

	/*
	 * Kakao: two values, the second optional, so unlike Apple they are not one unit. The only
	 * dangerous mismatch (Client Secret enabled in the console, empty here) is reported by the doctor.
	 */
	{
		key: "KAKAO_REST_API_KEY",
		group: "auth",
		sensitivity: "public",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the Kakao console's **REST API key**. Not the native app key, JavaScript key or Admin key — this one value turns Kakao sign-in on",
		},
	},
	{
		key: "KAKAO_CLIENT_SECRET",
		group: "auth",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the Client Secret under Kakao Login > Security. Needed only when it is set to 'enabled' in the console; empty in that state, sign-in fails after the user finishes it",
		},
	},

	{
		key: "MAIL_TRANSPORT",
		group: "mail",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description: "this value turns email ownership verification on",
		},
	},
	{
		key: "MAIL_FROM",
		group: "mail",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "SMTP_HOST",
		group: "mail",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "SMTP_PORT",
		group: "mail",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "SMTP_SECURE",
		group: "mail",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "SMTP_USER",
		group: "mail",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "SMTP_PASSWORD",
		group: "mail",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "PASSWORD_RESET_ENABLED",
		group: "mail",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"must be on for password reset to open (MAIL_TRANSPORT is needed too) · turn it on only when the deployment's privacy policy lists the reset mail",
		},
	},
	{
		key: "PUSH_TRANSPORT",
		group: "push",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"this value actually sends pushes — registrations and delivery records are created even when it is empty",
		},
	},
	{
		key: "EXPO_ACCESS_TOKEN",
		group: "push",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},

	{
		key: "WEBAUTHN_RP_ID",
		group: "webauthn",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { productionRelevant: true },
	},
	{
		key: "WEBAUTHN_ORIGIN",
		group: "webauthn",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},
	{
		key: "WEBAUTHN_RP_NAME",
		group: "webauthn",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
	},

	{
		key: "OPENROUTER_API_KEY",
		group: "generation",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"empty makes only managed generation 503; everything else comes up as is",
		},
	},
	{
		key: "OPENROUTER_BASE_URL",
		group: "generation",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			description:
				"empty uses the code default. The model is not environment config",
		},
	},

	{
		key: "MANAGED_GENERATION_ACCESS",
		group: "generation",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"allowlist (default) | everyone. There is no metering, so who may use managed generation is who may grow this key's bill",
		},
	},

	{
		key: "IDENTITY_VERIFICATION_PROVIDER",
		group: "identity",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"empty makes both guardian consent and adult verification 503",
		},
	},
	{
		key: "PORTONE_STORE_ID",
		group: "identity",
		sensitivity: "public",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { description: "a public value designed to go to the browser" },
	},
	{
		key: "PORTONE_IDENTITY_CHANNEL_KEY",
		group: "identity",
		sensitivity: "public",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: { description: "a public value designed to go to the browser" },
	},
	{
		key: "PORTONE_V2_API_SECRET",
		group: "identity",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the only key for looking up identity verification results — kept on the server only",
		},
	},

	{
		key: "MEMBERSHIP_AGE_GATE",
		group: "membership",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description: "age gate rollout switch",
		},
	},
	{
		key: "ADULT_REVERIFICATION_ENABLED",
		group: "membership",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"on closes adult content to members whose adult verification is over a year old · turn it on only when the deployment's published documents state that re-verification",
		},
	},

	{
		key: "VITE_API_ORIGIN",
		group: "client",
		sensitivity: "public",
		surfaces: {
			compose: {
				in: "environment",
				services: ["web", "admin"],
				ownership: "operator",
			},
			rootExample: "documented",
			webExample: "documented",
			webBuild: true,
			adminBuild: true,
		},
		operator: {
			productionRelevant: true,
			description:
				"the API origin the browser calls (web and console) — a runtime value the containers hand the browser, with the build-time value as fallback. Empty means the local API (localhost:3001), so production deployments must fill it",
		},
	},
	{
		key: "VITE_ADMIN_ORIGIN",
		group: "client",
		sensitivity: "public",
		surfaces: {
			compose: {
				in: "environment",
				services: ["web"],
				ownership: "operator",
			},
			rootExample: "documented",
			webExample: "documented",
			webBuild: true,
		},
		operator: {
			productionRelevant: true,
			description:
				"the operations console origin — what the operations tool link on the account screen points at. Empty means that link is not drawn (there is no production default)",
		},
	},
	{
		key: "API_INTERNAL_ORIGIN",
		group: "client",
		sensitivity: "non-secret",
		surfaces: {
			compose: { in: "environment", services: ["web"], ownership: "operator" },
			rootExample: "documented",
		},
		operator: {
			description:
				"the address the web's server render uses to call the API — a different axis from the browser's VITE_API_ORIGIN",
		},
	},
	{
		key: "EXPO_PUBLIC_API_ORIGIN",
		group: "client",
		sensitivity: "public",
		surfaces: { mobileBuild: true },
		operator: {
			description:
				"baked into the mobile bundle. No default (an EAS build stops when it is empty or an example.com placeholder). Having no example file is intended — apps/mobile/README.md describes how",
		},
	},

	{
		key: "OTA_CI_GITHUB_REPOSITORY",
		group: "mobile-updates",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the repository (owner/repo) that runs the console's OTA publish and rollback — fill it together with the token and channels, or leave all empty",
		},
	},
	{
		key: "OTA_CI_GITHUB_TOKEN",
		group: "mobile-updates",
		sensitivity: "secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"a token with only Actions write access on that repository — not signing authority (the signing key lives only in CI environment secrets)",
		},
	},
	{
		key: "OTA_CI_CHANNELS",
		group: "mobile-updates",
		sensitivity: "non-secret",
		surfaces: {
			apiRuntime: true,
			compose: api("operator"),
			rootExample: "documented",
			apiExample: "documented",
		},
		operator: {
			productionRelevant: true,
			description:
				"the OTA channels this deployment registers for (CSV) — production for a production deployment, testflight for a TestFlight one",
		},
	},

	{
		key: "COMPOSE_BAKE",
		group: "tooling",
		sensitivity: "non-secret",
		surfaces: { rootExample: "documented" },
		operator: {
			description: "read by docker compose — does not go into a service",
		},
	},
	{
		key: "ROWCAT_IMAGE_REGISTRY",
		group: "tooling",
		sensitivity: "non-secret",
		surfaces: { rootExample: "documented" },
		operator: {
			description:
				"read by docker compose — which registry the three app images come from (default: the published GHCR images)",
		},
	},
	{
		key: "ROWCAT_IMAGE_TAG",
		group: "tooling",
		sensitivity: "non-secret",
		surfaces: { rootExample: "documented" },
		operator: {
			description:
				"read by docker compose — which image tag to run (default `latest`; pin `sha-<commit>` in a deployment)",
		},
	},
	{
		key: "BUILDX_BUILDER",
		group: "tooling",
		sensitivity: "non-secret",
		surfaces: { rootExample: "documented" },
		operator: {
			description: "read by docker buildx — does not go into a service",
		},
	},
];
