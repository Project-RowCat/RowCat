import type { AuthoringStore } from "@rowcat/authoring";
import { useCallback, useMemo, useState } from "react";
import { useAuthoringScope } from "../../lib/local-data/scope.tsx";
import { DRAFT_STRUCTURE_FAILURE } from "./create-copy.ts";

/**
 * Structural edits in the editor: add, delete and reorder children, set the default opening. Kept
 * apart from text input (autosave) because `Add lore` is a deliberate press that must become a record
 * immediately; debouncing it would lose the new item for someone who leaves right after pressing.
 *
 * The store keeps reordering to one transaction (`reorderLore`, `reorderStartScenes`); this hook
 * passes only the desired order. Writing `positionIndex` one at a time from the screen could leave
 * two items in the same slot if the app dies between writes. The default-opening invariants also
 * belong to the store and are not restated here.
 *
 * Failures stay inside the section. This app has no toasts (a divergence from web), so a failure is
 * one line in the section where the action was pressed, and this hook exports the sentence. Silence
 * would look like nothing happened and the user would keep editing believing the item was added.
 * One sentence serves every action: the difference between "could not add lore" and "could not
 * delete the scene" tells someone who just pressed it nothing, and per-action copy would grow with
 * each new action until one is missed.
 */

export interface DraftActions {
	addLore: () => Promise<void>;
	removeLore: (id: string) => Promise<void>;
	moveLore: (orderedIds: string[]) => Promise<void>;

	addStartScene: () => Promise<void>;
	removeStartScene: (id: string) => Promise<void>;
	moveStartScene: (orderedIds: string[]) => Promise<void>;
	setDefaultStartScene: (sceneId: string) => Promise<void>;

	/**
	 * Adds one scene image to the list; the asset is already uploaded. Uploading is not done here
	 * because these operations are local store writes where "press again" is the only advice, while an
	 * upload needs different guidance per format, size and connection (`scene-image-file.ts`).
	 */
	addSceneImage: (assetId: string) => Promise<boolean>;
	removeSceneImage: (id: string) => Promise<void>;

	/** Last failure; the section draws this sentence itself. */
	failure: string | null;
	dismissFailure: () => void;
}

export function useDraftActions(draftId: string): DraftActions {
	const { store } = useAuthoringScope();
	const [failure, setFailure] = useState<string | null>(null);
	const dismissFailure = useCallback(() => setFailure(null), []);

	// With no store yet, do nothing. The editor draws only after the scope opens, so this is rare, but
	// the session can drop while the screen is up; passing quietly beats throwing then.
	const run = useCallback(
		async (action: (store: AuthoringStore) => Promise<unknown>) => {
			if (!store) return false;
			try {
				await action(store);
				setFailure(null);
				return true;
			} catch {
				setFailure(DRAFT_STRUCTURE_FAILURE);
				return false;
			}
		},
		[store],
	);

	return useMemo(
		() => ({
			addLore: async () => {
				await run((s) => s.createLore(draftId));
			},
			removeLore: async (id) => {
				await run((s) => s.deleteLore(id));
			},
			moveLore: async (orderedIds) => {
				await run((s) => s.reorderLore(draftId, orderedIds));
			},

			addStartScene: async () => {
				await run((s) => s.createStartScene(draftId));
			},
			removeStartScene: async (id) => {
				await run((s) => s.deleteStartScene(id));
			},
			moveStartScene: async (orderedIds) => {
				await run((s) => s.reorderStartScenes(draftId, orderedIds));
			},
			setDefaultStartScene: async (sceneId) => {
				await run((s) => s.setDefaultStartScene(draftId, sceneId));
			},

			addSceneImage: (assetId) =>
				run((s) => s.createSceneImage(draftId, { assetId })),
			removeSceneImage: async (id) => {
				await run((s) => s.deleteSceneImage(id));
			},

			failure,
			dismissFailure,
		}),
		[draftId, run, failure, dismissFailure],
	);
}

/**
 * New order after moving one item a step. Pure because lore and scenes share the rule. A move past
 * either end returns the original order, so callers need not re-check bounds and a press while the
 * button is disabled does nothing.
 */
export function movedOrder(
	ids: readonly string[],
	id: string,
	direction: -1 | 1,
): string[] {
	const from = ids.indexOf(id);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= ids.length) return [...ids];
	const next = [...ids];
	const [moved] = next.splice(from, 1);
	if (moved !== undefined) next.splice(to, 0, moved);
	return next;
}
