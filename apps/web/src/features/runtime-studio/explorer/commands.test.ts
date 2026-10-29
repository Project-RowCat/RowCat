import { describe, expect, it, vi } from "vitest";
import {
	type RuntimeExplorerCommands,
	runtimeExplorerMenu,
} from "./commands.ts";

/**
 * The explorer's operation vocabulary is locked as values, including what is absent. The table is
 * checked without rendering, for two reasons.
 * - Drift between surfaces: the same items open from the context menu and the overflow menu. One
 *   shared definition is only confirmed by opening both. The overflow menu is the only route on
 *   devices without a mouse, so a divergence there would go unnoticed.
 * - No destructive folder operations. This is intentional: the authoring layer has no batch
 *   operation (see runtime-explorer-commands.ts). Recording the absence keeps a later reader from
 *   adding folder delete as a loop over descendants.
 */

const spies = (): RuntimeExplorerCommands => ({
	open: vi.fn(),
	startCreateFile: vi.fn(),
	startCreateFolder: vi.fn(),
	startRenameFile: vi.fn(),
	requestDeleteFile: vi.fn(),
	copyPath: vi.fn(),
	collapseAll: vi.fn(),
});

const ids = (
	target: Parameters<typeof runtimeExplorerMenu>[0],
	commands = spies(),
) => runtimeExplorerMenu(target, commands).map((item) => item.id);

const FILE = {
	kind: "file",
	fileId: "f1",
	path: "src/ui/panel.tsx",
} as const;

describe("file menu", () => {
	it("has open, rename, copy path and delete in that order", () => {
		expect(ids(FILE)).toEqual(["open", "rename", "copy-path", "delete"]);
	});

	it("only delete is destructive", () => {
		const destructive = runtimeExplorerMenu(FILE, spies())
			.filter((item) => item.destructive)
			.map((item) => item.id);
		expect(destructive).toEqual(["delete"]);
	});

	/** Delete asks first and does not delete. A confirmation dialog appears in between. */
	it("each item's command carries the target as is", () => {
		const commands = spies();
		for (const item of runtimeExplorerMenu(FILE, commands)) item.run();
		expect(commands.open).toHaveBeenCalledWith("f1");
		expect(commands.startRenameFile).toHaveBeenCalledWith(
			"f1",
			"src/ui/panel.tsx",
		);
		expect(commands.copyPath).toHaveBeenCalledWith("src/ui/panel.tsx");
		expect(commands.requestDeleteFile).toHaveBeenCalledWith(
			"f1",
			"src/ui/panel.tsx",
		);
	});

	/**
	 * Only items whose key actually works get a shortcut hint. A hint for a key that does nothing
	 * reads as a defect.
	 */
	it("only keys that really work get a hint", () => {
		const hinted = runtimeExplorerMenu(FILE, spies())
			.filter((item) => item.shortcut)
			.map((item) => [item.id, item.shortcut]);
		/**
		 * The list's keyboard handler receives exactly these two keys (runtime-explorer.tsx). A third key
		 * written here would be pressed by readers and do nothing.
		 */
		expect(hinted).toEqual([
			["rename", "F2"],
			["delete", "Delete"],
		]);
	});
});

describe("folder menu", () => {
	const FOLDER = { kind: "folder", path: "src/ui" } as const;

	it("has the two creates and copy path", () => {
		expect(ids(FOLDER)).toEqual(["new-file", "new-folder", "copy-path"]);
	});

	/**
	 * Folders have no rename or delete. Folders are derived from descendant file paths rather than
	 * stored as records, so these operations need a batch operation in the authoring layer. Calling
	 * `rename` for each descendant from the screen would leave a half-moved project if one call failed
	 * midway.
	 */
	it("no destructive action stands", () => {
		expect(ids(FOLDER)).not.toContain("delete");
		expect(ids(FOLDER)).not.toContain("rename");
	});

	it("creates in that folder, not the root", () => {
		const commands = spies();
		for (const item of runtimeExplorerMenu(FOLDER, commands)) item.run();
		expect(commands.startCreateFile).toHaveBeenCalledWith("src/ui");
		expect(commands.startCreateFolder).toHaveBeenCalledWith("src/ui");
		expect(commands.copyPath).toHaveBeenCalledWith("src/ui");
	});
});

describe("empty-space menu", () => {
	const ROOT = { kind: "root" } as const;

	it("has the two creates and collapse all", () => {
		expect(ids(ROOT)).toEqual(["new-file", "new-folder", "collapse-all"]);
	});

	it("creates at the root", () => {
		const commands = spies();
		for (const item of runtimeExplorerMenu(ROOT, commands)) item.run();
		expect(commands.startCreateFile).toHaveBeenCalledWith("");
		expect(commands.startCreateFolder).toHaveBeenCalledWith("");
		expect(commands.collapseAll).toHaveBeenCalled();
	});

	it("no action points at a single file", () => {
		const commands = spies();
		for (const item of runtimeExplorerMenu(ROOT, commands)) item.run();
		expect(commands.open).not.toHaveBeenCalled();
		expect(commands.requestDeleteFile).not.toHaveBeenCalled();
	});
});

/**
 * All three menus use the same vocabulary. If each target called differently named commands
 * (`openFile`, `openInEditor`, ...), those names would drift into doing slightly different things.
 */
describe("vocabulary", () => {
	it("no unknown item ids", () => {
		const all = [
			...ids(FILE),
			...ids({ kind: "folder", path: "src" }),
			...ids({ kind: "root" }),
		];
		expect(new Set(all)).toEqual(
			new Set([
				"open",
				"rename",
				"copy-path",
				"delete",
				"new-file",
				"new-folder",
				"collapse-all",
			]),
		);
	});
});
