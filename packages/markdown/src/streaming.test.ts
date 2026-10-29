import type { Node, Parent } from "mdast";
import { describe, expect, it } from "vitest";
import { CHAT_MARKDOWN_FIXTURE } from "./fixture.ts";
import { parseChatMarkdown } from "./parse.ts";

/**
 * Text while streaming: an unfinished construct must not block rendering.
 *
 * Streaming is the worst input for markdown. While a response arrives, the text is almost always
 * mid-syntax (`**hel`, `[link](https://exam`), and that is the normal state of every frame, not an
 * exception. If the parser throws there, the chat screen cannot draw anything until the response
 * ends. CommonMark already guarantees this (an unfinished delimiter is literal text). This test
 * checks that the folding added on top has not broken that property.
 */

const walk = (node: Node, into: Node[] = []): Node[] => {
	into.push(node);
	for (const child of (node as Parent).children ?? []) walk(child, into);
	return into;
};

const INCOMPLETE = [
	"**",
	"**hel",
	"*ital",
	"~~struck",
	"`code",
	"[foo](",
	"[foo](https://",
	"[link](https://exam",
	"![foo](",
	"![image](https://exam",
	"```ts",
	"```ts\nconst foo =",
	"| name | value",
	"| name | value |\n| ---",
	"> quote",
	"- [ ",
	"#",
	"<script",
	"<script>alert(1)",
	"&am",
	"\\",
];

describe("unfinished syntax", () => {
	it("throws on no fragment", () => {
		for (const source of INCOMPLETE)
			expect(() => parseChatMarkdown(source), source).not.toThrow();
	});

	/**
	 * Walks the manuscript one character longer at a time over the full range. Streaming produces
	 * exactly these inputs, and a defect that fails on a single prefix would stay hidden until that
	 * sentence arrived.
	 */
	it("throws on no prefix of the fixture", () => {
		for (let end = 0; end <= CHAT_MARKDOWN_FIXTURE.length; end += 1) {
			const prefix = CHAT_MARKDOWN_FIXTURE.slice(0, end);
			expect(() => parseChatMarkdown(prefix), `prefix ${end}`).not.toThrow();
		}
	});

	/**
	 * Unfinished image syntax is not drawn as a broken image. The guarantee is that the parser does
	 * not read it as an image, so the renderer needs no conditions of its own. Now that images are
	 * drawn, this matters: requests for every frame while a URL was half-arrived would turn one
	 * response into dozens of 404s.
	 */
	it("an unfinished image is not an image", () => {
		for (const source of ["![foo](", "![image](https://exam", "![a](https://"])
			expect(
				walk(parseChatMarkdown(source)).some((node) => node.type === "image"),
				source,
			).toBe(false);
	});

	it("an unfinished link is not a link", () => {
		expect(
			walk(parseChatMarkdown("[foo](https://")).some(
				(node) => node.type === "link",
			),
		).toBe(false);
	});

	/**
	 * A structure exists only at the moment its syntax closes. Until then the text is plain, so a
	 * flowing response never flashes a broken image that appears and disappears.
	 */
	it("closed syntax becomes structure", () => {
		const types = (source: string) =>
			new Set(walk(parseChatMarkdown(source)).map((node) => node.type));
		expect(types("**bold").has("strong")).toBe(false);
		expect(types("**bold**").has("strong")).toBe(true);
		expect(types("![cat](https://example.com/cat.png").has("image")).toBe(
			false,
		);
		expect(types("![cat](https://example.com/cat.png)").has("image")).toBe(
			true,
		);
	});

	/** Text inside an unclosed code fence is code, not parsed as markdown. */
	it("an unclosed code fence is still code", () => {
		const tree = parseChatMarkdown("```ts\nconst foo =");
		const code = walk(tree).find((node) => node.type === "code") as
			| { value: string }
			| undefined;
		expect(code?.value).toBe("const foo =");
	});
});
