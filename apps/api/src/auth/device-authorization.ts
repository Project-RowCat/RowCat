import { randomBytes } from "node:crypto";
import {
	DEVICE_APPROVAL_PAGE_PATH,
	DEVICE_CODE_AUTH_PATH,
	DEVICE_SESSION_AUTH_PATH,
	DEVICE_USER_CODE_ALPHABET,
	DEVICE_USER_CODE_LENGTH,
	DeviceCodeRequest,
	DeviceSessionRequest,
	MCP_DEVICE_CLIENT_ID,
} from "@rowcat/contracts";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
	deviceAuthorization,
	redeemDeviceCode,
} from "better-auth/plugins/device-authorization";
import { isFreshSession } from "./two-factor-policy.ts";

/**
 * `rowcat-mcp`'s sign-in: the device authorization grant (RFC 8628), approved on the web by a person
 * already signed in there (`@rowcat/contracts`' `device-authorization.ts` has the flow and why this
 * grant).
 *
 * The protocol is the library's plugin — issuance, the claim, approval and denial, polling with
 * `slow_down`, expiry and the one-time claim (`redeemDeviceCode`). That state machine is the kind of
 * code that is wrong when hand-written, the same reason the rest of `auth/` leans on the library. What
 * is ours is the one place the library hands over a credential in a form this server does not use:
 *
 * ```text
 * /device/code · /device · /device/approve · /device/deny   the library's, kept
 * /device/token                                             removed  answers with the raw session token as a
 *                                                                    bearer credential; there is no bearer plugin
 * /device/session                                           ours     the same redemption, then the signed cookie
 * ```
 *
 * `/device/session` ends exactly as `local-sign-in.ts` and the app hand-off do — `createSession`, then
 * `setSessionCookie` — so the tool stores a cookie like every other client, nothing downstream learns
 * which door it came through, and no token rides a response body.
 *
 * Two door rules stand in front (`enforceDeviceAuthorizationPolicy`, called from `hooks.before`):
 *
 * - **The request names the client and nothing else.** The library would accept `user_id` (pre-binding
 *   the request to an account) and `scope`; the account is decided by whoever approves, never named by
 *   the request, and the session has no scopes to narrow.
 * - **Approving needs a recent sign-in.** Approval mints a new session, and a new session is fresh.
 *   Without this rule a long-lived stolen cookie becomes a fresh one in two requests, and freshness is
 *   what stands between such a cookie and a permanent login method (passkey registration) or the
 *   two-factor settings. Same 24 hours and the same `SESSION_NOT_FRESH` as `two-factor-policy.ts`, so
 *   the page falls into the screens' existing "sign in again" sentence.
 *
 * Not decided here: which account approves. That is the session on the web page, the same session
 * that passed whatever sign-in the account has (two-factor included) — approval does not lower that
 * bar, it reuses it.
 */

/**
 * The request's lifetime. Long enough to sign in on the web first (a social round trip, a two-factor
 * code), short enough that a code read off someone's screen is soon worth nothing. The retention job
 * sweeps rows that outlive it unpolled (`jobs/legal/retention-policies.ts`).
 */
export const DEVICE_CODE_TTL_SECONDS = 10 * 60;

/** The library's default, stated because the tool's backoff starts from what the server answers. */
const DEVICE_POLL_INTERVAL = "5s";

/**
 * Issuance per address: an anonymous request that writes a row. A person runs `setup` a handful of
 * times; five a minute leaves room for that and a shared office address, and keeps one address from
 * filling the table faster than expiry empties it. Polling is not listed — the library answers a
 * too-eager poll with `slow_down` per request, and the default rule bounds the rest.
 */
export const DEVICE_CODE_RATE_LIMIT = {
	[DEVICE_CODE_AUTH_PATH]: { window: 60, max: 5 },
};

/**
 * The code a person compares, from the contract's alphabet so the issuer and both readers (the web
 * page, the terminal) agree on one value. 256 is a multiple of 32, so `byte % 32` is unbiased.
 */
