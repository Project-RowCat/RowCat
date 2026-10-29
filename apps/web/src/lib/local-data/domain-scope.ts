import { useCallback, useMemo } from "react";
import type { LocalDataDomain, LocalDataStores } from "./activation.ts";
import { type LocalDataScopeStatus, useLocalDataScope } from "./scope.tsx";

/**
 * Single-domain scope: the shape a screen actually sees.
 *
 * Feature code receives this instead of the whole LocalDataScope. A screen that holds the authoring
 * store has no reason to, and if it does, it will eventually use it. Then nothing in the code says
 * what that screen may touch.
 *
 * The adapter is deliberately thin. It picks one store out of the bundle and attaches the ownership
 * check to the domain. Ordering, isolation and lifetime rules stay in scope.tsx and activation.ts.
 * Copying them here would make each new domain re-solve the same races.
 */
export interface DomainScope<K extends LocalDataDomain> {
	status: LocalDataScopeStatus;
	/** Non-null only when status is "ready". */
	store: LocalDataStores[K] | null;
	viewerId: string | null;
	/**
	 * Waits until the scope opens, then returns this domain's store. Returns null on failure or for a
	 * guest.
	 */
	ensureStore: () => Promise<LocalDataStores[K] | null>;
	/**
	 * Asks whether this store still belongs to the active scope. Call it right before each
	 * irreversible step.
	 */
	ownsStore: (store: LocalDataStores[K]) => boolean;
}

export function useDomainScope<K extends LocalDataDomain>(
	domain: K,
): DomainScope<K> {
	const scope = useLocalDataScope();
	const { ensureStores, ownsStore: ownsAny } = scope;

	const ensureStore = useCallback(
		async () => (await ensureStores())?.[domain] ?? null,
		[ensureStores, domain],
	);

	/**
	 * The identity must stay fixed. The caller holds a click-time closure. Both dependencies do not
	 * change between renders (the scope guarantees this), so the result stays fixed too.
	 */
	const ownsStore = useCallback(
		(store: LocalDataStores[K]) => ownsAny(domain, store),
		[ownsAny, domain],
	);

	return useMemo(
		() => ({
			status: scope.status,
			store: scope.stores?.[domain] ?? null,
			viewerId: scope.viewerId,
			ensureStore,
			ownsStore,
		}),
		[
			scope.status,
			scope.stores,
			scope.viewerId,
			domain,
			ensureStore,
			ownsStore,
		],
	);
}
