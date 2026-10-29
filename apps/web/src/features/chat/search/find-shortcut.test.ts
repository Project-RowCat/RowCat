import { describe, expect, it } from "vitest";
import { type FindShortcutEvent, isFindShortcut } from "./find-shortcut.ts";

const press = (
	key: string,
	modifiers: Partial<Omit<FindShortcutEvent, "key">> = {},
): FindShortcutEvent => ({
	key,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});

describe("Mac", () => {
	it("Cmd+F opens it", () => {
		expect(isFindShortcut(press("f", { metaKey: true }), true)).toBe(true);
	});

	/** On macOS Ctrl+F moves the caret in text fields; taking it would remove an editing key. */
	it("Ctrl+F is left alone", () => {
		expect(isFindShortcut(press("f", { ctrlKey: true }), true)).toBe(false);
	});
});

describe("other devices", () => {
	it("Ctrl+F opens it", () => {
		expect(isFindShortcut(press("f", { ctrlKey: true }), false)).toBe(true);
	});

	it("Cmd (Meta)+F is left alone", () => {
		expect(isFindShortcut(press("f", { metaKey: true }), false)).toBe(false);
	});
});

describe("combinations not accepted", () => {
	it.each([
		["f without a modifier", press("f"), true],
		["with Shift", press("f", { metaKey: true, shiftKey: true }), true],
		["with Alt", press("f", { ctrlKey: true, altKey: true }), false],
		["another letter", press("g", { metaKey: true }), true],
		[
			"two modifiers together",
			press("f", { metaKey: true, ctrlKey: true }),
			true,
		],
	])("%s", (_label, event, mac) => {
		expect(isFindShortcut(event, mac)).toBe(false);
	});
});

describe("capital F", () => {
	it("reads the same with CapsLock on", () => {
		expect(isFindShortcut(press("F", { ctrlKey: true }), false)).toBe(true);
	});
});
