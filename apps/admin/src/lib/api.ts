import {
	apiBaseUrl,
	createRowCatClient,
	DEVELOPMENT_API_ORIGIN,
	type RowCatClient,
} from "@rowcat/sdk";

/**
 * Only the origin is chosen here; `@rowcat/sdk` attaches the `/v2` prefix from `@rowcat/contracts`,
 * the same rule as `apps/web/src/lib/api.ts`.
 *
 * - The value is runtime configuration, so one image serves any deployment: the container writes
 *   `VITE_API_ORIGIN` into `index.html` as `<meta name="rowcat-api-origin">` when it starts
 *   (`apps/admin/docker/rowcat-runtime-config.sh`, which fills the CSP from the same value). The
 *   build-time value is the fallback (`vite dev`).
 * - The default is the local API: a hand-run build silently touching production is the worse
 *   failure, especially here where buttons stop conversations and lock the app.
 * - No SSR branch: this is a pure SPA, so one client per tab is enough and the browser owns
 *   cookies.
 * - No `apiUrl(path)` helper: it would let screens assemble endpoints outside the contract.
 */
// `typeof document`: tests import this module in Node, where there is no document to read.
const configuredOrigin =
	(typeof document === "undefined"
		? undefined
		: document
				.querySelector<HTMLMetaElement>('meta[name="rowcat-api-origin"]')
				?.content.trim()) ||
	import.meta.env.VITE_API_ORIGIN?.trim() ||
	undefined;

/**
 * Exported because `lib/auth.ts` needs it too. Re-reading the env var there would split the origin
 * decision, and fixing only one side would send sign-in alone to a different server.
 */
export const API_BASE_URL = apiBaseUrl(
	configuredOrigin ?? DEVELOPMENT_API_ORIGIN,
);

const client = createRowCatClient({ baseUrl: API_BASE_URL });

/**
 * The only door to the API. A function rather than the instance (same as the web) so call sites
 * survive later environment differences. Feature code writing `fetch(\`${API_BASE_URL}/...\`)`
 * grows paths outside the contract.
 */
export const getRowCatClient = (): RowCatClient => client;
