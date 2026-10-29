import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	CHAT_MARKDOWN_FIXTURE,
	CHAT_MARKDOWN_NODE_TYPES,
	collectNodeTypes,
	parseChatMarkdown,
} from "@rowcat/markdown";
import { describe, expect, it } from "vitest";

/**
 * Checks that the mobile renderer covers the whole shared markdown vocabulary (third leg of parity;
 * the first is in `@rowcat/markdown`, the second in the web's `chat-markdown.test.ts`).
 *
 * It scans source because this app's tests do not boot React Native (`vitest.config.ts`); importing
 * the component would mean faking native modules, and code passed by a fake first breaks on device.
 * The first defence is the type: the renderer table is `Record<ChatMarkdownNodeType, …>`. This test
 * exists because that table could be loosened with a `Partial` or `as`, which looks like an
 * ordinary line in review.
 */

const source = readFileSync(
	fileURLToPath(new URL("./markdown-view.tsx", import.meta.url)),
	"utf8",
);

/** Keys actually written in the `RENDERERS` block. */
const declared = (): Set<string> => {
	const body = /const RENDERERS: Renderers = \{([\s\S]*?)\n\};/.exec(
		source,
	)?.[1];
	expect(body, "couldn't find the RENDERERS table").toBeDefined();
	const keys = new Set<string>();
	for (const [, key] of (body ?? "").matchAll(/^\t([A-Za-z]+): \(/gm))
		keys.add(key);
	return keys;
};

describe("the mobile renderer covers the shared vocabulary", () => {
	const keys = declared();

	it("actually read the table", () => {
		expect(keys.size).toBe(CHAT_MARKDOWN_NODE_TYPES.length);
	});

	it("every node kind has a renderer", () => {
		for (const type of CHAT_MARKDOWN_NODE_TYPES)
			expect(keys, `no place draws ${type}`).toContain(type);
	});

	/** A renderer outside the vocabulary is dead: folded trees never contain that kind. */
	it("no renderers outside the vocabulary", () => {
		for (const key of keys)
			expect(CHAT_MARKDOWN_NODE_TYPES as readonly string[], key).toContain(key);
	});

	it("draws every kind the fixture produces", () => {
		for (const type of collectNodeTypes(
			parseChatMarkdown(CHAT_MARKDOWN_FIXTURE),
		))
			expect(keys, type).toContain(type);
	});

	/** `Partial<Renderers>` or `as Renderers` would let a missing kind compile and vanish silently. */
	it("the table is a complete Record", () => {
		expect(source).toMatch(/type Renderers = \{ \[T in ChatMarkdownNodeType\]/);
		expect(source).toMatch(/const RENDERERS: Renderers = \{/);
		expect(source).not.toMatch(/Partial<Renderers>/);
	});
});

/**
 * Scans after stripping comments: comments here name forbidden words while explaining the boundary,
 * and scanning raw text would flag the explanation (same as `lib/boundaries.test.ts`).
 */
const stripped = source
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("doesn't rewrite the rules here", () => {
	/** Syntax, safety and normalization belong to the shared package; a local parser or scheme list lets one platform loosen alone. */
	it("takes the parser and URL policy from the shared package", () => {
		expect(stripped).toMatch(/from "@rowcat\/markdown"/);
		expect(stripped).toMatch(/parseChatMarkdown/);
		expect(stripped).toMatch(/safeLinkUrl/);
		expect(stripped).not.toMatch(/remark-|micromark|mdast-util/);
	});

	/** Even though images are drawn, the URL policy stays in the shared package. */
	it("doesn't redecide here what loads as an image", () => {
		expect(stripped).toMatch(/safeImageUrl/);
		expect(stripped).not.toMatch(/\.svg|looksLikeImageUrl|isRefusedImageUrl/);
	});

	/** Regex-based syntax reading here would be a second parser. */
	it("doesn't read syntax with regexes", () => {
		expect(stripped).not.toMatch(/\\\*\\\*/);
		expect(stripped).not.toMatch(/#\{1,6\}/);
	});
});
