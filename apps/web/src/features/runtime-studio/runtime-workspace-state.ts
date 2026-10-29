import { runtimeFileName, runtimeFolderOf } from "@rowcat/authoring";
import type { RuntimePanelTab } from "./layout/panels.ts";

/**
 * Studio workspace state: open tabs, active file, explorer selection, inline edit, expanded
 * folders, and panels.
 *
 * This is a pure reducer, and every rule here must be checkable without rendering. For example,
 * what becomes active when the active file disappears runs on every common deletion, and mistakes
 * there fail silently.
 *
 * - Tabs are keyed by file id, not path. Renaming changes the path (folders derive from the
 *   path), so a path key would make the tab look closed. The id survives a rename.
 * - Explorer selection is a separate axis from the active file. A context menu must not switch
 *   the editor. Folders cannot be opened or made active and have no id, so they are addressed by
 *   path. Overwriting `activeId` with the selection would make folders unselectable. The two axes
 *   render differently (`ACTIVE_RAIL_CLASS` in `runtime-explorer.tsx`), because a brightness
 *   difference alone was not enough to tell them apart.
 * - Inline editing holds one edit at a time. Per-row booleans would allow two rows to be editing
 *   together, and one Escape would cancel only one.
 * - Not kept here: - File contents. The source of truth is IndexedDB, read through `liveQuery`.
 *   Storing them here would create two sources of truth. - Validation results for inline input.
 *   These come from pure rules (`planRuntimeFileCreate`) recomputed against the current value.
 *   Storing them would let two copies go stale. - Cursor, scroll, and folding. These are Monaco
 *   view state, one per model. Keeping them here would tie the state shape to the editor
 *   implementation. Only `editorRequest` is kept: a one-time request that is cleared as soon as it
 *   is used. - Panel width and height. These are device preferences and live in
 *   `runtime-layout.ts`.
 */

/** Narrow screens show only one of these three panes at a time. */
export const RUNTIME_MOBILE_TABS = ["files", "code", "preview"] as const;
export type RuntimeMobileTab = (typeof RUNTIME_MOBILE_TABS)[number];

/**
 * What explorer actions point at. Folders are identified by path because they have no record (their
 * path is derived), so there is no id to point at. Files are identified by id, so an action keeps
 * pointing at the same file after a rename.
 */
export type RuntimeExplorerSelection =
	| { kind: "file"; fileId: string }
	| { kind: "folder"; path: string }
	| null;

/**
 * The single inline-name slot in the explorer. Only one can be open at a time. `parent` is on every
 * variant because the user types a name, not a full path. Typing full paths would turn the common
 * case of creating a file inside a folder into retyping known segments, where typos happen.
 */
export type RuntimeExplorerEdit =
	| { kind: "create-file"; parent: string; value: string }
	| { kind: "create-folder"; parent: string; value: string }
	| { kind: "rename-file"; fileId: string; parent: string; value: string }
	| null;

/**
 * A one-time request to the editor, not state. It has two variants because there are two requests:
 * for a newly created file, move focus to the editor; for a diagnostic, go to that line. Both can
 * only happen in the frame where the editor has attached the file's model, which is after the
 * record arrives through `liveQuery`. Waiting on a timer would drift on slow devices.
 */
export type RuntimeEditorRequest =
	| { kind: "focus"; fileId: string }
	| { kind: "reveal"; fileId: string; line: number; column: number }
	| null;

export interface RuntimeWorkspaceState {
	/** Open tabs. Their order is the on-screen tab order. */
	openIds: string[];
	activeId: string | null;
	selection: RuntimeExplorerSelection;
	/** The name being typed. `null` means no inline edit is open. */
	edit: RuntimeExplorerEdit;
	/** One-time request to the editor. Cleared once it has been handled. */
	editorRequest: RuntimeEditorRequest;
	/**
	 * A folder with no files yet. It is not a record. Nothing is saved when `New folder` is pressed, since a
	 * folder is just the set of files beneath it. But if nothing visible happened, the button would
	 * look broken, so the screen remembers the folder until a file arrives. Losing it on refresh is
	 * correct, because it was never saved.
	 */
	draftFolders: string[];
	/** Expanded folders. Any folder not listed here is collapsed. */
	expanded: string[];
	/** The tab shown in the bottom panel. `null` means the panel is collapsed. */
	panel: RuntimePanelTab | null;
	/**
	 * Whether the explorer pane is drawn on wide screens. The `files` pane on narrow screens ignores
	 * this value.
	 */
	explorerVisible: boolean;
	preview: boolean;
	mobileTab: RuntimeMobileTab;
}

