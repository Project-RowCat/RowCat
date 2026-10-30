import type { EnvValues } from "./env-schema.ts";

/**
 * Which environment variables decide each `env:doctor` capability — names only.
 *
 * The console's readiness list reads this so an operator looking at "Transactional mail: disabled"
 * also sees what to set, without the API sending the doctor's `detail` (which carries hosts, origins
 * and Services IDs). The doctor keeps building facts from resolved config; this table sits beside it
 * rather than inside every branch, because one capability is emitted from several branches and a
 * name list repeated per branch would drift between them.
 *
 * Keyed by capability id. `capability-variables.test.ts` resolves a spread of environments and fails
 * on an id with no row or a row no capability emits, so adding a capability to the doctor without a
 * line here does not pass. Values are `keyof EnvValues`, so a renamed variable breaks compilation.
 */
export const CAPABILITY_VARIABLES: Readonly<
	Record<string, readonly (keyof EnvValues)[]>
> = {
	database: ["DATABASE_URL", "DATABASE_POOL_MAX"],
	apiOrigin: ["API_ORIGIN"],
	browserOrigins: ["WEB_ORIGIN"],
	sessionSecret: ["BETTER_AUTH_SECRET"],
	googleOAuth: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
	appleSignIn: [
		"APPLE_SIGN_IN_CLIENT_ID",
		"APPLE_SIGN_IN_TEAM_ID",
		"APPLE_SIGN_IN_KEY_ID",
		"APPLE_SIGN_IN_PRIVATE_KEY",
	],
	kakaoSignIn: ["KAKAO_REST_API_KEY", "KAKAO_CLIENT_SECRET"],
	sessionCookieDomain: ["AUTH_COOKIE_DOMAIN"],
	webauthn: ["WEBAUTHN_RP_ID", "WEBAUTHN_ORIGIN", "WEBAUTHN_RP_NAME"],
	redisRateLimit: ["REDIS_URL"],
	backgroundJobs: [
		"BACKGROUND_JOBS_ENABLED",
		"BACKGROUND_JOBS_DAILY_AT",
		"BACKGROUND_JOBS_TIMEZONE",
	],
	mobileUpdateCi: [
		"OTA_CI_GITHUB_REPOSITORY",
		"OTA_CI_GITHUB_TOKEN",
		"OTA_CI_CHANNELS",
	],
	legalRetention: ["BACKGROUND_JOBS_ENABLED", "LEGAL_RETENTION_DRY_RUN"],
	transactionalMail: [
		"MAIL_TRANSPORT",
		"MAIL_FROM",
		"SMTP_HOST",
		"SMTP_PORT",
		"SMTP_SECURE",
		"SMTP_USER",
		"SMTP_PASSWORD",
		"PASSWORD_RESET_ENABLED",
	],
	nativePush: [
		"PUSH_TRANSPORT",
		"EXPO_ACCESS_TOKEN",
		"BACKGROUND_JOBS_ENABLED",
	],
	identityVerification: [
		"IDENTITY_VERIFICATION_PROVIDER",
		"PORTONE_STORE_ID",
		"PORTONE_IDENTITY_CHANNEL_KEY",
		"PORTONE_V2_API_SECRET",
	],
	managedGeneration: [
		"OPENROUTER_API_KEY",
		"OPENROUTER_BASE_URL",
		"MANAGED_GENERATION_ACCESS",
	],
	ageGate: ["MEMBERSHIP_AGE_GATE"],
};
