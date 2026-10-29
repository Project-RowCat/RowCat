import type { RuntimeConversationRecord } from "@rowcat/runtime-persistence";
import { useLiveQuery } from "dexie-react-hooks";
import { useRuntimeConversationScope } from "./conversation-scope.ts";

/**
 * Subscribes to library rows, in the same place and under the same rules as useLocalRooms. Not
 * TanStack Query: the value is this device's original, not a server cache. When sync applies
 * another device's rows, liveQuery picks up the change directly, so no code has to notify the list.
 */
export interface LocalRuntimeConversationsState {
	items: RuntimeConversationRecord[];
	loading: boolean;
}

export function useLocalRuntimeConversations(): LocalRuntimeConversationsState {
	const { store, status } = useRuntimeConversationScope();
	const items = useLiveQuery(
		() => (store ? store.list() : Promise.resolve(undefined)),
		[store],
	);
	return {
		items: items ?? [],
		loading: status !== "ready" || items === undefined,
	};
}
