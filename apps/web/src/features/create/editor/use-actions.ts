import type { AuthoringStore } from "@rowcat/authoring";
import { useCallback, useMemo } from "react";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { draftStructureFailureMessage } from "./failure.ts";

/**
 * Structural changes to the editor: adding, removing, and reordering children, and setting the
 * default opening.
 *
 * They are kept apart from text input (autosave) because their nature differs. Typing happens
 * several times a second and must be batched, but `Add lore` is a single explicit action and must
 * become a record immediately. If it were debounced, a user who clicked and then refreshed would
 * lose what they just created.
 *
 * That a reorder is one transaction is guaranteed by the store (`local-authoring/store.ts`). This
 * hook only states the order wanted.
 *
 * If the store does not exist yet, nothing happens. The editor renders only after its scope opens,
 * so this rarely matters, but a path remains where the session ends while the screen is still open.
 * Silently returning is better than throwing, since the user is already being sent to the sign-in
 * screen.
 */
export interface DraftActions {
	addLore: () => Promise<void>;
	removeLore: (id: string) => Promise<void>;
	moveLore: (orderedIds: string[]) => Promise<void>;

	addStartScene: () => Promise<void>;
	removeStartScene: (id: string) => Promise<void>;
	moveStartScene: (orderedIds: string[]) => Promise<void>;
	setDefaultStartScene: (sceneId: string | null) => Promise<void>;

	/**
	 * Adds one scene image to the list. The asset is already uploaded.
	 *
	 * The upload is not done here because failure differs in nature. The operations in this hook are
	 * local storage writes, where failure only means 'try again'. Uploads need different messages for
	 * format, size, or connection (`scene-image-file.ts`). If this hook owned those messages, they
	 * would pass through `run`, which in the past silently swallowed errors. Today `run` shows one
	 * generic sentence for every operation, which cannot replace the format and size guidance.
	 */
	addSceneImage: (assetId: string) => Promise<void>;
	removeSceneImage: (id: string) => Promise<void>;
}

export function useDraftActions(draftId: string): DraftActions {
	const { store } = useAuthoringScope();

	const run = useCallback(
		async (action: (store: AuthoringStore) => Promise<unknown>) => {
			if (!store) return;
			try {
				await action(store);
			} catch (error) {
				/**
				 * Failure is shown as a toast because there is no place for a message. The controls that
				 * trigger these operations are icons on a card (up, down, delete) or small buttons in a section
				 * header, with no room beside them for text. If the failure were silent, the screen would show
				 * that nothing happened, and the user would keep editing believing a lore entry was added.
				 *
				 * Inline slots are not created per operation: there would be eight of them, and missing one
				 * would go unnoticed.
				 *
				 * Navigation does not happen on failure, so the user can press again on the same spot. That is
				 * the only job this message has.
				 */
				console.error("[create] couldn't update the draft", error);
				showErrorToast(draftStructureFailureMessage());
			}
		},
		[store],
	);

	return useMemo(
		() => ({
			addLore: () => run((s) => s.createLore(draftId)),
			removeLore: (id) => run((s) => s.deleteLore(id)),
			moveLore: (orderedIds) => run((s) => s.reorderLore(draftId, orderedIds)),

			addStartScene: () => run((s) => s.createStartScene(draftId)),
			removeStartScene: (id) => run((s) => s.deleteStartScene(id)),
			moveStartScene: (orderedIds) =>
				run((s) => s.reorderStartScenes(draftId, orderedIds)),
			setDefaultStartScene: (sceneId) =>
				run((s) => s.setDefaultStartScene(draftId, sceneId)),

			addSceneImage: (assetId) =>
				run((s) => s.createSceneImage(draftId, { assetId })),
			removeSceneImage: (id) => run((s) => s.deleteSceneImage(id)),
		}),
		[draftId, run],
	);
}

/**
 * Computes the new order after moving one item one step in a list. It is a pure function because
 * both lists (lore and scenes) share the rule. A move past either end returns the original order
 * unchanged, so callers need not re-check the bounds, and a disabled button reached by keyboard
 * does nothing.
 */
export function movedOrder(
	ids: string[],
	id: string,
	direction: -1 | 1,
): string[] {
	const from = ids.indexOf(id);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= ids.length) return ids;
	const next = [...ids];
	const [moved] = next.splice(from, 1);
	// The spliced value is guaranteed to exist, since the bounds check above passed.
	if (moved !== undefined) next.splice(to, 0, moved);
	return next;
}
