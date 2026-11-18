import { z } from "zod";

/**
 * How a program on someone's computer — today only `rowcat-mcp` — gets a session for their account
 * **without being told a password**: the device authorization grant (RFC 8628), approved in a browser
 * where the person is already signed in.
 *
 * ```text
 * tool    POST /v2/auth/device/code      { client_id }            → device_code · user_code · verification_uri(_complete) · expires_in · interval
 * person  opens verification_uri_complete in any browser — this computer, a phone, the laptop beside an SSH session
 * web     GET  /v2/auth/device?user_code=…    claims the request for the account signed in there
 *         POST /v2/auth/device/approve | deny  { userCode }
 * tool    POST /v2/auth/device/session   { device_code, client_id } → Set-Cookie (the session), once approved
 * ```
 *
 * Why this grant and not a loopback callback or a custom scheme: the tool may run where no browser is
 * (SSH, a container), a loopback redirect needs the browser on the same machine and a wildcard
 * `127.0.0.1:*` in the server's trusted origins, and an npm package cannot register a URL scheme with
 * the operating system. The tool needs only the API address it already has — the server builds the
 * approval address from its own web origin, so a fork's address never has to be typed twice.
 *
 * Why the last step is ours: the library's own `/device/token` answers with the raw session token as a
 * bearer credential, and this API has no bearer plugin, so that value authenticates nothing here (the
 * session cookie is signed). `/device/session` runs the library's same redemption state machine and
 * finishes the way every other sign-in here does — the signed cookie in `Set-Cookie` — so nothing after
 * it learns which door the session came through, and no token sits in a response body.
 */

/**
 * The one client this deployment approves. The approval screen names what it is approving by this
 * value, so a second tool is a second value here and a second line of copy there — never a string the
 * request makes up.
 */
export const MCP_DEVICE_CLIENT_ID = "rowcat-mcp";

/** Under `/v2/auth` — the session is the library's, so the grant is a set of its endpoints. */
export const DEVICE_CODE_AUTH_PATH = "/device/code";
export const DEVICE_SESSION_AUTH_PATH = "/device/session";

/** The web page a person approves on; the server joins it to its web origin for `verification_uri`. */
export const DEVICE_APPROVAL_PAGE_PATH = "/device";

/** The query parameter the library puts on `verification_uri_complete`. */
export const DEVICE_USER_CODE_PARAM = "user_code";

/**
 * What the server issues as the code a person compares: eight characters from an alphabet without
 * 0/O and 1/I (the library's default, restated here so the issuer and both readers use one value).
 * 32 symbols, so a byte modulo the length is unbiased.
 */
export const DEVICE_USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DEVICE_USER_CODE_LENGTH = 8;

const USER_CODE_SHAPE = new RegExp(
	`^[${DEVICE_USER_CODE_ALPHABET}]{${DEVICE_USER_CODE_LENGTH}}$`,
);

/**
 * Folds what arrived — the address, or what a person typed — to the issued form, `null` when it cannot
 * be one. Case and separators are forgiven (`abcd-efgh` is `ABCDEFGH`); characters outside the
 * alphabet are not guessed at, because guessing `0` for `O` would approve a code nobody was shown.
 */
export function deviceUserCodeFrom(input: unknown): string | null {
	if (typeof input !== "string") return null;
	const folded = input.replace(/[\s-]/g, "").toUpperCase();
	return USER_CODE_SHAPE.test(folded) ? folded : null;
}

/**
 * How a person reads the code: two groups of four (`ABCD-EFGH`). The terminal and the approval page
 * both write it through here — the person compares the two by eye, and a difference in grouping alone
 * reads as "a different code".
 */
export const formatDeviceUserCode = (code: string): string =>
	code.length === DEVICE_USER_CODE_LENGTH
		? `${code.slice(0, 4)}-${code.slice(4)}`
		: code;

/**
 * The request carries the client and nothing else. The library's `user_id` (pre-binding the request to
 * an account) and `scope` are refused: the account is decided by whoever approves, never named by the
 * request, and the session has no scopes to narrow — a scope here would be a promise nothing keeps.
 */
export const DeviceCodeRequest = z
	.object({ client_id: z.literal(MCP_DEVICE_CLIENT_ID) })
	.strict();
export type DeviceCodeRequest = z.infer<typeof DeviceCodeRequest>;

/** RFC 8628 §3.2. Only http(s) addresses pass, because the tool may hand this one to a browser. */
export const DeviceCodeResponse = z.object({
	device_code: z.string().min(1).max(191),
	user_code: z.string().min(1).max(191),
	verification_uri: z.url({ protocol: /^https?$/ }),
	verification_uri_complete: z.url({ protocol: /^https?$/ }),
	expires_in: z.number().int().positive(),
	interval: z.number().int().positive(),
});
export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponse>;

export const DeviceSessionRequest = z
	.object({
		device_code: z.string().min(1).max(191),
		client_id: z.literal(MCP_DEVICE_CLIENT_ID),
	})
	.strict();
export type DeviceSessionRequest = z.infer<typeof DeviceSessionRequest>;

/**
 * What a poll answers instead of a session (RFC 8628 §3.5, plus the request errors). The first two
 * mean "ask again"; the rest end the attempt.
 */
export const DEVICE_SESSION_ERRORS = [
	"authorization_pending",
	"slow_down",
	"expired_token",
	"access_denied",
	"invalid_grant",
	"invalid_request",
] as const;
export type DeviceSessionError = (typeof DEVICE_SESSION_ERRORS)[number];

export const DeviceSessionErrorBody = z.object({
	error: z.enum(DEVICE_SESSION_ERRORS),
	error_description: z.string().optional(),
});