/**
 * The default workspace on first open. The preview pane is on, and it was off for a while.
 *
 * It was off because the pane showed only a sentence saying there was no execution engine, which
 * did not justify 340px of space. The same place recorded the condition for revisiting: when an
 * execution engine exists. That condition is now met. The preview pane compiles and runs the
 * creator's code in QuickJS (`features/runtime-preview`).
 *
 * Meanwhile the screen contradicted itself. The onboarding line says `Run it in the preview ⌘Enter`
 * (`runtime-onboarding.ts`), but neither the pane nor a run button was on screen. This was observed
 * at 1280px.
 *
 * The way to turn it off is unchanged (the studio menu in the header). Narrow screens ignore this
 * value: they draw one pane, and the first pane is still `code`.
 *
 * The bottom panel stays collapsed. It answers what went wrong, so it opens when there is something
 * to check. The header's check status opens it (pressing it opens `Problems`).
 */
export const initialRuntimeWorkspace = (): RuntimeWorkspaceState => ({
	openIds: [],
	activeId: null,
	selection: null,
	edit: null,
	editorRequest: null,
	draftFolders: [],
	expanded: [],
	panel: null,
	explorerVisible: true,
	preview: true,
	mobileTab: "code",
});

export type RuntimeWorkspaceAction =
	/**
	 * Opening a file from the explorer does not take focus. The user who picked a row has not yet
	 * decided what to do next and may want to view other files. The path that moves straight into the
	 * code is `navigate`, below.
	 */
	| { type: "open"; fileId: string }
	| { type: "close"; fileId: string }
	/** Keeps only this tab. If the target is not open, nothing happens. */
	| { type: "closeOthers"; fileId: string }
	| { type: "closeAll" }
	/** The repository list changed. Remove tabs and selection for files that no longer exist. */
	| { type: "sync"; fileIds: string[] }
	/** Moves the explorer action target. The editor is not touched. */
	| { type: "select"; selection: RuntimeExplorerSelection }
	/**
	 * Moves to this file. Quick open, pressing a diagnostic, and the `Runtime` pane's entry file all
	 * use this same transition. Opening also does three things: it expands ancestor folders (a
	 * selected row must not sit inside a collapsed folder), moves focus to the editor, and jumps to
	 * the line if one is given. If each call site listed these separately, one could miss an axis, and
	 * the mismatch would show only to users of that path. Without `line`, the transition only opens
	 * the file. `0` is not used for 'no line', because document coordinates are 1-based and `0` would
	 * not be distinguishable from 'position unknown'.
	 */
	| {
			type: "navigate";
			fileId: string;
			path: string;
			line?: number;
			column?: number;
	  }
	/**
	 * Reveals this file in the explorer: expands its ancestors and selects it. The editor is not
	 * touched.
	 */
	| { type: "revealInExplorer"; fileId: string; path: string }
	| { type: "startCreate"; kind: "file" | "folder"; parent: string }
	| { type: "startRename"; fileId: string; path: string }
	| { type: "editValue"; value: string }
	| { type: "cancelEdit" }
	/** The file was actually saved. Open it, select it, expand its folder, and request focus. */
	| { type: "createdFile"; fileId: string; parent: string }
	/** A folder was created. It has no record, so the screen remembers it and expands it. */
	| { type: "createdFolder"; path: string }
	| { type: "editorRequestHandled" }
	| { type: "toggleFolder"; path: string }
	| { type: "expandFolders"; paths: string[] }
	| { type: "collapseAll" }
	| { type: "setPanel"; panel: RuntimePanelTab | null }
	| { type: "toggleExplorer" }
	| { type: "togglePreview" }
	| { type: "setMobileTab"; tab: RuntimeMobileTab };

/**
 * When the active tab closes, the next active tab is the one to the right, or else the one to the
 * left. This follows the long-standing editor convention. Doing it differently makes closing
 * several files in a row jump to the other side of the list each time. Returns `null` when nothing
 * remains rather than forcing a choice.
 */
function neighbour(openIds: string[], index: number): string | null {
	return openIds[index] ?? openIds[index - 1] ?? null;
}

/**
 * Finds the surviving neighbour where the active tab was removed: right first, then left. The walk
 * must run over the previous list. Recounting indexes in the filtered list misplaces the result
 * when several files vanish at once, such as a whole draft folder deleted on another device.
 */
function nextAfterRemoval(
	previous: string[],
	activeId: string | null,
	live: Set<string>,
): string | null {
	const index = activeId === null ? -1 : previous.indexOf(activeId);
	if (index === -1) return previous.find((id) => live.has(id)) ?? null;
	for (let i = index + 1; i < previous.length; i++)
		if (live.has(previous[i])) return previous[i];
	for (let i = index - 1; i >= 0; i--)
		if (live.has(previous[i])) return previous[i];
	return null;
}

