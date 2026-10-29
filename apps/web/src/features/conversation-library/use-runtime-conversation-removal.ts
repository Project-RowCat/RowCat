import { useCallback } from "react";
import { useRuntimeConversationScope } from "#/lib/local-runtime-save/conversation-scope.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { runtimeConversationRemoveFailure } from "./runtime-conversation-copy.ts";

/**
 * The only action that removes a runtime row from the library. The sidebar and /chats both use this
 * hook.
 *
 * It calls the store's remove and nothing else. It does not touch playthrough or permanent
 * progress, and it does not even hold the ports for them (see conversation-scope.ts). There is no
 * confirmation dialog because the action is reversible and loses nothing. Failure shows a toast,
 * because a menu item fires on press and leaves no persistent surface for an error
 * (docs/design/FAILURE-FEEDBACK.md).
 *
 * It does not go through useRoomManagement. That hook's vocabulary (rename, settings, delete)
 * belongs to rooms, and attaching those actions to a runtime row would create a button that does
 * nothing.
 */
export function useRuntimeConversationRemoval(
	options: {
		/**
		 * Runs after removal. This is where the screen currently playing the removed work navigates away.
		 */
		onRemoved?: (storyId: string) => void;
	} = {},
): { remove: (storyId: string) => void } {
	const { store, ownsStore } = useRuntimeConversationScope();
	const { onRemoved } = options;
	const remove = useCallback(
		(storyId: string) => {
			if (store === null) return;
			void (async () => {
				try {
					/**
					 * Removal is reversible, but it must still not write into another owner's scope. Hence the
					 * ownership check before remove.
					 */
					if (!ownsStore(store)) return;
					await store.remove({ storyId, now: new Date().toISOString() });
					onRemoved?.(storyId);
				} catch {
					showErrorToast(runtimeConversationRemoveFailure());
				}
			})();
		},
		[store, ownsStore, onRemoved],
	);
	return { remove };
}
