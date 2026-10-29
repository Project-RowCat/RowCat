import { describe, expect, test } from "vitest";
import { ownedDocumentUrlTransform } from "./owned-markdown-url.ts";

/**
 * Address policy for documents the repo owns. Two directions are locked.
 *
 * First, internal destinations work. If they stop working, every link in the body silently reloads
 * the current page, with no error. Second, the widening covers internal destinations only. If
 * anything the shared policy blocks passes here, the fact that the repo owns the article becomes
 * the reason to allow schemes.
 */

describe("internal destinations pass", () => {
	test.each([
		"/docs/runtime",
		"/docs/runtime/concepts/state",
		"/docs/runtime/concepts/state#마이그레이션",
		"/account-deletion",
		"/settings/ai",
		"#section",
	])("%s", (href) => {
		expect(ownedDocumentUrlTransform(href, "href")).toBe(href);
	});

	test("trims addresses the way the browser does", () => {
		expect(ownedDocumentUrlTransform(" /docs/runtime ", "href")).toBe(
			"/docs/runtime",
		);
	});
});

describe("only internal destinations were widened", () => {
	test.each([
		["javascript:alert(1)", "the scheme is dangerous"],
		[
			"java\tscript:alert(1)",
			"hides the scheme with characters the browser strips",
		],
		["data:text/html,<script>", "an address carrying a document as an image"],
		["//example.com/docs/runtime", "a protocol-relative address is external"],
		["../runtime", "a relative path"],
		["#", "points at no section"],
	])("%s is stripped — %s", (href) => {
		expect(ownedDocumentUrlTransform(href, "href")).toBe("");
	});

	test("external addresses get exactly the same answer", () => {
		expect(ownedDocumentUrlTransform("https://example.com", "href")).toBe(
			"https://example.com",
		);
		expect(ownedDocumentUrlTransform("mailto:hi@example.com", "href")).toBe(
			"mailto:hi@example.com",
		);
	});

	/**
	 * Images do not pass this gate. The src scheme list is narrower than the link list (mailto: is a
	 * link, not an image), and a document's image never points to an internal path. src stays on the
	 * shared policy.
	 */
	test("src follows the shared policy as is", () => {
		expect(ownedDocumentUrlTransform("/docs/a.png", "src")).toBe("");
		expect(ownedDocumentUrlTransform("#section", "src")).toBe("");
		expect(ownedDocumentUrlTransform("mailto:hi@example.com", "src")).toBe("");
		expect(ownedDocumentUrlTransform("https://example.com/a.png", "src")).toBe(
			"https://example.com/a.png",
		);
	});
});
