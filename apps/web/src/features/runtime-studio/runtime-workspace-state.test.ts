import { describe, expect, it } from "vitest";
import {
	initialRuntimeWorkspace,
	type RuntimeWorkspaceAction,
	type RuntimeWorkspaceState,
	runtimeFileAncestors,
	runtimeWorkspaceReducer,
} from "./runtime-workspace-state.ts";

/**
 * Workspace state transitions, checked without rendering. Errors here are silent. If the active tab
 * disappears and no successor is chosen, the editor goes blank even though the file still exists.
 * If the active id points at a deleted file, its stale content keeps being drawn. Both look like
 * lost code.
 */

const run = (
	state: RuntimeWorkspaceState,
	...actions: RuntimeWorkspaceAction[]
): RuntimeWorkspaceState => actions.reduce(runtimeWorkspaceReducer, state);

const opened = (...ids: string[]): RuntimeWorkspaceState =>
	run(
		initialRuntimeWorkspace(),
		...ids.map((fileId): RuntimeWorkspaceAction => ({ type: "open", fileId })),
	);

describe("opening tabs", () => {
	it("the opened file becomes active", () => {
		const state = opened("a");
		expect(state.openIds).toEqual(["a"]);
		expect(state.activeId).toBe("a");
	});

	it("reopening an open file goes to its tab", () => {
		const state = run(opened("a", "b"), { type: "open", fileId: "a" });
		expect(state.openIds).toEqual(["a", "b"]);
		expect(state.activeId).toBe("a");
	});
});

describe("closing tabs", () => {
	it("closing the active tab activates the one to the right", () => {
		const state = run(opened("a", "b", "c"), { type: "open", fileId: "b" });
		const closed = runtimeWorkspaceReducer(state, {
			type: "close",
			fileId: "b",
		});
		expect(closed.openIds).toEqual(["a", "c"]);
		expect(closed.activeId).toBe("c");
	});

	it("without a right neighbor the left one becomes active", () => {
		const closed = run(opened("a", "b"), { type: "close", fileId: "b" });
		expect(closed.activeId).toBe("a");
	});

	it("closing the last tab leaves none active; nothing is forced", () => {
		const closed = run(opened("a"), { type: "close", fileId: "a" });
		expect(closed.openIds).toEqual([]);
		expect(closed.activeId).toBeNull();
	});

	it("closing an inactive tab keeps the active one", () => {
		const state = run(opened("a", "b", "c"), { type: "open", fileId: "a" });
		const closed = runtimeWorkspaceReducer(state, {
			type: "close",
			fileId: "c",
		});
		expect(closed.activeId).toBe("a");
	});

	it("closing a tab that isn't open does nothing", () => {
		const state = opened("a");
		expect(runtimeWorkspaceReducer(state, { type: "close", fileId: "z" })).toBe(
			state,
		);
	});
});

/**
 * The repository is the source of truth. Files disappear in three ways: deleted in this tab,
 * deleted in another tab, or removed when sync applies a deletion from another device. The last two
 * happen without any action in this screen, so cleanup placed only on the close path would leave
 * those tabs pointing at missing files.
 */
