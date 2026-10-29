import { resolveEnvironment } from "./config/env-resolve.ts";

/**
 * Process environment: read once here, and bad values kill the process at boot. A server that only
 * fails on `undefined` at the first request passes the health check and takes traffic, with the
 * cause surfacing long after deploy.
 *
 * No rules live in this file. The schema is `config/env-schema.ts`; relations between axes and
 * derivations are `config/env-resolve.ts`. What remains is three side effects: read `process.env`,
 * print diagnostics, exit on bad configuration. The split exists for tooling: `pnpm env:doctor`
 * runs to explain bad configuration and would die on `process.exit(1)` before drawing its diagnosis
 * if it imported this file. Keeping one validator also avoids "the server starts but doctor says it
 * passes".
 *
 * Importing this file takes part in boot. Code that only reads configuration (CLIs, checkers, test
 * harnesses) calls `config/env-resolve.ts` directly.
 */
const resolution = resolveEnvironment(process.env);

for (const warning of resolution.warnings) console.warn(`[env] ${warning}`);

if (!resolution.ok) {
	console.error(`[env] ${resolution.message}`);
	process.exit(1);
}

const config = resolution.config;

export const env = config.env;

export const isProduction = config.isProduction;

/* ── Member eligibility ── */

/**
 * Whether this deployment stands the age-confirmation gate. Unspecified is off. Only `"on"` turns
 * it on: also accepting `"true"`, `"1"` or `"yes"` would let one typo quietly make a deployment
 * that never asks for age, which has no visible symptom.
 */
export const ageGateEnabled = config.ageGateEnabled;

/**
 * Whether the one-year adult re-verification is on. When off, the viewer projection's
 * `adultRecheckRequired` is always `false`; the decision lives only in `auth/viewer.ts`.
 */
export const adultReverificationEnabled = config.adultReverificationEnabled;

/**
 * The identity verifier this deployment uses. Empty means no verification means (guardian consent
 * answers 503). Widen the vocabulary in the same commit that adds the adapter; a bare name would be
 * a means we cannot verify, and code that passes it would eventually appear.
 */
export const identityVerificationProvider = config.identityVerificationProvider;

/** PortOne identity-verification settings; all three must be present to count as configured. */
export const portOneIdentityConfig = config.portOneIdentityConfig;

/** The real address clients must use, e.g. https://api.example.com/v2. */
export const publicApiUrl = config.publicApiUrl;

/** Whitelist of origins browsers call directly. */
export const corsOrigins = config.corsOrigins;

/**
 * This deployment's canonical web origin, for when the server builds absolute web addresses: the
 * first entry of `WEB_ORIGIN`. The rest are other addresses of the same app, but the address a
 * guardian returns to from the verification provider must be a single fixed one; a client-supplied
 * value would be an open redirect that sends a child's consent link to another site.
 */
export const webOrigin = config.webOrigin;

/** Login redirect allowlist; defaults to the same set as the CORS whitelist. */
export const trustedOrigins = config.trustedOrigins;

/** IP basis of the login limiter: trusted proxy list and the header the proxy overwrites (`env-schema.ts`). */
export const authTrustedProxies = config.authTrustedProxies;
export const authIpHeader = config.authIpHeader;

/** Google sign-in turns on only when both credentials are present; a half configuration is a runtime 500. */
export const googleEnabled = config.googleEnabled;

/**
 * This deployment's Sign in with Apple config; `null` leaves the method off. It is a config object
 * rather than a secret string because Apple's `client_secret` is a short-lived JWT signed per
 * request; one value built at boot would silently expire in a long-lived process
 * (`lib/apple-signin-config.ts`).
 */
export const appleSignIn = config.appleSignIn;

/** Whether Apple sign-in is usable; provider registration and trusted origins read this. */
export const appleSignInEnabled = appleSignIn !== null;

