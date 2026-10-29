import { isIP } from "node:net";
import { API_BASE_PATH } from "@rowcat/contracts/http";
import { z } from "zod";
import {
	type AppleSignInConfig,
	resolveAppleSignInConfig,
} from "../lib/apple-signin-config.ts";
import {
	type MailTransportConfig,
	resolveMailConfig,
} from "../lib/mail-config.ts";
import {
	type MobileUpdateCiConfig,
	resolveMobileUpdateCiConfig,
} from "../lib/mobile-update-ci-config.ts";
import { isLoopbackOrigin, parseOriginList } from "../lib/origins.ts";
import {
	type PushTransportConfig,
	resolvePushConfig,
} from "../lib/push-config.ts";
import {
	resolveWebAuthnConfig,
	type WebAuthnConfig,
} from "../lib/webauthn-config.ts";
import { EnvSchema, type EnvValues } from "./env-schema.ts";

/**
 * Environment values to what this deployment can actually do, with no side effects.
 *
 * Failure is a value: nothing is printed and nothing exits here. The boot facade reads the failure
 * and calls `process.exit(1)`; the CLI draws it as a diagnostic. Having a single validator is the
 * point of this file: with two, "the server boots but doctor says it passes" (and the reverse)
 * becomes representable.
 *
 * Stops at the first error because later checks depend on earlier values (the rpID check needs a
 * valid origin list, and the verification origin derives from that list). That also keeps boot
 * output identical to before the extraction. Warnings are independent, so they are all collected.
 */

/**
 * Who may use managed generation. Closed vocabulary (see `env-schema.ts`).
 *
 * - `allowlist`: listed members and staff/admin only (the default)
 * - `everyone`: every signed-in member; only rate limits remain
 */
export type ManagedGenerationAccess = "allowlist" | "everyone";

export const MANAGED_GENERATION_ACCESS_VALUES: readonly ManagedGenerationAccess[] =
	["allowlist", "everyone"];

/** PortOne identity verification settings; only built when all three values are present. */
export interface PortOneIdentityConfig {
	storeId: string;
	channelKey: string;
	apiSecret: string;
}

/**
 * Everything this deployment can actually do.
 *
 * Holds secrets (`env`, `portOneIdentityConfig`, `mobileUpdateCi`), so the diagnostic report reads
 * only verdicts from it and builds its own model (`env-doctor.ts`); stripping secrets afterwards
 * would leak the first time one is missed.
 */
export interface ResolvedEnvironment {
	env: EnvValues;
	isProduction: boolean;
	ageGateEnabled: boolean;
	/** Whether the one-year adult re-verification is on (`ADULT_REVERIFICATION_ENABLED=on`). */
	adultReverificationEnabled: boolean;
	identityVerificationProvider: string | null;
	portOneIdentityConfig: PortOneIdentityConfig | null;

	publicApiUrl: string;
	corsOrigins: string[];
	webOrigin: string;
	trustedOrigins: string[];
	/** True when `AUTH_TRUSTED_ORIGINS` is empty and the CORS list is reused. */
	trustedOriginsDerived: boolean;
	/** Proxy IPs/CIDRs the login limiter trusts. Empty means only single-value headers are trusted. */
	authTrustedProxies: string[];
	/** Client-IP header the proxy overwrites; `null` means `X-Forwarded-For`. */
	authIpHeader: string | null;

	googleEnabled: boolean;
	/** Sign in with Apple config; `null` leaves that method off. */
	appleSignIn: AppleSignInConfig | null;
	/** The REST API key alone turns Kakao login on. */
	kakaoEnabled: boolean;
	/**
	 * Whether the enabled deployment also holds the Client Secret. Separate from `kakaoEnabled`
	 * because it is a pairing axis, so diagnostics can say "enabled but may not match the console".
	 */
	kakaoClientSecretSet: boolean;

	chatProviderEnabled: boolean;
	openRouterBaseUrl: string;
	/** True when `OPENROUTER_BASE_URL` is empty and the code default applies. */
	openRouterBaseUrlDerived: boolean;

	/**
	 * Who may use managed generation. The generation path decides per request from the member column
	 * and role; this only records whether the deployment builds that list.
	 */
	managedGenerationAccess: ManagedGenerationAccess;
	/** True when `MANAGED_GENERATION_ACCESS` is empty and the code default applies. */
	managedGenerationAccessDerived: boolean;