/**
 * This folder and every folder above it. The root (`""`) is not a folder and is not listed. For a
 * creation slot to be visible, every folder on the path must be expanded. If only the parent is
 * expanded, an input under `src/ui` sits inside the collapsed `src` and never appears.
 */
function selfAndAncestors(path: string): string[] {
	const out: string[] = [];
	for (let at = path; at.length > 0; at = runtimeFolderOf(at)) out.unshift(at);
	return out;
}

/**
 * Folders that must be expanded for a file to be visible: its containing folder and all of its
 * ancestors. This replaces expanding every folder on first open, which works for a small project
 * but grows into a long list that answers nothing. Showing where the file that was opened first
 * lives is enough; the user expands other branches. The function takes a file path because the file
 * itself is not a folder and is never listed.
 */
export const runtimeFileAncestors = (path: string): string[] =>
	selfAndAncestors(runtimeFolderOf(path));

function withExpanded(expanded: string[], paths: string[]): string[] {
	const missing = paths.filter((path) => !expanded.includes(path));
	return missing.length === 0 ? expanded : [...expanded, ...missing];
}

const sameSelection = (
	a: RuntimeExplorerSelection,
	b: RuntimeExplorerSelection,
): boolean => {
	if (a === null || b === null) return a === b;
	if (a.kind !== b.kind) return false;
	return a.kind === "file" && b.kind === "file"
		? a.fileId === b.fileId
		: a.kind === "folder" && b.kind === "folder"
			? a.path === b.path
			: false;
};

/**
 * Everything that opening a file changes, kept in one place because there are three entry paths:
 * the explorer, quick open, and pressing a diagnostic. All three must go through the same
 * transition. If each wrote its own version, one might fail to switch the narrow-screen pane or
 * leave a stale selection, and only users of that path would notice.
 */
function openFile(
	state: RuntimeWorkspaceState,
	fileId: string,
	request: RuntimeEditorRequest,
): RuntimeWorkspaceState {
	/**
	 * Reopening an already open file switches to its existing tab. A second tab would make the same
	 * file look like it is being edited in two places. Both tabs share one model, so the screen would
	 * misrepresent the state.
	 */
	const openIds = state.openIds.includes(fileId)
		? state.openIds
		: [...state.openIds, fileId];
	return {
		...state,
		openIds,
		activeId: fileId,
		selection: { kind: "file", fileId },
		editorRequest: request ?? state.editorRequest,
		mobileTab: "code",
	};
}