describe("reconciling the list", () => {
	it("tabs of vanished files are cleared", () => {
		const synced = run(opened("a", "b", "c"), {
			type: "sync",
			fileIds: ["a", "c"],
		});
		expect(synced.openIds).toEqual(["a", "c"]);
	});

	it("picks the right neighbor of a vanished active tab first, the same rule as closing", () => {
		const state = run(opened("a", "b", "c"), { type: "open", fileId: "b" });
		const synced = runtimeWorkspaceReducer(state, {
			type: "sync",
			fileIds: ["a", "c"],
		});
		expect(synced.activeId).toBe("c");
	});

	it("positions stay right when several vanish at once", () => {
		const state = run(opened("a", "b", "c", "d"), {
			type: "open",
			fileId: "b",
		});
		const synced = runtimeWorkspaceReducer(state, {
			type: "sync",
			fileIds: ["a", "d"],
		});
		expect(synced.activeId).toBe("d");
	});

	it("goes left when everything to the right is gone", () => {
		const state = run(opened("a", "b", "c"), { type: "open", fileId: "b" });
		const synced = runtimeWorkspaceReducer(state, {
			type: "sync",
			fileIds: ["a"],
		});
		expect(synced.activeId).toBe("a");
	});

	it("none active when all vanish", () => {
		const synced = run(opened("a", "b"), { type: "sync", fileIds: [] });
		expect(synced.openIds).toEqual([]);
		expect(synced.activeId).toBeNull();
	});

	it("returns **the same object** when nothing changes", () => {
		/**
		 * Callers may skip rendering based only on reference identity. This matters because the check
		 * runs on every list update.
		 */
		const state = opened("a", "b");
		expect(
			runtimeWorkspaceReducer(state, { type: "sync", fileIds: ["a", "b"] }),
		).toBe(state);
	});

	it("tabs stay as files not yet opened join the list", () => {
		const state = opened("a");
		expect(
			runtimeWorkspaceReducer(state, {
				type: "sync",
				fileIds: ["a", "b", "c"],
			}),
		).toBe(state);
	});
});

describe("folders", () => {
	it("expanding is a toggle", () => {
		const open = run(initialRuntimeWorkspace(), {
			type: "toggleFolder",
			path: "src",
		});
		expect(open.expanded).toEqual(["src"]);
		expect(
			runtimeWorkspaceReducer(open, { type: "toggleFolder", path: "src" })
				.expanded,
		).toEqual([]);
	});

	it("expanding an already expanded folder adds nothing", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "expandFolders", paths: ["src", "src/ui"] },
			{ type: "expandFolders", paths: ["src"] },
		);
		expect(state.expanded).toEqual(["src", "src/ui"]);
	});

	/**
	 * A folder with no files is not a record, so there is nothing to save. Without screen-level
	 * memory, the `New folder` button would appear to do nothing.
	 */
	it("the screen remembers a created folder and keeps it expanded", () => {
		const state = run(initialRuntimeWorkspace(), {
			type: "createdFolder",
			path: "src/hooks",
		});
		expect(state.draftFolders).toEqual(["src/hooks"]);
		expect(state.expanded).toContain("src/hooks");
	});

	/**
	 * The newly created folder becomes the target of the next action, since it was made to hold files.
	 */
	it("a created folder is selected and the inline input closes", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "startCreate", kind: "folder", parent: "src" },
			{ type: "editValue", value: "hooks" },
			{ type: "createdFolder", path: "src/hooks" },
		);
		expect(state.selection).toEqual({ kind: "folder", path: "src/hooks" });
		expect(state.edit).toBeNull();
	});

	/**
	 * Every ancestor on the path must be expanded. Expanding only the parent leaves the row hidden
	 * inside a collapsed ancestor.
	 */
	it("also expands the created folder's ancestors", () => {
		const state = run(initialRuntimeWorkspace(), {
			type: "createdFolder",
			path: "src/ui/panels",
		});
		expect(state.expanded).toEqual(["src", "src/ui", "src/ui/panels"]);
	});

	it("creating the same folder twice doesn't grow the list", () => {
		const once = run(initialRuntimeWorkspace(), {
			type: "createdFolder",
			path: "src/hooks",
		});
		const twice = runtimeWorkspaceReducer(once, {
			type: "createdFolder",
			path: "src/hooks",
		});
		expect(twice.draftFolders).toEqual(["src/hooks"]);
		expect(twice.expanded).toEqual(once.expanded);
	});

	/**
	 * `Collapse all` (collapse all) changes only the expansion state. Touching open tabs or the active file
	 * would close the code the user was looking at while tidying the list.
	 */
	it("collapse all clears only expansion", () => {
		const state = run(
			opened("a", "b"),
			{ type: "expandFolders", paths: ["src", "src/ui"] },
			{ type: "select", selection: { kind: "file", fileId: "a" } },
			{ type: "collapseAll" },
		);
		expect(state.expanded).toEqual([]);
		expect(state.openIds).toEqual(["a", "b"]);
		expect(state.activeId).toBe("b");
		expect(state.selection).toEqual({ kind: "file", fileId: "a" });
	});

	it("returns the same object when everything is already collapsed", () => {
		const state = initialRuntimeWorkspace();
		expect(runtimeWorkspaceReducer(state, { type: "collapseAll" })).toBe(state);
	});
});

