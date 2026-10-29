import { describe, expect, it, vi } from "vitest";
import {
	isRuntimeTabCloseClick,
	type RuntimeTabCommands,
	runtimeTabMenu,
} from "./tab-commands.ts";

/**
 * Pins the tab menu's vocabulary as values: what is present and what is absent. The absence of `Delete`
 * (delete) matters most. Closing a tab can be undone by reopening it; deleting a file cannot.
 * Placing both in one menu would reduce that difference to a line of spacing.
 */

const stub = (): RuntimeTabCommands => ({
	close: vi.fn(),
	closeOthers: vi.fn(),
	closeAll: vi.fn(),
	revealInExplorer: vi.fn(),
	copyPath: vi.fn(),
});

const target = { fileId: "a", path: "src/main.tsx" };

describe("items", () => {
	it("there are five, in a fixed order", () => {
		expect(runtimeTabMenu(target, 2, stub()).map((item) => item.id)).toEqual([
			"close",
			"close-others",
			"close-all",
			"reveal",
			"copy-path",
		]);
	});

	it("there is no item that deletes the file", () => {
		const ids = runtimeTabMenu(target, 2, stub()).map((item) => item.id);
		expect(ids).not.toContain("delete");
		expect(ids).not.toContain("rename");
	});

	/**
	 * The separator marks the boundary between cleanup actions (close) and navigation actions (reveal,
	 * copy).
	 */
	it("a separator stands before reveal and copy", () => {
		const items = runtimeTabMenu(target, 2, stub());
		expect(items.find((item) => item.id === "reveal")?.separatorBefore).toBe(
			true,
		);
	});
});

describe("close others", () => {
	it("nothing to do with only one tab", () => {
		const items = runtimeTabMenu(target, 1, stub());
		expect(items.find((item) => item.id === "close-others")?.disabled).toBe(
			true,
		);
	});

	it("enabled with two or more", () => {
		const items = runtimeTabMenu(target, 2, stub());
		expect(
			items.find((item) => item.id === "close-others")?.disabled,
		).toBeFalsy();
	});

	/**
	 * Close stays enabled even when only one tab is open. Being the last tab is not a reason to block
	 * closing.
	 */
	it("close works even with one tab", () => {
		const items = runtimeTabMenu(target, 1, stub());
		expect(items.find((item) => item.id === "close")?.disabled).toBeFalsy();
	});
});

describe("what it calls", () => {
	it("path items pass the full path", () => {
		const commands = stub();
		const items = runtimeTabMenu(target, 2, commands);
		items.find((item) => item.id === "copy-path")?.run();
		items.find((item) => item.id === "reveal")?.run();
		expect(commands.copyPath).toHaveBeenCalledWith("src/main.tsx");
		expect(commands.revealInExplorer).toHaveBeenCalledWith("a", "src/main.tsx");
	});

	it("close items point at this tab", () => {
		const commands = stub();
		const items = runtimeTabMenu(target, 2, commands);
		items.find((item) => item.id === "close")?.run();
		items.find((item) => item.id === "close-others")?.run();
		expect(commands.close).toHaveBeenCalledWith("a");
		expect(commands.closeOthers).toHaveBeenCalledWith("a");
	});
});

/**
 * The middle button is checked with `button === 1`, not `buttons`. The two count the same buttons
 * differently (`button`: 0, 1, 2; `buttons` bitmask: 1, 4, 2). Mixing them makes a right click
 * close the tab, which looks like the context menu failing to open.
 */
describe("middle click", () => {
	it("only the middle button closes", () => {
		expect(isRuntimeTabCloseClick(1)).toBe(true);
	});

	it("the primary and right buttons don't close", () => {
		expect(isRuntimeTabCloseClick(0)).toBe(false);
		expect(isRuntimeTabCloseClick(2)).toBe(false);
	});

	/**
	 * Mice with back and forward buttons also fire `auxclick`. Presses of buttons 3 and 4, and of any
	 * unknown value, must not close a tab.
	 */
	it("unknown buttons don't close", () => {
		for (const button of [3, 4, -1])
			expect(isRuntimeTabCloseClick(button)).toBe(false);
	});
});
