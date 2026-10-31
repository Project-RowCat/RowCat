import { APIError } from "better-auth/api";

/**
 * A reset link comes back to a web page and nowhere else. Our rule standing in front of the
 * library's two reset doors:
 *
 * ```text
 * POST /request-password-reset   body.redirectTo     where the mailed link will land
 * GET  /reset-password/:token    query.callbackURL   where that link lands, carrying ?token=
 * ```
 *
 * The library checks both against `trustedOrigins`, and that list holds the native app's
 * `rowcat://`, which admits the **whole scheme** (`trusted-origins.ts`). So anyone could ask for a
 * reset mail to a victim's address with `redirectTo: "rowcat://anything"`; the victim opening the
 * genuine mail on a phone hands a live reset token to whichever app claims that scheme, and on
 * Android any installed app can. The token is the account.
 *
 * Narrowing the native entry instead is not available: native sign-in, account linking and the
 * verification return all ride on it (the Expo plugin hands the session over by deep link), and a
 * hostile app that claims the scheme receives every path anyway. Reset is the one flow that never
 * needs it — the app opens the web's `/reset-password` (`passwordResetWebUrl`) and calls neither
 * endpoint — so the rule is narrow: a reset target is `http(s)`, or a relative path the library
 * already vets. Which `http(s)` origins pass is still the library's `originCheck`.
 *
 * Refused with the library's own codes, before the handler runs, so no mail goes out for a refused
 * request; the web always sends its own origin and never meets this.
 */
export function enforcePasswordResetTarget(
	// biome-ignore lint/suspicious/noExplicitAny: passes Better Auth's middleware context type through as-is.
	ctx: { path?: string; body?: unknown; query?: unknown } & any,
): void {
	if (ctx.path === "/request-password-reset") {
		const target = (ctx.body as { redirectTo?: unknown } | null)?.redirectTo;
		if (!isWebTarget(target))
			throw APIError.from("FORBIDDEN", {
				message: "Invalid redirectURL",
				code: "INVALID_REDIRECT_URL",
			});
		return;
	}
	if (ctx.path?.startsWith("/reset-password/")) {
		const target = (ctx.query as { callbackURL?: unknown } | null)?.callbackURL;
		if (!isWebTarget(target))
			throw APIError.from("FORBIDDEN", {
				message: "Invalid callbackURL",
				code: "INVALID_CALLBACK_URL",
			});
	}
}

/**
 * Absent, a relative path, or an absolute `http(s)` URL. A value `URL` cannot parse alone is
 * relative (or garbage), and the library's `isSafeRelativeURL` decides it; one that parses with any
 * other scheme — `rowcat:`, `exp:`, `javascript:`, with or without `//` — is refused here.
 */
export function isWebTarget(target: unknown): boolean {
	if (target === undefined || target === null || target === "") return true;
	if (typeof target !== "string") return false;
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return true;
	}
	return url.protocol === "http:" || url.protocol === "https:";
}
