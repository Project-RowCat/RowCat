import type { DraftConflictRecovery } from "@rowcat/authoring";
import { useLiveQuery } from "dexie-react-hooks";
import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";

/**
 * Subscribes to recovery copies, on the same axis as the draft subscription
 * (local-authoring/hooks.ts). Not TanStack Query: this value is not a cache of server state. It is
 * the original that sync just left on this device. In a query cache, a later pull that adds a copy
 * would leave the screen unchanged, so the user would not learn a draft was lost until the next
 * reload. liveQuery listens to IndexedDB changes directly.
 */

export type DraftRecoveryScope = DomainScope<"draftRecovery">;

export const useDraftRecoveryScope = (): DraftRecoveryScope =>
	useDomainScope("draftRecovery");

export interface RecoveryListState {
	items: DraftConflictRecovery[];
	/** True until the first result arrives. This is distinct from an empty list. */
	loading: boolean;
}

/**
 * Copies of this draft. A guest (`unavailable`) is not folded into `loading`. There is no database
 * to open, so that wait would never end, and a never-ending wait is worse than an error because the
 * screen would not say what to do. The draft subscription follows the same rule.
 */
export function useDraftRecoveries(draftId: string): RecoveryListState {
	const { store, status } = useDraftRecoveryScope();
	const items = useLiveQuery(
		() => (store ? store.listForDraft(draftId) : Promise.resolve(undefined)),
		[store, draftId],
	);
	return {
		items: items ?? [],
		loading: status === "ready" && items === undefined,
	};
}

/**
 * Every copy left on this account, for users who no longer remember which draft a copy came from.
 * The count and list screens use this same hook. A separate count query could use a different
 * predicate, and the screen would then say `2 items` while drawing only one row.
 */
export function useAllDraftRecoveries(): RecoveryListState {
	const { store, status } = useDraftRecoveryScope();
	const items = useLiveQuery(
		() => (store ? store.list() : Promise.resolve(undefined)),
		[store],
	);
	return {
		items: items ?? [],
		loading: status === "ready" && items === undefined,
	};
}
