import type { RowCatClient } from "@rowcat/sdk";
import { queryOptions } from "@tanstack/react-query";

/**
 * Public runtime config: `GET /v2/runtime-config`. The app reads it before login.
 *
 * The key is **outside** `["viewer"]` on purpose. The value is a fact about the deployment, not
 * anyone's state, so login and logout have no reason to clear it. Under the viewer prefix, the
 * login screen would ask for the same value again on every redraw.
 *
 * Not authorization. The value is material for avoiding dead links. Requesting a feature that was
 * turned off is rejected by the server anyway (see the `RuntimeConfigDto` header).
 *
 * Freshness equals the server's `Cache-Control` (30 seconds). Shorter would just re-read the same
 * response from the HTTP cache. Longer would keep buttons for operator-disabled features visible
 * for longer.
 */
export const RUNTIME_CONFIG_QUERY_KEY = ["runtime-config"] as const;

export function runtimeConfigQueryOptions(client: RowCatClient) {
	return queryOptions({
		queryKey: RUNTIME_CONFIG_QUERY_KEY,
		queryFn: ({ signal }) => client.ops.runtimeConfig({ signal }),
		staleTime: 30_000,
	});
}
