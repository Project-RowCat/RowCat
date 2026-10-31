import { PRODUCT_TIME_ZONE } from "@rowcat/domain";
import { z } from "zod";

/**
 * The environment variables the API runtime knows; the only list of them in this repository.
 *
 * Split from `env.ts` because the schema is pure while `env.ts` is the boot facade: it reads
 * `process.env` and calls `process.exit(1)` on bad values, so importing it can kill the process.
 * Config-inspecting tools (`env:check`, `env:doctor`) would die without saying anything about the
 * state they were meant to diagnose. There is still one validator (`resolveEnvironment` in
 * `env-resolve.ts`) shared by boot and the CLI.
 *
 * Only shape and defaults belong here. Relations between axes (half-configurations, rpID covering
 * the origin) live in `env-resolve.ts`; which deployment surface owns a value lives in
 * `env-inventory.ts`.
 *
 * Read and validated once, here. Bad values fail at boot; otherwise the server would pass health
 * checks, take traffic, and blow up on `undefined` at the first request.
 */
export const EnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	HOST: z.string().default("127.0.0.1"),
	PORT: z.coerce.number().int().min(1).max(65535).default(3001),
	/** Browser-callable origin allowlist (CSV). No wildcards. */
	WEB_ORIGIN: z.string().default("http://localhost:3000"),
	/**
	 * The API's public origin. Used instead of HOST/PORT to build absolute URLs: behind a proxy the
	 * bind address differs from the public one, and the Host header is client-controlled.
	 */
	API_ORIGIN: z.url().default("http://localhost:3001"),

	DATABASE_URL: z
		.string()
		.min(1)
		.default("postgres://rowcat:rowcat@localhost:5432/rowcat"),
	/**
	 * Connection cap per instance. Total load on the DB is instances times this value, so lower it to
	 * stay under Postgres `max_connections` when scaling out.
	 */
	DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

	/**
	 * Counter store for distributed rate limiting. Empty falls back to an in-process counter.
	 *
	 * Optional on purpose: local dev and tests run without Redis, and requiring it would force Redis
	 * on every developer. In production an empty value is warned loudly at boot, because with more
	 * than one replica the in-process counter multiplies the limit by the replica count. Not
	 * rate-limit-specific: any later Redis use (session secondary store, SSE broker) goes through this
	 * same variable.
	 */
	REDIS_URL: z.string().default(""),

	/**
	 * Whether this process runs periodic jobs: `on` | `off`; empty means off.
	 *
	 * Off by default because of what the switch guards: one job performs irreversible destruction
	 * (statutory retention expiry) and another sends push to real devices. If they ran just because a
	 * module was imported, every laptop, CI runner, migration script and Playwright helper would get
	 * its own scheduler.
	 *
	 * Only `"on"` enables it. Also accepting `"true"`/`"1"` would let a typo produce a quietly
	 * disabled deployment (same judgement as `MEMBERSHIP_AGE_GATE`).
	 *
	 * Every replica with this on has a scheduler; overlap is prevented by the Postgres advisory lock
	 * (`jobs/lock.ts`), not by assuming a single container.
	 */
	BACKGROUND_JOBS_ENABLED: z.string().default(""),
	/**
	 * Time of day (`HH:MM`) for daily jobs, in `BACKGROUND_JOBS_TIMEZONE`.
	 *
	 * The host time zone is deliberately not read: container `TZ` is set by the image, orchestrator
	 * and platform, so relying on it would run destruction at a different time per deployment of the
	 * same commit. The exact minute is not a correctness condition (expiry is a `cutoff` comparison
	 * and rows missed are found by the next run); night is chosen only for low traffic.
	 */
	BACKGROUND_JOBS_DAILY_AT: z.string().default("03:00"),
	/** IANA time zone for the time above. Defaults to the product zone (`PRODUCT_TIME_ZONE`). */
	BACKGROUND_JOBS_TIMEZONE: z.string().default(PRODUCT_TIME_ZONE),
	/**
	 * Counts statutory-retention destruction without performing it: `on` or `off`.
	 *
	 * A rollout switch: leave it on for the first days after deploy, check the logged candidate count,
	 * then turn it off. Off is the default because forgetting it on means the destruction the policy
	 * promises never happens (a Korean Personal Information Protection Act art. 21 violation) with no visible symptom.
	 *
	 * It does not enable unresolved legal categories. What may be destroyed is decided by the registry
	 * in `jobs/legal/retention-policies.ts`, regardless of this value.
	 */
	LEGAL_RETENTION_DRY_RUN: z.string().default(""),

	/**
	 * Session cookie signing key. Empty in production blocks boot: booting on a development default
	 * would give every deployed instance the same key, and sessions could be forged.
	 */
	BETTER_AUTH_SECRET: z.string().default(""),
	/**
	 * Origins allowed as post-login return targets. Empty uses WEB_ORIGIN. Nothing outside the
	 * allowlist is redirected to, to prevent open redirects.
	 */
	AUTH_TRUSTED_ORIGINS: z.string().default(""),
	/**
	 * Cookie domain for the session. Set to `.example.com` when API (api.example.com) and web
	 * (example.com) are different subdomains so the browser sends the cookie to the API; empty for the
	 * same origin.
	 */
	AUTH_COOKIE_DOMAIN: z.string().default(""),
	/**
	 * How the login/signup limiters find the client address (`lib/client-ip.ts`). With both empty it
	 * is the connecting socket, which is right when the API is reached directly; behind a proxy every
	 * visitor arrives from the proxy and shares its bucket, so one of the two is needed there.
	 *
	 * `AUTH_TRUSTED_PROXIES` is CDN/load balancer IPs or CIDRs (CSV). Forwarding headers are believed
	 * only from a connection in this list; `X-Forwarded-For` is walked from the right and the first
	 * untrusted hop is the client. `AUTH_IP_HEADER` is a single header the proxy **overwrites** (e.g.
	 * `cf-connecting-ip`) and is checked first; set alone it is believed from any connection, so the
	 * API port must then be reachable only through that proxy. Both empty warns in production.
	 */
	AUTH_TRUSTED_PROXIES: z.string().default(""),
	AUTH_IP_HEADER: z.string().default(""),
	/**
	 * Whether this deployment may have a local owner: the administrator created at first setup with
	 * no account, whom a browser on the same computer is then signed in as (`POST /v2/setup/claim-local`,
	 * `POST /v2/auth/local-sign-in`). Only `"on"` opens those two doors; otherwise the claim answers 403
	 * `setup_local_unavailable` (the console then offers the account path) and the sign-in answers 404.
	 *
	 * The one-computer installer sets it (`apps/desktop/src/stack.ts`); a server deployment leaves it
	 * empty. The doors also ask whether the request is from this computer (`lib/local-request.ts`), but
	 * that answer rests on the TCP peer being loopback, and anything on the same machine that relays
	 * remote traffic without announcing itself — `socat`, an SSH tunnel, `ngrok tcp`, nginx with a bare
	 * `proxy_pass` — makes every remote request loopback. On a server that is a normal shape, so the
	 * deployment states the fact instead of the request proving it.
	 */
	LOCAL_OWNER_ENABLED: z.string().default(""),
	GOOGLE_CLIENT_ID: z.string().default(""),
	GOOGLE_CLIENT_SECRET: z.string().default(""),
	/*
	 * Sign in with Apple: the four values are one bundle, and a missing one blocks boot
	 * (`lib/apple-signin-config.ts`). A half-configuration fails only after the user finishes signing
	 * in on Apple's screen, and nothing on screen points at our configuration.
	 *
	 * Unlike Google there is no secret to paste: `client_secret` is a short-lived JWT signed with the
	 * private key below. Why a pre-signed JWT is not accepted via env is in that file's header (it
	 * expires silently).
	 */

	/** Services ID (web), not the app bundle id. */
	APPLE_SIGN_IN_CLIENT_ID: z.string().default(""),
	/** Apple developer team id (10 chars). */
	APPLE_SIGN_IN_TEAM_ID: z.string().default(""),
	/** Key ID of the `.p8` key; becomes `kid` in the signing header. */
	APPLE_SIGN_IN_KEY_ID: z.string().default(""),
	/** The **contents** of the `.p8` file, not a path; newlines may be written as `\n`. */
	APPLE_SIGN_IN_PRIVATE_KEY: z.string().default(""),

	/*
	 * Kakao login is a third shape: the second value is optional, so "only the first filled" can be a
	 * valid configuration rather than a typo.
	 *
	 * - Google: on only with both; a half is just a typo and stays quietly off
	 * - Apple: four values as one bundle; a half blocks boot (multi-line key, different mistake
	 *   shape)
	 * - Kakao: on with the first alone; the second is an optional security setting in the Kakao
	 *   console
	 *
	 * The second is not required because deployments without Client Secret enabled in the console
	 * exist. Diagnostics (`env-doctor.ts`) instead state the one dangerous direction: enabled in the
	 * console but empty here makes token exchange fail after the user finishes signing in.
	 */

	/**
	 * The **REST API key** from the Kakao developer console.
	 *
	 * Not named `KAKAO_CLIENT_ID` because the console has four keys (native app, JavaScript, REST API,
	 * Admin), all called "key"; a client-id name does not say which to copy, and a wrong key fails
	 * only after login completes. The Admin key must never go here (it can manage users).
	 */
	KAKAO_REST_API_KEY: z.string().default(""),
	/**
	 * Client Secret under Kakao Login > Security. Must match the console's activation state. Empty is
	 * valid, so it is not enforced (see above).
	 */
	KAKAO_CLIENT_SECRET: z.string().default(""),

	/**
	 * Platform model key. Server-only: once it reaches the browser anyone can call models on our
	 * account, which is why generation goes through this server instead of calling the provider from
	 * the client.
	 *
	 * Empty makes the generation endpoint answer 503. No fake response is substituted, because a
	 * deployment with missing config would look healthy while users think the model got worse.
	 */
	OPENROUTER_API_KEY: z.string().default(""),
	/**
	 * Provider endpoint, open so staging can swap in a proxy. The empty string is allowed explicitly
	 * in the union: with `z.url()` alone, the empty string compose passes would block boot, killing
	 * deployments that never use this value.
	 */
	OPENROUTER_BASE_URL: z.union([z.literal(""), z.url()]).default(""),
	/**
	 * Who may use managed generation: `allowlist` | `everyone`; empty means allowlist.
	 *
	 * This open-source release has no metering. Managed generation runs on the operator's
	 * `OPENROUTER_API_KEY` with no way to charge users, so only the per-member rate limit
	 * (`lib/rate-limit`) and this allowlist limit spending.
	 *
	 * - `allowlist`: members with `member.managed_generation_allowed = true` and staff/admin roles;
	 *   others get 403 `chat_managed_not_allowed` and go to BYO
	 * - `everyone`: every signed-in member; only rate limits remain
	 *
	 * Closed is the default because otherwise anyone who signs up once the key is filled spends the
	 * operator's money, discovered through the provider's invoice rather than a symptom. A value
	 * outside the vocabulary blocks boot so code never guesses which way to fold a typo.
	 */
	MANAGED_GENERATION_ACCESS: z.string().default(""),

	/**
	 * Whether this deployment turns on the age-check gate: `on` | `off`; empty means off.
	 *
	 * Off by default because of rollout order: the column migration makes every existing member
	 * `unknown` instantly, and if the age screen and revised legal documents are not deployed yet they
	 * lose the whole app with no explanation. Turn it on after schema, server, screens and documents
	 * are all up (rollout section of `docs/membership/ARCHITECTURE.md`).
	 *
	 * The switch does not apply to members already confirmed as children: turning it off only means
	 * age is not asked yet, while "under 14 without guardian consent" stays true regardless.
	 */
	MEMBERSHIP_AGE_GATE: z.string().default(""),
	/**
	 * Whether the one-year adult re-verification is on: `on`, or empty meaning off.
	 *
	 * When on, members whose last adult verification is over a year old lose adult viewing until they
	 * verify again (the Korean Juvenile Protection Act Enforcement Decree art. 17(2): a member check can stand in for re-verification for one
	 * year). Publishing eligibility is unaffected.
	 *
	 * A separate switch because a deployment's own documents decide whether they state this
	 * re-verification, and one whose documents do not must leave it empty. Turning it on in a running
	 * deployment is unfavourable to members, so fill it only after the deployment's own notice of that
	 * change has run its course.
	 */
	ADULT_REVERIFICATION_ENABLED: z.string().default(""),
	/**
	 * Identity verification provider: `portone` | `dev`; empty means no verification means.
	 *
	 * Not guardian-consent-specific. Verification is a capability (`services/identity/`), and empty
	 * blocks **every** consumer: today guardian consent (under-14 signup) and a member's own adult
	 * check, both refused with 503 (fail-closed). No fake verifier fills the default because that
	 * would record unverified consent as verified.
	 *
	 * `dev` blocks boot in production (check below) because that adapter passes everyone. Adding an
	 * authority adds a value here and an adapter under `services/guardian/`. There is no dev-only HTTP
	 * route; dev and production share endpoints and differ only in the adapter this setting picks.
	 */
	IDENTITY_VERIFICATION_PROVIDER: z.string().default(""),
	/**
	 * PortOne V2 store id. Designed to be public to the browser: it travels through the contract
	 * (`IdentityVerificationHandoff`, used by the guardian-consent and account screens). Noted here
	 * because next to the secret below all three look secret, and they are handled differently.
	 */
	PORTONE_STORE_ID: z.string().default(""),
	/** PortOne identity-verification channel key. Public like the store id. */
	PORTONE_IDENTITY_CHANNEL_KEY: z.string().default(""),
	/**
	 * PortOne V2 API secret. Server-only: it is the only key for looking up verification results, so
	 * the client cannot do the lookup. If it reached the browser, guardian consent would become a
	 * procedure anyone could query and claim any value on (same axis as `OPENROUTER_API_KEY`).
	 */
	PORTONE_V2_API_SECRET: z.string().default(""),

	/**
	 * Whether this deployment actually sends authentication mail: `smtp` | `dev`; empty means no
	 * delivery means.
	 *
	 * SMTP rather than a provider API because no commercial mail provider has operational config in
	 * this repository. Choosing Resend, SES or SendGrid is an operations decision (contracts, pricing,
	 * domain authentication); SMTP is the common surface all of them offer.
	 *
	 * `dev` blocks boot in production (check below): it sends no mail and logs verification links, so
	 * anyone able to read logs could verify any account's email (same judgement as
	 * `IDENTITY_VERIFICATION_PROVIDER=dev`).
	 *
	 * Empty means email verification is not required (`emailVerificationRequired`). Requiring it
	 * without being able to send leaves accounts that can sign up but never sign in, which is worse
	 * than not enabling verification.
	 */
	MAIL_TRANSPORT: z.string().default(""),
	/**
	 * Sender; `"RowCat <no-reply@example.com>"` form is accepted. No default: mail from a domain we do
	 * not own fails SPF/DKIM and users only see "no mail arrives".
	 */
	MAIL_FROM: z.string().default(""),
	SMTP_HOST: z.string().default(""),
	/** 587 (STARTTLS) by default. 465 is implicit TLS and goes with `SMTP_SECURE=true`. */
	SMTP_PORT: z.preprocess(
		(value) => (value === "" || value === undefined ? undefined : value),
		z.coerce.number().int().min(1).max(65535).default(587),
	),
	/** Whether TLS from connect (465). Empty upgrades via STARTTLS. */
	SMTP_SECURE: z.string().default(""),
	/**
	 * SMTP credentials. Never logged (`no-secret-logging.test.ts` already matches `secret` and
	 * `password`).
	 *
	 * Both empty is allowed because an unauthenticated relay (internal MTA) is a valid setup. A
	 * **half** blocks boot (below): a username without a password fails at the auth step, which would
	 * surface only after someone presses signup.
	 */
	SMTP_USER: z.string().default(""),
	SMTP_PASSWORD: z.string().default(""),
	/**
	 * Whether password reset is open: `on` | empty; empty means closed.
	 *
	 * A mail transport alone never opens it. The separate switch exists because of documents, not
	 * technology: a privacy policy may close the list of mail the company sends, so turn it on only if
	 * your deployment's own privacy policy lists the reset mail. Otherwise leave it empty, the same
	 * shape as leaving Apple/Kakao credentials empty.
	 *
	 * It actually opens only with `MAIL_TRANSPORT` **and** this value (`passwordResetEnabled`). This
	 * value alone warns: opening a reset that cannot send leaves "sent" with nothing arriving.
	 *
	 * Only `"on"` enables it (same judgement as `BACKGROUND_JOBS_ENABLED`).
	 */
	PASSWORD_RESET_ENABLED: z.string().default(""),

	/**
	 * Transport that actually sends push: `expo` | empty (do not send).
	 *
	 * Empty is the default, and delivery rows are still recorded then. That split is the point:
	 * recording a delivery when a notification is created is bookkeeping (same transaction), while the
	 * outbound request is transport. Turning transport on later changes no code.
	 *
	 * Without it the delivery job is not registered at all, so ordinary local development never pushes
	 * to real devices.
	 */
	PUSH_TRANSPORT: z.string().default(""),

	/**
	 * Expo access token; a secret.
	 *
	 * Optional. Without it Expo Push Service accepts unauthenticated requests (holding the token is
	 * the authorization); with it, sends are authenticated to this project. Required on accounts with
	 * Expo's "enhanced security". There is no half-configuration: `PUSH_TRANSPORT` alone turns push on
	 * and this layers authentication on top.
	 */
	EXPO_ACCESS_TOKEN: z.string().default(""),

	/**
	 * Relying Party ID: the domain passkeys bind to. Empty uses the web origin's host.
	 *
	 * Not derived from request headers, which is why these two values exist. Without config the plugin
	 * uses `baseURL`'s host (the **API domain**) as rpID and the `Origin` header as the verification
	 * origin; both are wrong here, since the ceremony happens on the **web origin** and `Origin` can
	 * be set to anything by non-browser clients.
	 *
	 * To share passkeys across subdomains, set the parent domain (e.g. `example.com`). The rpID must
	 * be a registrable suffix of the web origin host or boot is blocked: a mismatched value makes the
	 * browser reject registration, which looks like a device problem rather than configuration.
	 */
	WEBAUTHN_RP_ID: z.string().default(""),
	/**
	 * Origins allowed to perform the ceremony (CSV). Empty reuses the `WEB_ORIGIN` list. A list
	 * because preview deployments and old domains may share one rpID. Never falls back to the `Origin`
	 * header: letting it into verification would void WebAuthn's origin binding.
	 */
	WEBAUTHN_ORIGIN: z.string().default(""),
	/** Name shown in the browser's passkey list; user-visible, so the deployment chooses it. */
	WEBAUTHN_RP_NAME: z.string().default(""),

	/**
	 * **GitHub repository** (`owner/repo`) that runs the operations console's publish and rollback
	 * requests.
	 *
	 * Fill this and the two below together or leave all empty. Empty keeps the console able to read
	 * releases and press rollout, pause and resume, but removes the publish button (publishing then
	 * goes through the CLI); that is a valid deployment.
	 *
	 * The signing key never reaches this deployment: these values only start one CI workflow, and the
	 * workflow's environment secret (`ota-<channel>`) does the signing (`docs/ota/ARCHITECTURE.md`).
	 */
	OTA_CI_GITHUB_REPOSITORY: z.string().default(""),
	/**
	 * Token that starts that repository's workflow; a secret.
	 *
	 * Make it as narrow as possible: a fine-grained token or GitHub App installation token with only
	 * `Actions: read and write` on this one repository, never repository admin or contents write. If
	 * the API is compromised, this value must not allow more than re-running a permitted branch's
	 * workflow.
	 */
	OTA_CI_GITHUB_TOKEN: z.string().default(""),
	/**
	 * Channels this deployment registers (CSV subset of `preview,testflight,production`). Each
	 * channel's bundle has a fixed API origin, so a production deployment does not accept TestFlight
	 * releases. Publish requests for a channel outside the list get 400, earlier than a registration
	 * rejected after reaching CI.
	 */
	OTA_CI_CHANNELS: z.string().default(""),
});

export type EnvValues = z.infer<typeof EnvSchema>;

/**
 * Every key the API runtime knows; the drift check uses this list as the authority. There is no
 * hand-written copy, so a key added to the schema grows this array and its absence from the
 * inventory shows up in the check immediately.
 */
export const ENV_SCHEMA_KEYS: readonly string[] = Object.freeze(
	Object.keys(EnvSchema.shape).sort(),
);
