import { app } from "../app.ts";

/**
 * Where API tests build requests, going through the real Hono app.
 *
 * Service functions are not called directly because the fragile parts sit outside them: the
 * middleware resolving the viewer from the session, gates, wire parsing and HTTP translation. This
 * file only shortens that call; what is verified stays in each test. Domain operations (seeding a
 * story, suspending a member) do not belong here.
 */

/** Trusted origin, sent by default because a browser would send it. */
export const WEB_ORIGIN = "http://localhost:3000";

/** Folds several `Set-Cookie` headers into one `Cookie` line that can ride a request. */
export const cookieFromResponse = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");

export interface ApiRequestInit {
	method?: string;
	cookie?: string | null;
	/** Serialized as JSON with `Content-Type` attached; use `raw` for binary bodies. */
	body?: unknown;
	/** Body sent as-is (cover and avatar uploads). */
	raw?: string | Uint8Array;
	headers?: Record<string, string>;
	/** `null` omits the origin; only for testing the origin decision itself. */
	origin?: string | null;
	/** Simulates the caller leaving (routes read it as `c.req.raw.signal`). */
	signal?: AbortSignal;
}

/** Requests the app with a path prefix; `path` is only the part after the prefix (`/me`). */
function request(
	prefix: string,
	path: string,
	init: ApiRequestInit = {},
): Promise<Response> {
	const { method, cookie, body, raw, headers, origin, signal } = init;
	const resolvedOrigin = origin === undefined ? WEB_ORIGIN : origin;
	const hasBody = body !== undefined || raw !== undefined;
	return Promise.resolve(
		app.request(`${prefix}${path}`, {
			method: method ?? (hasBody ? "POST" : "GET"),
			headers: {
				...(resolvedOrigin ? { Origin: resolvedOrigin } : {}),
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
				...(cookie ? { Cookie: cookie } : {}),
				...headers,
			},
			body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
			signal,
		}),
	);
}

/** Under `/v2`: the product API. */
export const api = (path: string, init?: ApiRequestInit): Promise<Response> =>
	request("/v2", path, init);

export const apiGet = (
	path: string,
	cookie?: string | null,
): Promise<Response> => api(path, { cookie });

export const apiPost = (
	path: string,
	body?: unknown,
	cookie?: string | null,
): Promise<Response> => api(path, { method: "POST", body, cookie });

/**
 * Under `/v2/auth`: operations Better Auth already opens over HTTP (signup, sign-in, password
 * change, deletion). They are not wrapped in our routers, hence the different prefix
 * (`routes/me/account.ts` header).
 */
export const authPost = (
	path: string,
	body?: unknown,
	cookie?: string | null,
): Promise<Response> =>
	request("/v2/auth", path, { method: "POST", body, cookie });

/** Reads the response body. The type assertion is the caller's contract claim, not validation. */
export const jsonOf = async <T>(response: Response): Promise<T> =>
	(await response.json()) as T;
