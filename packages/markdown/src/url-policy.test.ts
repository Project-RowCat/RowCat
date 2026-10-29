import { describe, expect, it } from "vitest";
import {
	markdownUrlTransform,
	safeImageUrl,
	safeLinkUrl,
	schemeOf,
} from "./url-policy.ts";

describe("only safe schemes pass", () => {
	it("links are http, https and mailto", () => {
		expect(safeLinkUrl("https://example.com")).toBe("https://example.com");
		expect(safeLinkUrl("http://example.com")).toBe("http://example.com");
		expect(safeLinkUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
	});

	/**
	 * This list is why this file exists. The parser reads all three as valid destinations. A
	 * syntactically valid link and a URL that is safe to follow are different things.
	 */
	it("executable schemes do not become links", () => {
		for (const url of [
			"javascript:alert(1)",
			"JavaScript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"data:image/png;base64,AAAA",
			"vbscript:msgbox(1)",
			"file:///etc/passwd",
			"blob:https://example.com/x",
		])
			expect(safeLinkUrl(url), url).toBeNull();
	});

	/**
	 * Browsers read the scheme from a URL attribute value after removing tabs and newlines. If we do
	 * not remove them, this string looks like a scheme-less relative path but becomes a script in a
	 * browser.
	 */
	it("tabs and newlines cannot hide a scheme", () => {
		expect(safeLinkUrl("java\tscript:alert(1)")).toBeNull();
		expect(safeLinkUrl("java\nscript:alert(1)")).toBeNull();
		expect(safeLinkUrl("  javascript:alert(1)  ")).toBeNull();
		expect(schemeOf("java\tscript:alert(1)")).toBe("javascript:");
	});

	/**
	 * A percent-encoded scheme is not a scheme. It falls through as a relative path and is rejected.
	 */
	it("encoded schemes do not pass either", () => {
		expect(safeLinkUrl("java%73cript:alert(1)")).toBeNull();
	});

	/**
	 * The author of conversation text is not RowCat. A third party's text that makes our screen look
	 * like its own sentence is a lure, not a link.
	 */
	it("relative paths and internal anchors do not become links", () => {
		expect(safeLinkUrl("/account")).toBeNull();
		expect(safeLinkUrl("../secret")).toBeNull();
		expect(safeLinkUrl("#section")).toBeNull();
	});

	/**
	 * The image list is deliberately narrower. `data:image/png` looks harmless, but the same syntax
	 * can express `data:image/svg+xml`, which is a document, not an image.
	 */
	it("images are http and https only", () => {
		expect(safeImageUrl("https://example.com/cat.png")).toBe(
			"https://example.com/cat.png",
		);
		expect(safeImageUrl("mailto:hi@example.com")).toBeNull();
		expect(safeImageUrl("data:image/png;base64,AAAA")).toBeNull();
	});

	/**
	 * Absent and empty are different values. Returning an empty string would let the caller render
	 * `href=""`, a link to the current page.
	 */
	it("a refusal is null, not an empty string", () => {
		expect(safeLinkUrl("javascript:alert(1)")).toBeNull();
		/*
		 * Only the renderer's hook (`urlTransform`) returns an empty string, per that library's contract.
		 */
		expect(markdownUrlTransform("javascript:alert(1)", "href")).toBe("");
		expect(markdownUrlTransform("https://example.com", "href")).toBe(
			"https://example.com",
		);
	});

	/** The `href` and `src` lists differ. Ignoring the attribute would loosen the image side. */
	it("each attribute uses its own list", () => {
		expect(markdownUrlTransform("mailto:hi@example.com", "href")).toBe(
			"mailto:hi@example.com",
		);
		expect(markdownUrlTransform("mailto:hi@example.com", "src")).toBe("");
	});
});
