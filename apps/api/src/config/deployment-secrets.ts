/**
 * Which secret values a production deployment may not run on.
 *
 * This repository is public, so every value it writes down for local use — the compose database
 * password, the test session key — is a credential anyone can read. A deployment that kept one ran
 * fine and showed no symptom: the session key still signs cookies, the database still answers. What
 * it lost is the secret, and nothing ever says so. These rules turn that state into a boot error.
 *
 * What this does not hold: entropy measurement or a password-strength score. A length floor and a
 * list of the values this repository itself publishes are facts; a strength score is a guess, and a
 * guess that rejects a good key teaches operators to pad it until the check passes.
 *
 * Development and test runs are not asked — local setups use these values on purpose.
 */

/**
 * Better Auth signs session cookies with this key. 32 characters is the floor `openssl rand -base64 32`
 * (44 characters) clears with room to spare; a shorter value is a password someone typed.
 */
export const MIN_AUTH_SECRET_LENGTH = 32;

/** Session keys this repository writes down for tests (`apps/api/vitest*.config.ts`). */
export const PUBLISHED_AUTH_SECRETS: readonly string[] = [
	"rowcat-test-secret-not-for-deploy",
];

/**
 * The database password the examples and CI use (`postgres://rowcat:rowcat@…`). It is also the
 * schema's `DATABASE_URL` default, so a production process with no `DATABASE_URL` at all lands here.
 */
export const DEVELOPMENT_DATABASE_PASSWORD = "rowcat";

/** Why a production session key is refused; `null` when it is acceptable (or absent — boot asks that separately). */
export function authSecretProblem(secret: string): string | null {
	if (!secret) return null;
	if (PUBLISHED_AUTH_SECRETS.includes(secret))
		return "BETTER_AUTH_SECRET is a value published in this repository — anyone can forge session cookies with it. Generate one: openssl rand -base64 32";
	if (secret.length < MIN_AUTH_SECRET_LENGTH)
		return `BETTER_AUTH_SECRET is ${secret.length} characters; production needs at least ${MIN_AUTH_SECRET_LENGTH}. Generate one: openssl rand -base64 32`;
	return null;
}

/**
 * The password inside a `postgres://` URL, decoded. `null` when the value is not a URL or carries no
 * password — key=value connection strings and passwordless (socket, IAM) setups are not this
 * check's to judge.
 */
export function databaseUrlPassword(databaseUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(databaseUrl);
	} catch {
		return null;
	}
	if (!url.password) return null;
	try {
		return decodeURIComponent(url.password);
	} catch {
		return url.password;
	}
}

/** Why a production database URL is refused; `null` when acceptable. */
export function databaseUrlProblem(databaseUrl: string): string | null {
	if (databaseUrlPassword(databaseUrl) !== DEVELOPMENT_DATABASE_PASSWORD)
		return null;
	return `DATABASE_URL uses the development password published in this repository ("${DEVELOPMENT_DATABASE_PASSWORD}"). Set POSTGRES_PASSWORD (compose) or DATABASE_URL to a generated one: openssl rand -hex 24. An existing database keeps the password it was created with — change it with ALTER ROLE first (docs/ops/CONFIGURATION.md)`;
}
