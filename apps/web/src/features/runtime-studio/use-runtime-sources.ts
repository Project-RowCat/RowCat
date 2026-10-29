import type { DraftRuntimeAsset, DraftRuntimeFile } from "@rowcat/authoring";
import { useCallback, useMemo, useState } from "react";
import {
	currentRuntimeProjectSnapshot,
	emptyRuntimeEditedSources,
	type RuntimeAssetBinding,
	type RuntimeEditedSources,
	type RuntimeProjectSnapshot,
	reconcileEditedSources,
	startEditingSource,
} from "./compile/source-snapshot.ts";

/**
 * Attaches the editor's source authority to screen state. The rules live in a pure module.
 *
 * The editor component (`runtime-code-editor.tsx`) keeps its own model table with the same
 * judgment, but that table belongs to Monaco and stays inside it. It does not exist while the
 * editor is unmounted, such as when all tabs are closed or the lazy chunk has not arrived yet. This
 * hook holds the same facts as plain values, updated through the `onChange` the editor calls.
 * Preview and analysis read snapshots derived from these values without knowing about Monaco.
 *
 * This hook writes nothing to the repository. `onChange` only updates the table. The caller queues
 * autosave from the same callback, separately. Combining them here would make the snapshot wait on
 * save success. When a record catches up, its entry drops out of the table. Later remote changes
 * are carried by the record itself.
 *
 * The table is adjusted to a new list during render, not in an effect (the same pattern as
 * `useEditedValue`). In an effect, one frame would show a snapshot pointing at a deleted file, and
 * a `Run` pressed in that frame would send a nonexistent file to the worker.
 */

export interface RuntimeSourcesInput {
	files: readonly DraftRuntimeFile[];
	entry: string;
	/**
	 * Images grouped by logical name, passed through exactly as stored. Unlike files, the editor does
	 * not run ahead of them, so there is nothing to reconcile. This hook's only job for assets is to
	 * include them in the snapshot. When their value changes, the signature changes and a running
	 * preview is marked stale (`runtimeProjectSignature`).
	 */
	assets: readonly DraftRuntimeAsset[];
}

export interface RuntimeSources {
	/**
	 * The current project source. It is a new object only when the inputs change. Once built, it is
	 * never mutated.
	 */
	snapshot: RuntimeProjectSnapshot;
	/** Called when the editor changes a value. Saving does not happen here. */
	onChange: (fileId: string, content: string) => void;
}

export function useRuntimeSources({
	files,
	entry,
	assets,
}: RuntimeSourcesInput): RuntimeSources {
	const [edited, setEdited] = useState<RuntimeEditedSources>(
		emptyRuntimeEditedSources,
	);

	const reconciled = reconcileEditedSources(edited, files);
	if (reconciled !== edited) setEdited(reconciled);

	const onChange = useCallback((fileId: string, content: string) => {
		setEdited((previous) => startEditingSource(previous, fileId, content));
	}, []);

	/**
	 * The snapshot carries only three things per asset. Dimensions, format, and authoring-axis
	 * metadata belong to the asset list screen. Including them would make a metadata change from sync
	 * mark the preview stale. `kind` is the exception, because it is an interpretation axis rather
	 * than metadata. Without it, every name would be read as an image, and sounds would silently go
	 * quiet.
	 */
	const bindings = useMemo<readonly RuntimeAssetBinding[]>(
		() =>
			assets.map((asset) => ({
				path: asset.path,
				assetId: asset.assetId,
				kind: asset.kind,
			})),
		[assets],
	);

	const snapshot = useMemo(
		() =>
			currentRuntimeProjectSnapshot({
				files,
				entry,
				edited: reconciled,
				assets: bindings,
			}),
		[files, entry, reconciled, bindings],
	);

	return { snapshot, onChange };
}
