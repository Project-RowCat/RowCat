import type {
	RuntimeConversationRecord,
	RuntimeConversationStore,
} from "@rowcat/runtime-persistence";
import { useMemo } from "react";
import { type LocalLive, useLocalLive } from "./live.ts";
import { useRuntimeConversationScope } from "./scope.tsx";

/**
 * **Subscribes** to every runtime library row. Same place and same rules as `use-rooms.ts`.
 *
 * The subscription's signal is the write signal the assembly point attached (`stores.ts` wraps this
 * port with `mutations`). So when the playback screen writes a row, or the list removes one, the
 * drawer and `/chats` hear it directly, with neither polling nor "read again after writing".
 *
 * Only the unified library hook calls this. If each screen called it, one would apply the scope
 * check and another would forget the subscription, and the forgetful one would go stale silently.
 */
export interface LocalRuntimeConversations
	extends LocalLive<RuntimeConversationRecord[]> {
	store: RuntimeConversationStore | null;
}

export function useLocalRuntimeConversations(): LocalRuntimeConversations {
	const { store } = useRuntimeConversationScope();
	const load = useMemo(() => (store ? () => store.list() : null), [store]);
	const live = useLocalLive<RuntimeConversationRecord[]>(load, EMPTY);
	return useMemo(() => ({ ...live, store }), [live, store]);
}

const EMPTY: RuntimeConversationRecord[] = [];
