import { describe, expect, it } from "vitest";
import { shouldCloseDialog } from "./dismiss.ts";

/**
 * Why a dialog closes. The defect this test covers was real.
 *
 * A dialog opened from a menu item closed as soon as it opened. The pointer or focus moving outside
 * the dialog, which the menu does when it returns focus to its trigger, was read as the user trying
 * to close it. The timing varies, so the bug does not reproduce every time. The rule itself is
 * therefore pinned down with a test.
 */

describe("only an explicit choice closes the dialog", () => {
	it.each([
		"escape-key",
		"close-press",
		"trigger-press",
		"imperative-action",
	])("%s closes", (reason) => {
		expect(shouldCloseDialog(reason, false)).toBe(true);
	});

	it.each(["outside-press", "focus-out"])("%s does not close", (reason) => {
		expect(shouldCloseDialog(reason, false)).toBe(false);
	});
});

describe("does not close while pending", () => {
	/**
	 * Dismissal is blocked while a save or delete is running. If the dialog disappeared mid-operation,
	 * there would be nowhere to show the result or a failure message.
	 */
	it.each([
		"escape-key",
		"close-press",
		"outside-press",
	])("%s is ignored too", (reason) => {
		expect(shouldCloseDialog(reason, true)).toBe(false);
	});
});
