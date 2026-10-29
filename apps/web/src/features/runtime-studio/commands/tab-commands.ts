import { RUNTIME_STUDIO } from "../runtime-copy.ts";

/**
 * Defines the actions available on one open tab. The definition is single, but it is drawn in two
 * places:
 * - Right-click context menu on the tab (desktop).
 * - Overflow button at the end of the tab strip (coarse pointers and keyboard). Not merged with
 *   the explorer's menu. That menu acts on file contents (create, rename, delete). Merging would
 *   add Delete here, and deleting a file cannot be undone the way closing a tab can. One overflow
 *   button for the whole strip, not one per tab. Per-tab buttons would double the width of a strip
 *   that already scrolls horizontally. Deliberately absent: pin, drag reorder, duplicate, split
 *   editor, move file. The first three add nothing to the two questions the strip answers (what is
 *   open, what is viewed). The last two change the screen structure and need their own decision.
 */

/**
 * Middle click closes the tab; it never opens one. The check uses `MouseEvent.button` (middle = 1),
 * not the `buttons` bitmask (middle = 4), because mixing them makes a right click close the tab.
 * This borrows one browser convention without mimicking browser tabs: pin and drag reorder stay
 * absent.
 */
export const isRuntimeTabCloseClick = (button: number): boolean => button === 1;

export interface RuntimeTabCommands {
	close: (fileId: string) => void;
	closeOthers: (fileId: string) => void;
	closeAll: () => void;
	/** Expands and selects this file in the explorer. The editor is left untouched. */
	revealInExplorer: (fileId: string, path: string) => void;
	copyPath: (path: string) => void;
}

export const RUNTIME_TAB_COMMAND_IDS = [
	"close",
	"close-others",
	"close-all",
	"reveal",
	"copy-path",
] as const;
export type RuntimeTabCommandId = (typeof RUNTIME_TAB_COMMAND_IDS)[number];

export interface RuntimeTabMenuItem {
	id: RuntimeTabCommandId;
	label: string;
	/** Draws a separator before this item. It marks a group boundary, not a property of the item. */
	separatorBefore?: boolean;
	/**
	 * Whether the item can be pressed now. `Close` (close) is always enabled, even with one tab open.
	 * `Close others` (close others) is disabled when only one tab is open, because it would do nothing.
	 * Drawing it disabled is better than a press that does nothing.
	 */
	disabled?: boolean;
	run: () => void;
}

/**
 * A pure function, so tests can check the item list as data, including that `Delete` (delete) is
 * absent. See the file header.
 */
export function runtimeTabMenu(
	target: { fileId: string; path: string },
	/** Number of open tabs. Decides whether `Close others` (close others) has anything to do. */
	openCount: number,
	commands: RuntimeTabCommands,
): RuntimeTabMenuItem[] {
	return [
		{
			id: "close",
			label: RUNTIME_STUDIO.closeTab,
			run: () => commands.close(target.fileId),
		},
		{
			id: "close-others",
			label: RUNTIME_STUDIO.closeOtherTabs,
			disabled: openCount < 2,
			run: () => commands.closeOthers(target.fileId),
		},
		{
			id: "close-all",
			label: RUNTIME_STUDIO.closeAllTabs,
			run: () => commands.closeAll(),
		},
		{
			id: "reveal",
			label: RUNTIME_STUDIO.revealInExplorer,
			separatorBefore: true,
			run: () => commands.revealInExplorer(target.fileId, target.path),
		},
		{
			id: "copy-path",
			label: RUNTIME_STUDIO.copyPath,
			run: () => commands.copyPath(target.path),
		},
	];
}
