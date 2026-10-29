import { CHAT_MARKDOWN_FIXTURE } from "@rowcat/markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./markdown.tsx";

/**
 * Looks at the rendered result. This is rare among this repository's web tests.
 *
 * The rule is not to render React in tests (`vitest.config.ts`), because markup changes keep
 * breaking repository tests. That reason does not hold here: what this file checks is not layout
 * but **safety and meaning**, and those must hold however the classes change.
 *
 * A tree check cannot replace it. The shared package already verifies by value that folding turns
 * `<script>` into characters, but **whether those characters become markup again on the page** is
 * the renderer's question. One `dangerouslySetInnerHTML` or one `rehypePlugins` line would reverse
 * that fact while the tree stayed identical.
 *
 * It asserts no layout: no class names, order or spacing. It checks only whether this syntax became
 * this element, and whether this does not run.
 */

const html = (source: string): string =>
	renderToStaticMarkup(<ChatMarkdown content={source} />);

describe("HTML does not run", () => {
	/**
	 * **This is the check that guards the most expensive defect in this slice.** Text entering here is
	 * written by other people (works) and by the model (responses). The moment one of them becomes a
	 * script on our page, every other boundary in this product loses its meaning.
	 */
	it("a script tag does not become markup", () => {
		const out = html("<script>alert(1)</script>");
		expect(out).not.toContain("<script");
		/* Nothing is removed: the author's characters remain, escaped. */
		expect(out).toContain("&lt;script&gt;");
	});

	it("a tag with an event handler does not become markup either", () => {
		const out = html("<img src=x onerror=alert(1)>");
		expect(out).not.toMatch(/<img[^>]*onerror/);
		expect(out).toContain("&lt;img");
	});

	it("an iframe does not become markup either", () => {
		const out = html('<iframe src="https://evil.example"></iframe>');
		expect(out).not.toContain("<iframe");
		expect(out).toContain("&lt;iframe");
	});

	it("an executable scheme does not become a clickable link", () => {
		for (const url of [
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
		]) {
			const out = html(`[Click me](${url})`);
			expect(out, url).not.toContain("<a ");
			expect(out, url).not.toContain("javascript:");
			expect(out, url).not.toContain("vbscript:");
			/* Only the link is stripped; the author's text remains. */
			expect(out, url).toContain("Click me");
		}
	});

	it("a dangerous image source makes no request", () => {
		const out = html("![picture](javascript:alert(1))");
		expect(out).not.toContain("<img");
		expect(out).toContain("picture");
	});
});

describe("syntax becomes elements", () => {
	const out = html(CHAT_MARKDOWN_FIXTURE);

	/**
	 * One fixture generates the whole vocabulary (a test in the shared package), so this list is the
	 * web side of parity. Mobile carries the same manuscript into native views with the same meaning.
	 */
	it("every kind in the vocabulary arrives as its own element", () => {
		for (const tag of [
			"<h1",
			"<h2",
			"<p",
			"<strong",
			"<em",
			"<del",
			"<code",
			"<pre",
			"<blockquote",
			"<ul",
			"<ol",
			"<li",
			"<table",
			"<thead",
			"<tbody",
			"<tr",
			"<th",
			"<td",
			"<a ",
			"<img",
			"<br",
			"<hr",
			'type="checkbox"',
		])
			expect(out, tag).toContain(tag);
	});

	it("links open in a new tab and do not hand over this document", () => {
		expect(out).toMatch(/rel="nofollow noopener noreferrer"/);
		expect(out).toContain('href="https://example.com"');
	});

	it("draws external pictures, sends no referrer, and loads lazily", () => {
		expect(out).toMatch(/<img[^>]*src="https:\/\/example\.com\/cat\.png"/);
		expect(out).toMatch(/<img[^>]*referrerpolicy="no-referrer"/i);
		expect(out).toMatch(/<img[^>]*loading="lazy"/);
		/* The alt text is the author's value; removing it would make the image vanish for screen readers. */
		expect(out).toMatch(/<img[^>]*alt="[^"]+"/);
	});

	/** Even when the author does not say "insert a picture", an image address on its own line is a picture. */
	it("a bare image URL becomes a picture too", () => {
		expect(html("https://example.com/cat.png").match(/<img\b/g)).toHaveLength(
			1,
		);
	});

	/** An SVG is a document, not a picture. The rendering must not loosen that decision. */
	it("SVG is not drawn and folds to alt text", () => {
		const svg = html("![logo](https://example.com/logo.svg)");
		expect(svg).not.toContain("<img");
		/* An image that cannot be drawn has one answer: no pressable link is left behind (`altOnly`). */
		expect(svg).not.toContain("<a");
		expect(svg).toContain("logo");
	});

	it("a picture inside a link makes no nested anchor and keeps the outer destination", () => {
		const out = html(
			"[![cat](https://img.example/cat.png)](https://example.com/story)",
		);
		expect(out).not.toContain("<img");
		expect(out.match(/<a\b/g)).toHaveLength(1);
		expect(out).toContain('href="https://example.com/story"');
		expect(out).toContain("cat");
	});

	it("task list boxes cannot be pressed", () => {
		expect(out).toMatch(/<input[^>]*disabled/);
		expect(out).toMatch(/<input[^>]*checked/);
	});

	/** The start number is the author's value. Counting again from 1 would be us editing the text. */
	it("an ordered list keeps its start number", () => {
		expect(html("5. five\n6. six")).toContain('start="5"');
	});

	/** Dropping alignment would send a right-aligned number column back to the left. */
	it("table alignment survives", () => {
		expect(out).toMatch(/text-align:\s*right/);
	});

	/** Markdown inside code is text. Interpreting it would remove any way to show the code. */
	it("markdown inside code is not interpreted", () => {
		const out = html("```\n**bold** [link](https://example.com)\n```");
		expect(out).not.toContain("<strong");
		expect(out).not.toContain("<a ");
		expect(out).toContain("**bold**");
	});
});

describe("draws while streaming too", () => {
	/**
	 * During streaming the manuscript is almost always in the middle of some syntax. If the renderer
	 * threw in that state, the conversation screen could draw nothing until the response finished.
	 */
	it("does not throw on unfinished syntax", () => {
		for (const source of [
			"**",
			"**hel",
			"[foo](",
			"[link](https://exam",
			"![foo](",
			"![image](https://exam",
			"```ts",
			"```ts\nconst foo =",
			"| name | value",
			"<script",
		])
			expect(() => html(source), source).not.toThrow();
	});

	/** An unfinished image syntax is **not drawn as a broken picture.** */
	it("an unfinished image does not become a picture", () => {
		expect(html("![image](https://exam")).not.toContain("<img");
	});

	it("plain text stays a plain paragraph", () => {
		expect(html("hello")).toContain("hello");
		expect(html("hello")).not.toContain("<strong");
	});
});
