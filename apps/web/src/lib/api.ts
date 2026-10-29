import {
	apiBaseUrl,
	createRowCatClient,
	DEVELOPMENT_API_ORIGIN,
} from "@rowcat/sdk";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * Origin of the API this app connects to. Only the origin is chosen here. The path prefix (`/v2`)
 * comes from @rowcat/contracts and is attached by @rowcat/sdk, so a version bump should need no
 * web-side change.
 *
 * The default is the local API, and so are local `vite build` and `vite preview`, not just `vite
 * dev`. A hand-run build silently touching production data is the riskier failure. The deployment
 * image bakes in the real domain through the build argument `VITE_API_ORIGIN`
 * (apps/web/Dockerfile). To point a local build elsewhere, set it in `apps/web/.env.local`. A
 * malformed value makes `new URL` throw at module load.
 *
 * SSR may not use this value; see `ssrBaseUrl`. That case happens in the compose stack.
 *
 * Do not add a helper such as `apiUrl(path)`. Feature code would then assemble endpoints by hand,
 * and path and query serialization would spread outside @rowcat/contracts.
 */
// An empty build argument arrives as an empty string. `??` does not filter it out and `new URL('')`
// throws, so `||` is used.
const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim() || undefined;

/**
 * Base URL of the API (`.../v2`). It is exported because a second consumer exists: the Better Auth
 * client needs `${API_BASE_URL}/auth` (lib/auth.ts). If that module re-read the environment
 * variable, the origin decision would split in two, and fixing one side would quietly send login
 * requests to a different server.
 *
 * Only web infrastructure (lib/) should use it. Feature code still goes through
 * `getRowCatClient()`; a fetch built from this value inside a feature would add paths outside the
 * contract.
 */
export const API_BASE_URL = apiBaseUrl(
	configuredOrigin ?? DEVELOPMENT_API_ORIGIN,
);

/**
 * Base URL the server-side render uses to call the API. This is a runtime value.
 *
 * It must differ from the browser value above when the same API has different addresses for the
 * browser and the web server. The compose stack does: the browser reaches the API at the published
 * `http://localhost:3001`, but from inside the web container that address points at the container
 * itself, so SSR dies with `fetch failed`. Inside the compose network the API is reached by its
 * service name, `http://api:3001`.
 *
 * It reads `process.env`, not `import.meta.env`. The browser value is baked into the bundle at
 * build time, so each deployment needs its own image. This value never reaches the browser, so it
 * can be supplied at runtime, and one image can run locally and in production with different
 * internal addresses.
 *
 * When unset, it equals the browser value. That is correct when web and api share one domain, and
 * then this branch does nothing.
 *
 * The read sits inside `.server()` because of the bundle boundary. Read at module top level,
 * `process` would leak into the browser bundle.
 */
let ssrBaseUrl: string | undefined;

/**
 * The browser's shared client.
 *
 * One tab is one person and the browser manages cookies, so there is no reason to split instances.
 * `credentials: 'include'` attaches the session. The code deliberately does not read
 * `document.cookie`: the Better Auth session cookie must stay HttpOnly, because once JavaScript can
 * read it, a single XSS becomes session theft.
 *
 * It is not exported on purpose. If feature code grabbed this instance directly, server rendering
 * would use a client without cookies, and a logged-in user would receive the logged-out gallery.
 * Only `getRowCatClient()` is exposed.
 */
const browserClient = createRowCatClient({ baseUrl: API_BASE_URL });

/**
 * The API client for the current runtime.
 *
 * In the browser it returns the shared instance. On the server it builds a new client that carries
 * only the Cookie of the current request. Node's `fetch` has no cookie jar, so `credentials:
 * 'include'` alone would never carry the incoming session to Hono. If the viewer cannot be
 * resolved, the server renders the gallery as a stranger, and that result would be cached in SSR
 * and persist past hydration.
 *
 * The instance is created per request. A module-level cookie variable would let two concurrent
 * requests overwrite the same slot, so one user's query could leave with another user's session.
 * `getRequestHeader` reads the current request's header from AsyncLocalStorage, which makes that
 * mix-up structurally impossible.
 *
 * Only the Cookie header is forwarded. Passing the whole incoming header would turn the web server
 * into a reverse proxy, and headers such as Host and Content-Length would reach another origin and
 * cause silent misbehavior.
 *
 * `createIsomorphicFn` is used for the bundle boundary. In the client build the `.server` branch
 * and the `@tanstack/react-start/server` import are removed entirely, so server-only APIs never
 * reach the browser. Loaders run on the server for the first entry and in the browser for later
 * navigations; this one function hands each side a client for its environment.
 */
export const getRowCatClient = createIsomorphicFn()
	.client(() => browserClient)
	.server(() => {
		if (ssrBaseUrl === undefined) {
			const internal = process.env.API_INTERNAL_ORIGIN?.trim();
			ssrBaseUrl = internal ? apiBaseUrl(internal) : API_BASE_URL;
		}
		const cookie = getRequestHeader("cookie");
		return createRowCatClient({
			baseUrl: ssrBaseUrl,
			/**
			 * The request may travel over the internal network, but the address must be the public origin.
			 *
			 * The address built during server rendering is embedded in the HTML sent to the browser. If an
			 * internal host ends up there, the result is a broken image rather than an error, so the failure
			 * is silent (see `publicBaseUrl` in @rowcat/sdk).
			 */
			publicBaseUrl: API_BASE_URL,
			// Logged-out requests have no Cookie header at all. Do not create an empty one and send it.
			headers: cookie ? { cookie } : undefined,
		});
	});
