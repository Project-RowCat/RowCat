import { useCallback, useState } from "react";
import {
	clampRuntimeSize,
	defaultRuntimeLayout,
	type RuntimeLayout,
	type RuntimeLayoutKey,
	readRuntimeLayout,
	writeRuntimeLayout,
} from "./layout.ts";

/**
 * Screen side of the panel sizes: read once, written on every change. The initial value is read
 * with a lazy useState(fn), so the first render does the storage access rather than the module top
 * level. The screen sits behind ClientOnly, but the code does not rely on that. Writes are not
 * debounced. localStorage.setItem is synchronous and the value is small, and a debounce would lose
 * the last width of someone who closes the tab mid-drag. reset restores only sizes. Open tabs, the
 * active file, expanded folders and panel visibility are workspace state and not owned here.
 * Restoring the whole workspace would be irreversible, so the action is named `Reset panel sizes` (reset
 * panel sizes). Defaults are not copied into this file. They live in RUNTIME_LAYOUT_LIMITS, and a
 * copy would leave this action on old values after a default changes.
 */
export function useRuntimeLayout(): [
	RuntimeLayout,
	(patch: Partial<RuntimeLayout>) => void,
	() => void,
] {
	const [layout, setLayout] = useState<RuntimeLayout>(readRuntimeLayout);

	const update = useCallback((patch: Partial<RuntimeLayout>) => {
		setLayout((current) => {
			/**
			 * Incoming values are always clamped here, even though the handles already clamp. Saving happens
			 * in this function, so an out-of-range value would be persisted and reopen at that value,
			 * leaving the user stuck.
			 */
			const next: RuntimeLayout = { ...current };
			for (const [key, value] of Object.entries(patch))
				if (typeof value === "number")
					next[key as RuntimeLayoutKey] = clampRuntimeSize(
						key as RuntimeLayoutKey,
						value,
					);

			if (
				next.explorer === current.explorer &&
				next.preview === current.preview &&
				next.panel === current.panel
			)
				return current;

			writeRuntimeLayout(next);
			return next;
		});
	}, []);

	const reset = useCallback(() => {
		const next = defaultRuntimeLayout();
		writeRuntimeLayout(next);
		setLayout(next);
	}, []);

	return [layout, update, reset];
}
