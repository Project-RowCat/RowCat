import type { AuthoringStore, DraftRuntimeFile } from "@rowcat/authoring";
import { useCallback, useMemo } from "react";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { runtimeActionFailure } from "./runtime-copy.ts";

/**
 * Structural changes to the runtime: turning it on and off, and creating, renaming, and deleting
 * files.
 *
 * This sits on the same axis as `useDraftActions` in the draft editor, and for the same reason it
 * is separate. Typing in the code body goes through the autosave queue (`patchRuntimeFile`).
 * Creating a file is one deliberate action, so it must become a record immediately. If it were
 * debounced, a user who reloaded right after creating a file would lose it.
 *
 * Path validation is not here. That rule is pure (`planRuntimeFileCreate`), and callers run it
 * first. Repeating it here would create two copies, and this hook has no place to explain why a
 * value is invalid, because failures collapse into a toast line.
 */

export interface RuntimeActions {
	/**
	 * Turns the runtime back on or off. The first-time enable path is not here. It only makes sense
	 * after a template is picked, and its failures must stay in the gallery rather than appear as a
	 * toast, so it has its own hook (`features/runtime-templates/use-create-runtime-project.ts`).
	 */
	setEnabled: (enabled: boolean) => Promise<void>;
	/**
	 * Creates one file and returns its record so the caller can open the tab immediately. Returning
	 * `void` would force the screen to wait for the list to refresh and then look the file up by path.
	 * In that gap, another device could create the same path and the screen would open someone else's
	 * file.
	 */
	createFile: (
		path: string,
		content?: string,
	) => Promise<DraftRuntimeFile | null>;
	/**
	 * Renames the file and returns whether it succeeded, so the caller can decide whether to close the
	 * inline input. With `void`, a failed rename would still close the input and the user would lose
	 * the name they typed. The toast says what failed but does not return the value.
	 */
	rename: (fileId: string, path: string) => Promise<boolean>;
	remove: (fileId: string) => Promise<boolean>;
}

export function useRuntimeActions(draftId: string): RuntimeActions {
	const { store } = useAuthoringScope();

	/**
	 * Failures are shown as toasts because the controls that trigger these actions are explorer icons
	 * or menu items, with no room next to them for a sentence. If failure were silent, nothing would
	 * appear to happen and the user could not tell whether the file was created. This is the same
	 * decision as `useDraftActions`.
	 */
	const run = useCallback(
		async <T>(
			action: (store: AuthoringStore) => Promise<T>,
		): Promise<T | null> => {
			if (!store) return null;
			try {
				return await action(store);
			} catch (error) {
				console.error("[runtime] a runtime action failed", error);
				showErrorToast(runtimeActionFailure());
				return null;
			}
		},
		[store],
	);

	return useMemo(
		() => ({
			setEnabled: async (enabled: boolean) => {
				await run((target) => target.setRuntimeEnabled(draftId, enabled));
			},
			createFile: async (path: string, content?: string) =>
				run((target) => target.createRuntimeFile(draftId, { path, content })),
			rename: async (fileId: string, path: string) =>
				(await run(async (target) => {
					await target.updateRuntimeFile(fileId, { path });
					return true;
				})) ?? false,
			remove: async (fileId: string) =>
				(await run(async (target) => {
					await target.deleteRuntimeFile(fileId);
					return true;
				})) ?? false,
		}),
		[draftId, run],
	);
}
