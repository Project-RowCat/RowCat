import type { GenerationProvider } from "@rowcat/chat";
import { useMemo } from "react";
import type { ProviderConnectionSummary } from "../local-provider/record.ts";
import type { ProviderConnectionStore } from "../local-provider/store.ts";
import { useLocalLiveOn } from "./live.ts";
import { useProviderScope } from "./scope.tsx";

/**
 * Subscribes to the **provider connections** of this account and device. This is the single place
 * that reads them.
 *
 * Same shape and rationale as `use-personas.ts` and `use-rooms.ts`: with two call sites, one would
 * apply the scope check and the other would forget the subscription, and the forgetful one goes
 * stale silently. Here the symptom is especially bad. **A target the model picker drew as available
 * is actually blocked, or a provider just connected stays greyed out.**
 *
 * ## The reason for not using TanStack Query is stronger than for generation preferences
 *
 * For preferences, the concern was a design problem: two sources of truth. Here the bigger fact is
 * that **the query cache is serialized**. It is visible to development tools as-is, and some
 * diagnostic paths include a cache snapshot. Even if only summaries are cached, values from the
 * credential domain should not sit in that layer.
 *
 * ## The signals are split
 *
 * The subscription runs on `stores.providerConnections` (neither `mutations` nor `preferences`).
 * The first is the axis that wakes automatic sync, so saving one connection would trigger a sync
 * with nothing to upload. The second is "what this device wants", and putting connections there
 * would redraw the whole generation settings screen whenever a key is connected.
 *
 * ## Generation does not use this hook
 *
 * Generation reads directly from the store at the moment a request starts (`loadConnectedProviders`
 * in `generation-turn.ts`). Routing through render state would leave a window where a connection
 * that was just removed has not yet arrived.
 */

export interface LocalProviderConnections {
	/** Connections of this device and member. Empty until they arrive, while `loading` is true. */
	connections: ProviderConnectionSummary[];
	/**
	 * The shape the availability check takes; `resolveGenerationExecution` and `buildModelOptions` use
	 * it.
	 *
	 * This keeps screens from re-writing `connections.some(c => c.provider === target.provider)`. If
	 * that began to be written out, the check would exist separately in the model picker, the room
	 * settings, summaries, and the story test, and whichever site missed one would **claim a target is
	 * usable without a connection**.
	 */
	providers: GenerationProvider[];
	/**
	 * The first result has not arrived yet. **This is different from "no connection".**
	 *
	 * Without this distinction a screen would draw `Not connected` before the Keychain is read, then switch
	 * to `Linked` once the value arrives. The user would see their connection disappear and come back.
	 */
	loading: boolean;
	/**
	 * The owner of this list is the store **instance**, not the member id.
	 *
	 * The step that re-checks ownership before an irreversible write (connect or disconnect) reads
	 * this value. Comparing member ids would make `Alice → sign out → Alice` the same value, and a
	 * save started in a session that had already ended would become the Keychain entry of the new
	 * session.
	 */
	store: ProviderConnectionStore | null;
	/** Whether this store is **still** the store of the active scope. */
	ownsStore: (store: ProviderConnectionStore) => boolean;
	/** Reads again without a signal: the way out of a failure. */
	reload: () => void;
	/** Whether the last read failed. The screen draws the held value as-is and only adds a retry. */
	failed: boolean;
}

export function useProviderConnections(): LocalProviderConnections {
	const { store, signal, loading: opening, ownsStore } = useProviderScope();

	/** Memoizes the read function. A new function per render would make the subscription re-read on every render. */
	const load = useMemo(() => (store ? () => store.list() : null), [store]);
	const live = useLocalLiveOn(signal, load, EMPTY);

	return useMemo(
		() => ({
			connections: live.value,
			providers: live.value.map((connection) => connection.provider),
			loading: opening || live.status === "loading",
			store,
			ownsStore,
			reload: live.reload,
			failed: live.status === "error",
		}),
		[live, opening, store, ownsStore],
	);
}

/** A stable empty array: a new array per render would make consumers redraw every time. */
const EMPTY: ProviderConnectionSummary[] = [];
