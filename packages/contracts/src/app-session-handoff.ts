import { z } from "zod";

/**
 * How a browser sign-in hands its session to the native app — **a one-time code the app redeems with a
 * secret it never let out of the process**, not the session itself in a URL.
 *
 * ```text
 * app      verifier = 32 random bytes          binding = base64url(sha256(verifier))
 *          callbackURL = rowcat://…?rowcat_handoff_binding=<binding>
 * browser  OAuth round trip → /callback → 302 rowcat://…?rowcat_handoff=<code>      (no cookie in the URL)
 * app      POST /v2/auth/app-session/redeem { code, verifier } → Set-Cookie (the session)
 * ```
 *
 * The URL that leaves the browser crosses the operating system's link routing, and a custom scheme does
 * not say which app receives it — on Android any installed app may register `rowcat://`. Before this,
 * that URL carried the session cookie whole (`@better-auth/expo`'s after-hook), so whoever received it
 * was signed in. Now it carries a code that is useless without the verifier, and the verifier exists only
 * in the app that started the flow (the same shape as OAuth's PKCE, applied to our own last hop). PKCE calls
 * the hashed value a code challenge; here it is the **binding**, because the app's static scans reserve that
 * word for WebAuthn (`apps/mobile/src/features/account/account-boundaries.test.ts`).
 *
 * There is no fallback that puts a cookie in a URL: a callback without a binding hands over nothing,
 * and the app reads that as a sign-in that did not complete.
 */

/** The query parameter the app adds to its callback URL. The server strips it before redirecting. */
export const APP_SESSION_HANDOFF_BINDING_PARAM = "rowcat_handoff_binding";

/** The query parameter the server adds to the redirect: the one-time code. */
export const APP_SESSION_HANDOFF_CODE_PARAM = "rowcat_handoff";

/** Under `/v2/auth` — the session is the library's, so redemption is one of its endpoints. */
export const APP_SESSION_HANDOFF_REDEEM_PATH = "/app-session/redeem";

/** The one refusal. Which part failed (unknown, expired, used, wrong verifier) is not said. */
export const APP_SESSION_HANDOFF_INVALID = "APP_SESSION_HANDOFF_INVALID";

/** 32 bytes as unpadded base64url — what the verifier, the binding and the code all are. */
export const AppSessionHandoffToken = z
	.string()
	.regex(/^[A-Za-z0-9_-]{43}$/, "expected 32 bytes of unpadded base64url");

export const AppSessionHandoffRedeemRequest = z
	.object({ code: AppSessionHandoffToken, verifier: AppSessionHandoffToken })
	.strict();
export type AppSessionHandoffRedeemRequest = z.infer<
	typeof AppSessionHandoffRedeemRequest
>;
