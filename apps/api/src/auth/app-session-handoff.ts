import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { expo } from "@better-auth/expo";
import {
	APP_SESSION_HANDOFF_BINDING_PARAM,
	APP_SESSION_HANDOFF_CODE_PARAM,
	APP_SESSION_HANDOFF_INVALID,
	APP_SESSION_HANDOFF_REDEEM_PATH,
	AppSessionHandoffRedeemRequest,
	AppSessionHandoffToken,
} from "@rowcat/contracts";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
	saveAppSessionHandoff,
	takeAppSessionHandoff,
} from "../services/app-session-handoff.ts";

/**
 * The native app's browser sign-in, finished by a one-time code instead of a cookie in a URL
 * (`@rowcat/contracts`' `app-session-handoff.ts` has the flow).
 *
 * ## What changed in `@better-auth/expo`
 *
 * That plugin does three things, and this file keeps two:
 *
 * ```text
 * expo-origin → origin           kept     native fetch has no Origin; the trust check runs on this
 * /expo-authorization-proxy      kept     native has nowhere to plant the state cookie
 * after /callback: cookie → URL  removed  the session itself rode the rowcat:// redirect
 * ```
 *
 * The third is the reason for this file. A custom scheme does not prove which app receives the URL —
 * on Android another installed app may claim `rowcat://`, and the email verification link goes through
 * the system's routing on both platforms. `nativeExpoPlugin` is the library plugin with its after-hook
 * removed; `appSessionHandoffPlugin` stands in that seat and never writes a cookie into a URL.
 *
 * ## The rewrite
 *
 * Every redirect to a trusted non-http scheme has `cookie` and the binding stripped, and the response's
 * `Set-Cookie` dropped: the session must live in the app, not also in the system browser's jar. Only when
 * the callback created a session **and** the app sent a binding does a code ride the redirect.
 * A callback without a binding hands over nothing — there is no fallback for older clients, because
 * the fallback is the weakness (there is no hosted service and no shipped store build that needs it).
 */

/** The library plugin minus the after-hook that put the session cookie in the redirect URL. */
export const nativeExpoPlugin = (): BetterAuthPlugin => {
	const { hooks: _cookieInUrl, ...plugin } = expo();
	return plugin as BetterAuthPlugin;
};

const NATIVE_REDIRECT_PATHS = [
	"/callback",
	"/magic-link/verify",
	"/verify-email",
];

export interface NativeRedirectRewrite {
	/** The redirect to send instead — no `cookie`, no binding. */
	location: string;
	/** The app's binding, when it sent a well-formed one. */
	binding: string | null;
}

/**
 * Pure: what a redirect becomes. `null` means it is not a custom-scheme redirect and stays as it is
 * (http and https destinations are the web's, which receives its session as a cookie on its own origin).
 */
export function rewriteNativeRedirect(
	location: string,
): NativeRedirectRewrite | null {
	let url: URL;
	try {
		url = new URL(location);
	} catch {
		return null;
	}
	if (url.protocol === "http:" || url.protocol === "https:") return null;
	const raw = url.searchParams.get(APP_SESSION_HANDOFF_BINDING_PARAM);
	url.searchParams.delete(APP_SESSION_HANDOFF_BINDING_PARAM);
	url.searchParams.delete(APP_SESSION_HANDOFF_CODE_PARAM);
	url.searchParams.delete("cookie");
	const binding =
		raw !== null && AppSessionHandoffToken.safeParse(raw).success ? raw : null;
	return { location: url.toString(), binding };
}

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

/** `base64url(sha256(verifier))` — the same derivation the app runs (`apps/mobile/src/lib/app-session-handoff.ts`). */
export const handoffBindingOf = (verifier: string): string =>
	base64url(createHash("sha256").update(verifier).digest());

const sameToken = (a: string, b: string): boolean => {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * The after-hook's body, with its four inputs passed in so a test can drive it without an OAuth
 * provider: the response headers it rewrites, the library's trust check, the session the callback
 * created (if any) and where the one-time row goes.
 */
export async function handNativeRedirect(input: {
	headers: Headers;
	isTrusted: (url: string) => boolean;
	sessionToken: string | null;
	save: typeof saveAppSessionHandoff;
	newCode?: () => string;
}): Promise<void> {
	const location = input.headers.get("location");
	if (!location || !input.isTrusted(location)) return;
	const rewrite = rewriteNativeRedirect(location);
	if (!rewrite) return;
	input.headers.delete("set-cookie");
	let destination = rewrite.location;
	if (input.sessionToken && rewrite.binding) {
		const code = (input.newCode ?? (() => base64url(randomBytes(32))))();
		await input.save(code, {
			binding: rewrite.binding,
			sessionToken: input.sessionToken,
		});
		const url = new URL(destination);
		url.searchParams.set(APP_SESSION_HANDOFF_CODE_PARAM, code);
		destination = url.toString();
	}
	input.headers.set("location", destination);
}

const invalid = () =>
	new APIError("BAD_REQUEST", {
		code: APP_SESSION_HANDOFF_INVALID,
		message: "This sign-in could not be completed. Please sign in again.",
	});

export const appSessionHandoffPlugin = () =>
	({
		id: "rowcat-app-session-handoff",
		hooks: {
			after: [
				{
					matcher: (context) =>
						NATIVE_REDIRECT_PATHS.some((path) =>
							context.path?.startsWith(path),
						),
					handler: createAuthMiddleware(async (ctx) => {
						const headers = ctx.context.responseHeaders;
						if (!headers) return;
						await handNativeRedirect({
							headers,
							isTrusted: (url) => ctx.context.isTrustedOrigin(url),
							sessionToken: ctx.context.newSession?.session.token ?? null,
							save: saveAppSessionHandoff,
						});
					}),
				},
			],
		},
		endpoints: {
			appSessionRedeem: createAuthEndpoint(
				APP_SESSION_HANDOFF_REDEEM_PATH,
				{ method: "POST", body: AppSessionHandoffRedeemRequest },
				async (ctx) => {
					const handoff = await takeAppSessionHandoff(ctx.body.code);
					if (
						!handoff ||
						!sameToken(handoff.binding, handoffBindingOf(ctx.body.verifier))
					)
						throw invalid();
					const found = await ctx.context.internalAdapter.findSession(
						handoff.sessionToken,
					);
					if (!found || found.session.expiresAt.getTime() <= Date.now())
						throw invalid();
					await setSessionCookie(ctx, {
						session: found.session,
						user: found.user,
					});
					return ctx.json({ ok: true });
				},
			),
		},
	}) satisfies BetterAuthPlugin;
