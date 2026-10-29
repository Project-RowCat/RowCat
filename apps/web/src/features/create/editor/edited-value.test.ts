import { describe, expect, it } from "vitest";
import {
	type EditedValue,
	reconcileEditedValue,
	startEditingValue,
} from "./edited-value.ts";

/**
 * The rule protects one thing: text the user typed must not disappear when an autosave arrives.
 * Saves land 500ms later, and in the meantime the screen moves ahead.
 */
describe("reconcileEditedValue", () => {
	const settled = (value: string): EditedValue<string> => ({
		value,
		pending: null,
	});

	it("without an edit it accepts the record as is", () => {
		// Covers changes arriving from another tab or from sync.
		expect(reconcileEditedValue(settled("The"), "The Night Library")).toEqual({
			value: "The Night Library",
			pending: null,
		});
	});

	it("returns the same state when nothing changes", () => {
		// The caller only compares identity and skips setState during render, so an unchanged state must
		// be returned as the same object.
		const state = settled("The");
		expect(reconcileEditedValue(state, "The")).toBe(state);
	});

	it("ignores an old snapshot that arrives while a save is pending", () => {
		// The user kept typing while a save was pending, so the record is still two characters behind.
		const state = startEditingValue("The Night Library");
		expect(reconcileEditedValue(state, "The Night Lib")).toBe(state);
	});

	it("listens to the record again once the sent value comes back", () => {
		const typed = startEditingValue("The Night Library");
		const caughtUp = reconcileEditedValue(typed, "The Night Library");
		expect(caughtUp).toEqual({ value: "The Night Library", pending: null });

		// External changes after the catch-up apply to the screen immediately.
		expect(reconcileEditedValue(caughtUp, "The Day Library")).toEqual({
			value: "The Day Library",
			pending: null,
		});
	});

	it("the screen wins even when an intermediate save comes back", () => {
		/**
		 * The flush on collapse writes the value at that moment. Its echo is not the last typed value, so
		 * accepting it would wipe out characters typed after it.
		 */
		let state = startEditingValue("The");
		state = reconcileEditedValue(state, "The");
		state = startEditingValue("The Night Library");
		expect(reconcileEditedValue(state, "The Night").value).toBe(
			"The Night Library",
		);
	});

	it("takes a comparison function, so arrays compare by value", () => {
		const same = (a: string[], b: string[]) =>
			a.length === b.length && a.every((item, index) => item === b[index]);
		const state: EditedValue<string[]> = { value: ["The"], pending: ["The"] };
		// A different array instance with the same contents must still count as caught up.
		expect(reconcileEditedValue(state, ["The"], same)).toEqual({
			value: ["The"],
			pending: null,
		});
	});
});
