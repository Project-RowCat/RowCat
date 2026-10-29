/**
 * Whether an edit actually changed the compile input: a single effect signal. It is kept as a pure
 * module so its properties can be checked without rendering, and so that changing this calculation
 * never means changing a React hook as files grow.
 * - Not concatenation. An earlier version joined each file as `path content`, so different
 *   projects could produce the same string (path `a` with content `b c` equals path `a b` with
 *   content `c`). The symptom is silent: analysis does not rerun, and Problems shows the previous
 *   project's diagnostics until the next keystroke. JSON encoding carries the boundaries.
 * - Not a hash. The signal only answers whether analysis must rerun. Artifact identity is
 *   computed by the compiler's `canonicalSourceBytes`, which needs a cryptographic hash because its
 *   values are stored and compared. A hash here would bring an async browser API into the render
 *   path for a short string.
 * - Store metadata stays out. id, rev, dirty, updatedAt, and serverVersion are not inputs. If
 *   they were, a synced metadata change would rerun analysis, which produces identical output.
 */

export interface RuntimeCompileSignatureFile {
	path: string;
	content: string;
}

/**
 * Sorts by path, then by content. It does not use `localeCompare`: a locale-dependent order would
 * give one project different signals on different devices, which shows up only as analysis running
 * an extra time on one machine. Code-unit comparison is identical everywhere.
 */
const byPath = (
	left: RuntimeCompileSignatureFile,
	right: RuntimeCompileSignatureFile,
): number => {
	if (left.path !== right.path) return left.path < right.path ? -1 : 1;
	if (left.content !== right.content)
		return left.content < right.content ? -1 : 1;
	return 0;
};

/**
 * Signal for compile input. List order is not part of it. liveQuery can reorder the repository
 * (remote sync, edits in another tab), but analysis output does not depend on order. Counting order
 * would rerun analysis on every reordering that changed nothing.
 */
export function runtimeCompileSignature(
	files: readonly RuntimeCompileSignatureFile[],
): string {
	return JSON.stringify(
		[...files].sort(byPath).map((file) => [file.path, file.content] as const),
	);
}

export interface RuntimeAssetSignatureBinding {
	path: string;
	assetId: string;
	kind: "image" | "audio";
}

/**
 * Run-snapshot signal, covering source and managed assets together. It is separate from
 * `runtimeCompileSignature` on purpose. That function answers whether analysis must rerun, which
 * does not depend on assets because the compiler ignores logical names. This function answers
 * whether the running preview is stale, which assets do affect. Folding both into one value would
 * turn every image swap into a full recompile with an identical result. Assets are canonicalized
 * with the same rules: sorted by name, since the repository's list order is not a signal, and JSON
 * carries the boundaries.
 */
export function runtimeProjectSignature(snapshot: {
	files: readonly RuntimeCompileSignatureFile[];
	assets: readonly RuntimeAssetSignatureBinding[];
}): string {
	const assets = [...snapshot.assets]
		.sort((left, right) => {
			if (left.path !== right.path) return left.path < right.path ? -1 : 1;
			if (left.assetId !== right.assetId)
				return left.assetId < right.assetId ? -1 : 1;
			/**
			 * Kind is part of the signal. Changing kind while keeping the same name and media is not a
			 * normal path, since replacement fixes the kind. But if the signal ignored kind, such an edit
			 * would not mark the preview as stale on the day it happens.
			 */
			if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
			return 0;
		})
		.map((binding) => [binding.path, binding.assetId, binding.kind] as const);
	return JSON.stringify([runtimeCompileSignature(snapshot.files), assets]);
}
