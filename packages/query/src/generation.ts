import type { GenerationModel, RowCatClient } from "@rowcat/sdk";
import { queryOptions } from "@tanstack/react-query";

/**
 * Cache cell for the generation target catalog. It belongs in TanStack Query because it is server
 * state, a copy of a server-owned list. Local data (conversations, drafts, device preferences,
 * provider connections) is device-owned and never goes here. Provider connections must never reach
 * this layer, including their status, summaries, and especially credentials. Those live in
 * member-scoped IndexedDB, observed through liveQuery. The query cache is serialized, visible in
 * devtools, and prefetched into the SSR payload, so it would expose them.
 */
export const GENERATION_MODELS_QUERY_KEY = ["generation", "models"] as const;

/**
 * Selectable generation targets. staleTime is long because people do not change this list; the list
 * changes through deploys. It is not infinite: some users keep a tab open for days, and a model
 * removed in the meantime would stay selectable. A failed fetch does not affect stored preferences
 * or provider connections. The catalog is only a list of choices, not the source of truth for
 * values already chosen (see `docs/settings/ARCHITECTURE.md`).
 */
export function generationModelsQueryOptions(client: RowCatClient) {
	return queryOptions<GenerationModel[]>({
		queryKey: GENERATION_MODELS_QUERY_KEY,
		queryFn: ({ signal }) => client.chat.models({ signal }),
		staleTime: 10 * 60_000,
	});
}
