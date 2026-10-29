import { runtimeFileName, runtimeFolderOf } from "@rowcat/authoring";

/**
 * Location indicator above the editor: shows where the active file is.
 * - Tab labels are short by design (runtime-tab-labels.ts). Without a location, `button.tsx`
 *   alone does not say which folder it belongs to.
 * - It is not a second explorer. It renders the path of the one active file. Clickable folder
 *   segments would give the line its own open and scroll state, which the left tree already has.
 * - Truncation removes the front, not the back. The kept part is the file name and its nearest
 *   parent, and a leading `…` marks the cut. The full path is carried by the accessible name and
 *   `title`.
 */

/**
 * The limit of 2 was chosen by measurement. The starter project has one folder level
 * (`src/main.tsx`), and a common cleanup gives two (`src/components/button.tsx`). Up to two folders
 * show without truncation, and `…` appears only for deeper paths.
 */
export const RUNTIME_BREADCRUMB_FOLDER_LIMIT = 2;

export interface RuntimeBreadcrumb {
	folders: string[];
	truncated: boolean;
	/** The file name. It is never truncated. */
	name: string;
}

/**
 * Turns a path into drawable segments. A file at the root has no folder and yields only its name
 * (`main.tsx`), with no empty segment. Without this, a line such as `/ main.tsx` would appear,
 * which is not a path.
 */
export function runtimeBreadcrumb(
	path: string,
	limit = RUNTIME_BREADCRUMB_FOLDER_LIMIT,
): RuntimeBreadcrumb {
	const name = runtimeFileName(path);
	const folder = runtimeFolderOf(path);
	const all = folder === "" ? [] : folder.split("/");

	/** A limit of 0 or less draws no folder segments. Only the truncation marker remains. */
	const kept = limit <= 0 ? [] : all.slice(-limit);
	return { folders: kept, truncated: kept.length < all.length, name };
}