	mailTransportConfig: MailTransportConfig;
	mailEnabled: boolean;
	emailVerificationRequired: boolean;
	/**
	 * Whether password reset is open: requires a mail transport **and** `PASSWORD_RESET_ENABLED=on`.
	 * Without a transport the screen says "sent" and nothing arrives; without the switch, mail goes
	 * out that the published policy does not list (`env-schema.ts`).
	 */
	passwordResetEnabled: boolean;

	/**
	 * Whether native push can actually be sent. `null` means delivery is off, not that the feature is
	 * absent: registrations and delivery rows are still created, they just do not go out (see the
	 * `config/env-schema.ts` header).
	 */
	pushTransportConfig: PushTransportConfig;
	pushEnabled: boolean;

	webauthnConfig: WebAuthnConfig;
	/** True when the rpID derives from the web origin (`WEBAUTHN_RP_ID` empty). */
	webauthnRpIdDerived: boolean;
	/** True when the verification origins derive from `WEB_ORIGIN`. */
	webauthnOriginsDerived: boolean;

	redisUrl: string | null;

	/**
	 * CI connection the operations console uses to start OTA publish jobs. `null` removes the publish
	 * button (read, rollout, pause and resume stay). Holds the token, so the diagnostic report reads
	 * verdicts only.
	 */
	mobileUpdateCi: MobileUpdateCiConfig | null;

	backgroundJobsEnabled: boolean;
	legalRetentionDryRun: boolean;
	backgroundJobsTimeZone: string;
	backgroundJobsDailyAt: { hour: number; minute: number };
}

export type EnvironmentResolution =
	| { ok: true; config: ResolvedEnvironment; warnings: string[] }
	| { ok: false; message: string; warnings: string[] };

const DEV_IDENTITY_VERIFIER = "dev";

/** Single source of the provider endpoint default. */
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Aborts the flow; callers read only the message in `catch`. */
class ConfigError extends Error {}

const fail = (message: string): never => {
	throw new ConfigError(message);
};

/** Accepts only IPv4/IPv6 addresses or CIDRs; the library would silently drop anything else. */
function parseTrustedProxies(raw: string): string[] {
	const entries = raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	for (const entry of entries) {
		const [address, prefix, extra] = entry.split("/");
		const family = address ? isIP(address) : 0;
		const prefixOk =
			prefix === undefined ||
			(/^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128));
		if (family === 0 || extra !== undefined || !prefixOk)
			fail(
				`an AUTH_TRUSTED_PROXIES entry is neither an IP nor a CIDR: ${JSON.stringify(entry)}`,
			);
	}
	return entries;
}

/**
 * Checks that the time zone resolves in this runtime. A typo (`Asia/Seuol`) fails silently
 * otherwise: `Intl.DateTimeFormat` throws inside the daily scheduler, and retention destruction and
 * orphan cleanup never run.
 */
function assertTimeZone(zone: string): void {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
	} catch {
		fail(`BACKGROUND_JOBS_TIMEZONE is not an IANA timezone: ${zone}`);
	}
}

/**
 * Resolves a whole environment. `process.env`, `--env-file` values and test literals all pass
 * through this function. It must not read `process.env` itself: the tool would then inspect the
 * shell it runs in instead of the deployment it is diagnosing.
 */