export function newDeviceUserCode(
	bytes: Uint8Array = randomBytes(DEVICE_USER_CODE_LENGTH),
): string {
	return Array.from(
		bytes.subarray(0, DEVICE_USER_CODE_LENGTH),
		(byte) =>
			DEVICE_USER_CODE_ALPHABET[byte % DEVICE_USER_CODE_ALPHABET.length],
	).join("");
}

/** RFC 8628's error shape, which the library's own refusals on these paths already use. */
const invalidRequest = (description: string) =>
	new APIError("BAD_REQUEST", {
		error: "invalid_request",
		error_description: description,
	});

/** The library plugin minus the endpoint that hands over a bearer token. */
const libraryPlugin = (webOrigin: string) => {
	const { endpoints, ...plugin } = deviceAuthorization({
		expiresIn: `${DEVICE_CODE_TTL_SECONDS}s`,
		interval: DEVICE_POLL_INTERVAL,
		userCodeLength: DEVICE_USER_CODE_LENGTH,
		generateUserCode: () => newDeviceUserCode(),
		validateClient: (clientId) => clientId === MCP_DEVICE_CLIENT_ID,
		/**
		 * The page lives on the web, not under this API. The deployment's canonical web origin is the one
		 * value the server already uses for absolute web addresses (`webOrigin` in `env.ts`), so a fork
		 * never configures this separately.
		 */
		verificationUri: new URL(DEVICE_APPROVAL_PAGE_PATH, webOrigin).toString(),
	});
	const { deviceToken: _bearerToken, ...kept } = endpoints;
	return { plugin, endpoints: kept };
};

export const deviceAuthorizationPlugin = (webOrigin: string) => {
	const { plugin, endpoints } = libraryPlugin(webOrigin);
	return {
		...plugin,
		endpoints: {
			...endpoints,
			deviceSession: createAuthEndpoint(
				DEVICE_SESSION_AUTH_PATH,
				{
					method: "POST",
					body: DeviceSessionRequest,
					onValidationError: ({ message }) => {
						throw invalidRequest(message);
					},
					metadata: { noStore: true },
				},
				async (ctx) => {
					const { device_code, client_id } = ctx.body;
					const { user } = await redeemDeviceCode({
						ctx,
						deviceCode: device_code,
						authorizeRedemption: (record) => {
							if (record.clientId !== client_id)
								throw new APIError("BAD_REQUEST", {
									error: "invalid_grant",
									error_description: "Client ID mismatch",
								});
							return {
								ownershipWhere: { field: "clientId", value: client_id },
								context: undefined,
							};
						},
						prepareRedemption: () => undefined,
					});
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					if (!session)
						throw new APIError("INTERNAL_SERVER_ERROR", {
							error: "server_error",
							error_description: "Failed to create a session",
						});
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ ok: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
};

/** The library's approval path; the freshness rule stands in front of it. */
export const DEVICE_APPROVE_AUTH_PATH = "/device/approve";

/**
 * Called from `hooks.before`; throws to block. Both rules are described in the file header.
 */
export async function enforceDeviceAuthorizationPolicy(
	// biome-ignore lint/suspicious/noExplicitAny: passes Better Auth's middleware context type through as-is.
	ctx: { path?: string; body?: unknown } & any,
	now: () => number = Date.now,
): Promise<void> {
	if (ctx.path === DEVICE_CODE_AUTH_PATH) {
		if (!DeviceCodeRequest.safeParse(ctx.body).success)
			throw invalidRequest("The request names the client and nothing else.");
		return;
	}
	if (ctx.path !== DEVICE_APPROVE_AUTH_PATH) return;
	const session = await getSessionFromCtx(ctx);
	/** Without a session the library answers 401; do not preempt its vocabulary. */
	if (!session?.session) return;
	if (!isFreshSession(session.session.createdAt, now()))
		throw APIError.from("FORBIDDEN", {
			message: "Session is not fresh",
			code: "SESSION_NOT_FRESH",
		});
}
