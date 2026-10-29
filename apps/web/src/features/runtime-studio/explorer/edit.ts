import type { DraftRuntimeFile, RuntimePathCheck } from "@rowcat/authoring";
import {
	checkRuntimePath,
	planRuntimeFileCreate,
	planRuntimeFileRename,
} from "@rowcat/authoring";
import { runtimePathIssueMessage } from "../path-issue-copy.ts";
import type { RuntimeExplorerEdit } from "../runtime-workspace-state.ts";

/**
 * Converts the inline input value into a path and a verdict. The user types a single name, but the
 * stored value is the full path, so a rule joins them. The rule sits outside the component because
 * it cannot be checked without rendering. It never decides anything itself: it joins the parent
 * folder and the name and passes them to the pure rules in
 * @rowcat/authoring.
 * Restating the path rules here (allowed characters, depth, extension, duplicates, count) would
 * split them across two places. They would diverge when a limit changes. The screen would accept a
 * value the store rejects, and the user would see Enter do nothing.
 */

/**
 * Does not normalize. checkRuntimePath does that as part of the same verdict. Normalizing here
 * would create a gap where the value checked differs from the value saved.
 */
export const runtimeEditPath = (parent: string, value: string): string =>
	parent.length === 0 ? value.trim() : `${parent}/${value.trim()}`;

/**
 * Whether the value being typed is acceptable. If no edit is open there is nothing to check. The
 * rule that a rename does not count itself as a duplicate is applied here (planRuntimeFileRename
 * holds that verdict). Without it, a rename that only changes case would always be rejected.
 */
export function runtimeEditCheck(
	edit: RuntimeExplorerEdit,
	files: readonly DraftRuntimeFile[],
): RuntimePathCheck | null {
	if (edit === null) return null;
	const path = runtimeEditPath(edit.parent, edit.value);
	switch (edit.kind) {
		case "create-file":
			return planRuntimeFileCreate(files, path);
		case "create-folder":
			return checkRuntimePath(path, "folder");
		case "rename-file":
			return planRuntimeFileRename(files, edit.fileId, path);
	}
}

/**
 * The sentence to draw beside the input. An empty input is not a failure: `Please enter a path` would show
 * as soon as the input opens, before the user has done anything. A failure can only be reported
 * after something has been typed.
 */
export function runtimeEditIssue(
	edit: RuntimeExplorerEdit,
	files: readonly DraftRuntimeFile[],
): string | null {
	if (edit === null || edit.value.trim().length === 0) return null;
	const check = runtimeEditCheck(edit, files);
	return check === null || check.ok
		? null
		: runtimePathIssueMessage(check.code, "file");
}
