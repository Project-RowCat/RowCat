import type { GenerationProvider } from "@rowcat/chat";
import { useLiveQuery } from "dexie-react-hooks";
import type { ProviderConnectionSummary } from "./record.ts";
import { useProviderScope } from "./scope.ts";

/**
 * Hook that subscribes to provider connections. It is the window the settings screen reads. This is
 * a stronger reason not to use TanStack Query than for generation preferences. The query cache gets
 * serialized in places: devtools shows it, prefetching puts it into the SSR payload, and some error
 * reporters send a cache snapshot. Even a summary should not sit in that layer for credential
 * values. liveQuery is used so that connecting or disconnecting in another tab updates this
 * subscription automatically. No BroadcastChannel is needed, and secrets are never broadcast, since
 * that channel is heard by every document of the same origin. The generation runtime does not use
 * this hook. It reads the store directly at request start, because going through render state would
 * leave a window where a connection just dropped in another tab has not arrived.
 */

export interface ProviderConnectionState {
	/**
	 * The member's connections on this device. This is an empty array until the first value arrives,
	 * and loading is true until then.
	 */
	connections: ProviderConnectionSummary[];
	/**
	 * Still waiting for the first result. This differs from 'no connection'. Without this distinction,
	 * the settings screen would draw `Not connected` (not connected) before IndexedDB opens, then switch to
	 * `Linked` (connected) when the value arrives. The user would see their connection disappear and come
	 * back.
	 */
	loading: boolean;
}

export function useProviderConnections(): ProviderConnectionState {
	const { store, status } = useProviderScope();
	const value = useLiveQuery(
		() => (store ? store.list() : Promise.resolve(undefined)),
		[store],
	);
	return {
		connections: value ?? [],
		loading: status !== "ready" || value === undefined,
	};
}

/**
 * Currently connected providers, in the shape that availability resolution
 * (resolveGenerationExecution) takes. This keeps the screen from writing connections.some(c =>
 * c.provider === target.provider) itself. If it did, the check would be duplicated across the model
 * picker, room settings and warning text, and one place that missed a provider would say generation
 * works without a connection.
 */
export function useConnectedProviders(): {
	providers: GenerationProvider[];
	loading: boolean;
} {
	const { connections, loading } = useProviderConnections();
	return {
		providers: connections.map((connection) => connection.provider),
		loading,
	};
}