export function runtimeWorkspaceReducer(
	state: RuntimeWorkspaceState,
	action: RuntimeWorkspaceAction,
): RuntimeWorkspaceState {
	switch (action.type) {
		case "open":
			return openFile(state, action.fileId, null);

		case "navigate": {
			const request: RuntimeEditorRequest =
				action.line === undefined
					? { kind: "focus", fileId: action.fileId }
					: {
							kind: "reveal",
							fileId: action.fileId,
							line: action.line,
							column: action.column ?? 1,
						};
			const opened = openFile(state, action.fileId, request);
			return {
				...opened,
				expanded: withExpanded(
					opened.expanded,
					runtimeFileAncestors(action.path),
				),
			};
		}

		case "revealInExplorer":
			return {
				...state,
				expanded: withExpanded(
					state.expanded,
					runtimeFileAncestors(action.path),
				),
				selection: { kind: "file", fileId: action.fileId },
				/**
				 * If the reveal request has no pane to show it, nothing appears to happen. On narrow screens
				 * this switches the pane. On wide screens it restores a collapsed explorer.
				 */
				explorerVisible: true,
				mobileTab: "files",
			};

		case "close": {
			const index = state.openIds.indexOf(action.fileId);
			if (index === -1) return state;
			const openIds = state.openIds.filter((id) => id !== action.fileId);
			return {
				...state,
				openIds,
				activeId:
					state.activeId === action.fileId
						? neighbour(openIds, index)
						: state.activeId,
			};
		}

		case "closeOthers":
			/**
			 * A request to keep only a tab that is no longer open does not mean close all tabs. The list
			 * changed in the meantime, so nothing is done.
			 */
			if (!state.openIds.includes(action.fileId)) return state;
			return {
				...state,
				openIds: [action.fileId],
				/**
				 * The tab that is kept becomes the one being viewed. A single remaining tab cannot be inactive.
				 */
				activeId: action.fileId,
			};

		case "closeAll":
			/**
			 * Deletes no files. Closed tabs can be reopened from the explorer, so there is no confirmation
			 * dialog. This is the point where closing differs from deleting.
			 */
			return state.openIds.length === 0
				? state
				: { ...state, openIds: [], activeId: null };

		case "sync": {
			/**
			 * The repository is the source of truth, not the list the screen remembers. Files disappear in
			 * three ways: deleted in this tab, deleted in another tab, or removed when sync applies another
			 * device's deletion. The last two happen without any action in this component, so cleanup only
			 * on the close path would leave those tabs pointing at missing files.
			 *
			 * Cleanup covers more than tabs. A selection on a missing file is a target that cannot be acted
			 * on (`F2` does nothing). An inline name input for a missing file would try to modify a record
			 * that no longer exists. A pending editor request for it has no model to navigate to.
			 */
			const live = new Set(action.fileIds);
			const activeSurvives =
				state.activeId !== null && live.has(state.activeId);
			const selectionSurvives =
				state.selection === null ||
				state.selection.kind === "folder" ||
				live.has(state.selection.fileId);
			const editSurvives =
				state.edit === null ||
				state.edit.kind !== "rename-file" ||
				live.has(state.edit.fileId);
			const requestSurvives =
				state.editorRequest === null || live.has(state.editorRequest.fileId);

			if (
				state.openIds.every((id) => live.has(id)) &&
				(state.activeId === null || activeSurvives) &&
				selectionSurvives &&
				editSurvives &&
				requestSurvives
			)
				return state;

			const openIds = state.openIds.filter((id) => live.has(id));
			return {
				...state,
				openIds,
				activeId: activeSurvives
					? state.activeId
					: /**
						 * The next active tab is searched for from the removed tab's original position, rightward
						 * first. It must follow the same rule as closing. Whether the user or another device removed
						 * the file, the screen should behave the same way.
						 */
						nextAfterRemoval(state.openIds, state.activeId, live),
				/**
				 * A folder selection survives even if the folder becomes empty. It is still a valid place to
				 * create items.
				 */
				selection: selectionSurvives ? state.selection : null,
				edit: editSurvives ? state.edit : null,
				editorRequest: requestSurvives ? state.editorRequest : null,
			};
		}

		case "select":
			return sameSelection(state.selection, action.selection)
				? state
				: { ...state, selection: action.selection };

		case "startCreate":
			return {
				...state,
				edit: {
					kind: action.kind === "file" ? "create-file" : "create-folder",
					parent: action.parent,
					value: "",
				},
				/**
				 * The creation target becomes the current selection. When creating at the root there is nothing
				 * to select, since the root is the list itself rather than a row.
				 */
				selection:
					action.parent === "" ? null : { kind: "folder", path: action.parent },
				expanded: withExpanded(state.expanded, selfAndAncestors(action.parent)),
			};

		case "startRename":
			return {
				...state,
				edit: {
					kind: "rename-file",
					fileId: action.fileId,
					parent: runtimeFolderOf(action.path),
					value: runtimeFileName(action.path),
				},
				selection: { kind: "file", fileId: action.fileId },
			};

		case "editValue":
			if (state.edit === null) return state;
			return { ...state, edit: { ...state.edit, value: action.value } };

		case "cancelEdit":
			return state.edit === null ? state : { ...state, edit: null };

		case "createdFile":
			return {
				...openFile(state, action.fileId, {
					kind: "focus",
					fileId: action.fileId,
				}),
				edit: null,
				expanded: withExpanded(state.expanded, selfAndAncestors(action.parent)),
			};

		case "createdFolder":
			return {
				...state,
				draftFolders: state.draftFolders.includes(action.path)
					? state.draftFolders
					: [...state.draftFolders, action.path],
				expanded: withExpanded(state.expanded, selfAndAncestors(action.path)),
				selection: { kind: "folder", path: action.path },
				edit: null,
			};

		case "editorRequestHandled":
			return state.editorRequest === null
				? state
				: { ...state, editorRequest: null };

		case "toggleFolder": {
			const expanded = state.expanded.includes(action.path)
				? state.expanded.filter((path) => path !== action.path)
				: [...state.expanded, action.path];
			return { ...state, expanded };
		}

		case "expandFolders": {
			const expanded = withExpanded(state.expanded, action.paths);
			return expanded === state.expanded ? state : { ...state, expanded };
		}

		case "collapseAll":
			return state.expanded.length === 0 ? state : { ...state, expanded: [] };

		case "setPanel":
			return { ...state, panel: action.panel };

		case "toggleExplorer":
			/**
			 * Toggling hides one pane on wide screens. The `files` pane on narrow screens does not read this
			 * value. Hiding the explorer there would remove the only way to pick a file.
			 */
			return { ...state, explorerVisible: !state.explorerVisible };

		case "togglePreview":
			return { ...state, preview: !state.preview };

		case "setMobileTab":
			return { ...state, mobileTab: action.tab };
	}
}
