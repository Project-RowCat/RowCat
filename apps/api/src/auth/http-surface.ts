import { LOCAL_SIGN_IN_AUTH_PATH } from "@rowcat/contracts";

/**
 * What of Better Auth's HTTP surface this deployment leaves open. The library mounts every endpoint
 * its plugins define under `/v2/auth/*`; most are the doors the apps really use, and a few are
 * either replaced by our own routes or wider than the product needs. This file names those few, and
 * `app.ts` refuses them **before** the request reaches the library.
 *
 * Refusing at the HTTP edge, not in `hooks.before`, is the point: our wrappers call the same
 * operations server-side (`auth.api.listSessions`, `auth.api.revokeSession`, passkey and unlink
 * calls), and a hook would block those too. A direct call never passes through here.
 *
 * ```text
 * closed                          replaced by, or why
 * /list-sessions                  GET /v2/me/account/sessions — the raw list carries every session's token
 * /revoke-session(s), …-other-…   POST /v2/me/account/sessions* — revocation resolves ids within this list
 * /list-accounts                  GET /v2/me/account — the raw rows carry account ids and provider scopes
 * /unlink-account                 POST /v2/me/account/login-methods/… — the last-method rule is ours too
 * /get-access-token · /refresh-token · /account-info   provider OAuth tokens and profiles; nothing reads them
 * /passkey/list-user-passkeys     GET /v2/me/account/passkeys — the raw rows carry public keys and counters
 * /passkey/update-passkey         PATCH our passkey route — same row, narrower answer
 * /passkey/delete-passkey         DELETE our passkey route — the only place the removal notice is sent
 * /verify-password                nothing calls it; `scope: "server"` is metadata the router ignores, so it
 *                                 was a password oracle for any session at the default 100 per 10 s
 * /update-session                 nothing calls it; a write door the day the session table grows a field
 * /two-factor/send-otp · verify-otp   OTP is not configured (the mail vocabulary is closed); a door that
 *                                 would open silently the day someone adds `otpOptions`
 * ```
 *
 * The local owner's password-less sign-in (`/local-sign-in`, `local-sign-in.ts`) is closed to every
 * request that is not provably from this computer (`lib/local-request.ts`). It is closed here, with
 * the same 404 as the list above, because the library's handler sees no socket and cannot decide it.
 *
 * The Expo plugin's authorization relay stays open (the app's browser sign-in needs it) but only toward
 * the three providers' authorization endpoints. Left as the library ships it, the relay redirects to any
 * `https` address and signs whatever `state` that address carries into a cookie first — an open redirect
 * from the API's own domain. The allowlist closes that redirect.
 *
 * **It does not decide who minted the state it relays**, and nothing at this edge can: a genuine app
 * sign-in is an anonymous GET carrying only values anyone can reproduce. The native sign-in hands its
 * session to the app over the `rowcat://` scheme, and a custom scheme is not proof of which app receives
 * it. Making that hand-off verified (an https App Link / Universal Link, or a one-time code the app
 * redeems) is an open mobile decision (`docs/oss/SECURITY-REVIEW.md`), not something this file decides.
 */

const CLOSED_PATHS: ReadonlySet<string> = new Set([
	"/list-sessions",
	"/revoke-session",
	"/revoke-sessions",
	"/revoke-other-sessions",
	"/list-accounts",
	"/unlink-account",
	"/get-access-token",
	"/refresh-token",
	"/account-info",
	"/passkey/list-user-passkeys",
	"/passkey/update-passkey",
	"/passkey/delete-passkey",
	"/verify-password",
	"/update-session",
	"/two-factor/send-otp",
	"/two-factor/verify-otp",
]);

const EXPO_PROXY_PATH = "/expo-authorization-proxy";

const LOCAL_ONLY_PATH = LOCAL_SIGN_IN_AUTH_PATH.toLowerCase();

/**
 * The authorization endpoints Better Auth builds for the three providers this repository configures
 * (`@better-auth/core`'s `social-providers`). Compared as origin + path, so neither another page on the
 * provider's host nor a lookalike host passes. A provider added to `auth/index.ts` adds its line here,
 * or the app's browser sign-in for it is refused with a 400.
 */
export const EXPO_PROXY_TARGETS: ReadonlySet<string> = new Set([
	"https://accounts.google.com/o/oauth2/v2/auth",
	"https://appleid.apple.com/auth/authorize",
	"https://kauth.kakao.com/oauth/authorize",
]);

/**
 * The path as the library's router will see it, so `/list-sessions/`, `//list-sessions` and
 * `/LIST-SESSIONS` cannot walk around the list. Closing more than the router would match is the safe
 * direction of error.
 */
const normalize = (path: string): string => {
	let decoded = path;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		/** Malformed escapes: compare the raw string, which matches nothing the library routes either. */
	}
	const collapsed = decoded.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
	return (collapsed || "/").toLowerCase();
};

export type AuthSurfaceRefusal = "closed" | "proxy-target";

/**
 * `path` is the part after `/v2/auth`; `search` is the query string the request carries; `isLocal`
 * answers whether the request is from this computer, asked only for the one path that needs it.
 */
export function authSurfaceRefusal(
	path: string,
	search: URLSearchParams,
	isLocal: () => boolean,
): AuthSurfaceRefusal | null {
	const normalized = normalize(path);
	if (CLOSED_PATHS.has(normalized)) return "closed";
	if (normalized === LOCAL_ONLY_PATH && !isLocal()) return "closed";
	if (normalized === EXPO_PROXY_PATH && !expoProxyTargetAllowed(search))
		return "proxy-target";
	return null;
}

const expoProxyTargetAllowed = (search: URLSearchParams): boolean => {
	const target = search.get("authorizationURL");
	if (target === null) return false;
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return false;
	}
	/** Credentials and fragments are not part of any provider's authorization address. */
	if (url.username || url.password || url.hash) return false;
	return EXPO_PROXY_TARGETS.has(`${url.origin}${url.pathname}`);
};
