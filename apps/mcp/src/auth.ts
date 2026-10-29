/**
 * Sign-in and viewer lookup, using Better Auth's HTTP surface as-is. It calls the same two
 * addresses web and mobile call and carries the server's session cookie verbatim; nothing here
 * builds hashes or assembles tokens.
 *
 * The password is never stored: it goes out in one request and only the server's cookie remains.
 *
 * Deployments that require email verification return no session from sign-in. Without reading the
 * response the next request would answer as guest and look like "signed in but not working", so a
 * missing cookie is reported in a sentence.
 */

export interface SignInResult {
	/** One `name=value` line, sent as the Cookie header from the next request on. */
	readonly cookie: string;
}

export class RowCatAuthError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "RowCatAuthError";
		this.status = status;
	}
}

/** Collapses the `Set-Cookie` lines into one cookie line. */
const cookieOf = (response: Response): string | null => {
	const raw = response.headers.getSetCookie?.() ?? [];
	const pairs = raw
		.map((line) => line.split(";")[0] ?? "")
		.filter((pair) => pair.includes("="));
	return pairs.length === 0 ? null : pairs.join("; ");
};

/**
 * The request's `Origin`, set to the API's own origin; without it sign-in is a 403.
 *
 * Node's `fetch` sends `Sec-Fetch-Mode: cors` (a forbidden header we cannot remove) but no
 * `Origin`. Better Auth reads that combination as a browser request with a null origin and rejects
 * it with `MISSING_OR_NULL_ORIGIN`, so `rowcat-mcp login` failed on every deployment before this.
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

export async function signIn(
	baseUrl: string,
	email: string,
	password: string,
): Promise<SignInResult> {
	const origin = originOf(baseUrl);
	const response = await fetch(
		`${baseUrl.replace(/\/+$/, "")}/auth/sign-in/email`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(origin === null ? {} : { Origin: origin }),
			},
			body: JSON.stringify({ email, password }),
		},
	);
	if (!response.ok)
		throw new RowCatAuthError(
			response.status === 401 || response.status === 403
				? "The email or password is incorrect."
				: `Sign-in failed (HTTP ${response.status}).`,
			response.status,
		);
	const cookie = cookieOf(response);
	if (cookie === null)
		throw new RowCatAuthError(
			"No session was created. The account may need email verification: sign in once in a browser, then try again.",
			response.status,
		);
	return { cookie };
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
	const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/me`, {
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
