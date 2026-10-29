import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks the **wiring** of choosing a role before starting: the things types cannot catch.
 *
 * The rule itself is run by value in `start-story-chat.test.ts` (the chosen value is pinned in the
 * same transaction as the room). This checks **whether the dialog creates a room** and **when it
 * opens**. Breaking either still compiles, and the failure appears as an empty room in the user's
 * conversation list that they never created.
 */

const read = (path: string): string =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

const dialog = read("./story-persona-dialog.tsx");
const hook = read("./use-story-start.tsx");

describe("the picker dialog doesn't create a room", () => {
	/**
	 * Opening and starting are different acts, and that is the whole of this dialog. Cancelling leaves
	 * no room and no navigation. If merely opening the picker created an empty room in the
	 * conversation list, the user would inherit the job of clearing a conversation they never made.
	 */
	it("the dialog touches neither the store nor the start function", () => {
		for (const forbidden of [
			/\bcreateRoom\b/,
			/\bstartStoryChat\b/,
			/\bensureStore\b/,
			/\bstories\.play\b/,
		])
			expect(dialog, `${forbidden}`).not.toMatch(forbidden);
	});

	/** The chosen value is **passed out** through the callback, not applied in place. */
	it("passes the chosen value through a callback", () => {
		expect(dialog).toContain("onStart(selected)");
		expect(dialog).not.toMatch(/\bsetRoomPersona\b/);
	});
});

describe("the dialog opens only when there's something to choose", () => {
	/**
	 * With an empty library this starts immediately, exactly as before this feature existed: a dialog
	 * with only one thing to choose adds a step and asks nothing (web made the same call).
	 */
	it("an empty library starts right away", () => {
		expect(hook).toMatch(
			/if \(personas\.length === 0\)\s*\{\s*await run\(null\);/,
		);
	});

	/** The chosen value really goes into the start function; it is not attached after the room is created. */
	it("the chosen value rides in the start arguments", () => {
		expect(hook).toMatch(/startStoryChat\(\{[\s\S]*?\bpersona,[\s\S]*?\}\)/);
	});

	/** The dialog's lifetime belongs to the hook; if the screen opened it from its own state, the decision would split in two. */
	it("the hook exports the dialog", () => {
		expect(hook).toContain("<StoryPersonaDialog");
		const control = read("./story-start-control.tsx");
		expect(control).toContain("{start.dialog}");
		expect(control).not.toContain("StoryPersonaDialog");
	});
});
