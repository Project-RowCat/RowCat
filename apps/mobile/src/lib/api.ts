import { createRowCatClient, type RowCatClient } from "@rowcat/sdk";
import { readAuthCookie } from "./auth.ts";
import { createAuthenticatedFetch } from "./auth-fetch.ts";
import { API_BASE_URL } from "./env.ts";

/**
 * The only path through which mobile calls the API.
 *
 * Same place and same rule as the web's `lib/api.ts`: feature code does not build
 * ``fetch(`${API_ORIGIN}/...`)``. Doing so would scatter path rules outside `@rowcat/contracts`,
 * and on a contract change those spots would go stale silently. With authentication there is one
 * more reason: a request built that way carries **no session**.
 *
 * One difference from the web. The web builds a client per request because of SSR (putting cookies
 * in a module global would send requests with someone else's session), but mobile has no server
 * rendering. Even so, **the credential is not frozen into the instance**: one process sees guest →
 * Alice → guest → Bob, so a cookie fixed at creation would stay stuck at the first value. So there
 * is one instance, and **the cookie is read per request** (`auth-fetch.ts`).
 *
 * Not putting `Cookie` into `headers` is the whole decision. The SDK builds its default headers
 * once (`createRowCatClient`), so a value placed there would be that value forever.
 */
let client: RowCatClient | null = null;

/**
 * Better Auth is the only source of the cookie. We do not read SecureStore here, because that would
 * make two copies of the code that knows the cookie's format (expiry folding, naming rules).
 */
const authenticatedFetch = createAuthenticatedFetch(readAuthCookie);

export function getRowCatClient(): RowCatClient {
	if (!client)
		client = createRowCatClient({
			baseUrl: API_BASE_URL,
			fetch: authenticatedFetch,
		});
	return client;
}