export function resolveEnvironment(
	input: Record<string, unknown>,
): EnvironmentResolution {
	const warnings: string[] = [];

	try {
		const parsed = EnvSchema.safeParse(input);
		if (!parsed.success)
			fail(`invalid environment variables\n${z.prettifyError(parsed.error)}`);
		const env = parsed.data as EnvValues;

		const isProduction = env.NODE_ENV === "production";

		const ageGateEnabled = env.MEMBERSHIP_AGE_GATE === "on";
		const adultReverificationEnabled =
			env.ADULT_REVERIFICATION_ENABLED === "on";

		/**
		 * The dev identity verifier is a boot error in production, not a warning: it passes everyone, so
		 * guardian consent would be recorded without being obtained and adult entitlement opened without
		 * verification, and neither can be undone.
		 */
		if (
			isProduction &&
			env.IDENTITY_VERIFICATION_PROVIDER === DEV_IDENTITY_VERIFIER
		)
			fail(
				"production can't boot with IDENTITY_VERIFICATION_PROVIDER=dev — that verifier lets anyone through, guardian consent recorded that way was never given, and adult eligibility opened that way was never verified",
			);

		const identityVerificationProvider =
			env.IDENTITY_VERIFICATION_PROVIDER || null;

		/**
		 * PortOne settings count as configured only with all three values. A half-configuration folds to
		 * `null` because of how it fails: without the secret the window opens but lookup fails; without
		 * the channel key the window never opens.
		 */
		const portOneIdentityConfig: PortOneIdentityConfig | null =
			env.PORTONE_STORE_ID &&
			env.PORTONE_IDENTITY_CHANNEL_KEY &&
			env.PORTONE_V2_API_SECRET
				? {
						storeId: env.PORTONE_STORE_ID,
						channelKey: env.PORTONE_IDENTITY_CHANNEL_KEY,
						apiSecret: env.PORTONE_V2_API_SECRET,
					}
				: null;

		if (identityVerificationProvider === "portone" && !portOneIdentityConfig)
			warnings.push(
				"IDENTITY_VERIFICATION_PROVIDER=portone, but one of PORTONE_STORE_ID, PORTONE_IDENTITY_CHANNEL_KEY and PORTONE_V2_API_SECRET is missing — both procedures that use identity verification are blocked with 503 (members under 14 can't start using the product, and no member gains adult eligibility)",
			);

		if (isProduction && !env.BETTER_AUTH_SECRET)
			fail(
				"production needs BETTER_AUTH_SECRET — this value is the only thing that stops session cookies from being forged",
			);

		/** The address clients must reach, e.g. https://api.example.com/v2 */
		const publicApiUrl = new URL(API_BASE_PATH, env.API_ORIGIN).toString();

		/**
		 * Reads an origin list. Malformed values stop here: CORS and login redirects silently ignore
		 * unlisted origins, so one typo shows up as "deploy is healthy but every browser call fails".
		 */
		const parseOrigins = (name: string, value: string): string[] => {
			const { origins, invalid } = parseOriginList(value);
			if (invalid.length > 0)
				fail(
					`${name} has a value that is not an origin: ${invalid.join(", ")} — list only origins including the scheme, as CSV (e.g. https://example.com)`,
				);
			return origins;
		};

		const corsOrigins = parseOrigins("WEB_ORIGIN", env.WEB_ORIGIN);

		if (corsOrigins.length === 0)
			fail(
				"WEB_ORIGIN is empty — every request from a browser is blocked by CORS",
			);

		const webOrigin = corsOrigins[0] as string;

		if (isProduction && corsOrigins.every(isLoopbackOrigin))
			warnings.push(
				`production, but WEB_ORIGIN has only loopback (${corsOrigins.join(", ")}) — every browser request from the public domain is blocked by CORS. Unless this is local compose, put the web origin in WEB_ORIGIN`,
			);

		const trustedOriginsDerived = !env.AUTH_TRUSTED_ORIGINS;
		const trustedOrigins = trustedOriginsDerived
			? corsOrigins
			: parseOrigins("AUTH_TRUSTED_ORIGINS", env.AUTH_TRUSTED_ORIGINS);

		/**
		 * Basis for the login limiter's client IP. A bad CIDR blocks boot because the library silently
		 * drops that entry and runs on the rest, producing a deployment that thinks it trusts its proxy.
		 */
		const authTrustedProxies = parseTrustedProxies(env.AUTH_TRUSTED_PROXIES);
		const authIpHeader = env.AUTH_IP_HEADER.trim().toLowerCase() || null;
		if (authIpHeader !== null && !/^[a-z0-9-]+$/.test(authIpHeader))
			fail(
				`AUTH_IP_HEADER is not a header name: ${JSON.stringify(env.AUTH_IP_HEADER)}`,
			);
		if (
			isProduction &&
			authTrustedProxies.length === 0 &&
			authIpHeader === null
		)
			warnings.push(
				"AUTH_TRUSTED_PROXIES and AUTH_IP_HEADER are both empty — behind a proxy the sign-in and sign-up limiters are bypassed by one X-Forwarded-For line (one value) or everyone shares one bucket (two or more values)",
			);

		/** Social login turns on only when **both** credentials are present. */
		const googleEnabled = Boolean(
			env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
		);

		/**
		 * Sign in with Apple handles a half-configuration differently from Google. Google has two
		 * console-copied strings, so a half-filled state is effectively a typo and stays quietly off.
		 * Apple has four values, one a multi-line key file, and the failure appears only after the user
		 * finishes signing in on Apple's screen, so boot is blocked.
		 */
		const appleResult = resolveAppleSignInConfig({
			clientId: env.APPLE_SIGN_IN_CLIENT_ID,
			teamId: env.APPLE_SIGN_IN_TEAM_ID,
			keyId: env.APPLE_SIGN_IN_KEY_ID,
			privateKey: env.APPLE_SIGN_IN_PRIVATE_KEY,
		});
		if (!appleResult.ok) fail(appleResult.message);
		const appleSignIn = appleResult.ok ? appleResult.config : null;

		/**
		 * Kakao is turned on by the key alone. The second value is optional, so it is not "both required"
		 * like Google, and a half-configuration does not block boot like Apple (see the table in
		 * `env-schema.ts`). Only one mismatch direction is dangerous, and diagnostics warn about it.
		 */
		const kakaoEnabled = Boolean(env.KAKAO_REST_API_KEY);
		const kakaoClientSecretSet = Boolean(env.KAKAO_CLIENT_SECRET);

		if (!kakaoEnabled && kakaoClientSecretSet)
			warnings.push(
				"only KAKAO_CLIENT_SECRET is set and KAKAO_REST_API_KEY is empty — Kakao sign-in comes up off (fill in the REST API key if you meant to turn it on)",
			);

		const chatProviderEnabled = Boolean(env.OPENROUTER_API_KEY);
		const openRouterBaseUrlDerived = !env.OPENROUTER_BASE_URL;
		const openRouterBaseUrl =
			env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL;

		/**
		 * Managed generation allowlist; empty means `allowlist` (the closed side). A value outside the
		 * vocabulary blocks boot: folding a typo of `everyone` to closed leaves the operator believing it
		 * is open, and folding a typo of `allowlist` to open exposes the operator's key. Neither guess is
		 * safe, so none is made.
		 */
		if (
			env.MANAGED_GENERATION_ACCESS &&
			!MANAGED_GENERATION_ACCESS_VALUES.includes(
				env.MANAGED_GENERATION_ACCESS as ManagedGenerationAccess,
			)
		)
			fail(
				`MANAGED_GENERATION_ACCESS must be one of ${MANAGED_GENERATION_ACCESS_VALUES.join(" · ")} (got: ${env.MANAGED_GENERATION_ACCESS})`,
			);
		const managedGenerationAccessDerived = !env.MANAGED_GENERATION_ACCESS;
		const managedGenerationAccess: ManagedGenerationAccess =
			managedGenerationAccessDerived
				? "allowlist"
				: (env.MANAGED_GENERATION_ACCESS as ManagedGenerationAccess);

		const mailConfigResult = resolveMailConfig({
			transport: env.MAIL_TRANSPORT,
			from: env.MAIL_FROM,
			host: env.SMTP_HOST,
			port: env.SMTP_PORT,
			secure: env.SMTP_SECURE,
			user: env.SMTP_USER,
			password: env.SMTP_PASSWORD,
			production: isProduction,
		});
		if (!mailConfigResult.ok) fail(mailConfigResult.message);

		const mailTransportConfig: MailTransportConfig = (
			mailConfigResult as { ok: true; config: MailTransportConfig }
		).config;
		const mailEnabled = mailTransportConfig !== null;
		const emailVerificationRequired = mailEnabled;
		const passwordResetSwitch = env.PASSWORD_RESET_ENABLED === "on";
		const passwordResetEnabled = mailEnabled && passwordResetSwitch;
		if (passwordResetSwitch && !mailEnabled)
			warnings.push(
				"PASSWORD_RESET_ENABLED=on, but MAIL_TRANSPORT is empty — reset mail can't be sent, so password reset comes up closed",
			);

		if (isProduction && !mailEnabled)
			warnings.push(
				"production, but MAIL_TRANSPORT is empty — email ownership verification comes up off, and email change and password reset do not open either",
			);

		const pushResult = resolvePushConfig({
			transport: env.PUSH_TRANSPORT,
			accessToken: env.EXPO_ACCESS_TOKEN,
		});
		if (!pushResult.ok) fail(pushResult.message);

		const pushTransportConfig: PushTransportConfig = (
			pushResult as { ok: true; config: PushTransportConfig }
		).config;
		const pushEnabled = pushTransportConfig !== null;

		/**
		 * A transport with no jobs running is the quietest failure in this layer: registration succeeds,
		 * notifications and delivery rows are created, nothing goes out, and nothing is logged. Boot is
		 * not blocked because the inbox already holds the event, so only the banner is lost.
		 */
		if (pushEnabled && !env.BACKGROUND_JOBS_ENABLED)
			warnings.push(
				"PUSH_TRANSPORT is set, but BACKGROUND_JOBS_ENABLED is off — this process sends no pushes (delivery rows pile up and expire when their lifetime passes)",
			);

		const webauthnOriginsDerived = !env.WEBAUTHN_ORIGIN;
		const webauthnResult = resolveWebAuthnConfig({
			rpId: env.WEBAUTHN_RP_ID,
			rpName: env.WEBAUTHN_RP_NAME,
			origins: webauthnOriginsDerived
				? corsOrigins
				: parseOrigins("WEBAUTHN_ORIGIN", env.WEBAUTHN_ORIGIN),
			webOrigin,
		});
		if (!webauthnResult.ok) fail(webauthnResult.message);

		const webauthnConfig: WebAuthnConfig = (
			webauthnResult as { ok: true; config: WebAuthnConfig }
		).config;

		const redisUrl: string | null = env.REDIS_URL || null;

		if (isProduction && !redisUrl)
			warnings.push(
				"production, but REDIS_URL is empty — rate limiting runs on an in-process counter. " +
					"With two or more replicas the ceiling is multiplied by the replica count",
			);

		const backgroundJobsEnabled = env.BACKGROUND_JOBS_ENABLED === "on";
		const legalRetentionDryRun = env.LEGAL_RETENTION_DRY_RUN === "on";

		assertTimeZone(env.BACKGROUND_JOBS_TIMEZONE);
		const backgroundJobsTimeZone: string = env.BACKGROUND_JOBS_TIMEZONE;

		const dailyAt = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(
			env.BACKGROUND_JOBS_DAILY_AT,
		);

		const ciResult = resolveMobileUpdateCiConfig({
			repository: env.OTA_CI_GITHUB_REPOSITORY,
			token: env.OTA_CI_GITHUB_TOKEN,
			channels: env.OTA_CI_CHANNELS,
		});
		if (!ciResult.ok) fail(ciResult.message);
		const mobileUpdateCi = ciResult.ok ? ciResult.config : null;

		/**
		 * CI reports can be lost, and a lost job blocks its stream. There is one live job per stream
		 * (partial unique index) and the CI report is what ends it; `mobile-updates.reconcile-jobs` asks
		 * CI for the run state when no report arrives. Without that job running, one lost report leaves
		 * the channel's publish button at 409 forever, with no explanation on screen.
		 */
		if (mobileUpdateCi && !backgroundJobsEnabled) {
			if (isProduction)
				fail(
					"OTA_CI_* is filled, but BACKGROUND_JOBS_ENABLED is off — without reconciling lost CI reports, that channel's publish jobs stay stuck forever",
				);
			warnings.push(
				"OTA_CI_* is filled, but BACKGROUND_JOBS_ENABLED is off — this process does not run OTA job reconciliation (in production boot is blocked)",
			);
		}

		if (!dailyAt)
			fail(
				`BACKGROUND_JOBS_DAILY_AT must be HH:MM: ${env.BACKGROUND_JOBS_DAILY_AT}`,
			);

		const backgroundJobsDailyAt = {
			hour: Number(dailyAt?.[1] ?? 3),
			minute: Number(dailyAt?.[2] ?? 0),
		};

		if (isProduction && !backgroundJobsEnabled)
			warnings.push(
				"production, but BACKGROUND_JOBS_ENABLED is not on — orphan media cleanup and " +
					"retention destruction do not run",
			);

		if (isProduction && backgroundJobsEnabled && legalRetentionDryRun)
			warnings.push(
				"LEGAL_RETENTION_DRY_RUN is on — records past their retention period are only counted, not destroyed",
			);

		return {
			ok: true,
			warnings,
			config: {
				env,
				isProduction,
				ageGateEnabled,
				adultReverificationEnabled,
				identityVerificationProvider,
				portOneIdentityConfig,
				publicApiUrl,
				corsOrigins,
				webOrigin,
				trustedOrigins,
				trustedOriginsDerived,
				authTrustedProxies,
				authIpHeader,
				googleEnabled,
				appleSignIn,
				kakaoEnabled,
				kakaoClientSecretSet,
				chatProviderEnabled,
				openRouterBaseUrl,
				openRouterBaseUrlDerived,
				managedGenerationAccess,
				managedGenerationAccessDerived,
				mailTransportConfig,
				mailEnabled,
				emailVerificationRequired,
				passwordResetEnabled,
				pushTransportConfig,
				pushEnabled,
				webauthnConfig,
				webauthnRpIdDerived: !env.WEBAUTHN_RP_ID,
				webauthnOriginsDerived,
				redisUrl,
				mobileUpdateCi,
				backgroundJobsEnabled,
				legalRetentionDryRun,
				backgroundJobsTimeZone,
				backgroundJobsDailyAt,
			},
		};
	} catch (error) {
		if (error instanceof ConfigError)
			return { ok: false, message: error.message, warnings };
		throw error;
	}
}
