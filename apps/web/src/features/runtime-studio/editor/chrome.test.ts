/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { cssColorToHex, readRuntimeEditorChrome } from "./chrome.ts";
import { RUNTIME_CHROME_DARK, RUNTIME_CHROME_LIGHT } from "./monaco-theme.ts";

/**
 * Reading the surface must never stop the editor from mounting. The question this layer answers is
 * one thing: what is the app's background color. That answer can be missing in some environments
 * (tests, browsers without canvas, a first frame before tokens are applied). Falling back to the
 * default surface and failing to open the editor carry very different weight.
 */
describe("editor surface", () => {
	it("without an element it is that appearance's default", () => {
		expect(readRuntimeEditorChrome(null, false)).toEqual(RUNTIME_CHROME_LIGHT);
		expect(readRuntimeEditorChrome(null, true)).toEqual(RUNTIME_CHROME_DARK);
	});

	it("hex tokens read even without a converter", () => {
		expect(cssColorToHex("#101014")).toBe("#101014");
		expect(cssColorToHex("  #ABCDEF ")).toBe("#abcdef");
		expect(cssColorToHex("")).toBeNull();
	});

	/**
	 * This environment has no canvas, so `oklch()` cannot be read and collapses to the defaults. That
	 * silence is the point: it is a value, not an exception.
	 */
	it("an unreadable color does not displace the default", () => {
		const element = document.createElement("div");
		element.style.setProperty("--card", "oklch(0.141 0.005 285.823)");
		document.body.append(element);

		const chrome = readRuntimeEditorChrome(element, true);
		expect(chrome.background).toBe(RUNTIME_CHROME_DARK.background);
		element.remove();
	});

	it("only colors that were read go on top of the default", () => {
		const element = document.createElement("div");
		element.style.setProperty("--card", "#101014");
		document.body.append(element);

		const chrome = readRuntimeEditorChrome(element, true);
		expect(chrome.background).toBe("#101014");
		/** The rest stays as it is. Reading one color does not fabricate the whole table. */
		expect(chrome.border).toBe(RUNTIME_CHROME_DARK.border);
		element.remove();
	});
});
