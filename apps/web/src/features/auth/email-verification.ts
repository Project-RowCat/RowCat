import { authClient, redirectTargetFrom } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";
import type { AuthFailure } from "./auth-error.ts";
import { isTransportFailure } from "./auth-error.ts";

/**
 * Email ownership verification: resending and where the user returns.
 *
 * This file neither creates nor checks the verification token; Better Auth does that
 * (`/verify-email`). This file decides only two things: where the user comes back to, and how often
 * a mail can be resent. The first is a security boundary, the second is courtesy.
 *
 * ## The return address is not chosen by the user
 *
 * The callback URL is built from a **constant path**. Passing a query value through would turn the
 * link into a phishing path. It is delivered by mail, so it is far riskier than the login screen's
 * `?redirect=` (the provider link uses a constant path for the same reason). The server's
 * `trustedOrigins` checks it again, and that check is not turned off here.
 *
 * ## The cooldown is not a defence
 *
 * The constant below only stops an accidental second click. Abuse is limited by the server. The
 * point of saying so here is that this value must not be read as a rate limit; a disabled button is
 * no defence.
 */

/** Where the user returns after verifying: the login screen, with one marker attached. */
const VERIFIED_RETURN_PATH = "/login?verified=1";

/**
 * The absolute address a verification link brings the user back to.
 *
 * During server rendering there is no origin, so the parameter is omitted rather than passed as a
 * relative path and Better Auth falls back to its default. This function is only called from click
 * handlers anyway.
 *
 * ## This address is not only for the verification link
 *
 * `sign-in/email` uses `callbackURL` in two ways. For an unverified account it is the return
 * address of the verification mail (the original purpose of this file). For a successful sign-in,
 * the response carries `redirect: true`, and the client reloads the document at that address
 * (better-auth's `redirectPlugin`). So this value is also the post-login destination.
 *
 * Until that was noticed, this function always returned `/login?verified=1`, and email sign-in lost
 * `?redirect=` entirely: the login screen reopened and its `beforeLoad` sent the target-less viewer
 * to `/`. A guest who pressed `Start conversation` on a work and signed in never got back to that work. Google
 * sign-in built its own `callbackURL` with the destination, so only that path worked.
 *
 * So the destination is carried in this address. One value serves both uses:
 *
 * ```text
 * sign-in succeeds    /login?verified=1&redirect=/x  → beforeLoad sees the viewer and sends them to /x
 * verification link   /login?verified=1&redirect=/x  → verification notice, then continues to /x after sign-in
 * ```
 *
 * The value is not carried raw. It passes through `redirectTargetFrom` again, so only this app's
 * internal paths can arrive here (an origin cannot be expressed). That function is idempotent, so
 * re-passing an already filtered value gives the same result. The check matters most because the
 * link is delivered by mail.
 */
export function verificationCallbackUrl(
	returnPath?: string,
): string | undefined {
	if (typeof window === "undefined") return undefined;
	const target = redirectTargetFrom(returnPath);
	const search = target
		? `${VERIFIED_RETURN_PATH}&redirect=${encodeURIComponent(target)}`
		: VERIFIED_RETURN_PATH;
	return `${window.location.origin}${search}`;
}

/**
 * Resends the verification mail.
 *
 * No route of our own: Better Auth already exposes `/v2/auth/send-verification-email` over HTTP,
 * and that endpoint can be called **without a session** (a user who just signed up has none). It
 * applies its own rules for existence hiding and response-time floor.
 */
export async function resendVerificationEmail(
	email: string,
	returnPath?: string,
): Promise<AuthFailure | null> {
	const callbackURL = verificationCallbackUrl(returnPath);
	return (
		authClient
			.sendVerificationEmail({
				email,
				...(callbackURL ? { callbackURL } : {}),
			})
			.then((result) => result.error ?? null)
			/** No response arrived at all. An empty object is what `isTransportFailure` treats as true. */
			.catch((): AuthFailure => ({}))
	);
}

/**
 * Maps a resend failure to a sentence.
 *
 * It never says `that address does not exist`. The server answers success for
 * unknown addresses too (existence hiding), so only three failures can reach here: transport, too
 * many requests, and already verified.
 */
export function resendErrorMessage(error: AuthFailure): string {
	if (isTransportFailure(error))
		return translator("auth")("verification.resendTransport");
	if (error.status === 429) return translator("auth")("rateLimited");
	if (error.code === "EMAIL_ALREADY_VERIFIED")
		return translator("auth")("verification.alreadyVerified");
	return translator("auth")("verification.resendFailed");
}