/**
 * Explorer selection is a separate axis from the active file. Mixing them makes a right-click swap
 * the editor. Deleting a file while another stays open is the normal path, and if the editor
 * followed the selection, the user would lose their place even though the content is saved.
 */
describe("selection", () => {
	it("selecting a file doesn't move the editor", () => {
		const state = run(opened("a"), {
			type: "select",
			selection: { kind: "file", fileId: "b" },
		});
		expect(state.selection).toEqual({ kind: "file", fileId: "b" });
		expect(state.activeId).toBe("a");
		expect(state.openIds).toEqual(["a"]);
	});

	it("folders can be selected too, a target the active file can't express", () => {
		const state = run(opened("a"), {
			type: "select",
			selection: { kind: "folder", path: "src/ui" },
		});
		expect(state.selection).toEqual({ kind: "folder", path: "src/ui" });
		expect(state.activeId).toBe("a");
	});

	it("selection can be cleared", () => {
		const state = run(
			opened("a"),
			{ type: "select", selection: { kind: "folder", path: "src" } },
			{ type: "select", selection: null },
		);
		expect(state.selection).toBeNull();
	});

	it("selecting the same target returns the same object", () => {
		const state = run(initialRuntimeWorkspace(), {
			type: "select",
			selection: { kind: "folder", path: "src" },
		});
		expect(
			runtimeWorkspaceReducer(state, {
				type: "select",
				selection: { kind: "folder", path: "src" },
			}),
		).toBe(state);
	});

	/**
	 * Opening a file also selects it. The reverse does not hold: selecting a file does not open it.
	 */
	it("opening a file selects it", () => {
		expect(opened("a").selection).toEqual({ kind: "file", fileId: "a" });
	});

	it("a vanished file's selection is cleared", () => {
		const state = run(opened("a", "b"), { type: "sync", fileIds: ["a"] });
		expect(state.selection).toBeNull();
	});

	/**
	 * A folder selection survives even when the folder is empty, since it is still a valid place to
	 * create items.
	 */
	it("a folder selection survives files vanishing", () => {
		const state = run(
			opened("a"),
			{ type: "select", selection: { kind: "folder", path: "src" } },
			{ type: "sync", fileIds: [] },
		);
		expect(state.selection).toEqual({ kind: "folder", path: "src" });
	});
});

/**
 * Inline editing allows one edit at a time. A boolean per row would allow two rows to be editable
 * at once, and one `Escape` would then close only one of them.
 */
