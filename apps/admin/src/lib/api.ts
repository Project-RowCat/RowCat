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
 * - The default is the local API: a hand-run build silently touching production is the worse
 *   failure, especially here where buttons stop conversations and lock the app. Deploy images set
 *   the real domain via the `VITE_API_ORIGIN` build arg.
 * - No SSR branch: this is a pure SPA, so one client per tab is enough and the browser owns
 *   cookies.
 * - No `apiUrl(path)` helper: it would let screens assemble endpoints outside the contract.
 */
const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim() || undefined;

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
