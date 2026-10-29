import { useCallback, useState } from "react";
import { useRuntimeConversationScope } from "../../lib/local-data/scope.tsx";
import { RUNTIME_CONVERSATION_REMOVE_FAILURE } from "./runtime-conversation-copy.ts";

/**
 * The only operation that removes a runtime row from the library; the list and the drawer share
 * this hook. It calls the store's `remove` and nothing else: playthrough and long-term progress are
 * untouched (their port is not even held, see `useRuntimeConversationScope`), and there is no
 * confirmation since it is reversible and loses nothing. Failure stays as one line because the menu
 * item vanishes on press and leaves no interaction surface. It bypasses `useRoomManagement`, whose
 * vocabulary is the room's.
 */
export function useRuntimeConversationRemoval(
	options: { onRemoved?: (storyId: string) => void } = {},
): {
	remove: (storyId: string) => void;
	failure: string | null;
	dismissFailure: () => void;
} {
	const { store, ownsStore } = useRuntimeConversationScope();
	const [failure, setFailure] = useState<string | null>(null);
	const { onRemoved } = options;
	const remove = useCallback(
		(storyId: string) => {
			if (store === null) return;
			void (async () => {
				try {
					if (!ownsStore(store)) return;
					await store.remove({ storyId, now: new Date().toISOString() });
					onRemoved?.(storyId);
				} catch {
					setFailure(RUNTIME_CONVERSATION_REMOVE_FAILURE);
				}
			})();
		},
		[store, ownsStore, onRemoved],
	);
	return { remove, failure, dismissFailure: () => setFailure(null) };
}