describe("inline editing", () => {
	it("starting a file inside a folder expands and selects that folder", () => {
		const state = run(initialRuntimeWorkspace(), {
			type: "startCreate",
			kind: "file",
			parent: "src/ui",
		});
		expect(state.edit).toEqual({
			kind: "create-file",
			parent: "src/ui",
			value: "",
		});
		expect(state.expanded).toEqual(["src", "src/ui"]);
		expect(state.selection).toEqual({ kind: "folder", path: "src/ui" });
	});

	/** The root is the list itself, not a row, so there is nothing to select. */
	it("starting one at the root clears the selection", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "select", selection: { kind: "folder", path: "src" } },
			{ type: "startCreate", kind: "file", parent: "" },
		);
		expect(state.selection).toBeNull();
		expect(state.expanded).toEqual([]);
	});

	/** Only the name is typed. The full path is reassembled from the parent. */
	it("rename holds only the name and remembers the parent separately", () => {
		const state = run(initialRuntimeWorkspace(), {
			type: "startRename",
			fileId: "a",
			path: "src/ui/panel.tsx",
		});
		expect(state.edit).toEqual({
			kind: "rename-file",
			fileId: "a",
			parent: "src/ui",
			value: "panel.tsx",
		});
		expect(state.selection).toEqual({ kind: "file", fileId: "a" });
	});

	it("starting another structural action replaces the earlier edit", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "startRename", fileId: "a", path: "src/main.tsx" },
			{ type: "startCreate", kind: "folder", parent: "src" },
		);
		expect(state.edit).toEqual({
			kind: "create-folder",
			parent: "src",
			value: "",
		});
	});

	it("the value is held", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "startCreate", kind: "file", parent: "" },
			{ type: "editValue", value: "main.tsx" },
		);
		expect(state.edit?.value).toBe("main.tsx");
	});

	/** A late input event must not revive an input that has already closed. */
	it("holds no value when not open", () => {
		const state = initialRuntimeWorkspace();
		expect(
			runtimeWorkspaceReducer(state, { type: "editValue", value: "x" }),
		).toBe(state);
	});

	it("cancelling closes only the edit and keeps the selection", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "startCreate", kind: "file", parent: "src" },
			{ type: "editValue", value: "panel.tsx" },
			{ type: "cancelEdit" },
		);
		expect(state.edit).toBeNull();
		expect(state.selection).toEqual({ kind: "folder", path: "src" });
	});

	/**
	 * If the user is typing the name of a file that has since disappeared, submitting would try to
	 * modify a record that no longer exists.
	 */
	it("the input closes when the file being renamed vanishes", () => {
		const state = run(
			opened("a"),
			{ type: "startRename", fileId: "a", path: "src/main.tsx" },
			{ type: "sync", fileIds: [] },
		);
		expect(state.edit).toBeNull();
	});
});

/**
 * The path from a newly created file: expand its folder, open it, select it, and request focus. If
 * any step diverges, the new file may sit inside a collapsed folder, stay unopened, or remain on
 * the file list on a narrow screen.
 */
describe("after creating a file", () => {
	it("opens, activates and selects it, then closes the input", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "startCreate", kind: "file", parent: "src/ui" },
			{ type: "editValue", value: "panel.tsx" },
			{ type: "createdFile", fileId: "new", parent: "src/ui" },
		);
		expect(state.openIds).toEqual(["new"]);
		expect(state.activeId).toBe("new");
		expect(state.selection).toEqual({ kind: "file", fileId: "new" });
		expect(state.edit).toBeNull();
	});

	it("expands every ancestor folder and moves to the code face", () => {
		const state = run(initialRuntimeWorkspace(), {
			type: "setMobileTab",
			tab: "files",
		});
		const created = runtimeWorkspaceReducer(state, {
			type: "createdFile",
			fileId: "new",
			parent: "src/ui/panels",
		});
		expect(created.expanded).toEqual(["src", "src/ui", "src/ui/panels"]);
		expect(created.mobileTab).toBe("code");
	});

	/**
	 * Focus is a request that is consumed once and then cleared. If it persisted, the editor would
	 * take focus on every render.
	 */
	it("requests focus, and the request clears once handled", () => {
		const created = run(initialRuntimeWorkspace(), {
			type: "createdFile",
			fileId: "new",
			parent: "",
		});
		expect(created.editorRequest).toEqual({ kind: "focus", fileId: "new" });
		expect(
			runtimeWorkspaceReducer(created, { type: "editorRequestHandled" })
				.editorRequest,
		).toBeNull();
	});

	it("the focus request clears if the created file vanishes at once", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "createdFile", fileId: "new", parent: "" },
			{ type: "sync", fileIds: [] },
		);
		expect(state.editorRequest).toBeNull();
	});
});

/**
 * A request to the editor is a single field consumed once. Several one-shot fields could point at
 * different files at the same time, and then the editor would have no basis for deciding which one
 * to follow first.
 */
