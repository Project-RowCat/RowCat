import {
	DEVICE_CODE_AUTH_PATH,
	DEVICE_SESSION_AUTH_PATH,
	type DeviceCodeRequest,
	DeviceCodeResponse,
	DeviceSessionErrorBody,
	type DeviceSessionRequest,
	MCP_DEVICE_CLIENT_ID,
} from "@rowcat/contracts";

/**
 * Sign-in and viewer lookup, using Better Auth's HTTP surface as-is. **This tool never sees a
 * password.** It asks the server for a sign-in request, a person approves it in a browser where they
 * are already signed in, and the next poll answers with the session cookie itself — the same signed
 * cookie web and mobile hold, carried verbatim. Nothing here builds hashes or assembles tokens
 * (`@rowcat/contracts`' `device-authorization.ts` has the flow and why this grant).
 *
 * ```text
 * requestDeviceCode   POST /auth/device/code      → the address to approve at, the code to compare, timing
 * pollDeviceSession   POST /auth/device/session   → pending · slow down · denied · expired · the session
 * fetchViewer         GET  /me                    → who the cookie belongs to
 * ```
 *
 * The answers are folded into a small vocabulary here, and the order (when to ask, how long to wait,
 * what to print) belongs to `browser-sign-in.ts`.
 */

const base = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

/** Collapses the `Set-Cookie` lines into one cookie line. */
const cookieOf = (response: Response): string | null => {
	const raw = response.headers.getSetCookie?.() ?? [];
	const pairs = raw
		.map((line) => line.split(";")[0] ?? "")
		.filter((pair) => pair.includes("="));
	return pairs.length === 0 ? null : pairs.join("; ");
};

/**
 * The request's `Origin`, set to the API's own origin.
 *
 * Node's `fetch` sends `Sec-Fetch-Mode: cors` (a forbidden header we cannot remove) but no
 * `Origin`. Better Auth reads that combination as a browser request with a null origin and refuses
 * it with `MISSING_OR_NULL_ORIGIN` wherever it checks the origin, so `rowcat-mcp login` once failed on
 * every deployment for want of this header.
 *
 * The API's own origin is already trusted, so no deployment setting is added and `trustedOrigins`
 * does not widen. Using the web origin would impersonate an origin that is not this tool's own and
 * would add a per-deployment setting. The origin check guards against cross-site browser requests;
 * this process has no ambient cookies, so that threat model does not apply.
 */
const originOf = (baseUrl: string): string | null => {
	try {
		return new URL(baseUrl).origin;
	} catch {
		return null;
	}
};

const post = (
	fetchImpl: typeof fetch,
	baseUrl: string,
	path: string,
	body: DeviceCodeRequest | DeviceSessionRequest,
): Promise<Response> => {
	const origin = originOf(baseUrl);
	return fetchImpl(`${base(baseUrl)}/auth${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			...(origin === null ? {} : { Origin: origin }),
		},
		body: JSON.stringify(body),
	});
};

const jsonOf = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export type DeviceCodeOutcome =
	| { readonly ok: true; readonly request: DeviceCodeResponse }
	/** `status` is `null` when no answer arrived at all (the address, the network). */
	| { readonly ok: false; readonly status: number | null };

/**
 * Asks for a sign-in request. The answer is parsed, not trusted: `verification_uri_complete` is
 * handed to the operating system's opener, and the contract admits only http(s) addresses.
 */
export async function requestDeviceCode(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<DeviceCodeOutcome> {
	let response: Response;
	try {
		response = await post(fetchImpl, baseUrl, DEVICE_CODE_AUTH_PATH, {
			client_id: MCP_DEVICE_CLIENT_ID,
		});
	} catch {
		return { ok: false, status: null };
	}
	if (!response.ok) return { ok: false, status: response.status };
	const parsed = DeviceCodeResponse.safeParse(await jsonOf(response));
	return parsed.success
		? { ok: true, request: parsed.data }
		: { ok: false, status: response.status };
}

export type DevicePoll =
	| { readonly kind: "session"; readonly cookie: string }
	| { readonly kind: "pending" }
	/** RFC 8628 §3.5: ask less often from now on. */
	| { readonly kind: "slow_down" }
	| { readonly kind: "denied" }
	/** Expired, already redeemed or unknown: every one of them is "start again". */
	| { readonly kind: "expired" }
	/**
	 * Approved, but the answer carried no cookie — something between here and the API dropped
	 * `Set-Cookie`. Asking again cannot help: the request was consumed by that answer.
	 */
	| { readonly kind: "no_session" }
	/** No answer, or one this process cannot read; the caller decides how often that may happen. */
	| { readonly kind: "unknown"; readonly status: number | null };

/** One poll. Never throws: every way it can end is a value the loop branches on. */
export async function pollDeviceSession(
	baseUrl: string,
	deviceCode: string,
	fetchImpl: typeof fetch = fetch,
): Promise<DevicePoll> {
	let response: Response;
	try {
		response = await post(fetchImpl, baseUrl, DEVICE_SESSION_AUTH_PATH, {
			device_code: deviceCode,
			client_id: MCP_DEVICE_CLIENT_ID,
		});
	} catch {
		return { kind: "unknown", status: null };
	}
	if (response.ok) {
		const cookie = cookieOf(response);
		return cookie === null
			? { kind: "no_session" }
			: { kind: "session", cookie };
	}
	const parsed = DeviceSessionErrorBody.safeParse(await jsonOf(response));
	if (!parsed.success) return { kind: "unknown", status: response.status };
	switch (parsed.data.error) {
		case "authorization_pending":
			return { kind: "pending" };
		case "slow_down":
			return { kind: "slow_down" };
		case "access_denied":
			return { kind: "denied" };
		case "expired_token":
		case "invalid_grant":
			return { kind: "expired" };
		default:
			return { kind: "unknown", status: response.status };
	}
}

export interface Viewer {
	readonly id: string;
	readonly nickname: string;
}

/** Who the cookie belongs to; `null` for a guest (not an error). */
export async function fetchViewer(
	baseUrl: string,
	cookie: string,
): Promise<Viewer | null> {
	const response = await fetch(`${base(baseUrl)}/me`, {
		headers: { Cookie: cookie, Accept: "application/json" },
	});
	if (!response.ok) return null;
	const body: unknown = await response.json();
	if (typeof body !== "object" || body === null) return null;
	const row = body as { id?: unknown; nickname?: unknown };
	if (typeof row.id !== "string") return null;
	return {
		id: row.id,
		nickname: typeof row.nickname === "string" ? row.nickname : "",
	};
}
