import { MCP_DEVICE_CLIENT_ID } from "@rowcat/contracts";

/**
 * The rules of the page where a person approves `rowcat-mcp` (`@rowcat/contracts`'
 * `device-authorization.ts` has the flow). Pure: the screen draws one face, and which face is
 * decided here from what the server answered.
 *
 * ```text
 * the address has no usable code      enter-code     type the code from the terminal
 * read: pending, this account, mcp    review         the code, what approving gives, approve / deny
 * read: pending, no client in answer  other-account  another account opened it first; nothing to press
 * read: approved or denied            answered       opened again after it was answered
 * read or answer: unknown, expired    invalid        run setup again
 * approve: SESSION_NOT_FRESH / 401    recent-login   sign in again, then come back to this address
 * ```
 *
 * - **The page names what it approves by the client id, never by text the request carries.** A
 *   pending request from a client this page does not know is `invalid`, not a review with a blank
 *   name — approving what the screen cannot describe is the phishing shape this grant invites.
 * - **Opening the page is a write.** The server's read claims an unclaimed request for the account
 *   looking at it, so the page reads once per code, not on every focus or retry loop. The read is
 *   also rate-limited per address (five per ten minutes in production), and a loop would spend that
 *   on nothing.
 * - **Library strings are never drawn** (`auth-error.ts` says why). Only `error` (RFC 8628 codes),
 *   `code` (Better Auth's) and `status` are read.
 */

/** What `GET /v2/auth/device` answers; only these fields are read. */
export interface DeviceRequestRead {
	status?: unknown;
	client_id?: unknown;
}

/**
 * The `error` slot of the Better Auth client's `{ data, error }`. The grant's refusals carry RFC 8628
 * codes in `error`; the recent-sign-in rule carries Better Auth's `code`.
 */
export interface DeviceFailure {
	error?: string;
	code?: string;
	status?: number;
}

export type DeviceApprovalFailure = "network" | "rate-limited" | "unknown";

/**
 * Which face is showing. One slot, for the reason `reset-password-page.tsx` gives: several booleans
 * would make "approved and also asking to sign in again" representable.
 */
export type DeviceApprovalFace =
	| { kind: "enter-code" }
	| { kind: "checking"; userCode: string }
	| { kind: "review"; userCode: string }
	| { kind: "approved" }
	| { kind: "denied" }
	| { kind: "answered" }
	| { kind: "other-account" }
	| { kind: "invalid" }
	| { kind: "recent-login"; userCode: string }
	| { kind: "failed"; userCode: string; reason: DeviceApprovalFailure };

/** The face for what the read answered. */
export function faceForRead(
	userCode: string,
	read: DeviceRequestRead,
): DeviceApprovalFace {
	if (read.status === "approved" || read.status === "denied")
		return { kind: "answered" };
	if (read.status !== "pending") return { kind: "invalid" };
	/** The server leaves the client out of the answer for anyone but the account holding the request. */
	if (read.client_id === undefined) return { kind: "other-account" };
	return read.client_id === MCP_DEVICE_CLIENT_ID
		? { kind: "review", userCode }
		: { kind: "invalid" };
}

/**
 * The face for a refused read or answer. `null` status is a request that never got an answer
 * (network); retrying it is safe because every call here is idempotent or refuses a repeat.
 */
export function faceForFailure(
	userCode: string,
	failure: DeviceFailure | null | undefined,
): DeviceApprovalFace {
	const status = failure?.status ?? 0;
	if (status === 0) return { kind: "failed", userCode, reason: "network" };
	if (failure?.code === "SESSION_NOT_FRESH" || status === 401)
		return { kind: "recent-login", userCode };
	if (status === 429)
		return { kind: "failed", userCode, reason: "rate-limited" };
	/**
	 * `access_denied` with 403 is the library refusing an account that is not the one holding the
	 * request — the same fact the read reports as a missing client.
	 */
	if (status === 403 && failure?.error === "access_denied")
		return { kind: "other-account" };
	/** Unknown, expired, already answered or never opened: each is "start again from the terminal". */
	if (
		failure?.error === "invalid_request" ||
		failure?.error === "expired_token"
	)
		return { kind: "invalid" };
	return { kind: "failed", userCode, reason: "unknown" };
}
