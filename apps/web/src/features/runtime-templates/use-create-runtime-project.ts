import {
	instantiateRuntimeTemplate,
	type RuntimeTemplate,
} from "@rowcat/authoring";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";

/**
 * Creates a runtime project from the picked template and moves to the studio.
 *
 * The hook does not add a second save path. Its only job is calling `AuthoringStore.enableRuntime`.
 * A loop that creates files one by one (the shortest implementation) would allow half-committed
 * templates: the project is enabled but component files are missing, so it does not compile, and
 * the only fix is recreating files by hand. Atomicity belongs to the store's transaction (§27).
 *
 * Failure is not a toast. Unlike `useRuntimeActions`, where the control is an icon with no room for
 * a sentence, the gallery stays open here with the selected card (§26). Failure is returned as a
 * value and rendered by the screen.
 *
 * A second press in the same tick. `pending` is `setState` and lags within a tick, so a synchronous
 * lock prevents one double-click from starting two transactions (the work's test-start button
 * already uses the same shape). The store is idempotent, so a second call does not overwrite files,
 * but relying on that would let the screen pass through a state that is neither failure nor
 * success.
 */
export interface CreateRuntimeProjectState {
	pending: boolean;
	failed: boolean;
	create: (template: RuntimeTemplate) => Promise<void>;
	/**
	 * Clears the failure sentence before retrying. Leaving it would keep it on screen after a success.
	 */
	reset: () => void;
}

export function useCreateRuntimeProject(
	draftId: string,
): CreateRuntimeProjectState {
	const navigate = useNavigate();
	const { ensureStore } = useAuthoringScope();
	const creatingRef = useRef(false);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);

	const create = async (template: RuntimeTemplate): Promise<void> => {
		if (creatingRef.current) return;
		creatingRef.current = true;
		setPending(true);
		setFailed(false);
		try {
			const store = await ensureStore();
			/** The user is a guest, or the scope did not open. There is nothing that can be created. */
			if (store === null) {
				setFailed(true);
				return;
			}
			/**
			 * Registry values are copied here. The store receives only a path and a body, so the created
			 * record holds no reference to the template it came from. A later commit that edits these files
			 * therefore cannot touch someone else's project.
			 */
			const project = await store.enableRuntime(
				draftId,
				instantiateRuntimeTemplate(template),
			);
			if (project === null) {
				setFailed(true);
				return;
			}
			await navigate({ to: "/create/$draftId/runtime", params: { draftId } });
		} catch (error) {
			console.error(
				"[runtime] could not create the runtime from the template",
				error,
			);
			setFailed(true);
		} finally {
			creatingRef.current = false;
			setPending(false);
		}
	};

	return {
		pending,
		failed,
		create,
		reset: () => setFailed(false),
	};
}
