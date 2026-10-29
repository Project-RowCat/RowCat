import { APP_SCHEME } from "@rowcat/domain";

/**
 * Origins that auth trusts — a different list from browser CORS (`WEB_ORIGIN`/`corsOrigins`).
 *
 * CORS answers "may a browser on this origin call our API" and is http(s) only, since custom
 * schemes never appear in an `Origin` header. `trustedOrigins` answers "may auth redirect here /
 * accept a request from here", and native schemes belong in it.
 *
 * - Do not widen `parseOriginList` to accept `rowcat://`. Rejecting non-http(s) values as typos
 *   is its value; widened, a `rowcat://` in `WEB_ORIGIN` silently enters the CORS allowlist. Native
 *   `fetch` has no CORS, so nothing is gained and the browser-side defence is lost.
 * - No dev `exp://` here. Better Auth's Expo plugin adds it itself only when `NODE_ENV ===
 *   "development"`; an `exp://**` in production would let any Expo Go app be a redirect target, and
 *   this repository uses development builds with its own scheme (`apps/mobile/README.md`).
 */

/**
 * The native app's auth origin. The trailing `://` is the format: Better Auth splits custom-scheme
 * patterns into scheme/authority/path (`parseCustomSchemeOrigin`), and an empty authority and path
 * admit the whole scheme. Deep-link paths are decided by screens (`Linking.createURL("/")`);
 * pinning a path here would make every new route a list edit, and a missed one a 403 on sign-in
 * return.
 */
export const NATIVE_AUTH_ORIGIN = `${APP_SCHEME}://`;

/**
 * Pure on purpose: importing `env.ts` validates `process.env` and may `process.exit`, so decisions
 * inside it cannot be unit-tested (`lib/origins.ts` is split out for the same reason).
 */
export const withNativeAuthOrigin = (
	webOrigins: readonly string[],
): string[] =>
	webOrigins.includes(NATIVE_AUTH_ORIGIN)
		? [...webOrigins]
		: [...webOrigins, NATIVE_AUTH_ORIGIN];

/**
 * Apple's authorization origin, trusted as a request source rather than a redirect target.
 *
 * Only Sign in with Apple uses `response_mode=form_post`, so the browser sends a cross-site POST to
 * our callback with `Origin: https://appleid.apple.com`. Better Auth checks origins only on
 * requests that carry cookies (`validateOrigin`), and our auth cookies are `SameSite=Lax`, so in
 * theory the POST passes without this entry. That breaks behind a CDN that sets a `SameSite=None`
 * cookie (Cloudflare's `__cf_bm`): the POST gains a cookie header, the check runs, and the user
 * gets a 403 after finishing Apple sign-in.
 *
 * The list also validates redirect destinations, so adding a value allows redirecting there. Here
 * that is Apple's own sign-in page, which attackers do not control, and it is added only when Apple
 * is configured.
 */
export const APPLE_AUTH_ORIGIN = "https://appleid.apple.com";

/**
 * Takes `enabled` as an argument so the function stays pure and "not added when unconfigured" can
 * be checked by value.
 */
export const withAppleAuthOrigin = (
	origins: readonly string[],
	enabled: boolean,
): string[] =>
	!enabled || origins.includes(APPLE_AUTH_ORIGIN)
		? [...origins]
		: [...origins, APPLE_AUTH_ORIGIN];
