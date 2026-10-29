import type { IdentityVerificationRequest } from "@portone/browser-sdk/v2";
import type { IdentityVerificationHandoff } from "@rowcat/contracts";

/**
 * Maps the handoff method the server chose to what this app actually does. Two pure functions.
 *
 * Same role as the web's `lib/identity/handoff.ts`; only the execution differs (the native SDK
 * draws a webview here). The rule is the same: follow the server's choice, and do not proceed on an
 * unknown method.
 *
 * - Pure so the mapping is testable without rendering: a wrong `identityVerificationId` fails
 *   silently (the window opens and verification completes, but the server cannot find its attempt).
 * - `identityVerificationId` is never built here. The server creates and stores it and re-asks
 *   the authority with the stored value; a client-chosen id would let someone attach another
 *   person's verification to their own attempt. So no RNG, viewer id or clock in this file.
 * - `redirectUrl` is not sent. The server's value is the web's return address; the native SDK
 *   overrides it with its own `portone://blank` callback, so passing it is either dead or a future
 *   leak of a browser-only address into the native layer. That is also why the handoff is not
 *   spread (`{ ...handoff }`): every new contract field would ride along silently.
 */

/**
 * The request for the native SDK, picked from the SDK's own type so a renamed field breaks this
 * `Pick` first instead of failing only at runtime.
 */
export type PortOneIdentityRequest = Pick<
	IdentityVerificationRequest,
	"storeId" | "channelKey" | "identityVerificationId"
>;

/**
 * What this app can do; the third is doing nothing.
 *
 * ```text
 * portone      the native SDK draws a webview — the production path
 * browser      open the server-built address in the system browser — the dev verifier's path
 * unsupported  do not proceed — the client is fail-closed too
 * ```
 *
 * `browser` exists because the contract really has that branch (`kind: "redirect"`); opening the
 * browser preserves that verifier's meaning. The returned address's values are never read — the
 * server alone has authority over the result.
 */
export type NativeVerificationPlan =
	| { kind: "portone"; request: PortOneIdentityRequest }
	| { kind: "browser"; url: string }
	| { kind: "unsupported" };

/**
 * Not a `switch` with `default: throw`, so an unknown kind falls to `unsupported`: when a
 * deployment picks a new authority, not proceeding is better than the screen dying.
 */
export function planNativeVerification(
	handoff: IdentityVerificationHandoff,
): NativeVerificationPlan {
	if (handoff.kind === "portone-v2")
		return {
			kind: "portone",
			request: {
				storeId: handoff.storeId,
				channelKey: handoff.channelKey,
				identityVerificationId: handoff.identityVerificationId,
			},
		};
	if (handoff.kind === "redirect")
		return { kind: "browser", url: handoff.redirectUrl };
	return { kind: "unsupported" };
}

/**
 * Minimal shape of the authority's response. The native SDK turns the `portone://` callback's query
 * parameters into an object as-is (`Object.fromEntries`), so declared fields may be missing; read
 * only the one axis we use.
 */
export interface ProviderResponseShape {
	code?: unknown;
}

/**
 * Whether the authority reported success. Judged by the presence of the structured `code` alone,
 * never by message text (cancel codes differ per channel, and wording changes would flip the
 * result).
 *
 * Success only means the authority's window finished; the server then re-asks with its own secret
 * and decides eligibility.
 */
export function providerReportedSuccess(
	response: ProviderResponseShape | null | undefined,
): boolean {
	if (!response) return false;
	const code = response.code;
	/** An empty string is not a code either; query parameters can arrive that way. */
	return code === undefined || code === null || code === "";
}
