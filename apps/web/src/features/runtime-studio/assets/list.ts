import type {
	DraftRuntimeAsset,
	DraftRuntimeAssetKind,
} from "@rowcat/authoring";

/**
 * Find in the asset list: one name field and one kind filter. A pure function.
 * - Scope is the names this draft has bound. There is no 'every image I uploaded' list, on the
 *   server or on this screen, and no folders, tags, or bulk selection. The name space already looks
 *   like a path (`characters/sena/smile`), so a name prefix does the job folders would.
 * - Matching is on the logical name only. Media identity, addresses, and file format are not
 *   matched. Creators write names in code, and a list that matched identities would start exposing
 *   that value on screen. Case is folded because the name syntax accepts only lowercase
 *   (`classifyRuntimeAssetValue`); someone typing uppercase who sees an empty list would conclude
 *   the name is missing. Surrounding whitespace is folded too.
 * - Order is not changed. Storage already returns name order. Re-ranking by match quality would
 *   make the same row jump with every keystroke, and the row the user was aiming for would be
 *   missed.
 */

export type RuntimeAssetKindFilter = "all" | DraftRuntimeAssetKind;

export const RUNTIME_ASSET_KIND_FILTERS: readonly RuntimeAssetKindFilter[] = [
	"all",
	"image",
	"audio",
];

export interface RuntimeAssetListQuery {
	text: string;
	kind: RuntimeAssetKindFilter;
}

export const EMPTY_RUNTIME_ASSET_QUERY: RuntimeAssetListQuery = {
	text: "",
	kind: "all",
};

const normalize = (text: string): string => text.trim().toLowerCase();

export function filterRuntimeAssets<
	T extends Pick<DraftRuntimeAsset, "path" | "kind">,
>(assets: readonly T[], query: RuntimeAssetListQuery): T[] {
	const needle = normalize(query.text);
	return assets.filter(
		(asset) =>
			(query.kind === "all" || asset.kind === query.kind) &&
			(needle.length === 0 || asset.path.toLowerCase().includes(needle)),
	);
}

/** Count per kind, shown beside each filter option. Counts ignore the name condition. */
export function countRuntimeAssetsByKind(
	assets: readonly Pick<DraftRuntimeAsset, "kind">[],
): Record<RuntimeAssetKindFilter, number> {
	let image = 0;
	let audio = 0;
	for (const asset of assets)
		if (asset.kind === "audio") audio += 1;
		else image += 1;
	return { all: assets.length, image, audio };
}

/**
 * Whether the current condition filters anything. This is the axis that separates an empty result
 * from 'no assets'.
 */
export const isRuntimeAssetQueryActive = (query: RuntimeAssetListQuery) =>
	query.kind !== "all" || normalize(query.text).length > 0;