/**
 * Whether Kakao login is usable; the REST API key alone decides. The Client Secret stays out of the
 * decision, unlike Google, because it is an optional security setting toggled in the Kakao console,
 * so its absence can be a normal configuration (`config/env-schema.ts`).
 */
export const kakaoEnabled = config.kakaoEnabled;

/**
 * Whether generation can actually run. It does not block boot: the gallery and auth work without a
 * provider, and refusing to start the API for a missing key would make local development
 * impossible. Only generation requests are refused with 503.
 */
export const chatProviderEnabled = config.chatProviderEnabled;

/**
 * The provider endpoint to call. There is no model here: managed models are chosen by the user, the
 * public-identity to upstream-slug table is `services/generation/managed-models.ts`, and the
 * product default is decided by code (`DEFAULT_MANAGED_MODEL` in `@rowcat/contracts`), not
 * environment.
 */
export const openRouterBaseUrl = config.openRouterBaseUrl;

/**
 * Who may use managed generation: `allowlist` (default) | `everyone`. With no metering in the
 * open-source deployment this and the rate limits are the two guards on the operator's bill. On
 * `allowlist`, members with `member.managed_generation_allowed` and staff/admin may use it;
 * everyone else gets 403 `chat_managed_not_allowed`.
 */
export const managedGenerationAccess = config.managedGenerationAccess;

/**
 * The CI connection the operations console's OTA publish job calls. It holds a token. `null` makes
 * publish requests 503 and the screen draws no publish button.
 */
export const mobileUpdateCiConfig = config.mobileUpdateCi;

/* ── Outbound mail (transactional) ── */

export type { MailTransportConfig, SmtpConfig } from "./lib/mail-config.ts";

/** The mail transport this deployment uses; `null` means no delivery means. */
export const mailTransportConfig = config.mailTransportConfig;

/** Whether verification mail can actually be sent. */
export const mailEnabled = config.mailEnabled;

/**
 * Native push transport; without it the delivery job is not registered. Registrations and delivery
 * rows are created regardless of this value: deliveries piling up on a deployment with it off
 * expire with their lifetime while notifications stay in the inbox (`db/tables/push.ts`).
 */
export const pushTransportConfig = config.pushTransportConfig;

/** Whether the value above exists; job registration and diagnostics split on this. */
export const pushEnabled = config.pushEnabled;

/**
 * Whether email ownership verification is required, derived from the existence of a delivery means.
 * There is deliberately no separate switch: one would make "required but cannot send"
 * representable, and on that deployment every new signup would be blocked.
 */
export const emailVerificationRequired = config.emailVerificationRequired;

/**
 * Whether password reset is open: mail transport and `PASSWORD_RESET_ENABLED=on` both present. Auth
 * config registers the sender from this value and public runtime config carries the same value so
 * screens draw no dead link; the decision is this one line.
 */
export const passwordResetEnabled = config.passwordResetEnabled;

/* ── Passkeys (WebAuthn) ── */

export type { WebAuthnConfig } from "./lib/webauthn-config.ts";

/** This deployment's WebAuthn config; the slot that keeps the plugin from deriving values from headers. */
export const webauthnConfig = config.webauthnConfig;

/* ── Redis (rate limiting) ── */

/** The Redis rate-limit counters attach to; `null` means no distributed store. */
export const redisUrl = config.redisUrl;

/* ── Background jobs ── */

/** Whether this process runs periodic jobs. Unspecified is off. */
export const backgroundJobsEnabled = config.backgroundJobsEnabled;

/** Whether statutory-retention destruction only counts. Unspecified is real destruction. */
export const legalRetentionDryRun = config.legalRetentionDryRun;

/** IANA time zone used to interpret daily job times. */
export const backgroundJobsTimeZone = config.backgroundJobsTimeZone;

/** Time of day the daily jobs run (in the zone above). */
export const backgroundJobsDailyAt = config.backgroundJobsDailyAt;