describe("editor requests", () => {
	it("opening from the explorer requests no focus", () => {
		/** A user who selected a file has not yet decided what to do next. */
		expect(opened("a").editorRequest).toBeNull();
	});

	it("quick open also requests focus and expands ancestors", () => {
		const state = run(initialRuntimeWorkspace(), {
			type: "navigate",
			fileId: "a",
			path: "src/ui/panel.tsx",
		});
		expect(state.activeId).toBe("a");
		expect(state.editorRequest).toEqual({ kind: "focus", fileId: "a" });
		/** If the selected file sits inside a collapsed folder, the explorer selection is invisible. */
		expect(state.expanded).toEqual(["src", "src/ui"]);
	});

	/**
	 * Pressing a diagnostic opens the file and moves to the line. These two steps must be one
	 * transition.
	 */
	it("pressing a diagnostic opens that file and requests the position", () => {
		const state = run(opened("a"), {
			type: "navigate",
			fileId: "b",
			path: "src/main.tsx",
			line: 12,
			column: 4,
		});
		expect(state.openIds).toEqual(["a", "b"]);
		expect(state.activeId).toBe("b");
		expect(state.editorRequest).toEqual({
			kind: "reveal",
			fileId: "b",
			line: 12,
			column: 4,
		});
		expect(state.mobileTab).toBe("code");
	});

	it("a diagnostic for an already open file makes the same request", () => {
		const state = run(opened("a", "b"), {
			type: "navigate",
			fileId: "a",
			path: "src/main.tsx",
			line: 3,
			column: 9,
		});
		expect(state.openIds).toEqual(["a", "b"]);
		expect(state.activeId).toBe("a");
		expect(state.editorRequest).toEqual({
			kind: "reveal",
			fileId: "a",
			line: 3,
			column: 9,
		});
	});

	it("the request clears when its target vanishes", () => {
		const state = run(
			opened("a"),
			{ type: "navigate", fileId: "b", path: "src/b.ts", line: 1, column: 1 },
			{ type: "sync", fileIds: ["a"] },
		);
		expect(state.editorRequest).toBeNull();
	});

	it("returns the same object with no request to handle", () => {
		const state = opened("a");
		expect(
			runtimeWorkspaceReducer(state, { type: "editorRequestHandled" }),
		).toBe(state);
	});
});

/**
 * Bulk tab operations delete no files. That is the only difference between closing and deleting.
 * Closed tabs can be reopened from the explorer, so there is no confirmation dialog, and the
 * reducer should clear only `openIds`.
 */
describe("bulk tab actions", () => {
	it("closing others leaves only the target, which becomes active", () => {
		const state = run(opened("a", "b", "c"), {
			type: "closeOthers",
			fileId: "a",
		});
		expect(state.openIds).toEqual(["a"]);
		expect(state.activeId).toBe("a");
	});

	it("closing others keeps the explorer selection", () => {
		const state = run(
			opened("a", "b"),
			{ type: "select", selection: { kind: "folder", path: "src" } },
			{ type: "closeOthers", fileId: "a" },
		);
		expect(state.selection).toEqual({ kind: "folder", path: "src" });
	});

	it("targeting a tab that isn't open does nothing", () => {
		const state = opened("a", "b");
		expect(
			runtimeWorkspaceReducer(state, { type: "closeOthers", fileId: "z" }),
		).toBe(state);
	});

	it("closing all leaves nothing active", () => {
		const state = run(opened("a", "b"), { type: "closeAll" });
		expect(state.openIds).toEqual([]);
		expect(state.activeId).toBeNull();
	});

	/** Closing tabs must not touch expansion or draft folders. The files remain. */
	it("closing all keeps expansion and selection", () => {
		const state = run(
			opened("a", "b"),
			{ type: "expandFolders", paths: ["src"] },
			{ type: "select", selection: { kind: "file", fileId: "a" } },
			{ type: "closeAll" },
		);
		expect(state.expanded).toEqual(["src"]);
		expect(state.selection).toEqual({ kind: "file", fileId: "a" });
	});

	it("returns the same object with no tab to close", () => {
		const state = initialRuntimeWorkspace();
		expect(runtimeWorkspaceReducer(state, { type: "closeAll" })).toBe(state);
	});
});

