import type { DraftRuntimeFile } from "@rowcat/authoring";
import {
	type EditedValue,
	reconcileEditedValue,
	startEditingValue,
} from "#/features/create/editor/edited-value.ts";
import type { RuntimeCompileSignatureFile } from "./signature.ts";

/**
 * The current source of a runtime project: the single snapshot boundary the preview and analysis
 * read.
 *   editor model -> this snapshot -> preview worker and analysis pass (immediate)
 *   editor model -> autosave -> AuthoringStore -> liveQuery (500 ms later)
 * - Why not the store's records: the preview used to pass liveQuery's file list to the worker,
 *   which lags the editor by the autosave debounce. Changing `Count: 0` to `Count: 999` and
 *   pressing run at once ran the stale `0`. The screen later labeled the run `Changes pending` (has
 *   changes), even though the author had asked to run the code on screen.
 * - Why not flush autosave before running: a save failure would become a run failure, save
 *   latency would become run latency, and each run would become a write. The preview is derived
 *   execution, not a persistent action. The editor already owns unsaved values
 *   (`reconcileEditedValue`), and this module reuses that authority.
 * - Edited values are keyed by file id. Keying by path would orphan an edit on rename. The path
 *   always comes from the current record; the content is the edited value if one exists, otherwise
 *   the record's. Unopened and untouched files appear in the same list.
 * - Plain data only: `{ path, content }`. No Monaco model, sync fields (rev, dirty, updatedAt),
 *   or callbacks cross this boundary. The worker protocol must be serializable, and the signal must
 *   not move with store metadata.
 */

export type RuntimeSourceFile = RuntimeCompileSignatureFile;

/** A logical name and the media it points to. This is all the snapshot carries. */
export interface RuntimeAssetBinding {
	path: string;
	assetId: string;
	/**
	 * Image or audio. Unlike dimensions and format, this value is carried, because the resolver uses
	 * it to choose `<Image>` or `<Audio>` (`bindRuntimeAssetResolver`). Without it, every name would
	 * resolve as an image and audio would go silent with no error.
	 */
	kind: "image" | "audio";
}

export interface RuntimeProjectSnapshot {
	entry: string;
	files: readonly RuntimeSourceFile[];
	/**
	 * Assets the project names by logical name. Unlike files, the editor never leads these: assets
	 * change by operations (upload, rename, replace, remove) that go straight to the store. So there
	 * is no reconciliation step, and the value is always the record's. Dimensions and format are
	 * omitted. The preview only asks what a name points to and how to draw it.
	 */
	assets: readonly RuntimeAssetBinding[];
}

/**
 * File id to the value the editor holds. Whether the record has caught up is signaled by `pending`.
 */
export type RuntimeEditedSources = ReadonlyMap<string, EditedValue<string>>;

export type RuntimeSourceRecord = Pick<
	DraftRuntimeFile,
	"id" | "path" | "content"
>;

export const emptyRuntimeEditedSources = (): RuntimeEditedSources => new Map();

/**
 * The user edited a file: the screen leads, and the record is ignored until this value comes back.
 * It is the same transition as `startEditingValue` for a single editor input, here kept per file.
 */
export function startEditingSource(
	edited: RuntimeEditedSources,
	fileId: string,
	content: string,
): RuntimeEditedSources {
	const current = edited.get(fileId);
	if (current?.value === content && current.pending === content) return edited;
	const next = new Map(edited);
	next.set(fileId, startEditingValue(content));
	return next;
}

/**
 * Runs `reconcileEditedValue` for each file when the store's list changes. If nothing changed,
 * returns the same map object. Callers rely on identity to skip setState during render, and the
 * snapshot memo depends on it. Values for removed files are dropped. Keeping them would let an edit
 * reattach to a later record with the same id, and the map would grow forever.
 */
export function reconcileEditedSources(
	edited: RuntimeEditedSources,
	files: readonly RuntimeSourceRecord[],
): RuntimeEditedSources {
	let next: Map<string, EditedValue<string>> | null = null;
	const live = new Set<string>();

	for (const file of files) {
		live.add(file.id);
		const state = edited.get(file.id);
		if (state === undefined) continue;
		const reconciled = reconcileEditedValue(state, file.content);
		if (reconciled === state) continue;
		next ??= new Map(edited);
		/**
		 * A value the record has caught up with is removed from the map, since holding a second copy of
		 * the same value has no purpose. Later remote changes arrive through the record, and the snapshot
		 * falls back to it.
		 */
		if (reconciled.pending === null && reconciled.value === file.content)
			next.delete(file.id);
		else next.set(file.id, reconciled);
	}

	for (const fileId of edited.keys())
		if (!live.has(fileId)) {
			next ??= new Map(edited);
			next.delete(fileId);
		}

	return next ?? edited;
}

/**
 * The project's current source, which the preview and analysis read. Paths come from the record;
 * content comes from the edited value when one exists. The list keeps the record's order, and the
 * signal canonicalizes it (`runtimeCompileSignature`).
 */
export function currentRuntimeProjectSnapshot({
	files,
	entry,
	edited,
	assets,
}: {
	files: readonly RuntimeSourceRecord[];
	entry: string;
	edited: RuntimeEditedSources;
	assets: readonly RuntimeAssetBinding[];
}): RuntimeProjectSnapshot {
	return {
		entry,
		files: files.map((file) => ({
			path: file.path,
			content: edited.get(file.id)?.value ?? file.content,
		})),
		/**
		 * Passes the list through without sorting. The signal already canonicalizes order
		 * (`runtimeProjectSignature`), and the store already returns path order.
		 */
		assets,
	};
}
