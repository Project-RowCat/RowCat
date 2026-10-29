import { RUNTIME_STUDIO } from "../runtime-copy.ts";

/**
 * The explorer's operation vocabulary. It is drawn in three places and defined once.
 * - Context menu (right click): the desktop fast path.
 * - Overflow button: the path for coarse pointers and keyboard users. It cannot be removed.
 * - Keyboard: F2 and Delete on the selected row. If each place wrote its own labels and
 *   callbacks, changes would land in only one of them. A new right-click item would never reach the
 *   overflow menu on touch devices. The mismatch shows only on screen, and only on devices without
 *   a mouse.
 *
 * This is one table, not a command framework. There is no registry, dispatcher or shortcut parser.
 * Those layers hide where an operation comes from, and this screen has seven operations.
 *
 * Folders have no rename or delete. Folders derive from file paths (`@rowcat/authoring`'s
 * `runtime.ts`), so renaming one means rewriting every descendant's path. Doing that as one call
 * per descendant can fail midway and leave the project half moved, with no way back. Such an
 * operation needs a batch operation in the authoring layer (planRuntimeFolderRename…). Until it
 * exists, no menu item is shown: a missing item is better than one that only half works.
 */

export type RuntimeExplorerTarget =
	| { kind: "file"; fileId: string; path: string }
	| { kind: "folder"; path: string }
	/** Empty space in the list. Operations started here act on the project root. */
	| { kind: "root" };

/**
 * Everything the explorer can invoke. It holds no state transitions (the reducer) and no storage
 * writes (useRuntimeActions). It only groups both under one set of names, so menus need not know
 * which side they call.
 */
export interface RuntimeExplorerCommands {
	open: (fileId: string) => void;
	startCreateFile: (parent: string) => void;
	startCreateFolder: (parent: string) => void;
	startRenameFile: (fileId: string, path: string) => void;
	requestDeleteFile: (fileId: string, path: string) => void;
	copyPath: (path: string) => void;
	collapseAll: () => void;
}

export const RUNTIME_EXPLORER_COMMAND_IDS = [
	"open",
	"new-file",
	"new-folder",
	"rename",
	"copy-path",
	"delete",
	"collapse-all",
] as const;
export type RuntimeExplorerCommandId =
	(typeof RUNTIME_EXPLORER_COMMAND_IDS)[number];

export interface RuntimeExplorerMenuItem {
	id: RuntimeExplorerCommandId;
	label: string;
	/**
	 * Keyboard hint. Only implemented shortcuts are listed, because a hint for a key that does nothing
	 * reads as a defect.
	 */
	shortcut?: string;
	destructive?: boolean;
	/** Draws a separator above the item. It marks a group boundary, not a property of the item. */
	separatorBefore?: boolean;
	run: () => void;
}

/**
 * A pure function that returns the items a target accepts. Being pure lets tests check by value
 * which items exist and which do not. In particular, the folder menu must not include `delete` (see
 * the file header).
 */
export function runtimeExplorerMenu(
	target: RuntimeExplorerTarget,
	commands: RuntimeExplorerCommands,
): RuntimeExplorerMenuItem[] {
	if (target.kind === "file")
		return [
			{
				id: "open",
				label: RUNTIME_STUDIO.open,
				run: () => commands.open(target.fileId),
			},
			{
				id: "rename",
				label: RUNTIME_STUDIO.rename,
				shortcut: "F2",
				separatorBefore: true,
				run: () => commands.startRenameFile(target.fileId, target.path),
			},
			{
				id: "copy-path",
				label: RUNTIME_STUDIO.copyPath,
				run: () => commands.copyPath(target.path),
			},
			{
				id: "delete",
				label: RUNTIME_STUDIO.remove,
				/**
				 * `Delete` is a key that actually runs (the list handler in runtime-explorer.tsx), so it is
				 * listed. While it went undocumented, only people who had pressed it by accident knew it. For a
				 * deletion key that matters most: a listed key that does nothing costs far less than a hidden
				 * key that deletes files.
				 */
				shortcut: "Delete",
				destructive: true,
				separatorBefore: true,
				run: () => commands.requestDeleteFile(target.fileId, target.path),
			},
		];

	if (target.kind === "folder")
		return [
			{
				id: "new-file",
				label: RUNTIME_STUDIO.newFile,
				run: () => commands.startCreateFile(target.path),
			},
			{
				id: "new-folder",
				label: RUNTIME_STUDIO.newFolder,
				run: () => commands.startCreateFolder(target.path),
			},
			{
				id: "copy-path",
				label: RUNTIME_STUDIO.copyPath,
				separatorBefore: true,
				run: () => commands.copyPath(target.path),
			},
		];

	return [
		{
			id: "new-file",
			label: RUNTIME_STUDIO.newFile,
			run: () => commands.startCreateFile(""),
		},
		{
			id: "new-folder",
			label: RUNTIME_STUDIO.newFolder,
			run: () => commands.startCreateFolder(""),
		},
		{
			id: "collapse-all",
			label: RUNTIME_STUDIO.collapseAll,
			separatorBefore: true,
			run: () => commands.collapseAll(),
		},
	];
}
