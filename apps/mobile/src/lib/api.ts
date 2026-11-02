import { apiBaseUrl, createRowCatClient, type RowCatClient } from "@rowcat/sdk";
import { readAuthCookieFor } from "./auth.ts";
import { createAuthenticatedFetch } from "./auth-fetch.ts";
import { activeInstance } from "./instances/device-registry.ts";

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
 * Alice → guest → Bob, so a cookie fixed at creation would stay stuck at the first value. So the
 * **cookie is read per request** (`auth-fetch.ts`).
 *
 * Not putting `Cookie` into `headers` is the whole decision. The SDK builds its default headers
 * once (`createRowCatClient`), so a value placed there would be that value forever.
 *
 * **One client per server** (`docs/mobile/INSTANCES.md` §격리). The origin and the cookie source are
 * bound together when a client is built: a request built for one server must not pick up another
 * server's session because the active instance moved in between. The active instance changes only by
 * remounting the tree (`active-instance-root.tsx`), so everything below the root asks for its own
 * server's client.
 */
const clients = new Map<string, RowCatClient>();

export function getRowCatClient(): RowCatClient {
	const active = activeInstance();
	let client = clients.get(active.origin);
	if (!client) {
		client = createRowCatClient({
			baseUrl: apiBaseUrl(active.origin),
			/**
			 * Better Auth is the only source of the cookie — that server's own client, never the active one
			 * read at request time. We do not read SecureStore here, because that would make two copies of
			 * the code that knows the cookie's format (expiry folding, naming rules).
			 */
			fetch: createAuthenticatedFetch(() => readAuthCookieFor(active)),
		});
		clients.set(active.origin, client);
	}
	return client;
}
