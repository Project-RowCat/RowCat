import { APIError, getSessionFromCtx } from "better-auth/api";

/**
 * Our rules standing in front of the two-factor plugin; the plugin's protocol (TOTP, encrypted
 * secrets and backup codes, challenge cookie, failure lockout) is not rewritten. We decide only
 * which doors stay open and what each requires:
 *
 * ```text
 * enable · disable · regenerate backup codes   recent login (24h) + password (the plugin checks the password)
 * trusted devices (trustDevice)                rejected — the product has no such state
 * re-reading the TOTP URI                      closed — the secret leaves once, at enable
 * ```
 *
 * - Recent login on top of the password: the password says "this person knows it", freshness says
 *   "this session is not an old stolen cookie". Same threshold as session listing and method unlink
 *   (`freshAge`, which also guards account deletion). Failure uses the plugin's own
 *   `SESSION_NOT_FRESH` so screens fall into their existing "sign in again" path.
 * - `trustDevice` is refused, not ignored: it outlives sign-out and there is no screen to list or
 *   revoke it, so it would stay forever on a lost laptop. The slice that builds that screen deletes
 *   this rule.
 * - `get-totp-uri` would hand the secret to anyone holding a session and the password, i.e. a way
 *   to clone the second factor. Backup code plaintext likewise appears only in enable/regenerate
 *   responses; `viewBackupCodes` has no HTTP surface.
 */

export const TWO_FACTOR_FRESH_PATHS: ReadonlySet<string> = new Set([
	"/two-factor/enable",
	"/two-factor/disable",
	"/two-factor/generate-backup-codes",
]);

/** Plugin paths that re-expose the secret; never opened. */
export const TWO_FACTOR_CLOSED_PATHS: ReadonlySet<string> = new Set([
	"/two-factor/get-totp-uri",
]);

/** The two challenge-passing paths, which could otherwise mint a trusted-device cookie. */
const TRUST_DEVICE_PATHS: ReadonlySet<string> = new Set([
	"/two-factor/verify-totp",
	"/two-factor/verify-backup-code",
]);

/** Same as Better Auth's default `session.freshAge`. */
export const TWO_FACTOR_FRESH_AGE_SECONDS = 60 * 60 * 24;

interface HookContext {
	path?: string;
	body?: unknown;
}

/**
 * Called from `hooks.before`; throws to block. The session is re-read with `getSessionFromCtx`
 * because this runs before the plugin's middleware, and using the same function means both see the
 * same session.
 */
export async function enforceTwoFactorPolicy(
	// biome-ignore lint/suspicious/noExplicitAny: passes Better Auth's middleware context type through as-is.
	ctx: HookContext & any,
	now: () => number = Date.now,
): Promise<void> {
	const path: string | undefined = ctx.path;
	if (path === undefined || !path.startsWith("/two-factor/")) return;

	if (TWO_FACTOR_CLOSED_PATHS.has(path))
		throw APIError.from("NOT_FOUND", {
			message: "Not found",
			code: "NOT_FOUND",
		});

	if (TRUST_DEVICE_PATHS.has(path) && trustDeviceRequested(ctx.body))
		throw APIError.from("BAD_REQUEST", {
			message: "Trusted devices are not offered",
			code: "TRUST_DEVICE_UNSUPPORTED",
		});

	if (TWO_FACTOR_FRESH_PATHS.has(path)) {
		const session = await getSessionFromCtx(ctx);
		/** Without a session the plugin's middleware answers 401; do not preempt its vocabulary. */
		if (!session?.session) return;
		if (!isFreshSession(session.session.createdAt, now()))
			throw APIError.from("FORBIDDEN", {
				message: "Session is not fresh",
				code: "SESSION_NOT_FRESH",
			});
	}
}

export function isFreshSession(
	createdAt: Date | string,
	nowMs: number,
): boolean {
	const created = new Date(createdAt).getTime();
	if (!Number.isFinite(created)) return false;
	return nowMs - created < TWO_FACTOR_FRESH_AGE_SECONDS * 1000;
}

const trustDeviceRequested = (body: unknown): boolean =>
	typeof body === "object" &&
	body !== null &&
	(body as { trustDevice?: unknown }).trustDevice === true;