/**
 * Reveal in explorer leaves the editor alone. Revealing and opening are different actions. Moving
 * the active file here would discard the code of a user who only wanted to find where a file lives
 * while another file stays open.
 */
describe("reveal in explorer", () => {
	it("expands ancestors and selects, keeping the active file", () => {
		const state = run(opened("a"), {
			type: "revealInExplorer",
			fileId: "b",
			path: "src/ui/panels/panel.tsx",
		});
		expect(state.expanded).toEqual(["src", "src/ui", "src/ui/panels"]);
		expect(state.selection).toEqual({ kind: "file", fileId: "b" });
		expect(state.activeId).toBe("a");
		expect(state.openIds).toEqual(["a"]);
	});

	it("restores a collapsed explorer and goes to the files face on narrow screens", () => {
		const state = run(
			initialRuntimeWorkspace(),
			{ type: "toggleExplorer" },
			{ type: "revealInExplorer", fileId: "b", path: "src/main.tsx" },
		);
		expect(state.explorerVisible).toBe(true);
		expect(state.mobileTab).toBe("files");
	});
});

/**
 * Folders are expanded on first open only as far as the open file. Expanding everything worked for
 * a three-file project, but as a project grows the first screen becomes a long list that answers
 * nothing.
 */
describe("a file's ancestor folders", () => {
	it("returns the whole way there", () => {
		expect(runtimeFileAncestors("src/runtime/entry/main.tsx")).toEqual([
			"src",
			"src/runtime",
			"src/runtime/entry",
		]);
	});

	it("the file itself is not a folder and isn't listed", () => {
		expect(runtimeFileAncestors("src/main.tsx")).toEqual(["src"]);
	});

	it("a root file has nothing to expand", () => {
		expect(runtimeFileAncestors("main.tsx")).toEqual([]);
	});
});

describe("panels and faces", () => {
	/**
	 * The preview pane is on. The onboarding line says `Run it in the preview` (run in the preview), so the
	 * pane must be on screen from the start for that sentence to be true. It was false while the pane
	 * was off (see the header of `runtime-workspace-state.ts`). The bottom panel stays collapsed; it
	 * opens when there is a problem to investigate.
	 */
	it("starts with the explorer and preview, and the bottom panel collapsed", () => {
		const state = initialRuntimeWorkspace();
		expect(state.panel).toBeNull();
		expect(state.preview).toBe(true);
		expect(state.explorerVisible).toBe(true);
		expect(state.mobileTab).toBe("code");
	});

	it("the explorer is a toggle, a different axis from narrow-screen faces", () => {
		const hidden = run(initialRuntimeWorkspace(), { type: "toggleExplorer" });
		expect(hidden.explorerVisible).toBe(false);
		expect(hidden.mobileTab).toBe("code");
		expect(
			runtimeWorkspaceReducer(hidden, { type: "toggleExplorer" })
				.explorerVisible,
		).toBe(true);
	});

	it("selects and collapses the panel", () => {
		const open = run(initialRuntimeWorkspace(), {
			type: "setPanel",
			panel: "problems",
		});
		expect(open.panel).toBe("problems");
		expect(
			runtimeWorkspaceReducer(open, { type: "setPanel", panel: null }).panel,
		).toBeNull();
	});

	it("the preview is a toggle; a way to turn it off remains", () => {
		const hidden = run(initialRuntimeWorkspace(), { type: "togglePreview" });
		expect(hidden.preview).toBe(false);
		expect(
			runtimeWorkspaceReducer(hidden, { type: "togglePreview" }).preview,
		).toBe(true);
	});

	it("selects the narrow-screen face", () => {
		expect(
			run(initialRuntimeWorkspace(), { type: "setMobileTab", tab: "preview" })
				.mobileTab,
		).toBe("preview");
	});

	it("selecting a face doesn't touch tabs", () => {
		const state = run(opened("a", "b"), { type: "setMobileTab", tab: "files" });
		expect(state.openIds).toEqual(["a", "b"]);
		expect(state.activeId).toBe("b");
	});
});
