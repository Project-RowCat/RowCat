import type {
	DraftRuntimeAsset,
	DraftRuntimeAssetKind,
} from "@rowcat/authoring";
import {
	formatRuntimeAudioDuration,
	runtimeAudioFormatLabel,
} from "./audio-file.ts";
import { runtimeImageFormatLabel } from "./file.ts";

/**
 * Holds the image list the editor knows about: one list per model. This file is that pairing.
 * - Monaco's completion provider is registered per language, not per editor, so it is global. A
 *   provider that captured one draft's list would leak that draft's names into another draft
 *   without any error, and registering on every render would duplicate items.
 * - The key is the model object's identity, not its path. Two drafts both have the path
 *   `src/main.tsx`, so a Map keyed by path would make them share a slot. A WeakMap keyed by model
 *   makes that mistake unrepresentable and drops the entry when the model is discarded.
 * - The handle is a mutable box. When the list changes, the value inside the box changes; the
 *   provider is registered once and binding is not repeated.
 */

/**
 * Only the fields the editor intelligence actually uses. The raw authoring record is not passed
 * through.
 *
 * `dirty`, `serverVersion`, `rev`, and `deletedAt` are sync vocabulary. If the provider code could
 * see them, it might eventually decide something with them, duplicating the storage layer's rules
 * inside the editor.
 */
export interface RuntimeAssetEditorEntry {
	/** The logical name the creator writes in `asset()`. The screen always uses this name alone. */
	path: string;
	/**
	 * Image or sound. This value decides what the hover draws.
	 *
	 * It is not derived from `mime` each time, because that classification already lives on the
	 * authoring record. Computing it again here would give the same question two answers, and one
	 * would go stale.
	 */
	kind: DraftRuntimeAssetKind;
	/** Media identity. It is the material for the hover's image address, not a name. */
	mediaId: string;
	mime: string;
	/** Image dimensions. `null` for sound. */
	width: number | null;
	height: number | null;
	/** Sound duration in milliseconds. `null` for images. */
	durationMs: number | null;
}

export interface RuntimeAssetEditorCatalog {
	/** Sorted by name. The sort happens once here, and the provider uses the array as-is. */
	entries: readonly RuntimeAssetEditorEntry[];
	byPath: ReadonlyMap<string, RuntimeAssetEditorEntry>;
	/**
	 * Maps media identity to an address on the RowCat origin. The rule belongs to the SDK and is not
	 * assembled here.
	 */
	mediaUrl: (mediaId: string) => string;
}

/** A project with nothing bound. This is the normal state during authoring. */
const EMPTY_CATALOG: RuntimeAssetEditorCatalog = {
	entries: [],
	byPath: new Map(),
	mediaUrl: () => "",
};

/**
 * Reduces authoring records to the editor's table. The order is by name, and that order is part of
 * the contract.
 *
 * It is not sorted by upload order, sync order, or media identity. The name space looks like a path
 * and creators read it that way; if the list moved with storage details, the same project would
 * appear in a different order on each device. The comparison is not `localeCompare`, because a
 * locale that changes ordering would produce exactly the same symptom.
 *
 * When the same name appears twice, the first one wins. Authoring rules already reject duplicates
 * (`planRuntimeAssetBinding`), but a record from another device may not have passed that check, and
 * a repeated row would make it impossible to tell which item was chosen.
 */
export function prepareRuntimeAssetCatalog(
	assets: readonly RuntimeAssetEditorEntry[],
	mediaUrl: (mediaId: string) => string,
): RuntimeAssetEditorCatalog {
	const byPath = new Map<string, RuntimeAssetEditorEntry>();
	for (const asset of assets)
		if (!byPath.has(asset.path)) byPath.set(asset.path, asset);
	const entries = [...byPath.values()].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
	return { entries, byPath, mediaUrl };
}

/** Converts one authoring record into an editor entry. Pins down here which fields carry over. */
export const runtimeAssetEditorEntry = (
	asset: DraftRuntimeAsset,
): RuntimeAssetEditorEntry => ({
	path: asset.path,
	kind: asset.kind,
	mediaId: asset.assetId,
	mime: asset.mime,
	width: asset.width,
	height: asset.height,
	durationMs: asset.durationMs,
});

/**
 * `640 × 640 · WebP` or `MP3 · 01:42`. Autocomplete detail and hover use the same sentence.
 *
 * The leading part differs by media type; that is the whole job of this function. Sound cannot
 * carry dimensions and images cannot carry duration. Writing a missing axis as 0 would make the
 * line false.
 */
export function runtimeAssetDetail(entry: RuntimeAssetEditorEntry): string {
	if (entry.kind === "audio") {
		const format =
			entry.mime.length > 0 ? runtimeAudioFormatLabel(entry.mime) : null;
		const length =
			entry.durationMs !== null && Number.isFinite(entry.durationMs)
				? formatRuntimeAudioDuration(entry.durationMs)
				: null;
		return [format, length].filter((part) => part !== null).join(" · ");
	}
	const format =
		entry.mime.length > 0 ? runtimeImageFormatLabel(entry.mime) : null;
	const size =
		entry.width !== null &&
		entry.height !== null &&
		Number.isFinite(entry.width) &&
		Number.isFinite(entry.height) &&
		entry.width > 0 &&
		entry.height > 0
			? `${entry.width} × ${entry.height}`
			: null;
	return [size, format].filter((part) => part !== null).join(" · ");
}

/**
 * The box one editor holds.
 *
 * The key is typed `object` so the rule can be verified as a value without Monaco; it must not be
 * required to be an `ITextModel`. The only question this table answers is which draft this object
 * currently belongs to.
 */
export interface RuntimeAssetCatalogHandle {
	current: RuntimeAssetEditorCatalog;
}

const catalogs = new WeakMap<object, RuntimeAssetCatalogHandle>();

export const createRuntimeAssetCatalogHandle =
	(): RuntimeAssetCatalogHandle => ({ current: EMPTY_CATALOG });

/** Binds a model to this editor's box. The box is bound, not the list. */
export function bindRuntimeAssetCatalog(
	model: object,
	handle: RuntimeAssetCatalogHandle,
): void {
	catalogs.set(model, handle);
}

/**
 * Removes the binding.
 *
 * The `WeakMap` drops the entry automatically once the model is collected, but collection timing
 * belongs to the GC and cannot be observed. Unbinding where the model is discarded leaves no window
 * in which a discarded model still answers with a list.
 */
export function unbindRuntimeAssetCatalog(model: object): void {
	catalogs.delete(model);
}

/**
 * This model's list. Returns `null` for an unbound model.
 *
 * `null` must stay distinct from an empty list. TypeScript models outside the runtime studio must
 * not receive image intelligence; collapsing them to an empty list would make that fact look the
 * same as a project with no images.
 */
export function runtimeAssetCatalogFor(
	model: object,
): RuntimeAssetEditorCatalog | null {
	return catalogs.get(model)?.current ?? null;
}
