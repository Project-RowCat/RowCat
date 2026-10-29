/**
 * @vitest-environment jsdom
 *
 * The dismissal flag lives in `localStorage`, the same storage as the pane width. Only checking
 * against real storage tests this layer: a fake would never throw in private mode, where real
 * storage does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { runtimeShortcutLabel } from "./commands/use-shortcuts.ts";
import {
	dismissRuntimeOnboarding,
	runtimeOnboardingDismissed,
	showsRuntimeOnboarding,
} from "./runtime-onboarding.ts";

/**
 * When the onboarding line appears and when it stays hidden. Both directions matter. If it never
 * appears, a user who picked a template faces the real code workspace with no next step. If it
 * reappears after being closed, it becomes a line people dismiss without reading.
 */

afterEach(() => {
	window.localStorage.clear();
});

describe("memory", () => {
	it("starts not dismissed", () => {
		expect(runtimeOnboardingDismissed()).toBe(false);
	});

	it("stays dismissed the next time once dismissed", () => {
		dismissRuntimeOnboarding();
		expect(runtimeOnboardingDismissed()).toBe(true);
	});

	/**
	 * Anything other than "1" in storage shows the line. The value may come from an older version or
	 * from a hand edit in devtools, and showing it once more is cheaper than hiding it (the pane-width
	 * parser makes the same call).
	 */
	it("an unknown value folds toward showing", () => {
		window.localStorage.setItem("rowcat.runtime.onboarded", "true");
		expect(runtimeOnboardingDismissed()).toBe(false);
	});
});

describe("when to draw", () => {
	it("appears only after files arrive", () => {
		expect(showsRuntimeOnboarding({ dismissed: false, fileCount: 0 })).toBe(
			false,
		);
		expect(showsRuntimeOnboarding({ dismissed: false, fileCount: 1 })).toBe(
			true,
		);
	});

	it("once dismissed it doesn't appear even with files", () => {
		expect(showsRuntimeOnboarding({ dismissed: true, fileCount: 3 })).toBe(
			false,
		);
	});
});

describe("shortcut names", () => {
	/**
	 * Only single-character keys are uppercased. Uppercasing `Enter` gives `⌘ENTER`, which is not
	 * printed on any keyboard.
	 */
	it("multi-character keys are not uppercased", () => {
		expect(runtimeShortcutLabel("Enter")).toMatch(/Enter$/);
		expect(runtimeShortcutLabel("Enter")).not.toMatch(/ENTER/);
	});

	it("single-character keys are uppercase", () => {
		expect(runtimeShortcutLabel("p")).toMatch(/P$/);
	});

	/** `Shift` belongs only to the command palette. Its label must differ from quick open's. */
	it("the Shift variant is a different character from the base", () => {
		expect(runtimeShortcutLabel("p", { shift: true })).not.toBe(
			runtimeShortcutLabel("p"),
		);
	});
});
