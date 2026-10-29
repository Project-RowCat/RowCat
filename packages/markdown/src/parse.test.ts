import type { Node, Parent, Root } from "mdast";
import { describe, expect, it } from "vitest";
import { parseChatMarkdown } from "./parse.ts";

/**
 * Pipeline behavior, checked on the tree rather than rendered pixels, for two reasons. This repo's
 * tests do not render React (apps/web/vitest.config.ts), and the tree is the common contract of
 * both platforms: what is true here is true on web and mobile.
 */

const walk = (node: Node, into: Node[] = []): Node[] => {
	into.push(node);
	for (const child of (node as Parent).children ?? []) walk(child, into);
	return into;
};

const nodesOf = (source: string, type: string): Node[] =>
	walk(parseChatMarkdown(source)).filter((node) => node.type === type);

const textOf = (node: Node): string =>
	walk(node)
		.filter((n) => n.type === "text" || n.type === "inlineCode")
		.map((n) => (n as unknown as { value: string }).value)
		.join("");

const first = <T>(source: string, type: string): T => {
	const found = nodesOf(source, type)[0];
	expect(found, `no ${type} node: ${source}`).toBeDefined();
	return found as unknown as T;
};

const parse = (source: string): Root => parseChatMarkdown(source);

describe("block syntax", () => {
	it("splits paragraphs", () => {
		expect(
			nodesOf("First paragraph.\n\nSecond paragraph.", "paragraph"),
		).toHaveLength(2);
	});

	it("reads six levels of ATX headings", () => {
		for (let depth = 1; depth <= 6; depth += 1) {
			const heading = first<{ depth: number }>(
				`${"#".repeat(depth)} Heading`,
				"heading",
			);
			expect(heading.depth).toBe(depth);
		}
	});

	it("reads Setext headings", () => {
		expect(first<{ depth: number }>("Heading\n===", "heading").depth).toBe(1);
		expect(first<{ depth: number }>("Heading\n---", "heading").depth).toBe(2);
	});

	it("reads nested quotes", () => {
		const tree = parse("> outer\n>\n>> inner");
		expect(nodesOf("> outer\n>\n>> inner", "blockquote")).toHaveLength(2);
		expect(textOf(tree)).toContain("inner");
	});

	it("reads all three unordered markers", () => {
		for (const marker of ["-", "*", "+"]) {
			const list = first<{ ordered: boolean; children: unknown[] }>(
				`${marker} one\n${marker} two`,
				"list",
			);
			expect(list.ordered, marker).toBe(false);
			expect(list.children, marker).toHaveLength(2);
		}
	});

	/** The start number is the author's value. Resetting it to 1 changes the list's meaning. */
	it("keeps an ordered list's start number", () => {
		const list = first<{ ordered: boolean; start: number }>(
			"5. five\n6. six",
			"list",
		);
		expect(list.ordered).toBe(true);
		expect(list.start).toBe(5);
	});

	it("reads nested and mixed lists", () => {
		expect(nodesOf("- one\n  - two\n    - three", "list")).toHaveLength(3);
		const mixed = nodesOf("1. one\n   - child\n2. two", "list");
		expect(mixed).toHaveLength(2);
	});

	/** Checked state is data, not a control. The rendering side is responsible for preserving it. */
	it("reads task list check states", () => {
		const items = nodesOf(
			"- [ ] todo\n- [x] done\n- [X] done",
			"listItem",
		) as unknown as { checked: boolean | null }[];
		expect(items.map((item) => item.checked)).toEqual([false, true, true]);
		/* A plain item is `null`, which is a different fact from unchecked (false). */
		expect(
			(
				nodesOf("- plain", "listItem")[0] as unknown as {
					checked: boolean | null;
				}
			).checked,
		).toBeNull();
	});

	it("reads all three thematic break notations", () => {
		for (const rule of ["---", "***", "___"])
			expect(
				nodesOf(`text\n\n${rule}\n\ntext`, "thematicBreak"),
				rule,
			).toHaveLength(1);
	});

	it("reads fenced code blocks with their language", () => {
		const code = first<{ lang: string | null; value: string }>(
			"```ts\nconst value = 123;\n```",
			"code",
		);
		expect(code.lang).toBe("ts");
		expect(code.value).toBe("const value = 123;");
		expect(
			first<{ lang: string | null }>("```\nplain\n```", "code").lang,
		).toBeNull();
	});

	it("reads tilde fences and indented code blocks", () => {
		expect(
			first<{ lang: string | null }>('~~~js\nconsole.log("hi");\n~~~', "code")
				.lang,
		).toBe("js");
		expect(first<{ value: string }>("    indented();", "code").value).toBe(
			"indented();",
		);
	});

	/** Markdown inside code is literal text. Parsing it would leave no way to show the code. */
	it("does not interpret markdown inside code", () => {
		const source = "```\n**bold** [link](https://example.com) ![x](y.png)\n```";
		expect(nodesOf(source, "strong")).toHaveLength(0);
		expect(nodesOf(source, "link")).toHaveLength(0);
		expect(nodesOf(source, "image")).toHaveLength(0);
		expect(first<{ value: string }>(source, "code").value).toContain(
			"**bold**",
		);
	});

	it("does not interpret markdown inside inline code either", () => {
		const source = "`**bold**`";
		expect(nodesOf(source, "strong")).toHaveLength(0);
		expect(first<{ value: string }>(source, "inlineCode").value).toBe(
			"**bold**",
		);
	});
});

describe("tables", () => {
	const SOURCE =
		"| name | value |\n| --- | ---: |\n| alpha | 10 |\n| beta | 20 |";

	it("reads rows and cells", () => {
		expect(nodesOf(SOURCE, "tableRow")).toHaveLength(3);
		expect(nodesOf(SOURCE, "tableCell")).toHaveLength(6);
	});

	/** Alignment is an axis of the table, not of the cell. The renderer must read the value. */
	it("keeps alignment metadata", () => {
		const table = first<{ align: (string | null)[] }>(SOURCE, "table");
		expect(table.align).toEqual([null, "right"]);
	});
});

describe("inline syntax", () => {
	it("reads both notations of bold and italic", () => {
		expect(nodesOf("**bold**", "strong")).toHaveLength(1);
		expect(nodesOf("__bold__", "strong")).toHaveLength(1);
		expect(nodesOf("*italic*", "emphasis")).toHaveLength(1);
		expect(nodesOf("_italic_", "emphasis")).toHaveLength(1);
	});

	it("reads nested emphasis", () => {
		const strong = first<Parent>("***both***", "strong");
		expect(nodesOf("***both***", "emphasis")).toHaveLength(1);
		expect(textOf(strong)).toBe("both");
	});

	/**
	 * Korean roleplay broke most often here. Under CommonMark's flanking rules, a closing `**` that is
	 * preceded by punctuation and followed by a letter cannot close. English usually has a space after
	 * it, so this rarely shows; Korean particles attach directly, so `**"\uadf8\ub798"**\ub77c\uace0`, `**\uadf8\ub798!**\ud558\uace0` and
	 * `**(\uc18d\uc73c\ub85c)**\ud558\uace0` all failed and left literal asterisks. The failure is silent.
	 *
	 * The test once pinned this failure as a known limit (toHaveLength(0)). Reversing it was a product
	 * decision, because conversations already stored would read differently. The parser now uses CJK
	 * rules (see the section on why the CJK rule was adopted in parse.ts). The input-box `action markers`
	 * marker still wraps only the trimmed content (applyChatEmphasisMarker). That case is about
	 * whitespace, which the CJK rule does not relax; this one is about punctuation.
	 */
	it("a Korean particle after a closing marker preceded by punctuation does not block it", () => {
		expect(nodesOf('**"\uadf8\ub798"**\ub77c\uace0', "strong")).toHaveLength(1);
		expect(nodesOf("**\uadf8\ub798!**\ud558\uace0", "strong")).toHaveLength(1);
		expect(
			nodesOf("**(\uc18d\uc73c\ub85c)**\ud558\uace0", "strong"),
		).toHaveLength(1);
	});

	/**
	 * Note: this adoption is one-directional. It only makes more places read as emphasis and never
	 * fewer. If the reverse opened, this change would erase text in stored conversations: markers that
	 * were emphasis would turn into visible body characters.
	 */
	it("emphasis that worked before still works", () => {
		for (const source of [
			"**\ubb38\uc744 \uc5f0\ub2e4**\ub77c\uace0",
			"**\ubb38\uc744 \uc5f0\ub2e4**.",
			'**"\uadf8\ub798"** \ub77c\uace0',
			"a **bold**word",
			"**bold**, then",
			"**\uad75\uac8c**\uc640 *\uae30\uc6b8\uc784*\uc774",
		])
			expect(
				nodesOf(source, "strong").length + nodesOf(source, "emphasis").length,
				source,
			).toBeGreaterThan(0);
	});

	/** Text that was not emphasis stays unemphasized: the rule widened, nothing was removed. */
	it("what was not emphasis stays that way", () => {
		for (const source of [
			"2 * 3 * 4",
			"a * star",
			"**unfinished",
			"inside snake_case_word",
		]) {
			expect(nodesOf(source, "strong"), source).toHaveLength(0);
			expect(nodesOf(source, "emphasis"), source).toHaveLength(0);
		}
	});

	/**
	 * Warning: whitespace is not relaxed by the CJK rule, so the input box still has to trim. A space
	 * after an opening `**` or before a closing `**` still prevents emphasis. This is why the `action markers`
	 * marker wraps only the trimmed content rather than the exact selection (applyChatEmphasisMarker).
	 * Without this note, the next reader would see CJK rules are on and conclude the trimming can be
	 * removed.
	 */
	it("⚠️ whitespace inside the markers still blocks emphasis", () => {
		expect(nodesOf("**\ubb38\uc744 \uc5f0\ub2e4 **", "strong")).toHaveLength(0);
		expect(nodesOf("** \ubb38\uc744 \uc5f0\ub2e4**", "strong")).toHaveLength(0);
		expect(nodesOf("**\ubb38\uc744 \uc5f0\ub2e4**", "strong")).toHaveLength(1);
	});

	/**
	 * Warning: GFM strikethrough is not handled by this extension. The same break occurs there
	 * (`~~\uc544\ub2c8\uc57c!~~\ub77c\uace0`), but strikethrough belongs to a separate package and this change does not add
	 * that dependency (parse.ts). It is recorded as a known limit; without the note, a reader would
	 * assume strikethrough works too because CJK rules are on.
	 */
	it("⚠️ strikethrough still does not close before a Korean particle", () => {
		expect(
			nodesOf("~~\uc544\ub2c8\uc57c!~~\ub77c\uace0", "delete"),
		).toHaveLength(0);
		expect(
			nodesOf("~~\uc544\ub2c8\uc57c~~\ub77c\uace0", "delete"),
		).toHaveLength(1);
	});

	it("reads strikethrough", () => {
		expect(nodesOf("~~struck text~~", "delete")).toHaveLength(1);
	});

	it("keeps link titles", () => {
		const link = first<{ url: string; title: string | null }>(
			'[example](https://example.com "Title")',
			"link",
		);
		expect(link.url).toBe("https://example.com");
		expect(link.title).toBe("Title");
	});

	it("reads autolinks", () => {
		expect(
			first<{ url: string }>("a https://example.com/article b", "link").url,
		).toBe("https://example.com/article");
		expect(first<{ url: string }>("<https://example.com>", "link").url).toBe(
			"https://example.com",
		);
		expect(first<{ url: string }>("www.example.com", "link").url).toBe(
			"http://www.example.com",
		);
	});

	/** GFM also auto-links email addresses. The destination still has to pass the link allowlist. */
	it("mail autolinks become mailto", () => {
		expect(first<{ url: string }>("contact hi@example.com", "link").url).toBe(
			"mailto:hi@example.com",
		);
	});

	/**
	 * A scheme not on the allowlist folds to plain text. `tel:` is not dangerous, but it is not a
	 * destination this product opens. The list grows together with the screen that uses it: leaving it
	 * open would make it impossible to say which schemes are open.
	 */
	it("schemes outside the list do not become links", () => {
		expect(nodesOf("[call](tel:01012345678)", "link")).toHaveLength(0);
		expect(textOf(parse("[call](tel:01012345678)"))).toBe("call");
	});

	/** Line breaks are tree nodes. The parser knows them; CSS is not what preserves them. */
	it("keeps line breaks within a paragraph", () => {
		const source =
			'The door opens slowly.\nA cold wind comes in.\n\n"Who is there?"';
		expect(nodesOf(source, "break")).toHaveLength(1);
		expect(nodesOf(source, "paragraph")).toHaveLength(2);
	});

	it("reads escapes", () => {
		expect(nodesOf("\\*not italic\\*", "emphasis")).toHaveLength(0);
		expect(textOf(parse("\\*not italic\\*"))).toBe("*not italic*");
		expect(nodesOf("\\# not a heading", "heading")).toHaveLength(0);
		expect(nodesOf("\\[not a link\\]", "link")).toHaveLength(0);
	});

	it("decodes character references", () => {
		expect(textOf(parse("&amp; &lt; &gt;"))).toBe("& < >");
	});
});

describe("images", () => {
	it("keeps image syntax as an image", () => {
		const source = '![cat](https://example.com/cat.png "Title")';
		const image = first<{ url: string; title: string | null; alt: string }>(
			source,
			"image",
		);
		expect(image.url).toBe("https://example.com/cat.png");
		expect(image.title).toBe("Title");
		expect(image.alt).toBe("cat");
		expect(nodesOf(source, "link")).toHaveLength(0);
	});

	/**
	 * Images are lifted out of paragraphs. On mobile a paragraph is a single `Text`, and an `Image`
	 * without a size placed inside an RN `Text` silently disappears. Folding keeps the two renderers
	 * from ever meeting an image inside a paragraph.
	 */
	it("an image on its own line becomes a block", () => {
		const tree = parse("![cat](https://example.com/cat.png)");
		expect(tree.children).toHaveLength(1);
		expect(tree.children[0]?.type).toBe("image");
	});

	/**
	 * The unit of judgment is the line, not the paragraph. remark-breaks is on, so a newline does not
	 * split a paragraph, and an image between text lines is still a child of the same paragraph.
	 * Missing this turns that image into a link. Roleplay manuscripts rarely use blank lines, so most
	 * opening-scene images have this shape. Those images once rendered as `Open external image`; this test
	 * blocks that regression.
	 */
	it("an image line between text lines splits the paragraph", () => {
		for (const line of [
			"![](https://example.com/cat.png)",
			"https://example.com/cat.png",
		]) {
			const tree = parse(`The door opens.\n${line}\nHe smiles.`);
			expect(
				tree.children.map((node) => node.type),
				line,
			).toEqual(["paragraph", "image", "paragraph"]);
			expect(
				nodesOf(`The door opens.\n${line}\nHe smiles.`, "link"),
				line,
			).toHaveLength(0);
		}
	});

	/** An image does not change the line breaks of the surrounding text. */
	it("the remaining text lines keep their line breaks", () => {
		const tree = parse(
			"![](https://example.com/cat.png)\nThe door opens.\nHe smiles.",
		);
		expect(tree.children.map((node) => node.type)).toEqual([
			"image",
			"paragraph",
		]);
		/* The two text lines are still one paragraph, and the newline between them stays as a node. */
		expect(
			nodesOf(
				"![](https://example.com/cat.png)\nThe door opens.\nHe smiles.",
				"break",
			),
		).toHaveLength(1);
	});

	/**
	 * Several addresses pasted on separate lines form one paragraph (remark-breaks); all become
	 * images.
	 */
	it("draws every image joined by line breaks", () => {
		const tree = parse(
			"![a](https://example.com/a.png)\n![b](https://example.com/b.png)",
		);
		expect(tree.children.map((node) => node.type)).toEqual(["image", "image"]);
	});

	it("an image without alt text is still an image", () => {
		const source = "![](https://example.com/cat.png)";
		expect(nodesOf(source, "image")).toHaveLength(1);
		expect(nodesOf(source, "link")).toHaveLength(0);
	});

	/**
	 * An explicit image is something the author declared to be an image, so it skips the extension
	 * check. CDNs that serve by content address normally have no extension.
	 */
	it("draws an explicit image without an extension", () => {
		const source = "![x](https://cdn.example.com/asset/9f2)";
		expect(nodesOf(source, "image")).toHaveLength(1);
	});

	it("a bare URL pointing at an image is promoted to an image", () => {
		const source = "https://example.com/cat.png";
		const image = first<{ url: string; alt: string | null }>(source, "image");
		expect(image.url).toBe("https://example.com/cat.png");
		/* There is no description to invent: a URL is not a description of the image. */
		expect(image.alt).toBeNull();
		expect(nodesOf(source, "link")).toHaveLength(0);
	});

	/**
	 * An author who chose the words for a link wrote a link. Turning it into an image would drop them.
	 */
	it("a named link stays a link even when its address is an image", () => {
		const source = "[here](https://example.com/cat.png)";
		expect(nodesOf(source, "image")).toHaveLength(0);
		expect(nodesOf(source, "link")).toHaveLength(1);
	});

	it("an image inside a link becomes the outer link's text, not a nested link", () => {
		for (const source of [
			"[![cat](https://img.example/cat.png)](https://example.com/story)",
			"[![cat][img]][story]\n\n[img]: https://img.example/cat.png\n[story]: https://example.com/story",
		]) {
			expect(nodesOf(source, "link")).toHaveLength(1);
			expect(first<{ url: string }>(source, "link").url).toBe(
				"https://example.com/story",
			);
			expect(nodesOf(source, "image")).toHaveLength(0);
			expect(textOf(parse(source))).toBe("cat");
		}
	});

	it("an address pointing at a document stays a link", () => {
		expect(nodesOf("https://example.com/article", "image")).toHaveLength(0);
		expect(nodesOf("https://example.com/article", "link")).toHaveLength(1);
	});

	/** An image URL in the middle of a sentence was never the author saying 'put an image here'. */
	it("an image address mid-sentence is not promoted", () => {
		const source = "see this picture https://example.com/cat.png now";
		expect(nodesOf(source, "image")).toHaveLength(0);
		expect(nodesOf(source, "link")).toHaveLength(1);
	});

	/**
	 * Images inside a sentence also render. This was deliberately reversed, so the value is pinned
	 * here.
	 *
	 * The shape `*The door opens.* ![](night.png)` once rendered as an `Open external image` link. The rationale was that
	 * splitting the line into three would add a line break the author never wrote. But the model's
	 * actual output has this shape, so the check removed not a line break but the image itself. The
	 * choice is between one extra line break and a lost image; the image is the more expensive error.
	 */
	it("image syntax mid-sentence is lifted to a block too", () => {
		const source = "look ![cat](https://example.com/cat.png) here";
		const tree = parse(source);
		expect(tree.children.map((node) => node.type)).toEqual([
			"paragraph",
			"image",
			"paragraph",
		]);
		expect(nodesOf(source, "link")).toHaveLength(0);
		/*
		 * The single space that followed the image belongs to the image's line, so it does not remain
		 * before the paragraph's first character.
		 */
		expect(textOf(tree)).toBe("look here");
	});

	/** Text and an image on one line: the shape the model uses most often. */
	it("an image glued after text splits that line", () => {
		const tree = parse("*The door opens.* ![](https://example.com/night.png)");
		expect(tree.children.map((node) => node.type)).toEqual([
			"paragraph",
			"image",
		]);
	});

	it("an image on its own line is an image inside quotes and lists too", () => {
		expect(nodesOf("> ![a](https://example.com/a.png)", "image")).toHaveLength(
			1,
		);
		expect(nodesOf("- ![a](https://example.com/a.png)", "image")).toHaveLength(
			1,
		);
	});
});

describe("dangerous destinations", () => {
	it("links with executable schemes fold to text", () => {
		for (const url of [
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
		]) {
			const source = `[press me](${url})`;
			expect(nodesOf(source, "link"), url).toHaveLength(0);
			/* The author's text remains; only the link is stripped. */
			expect(textOf(parse(source)), url).toBe("press me");
		}
	});

	it("dangerous image sources fold to alt text", () => {
		const source = "![picture](javascript:alert(1))";
		expect(nodesOf(source, "image")).toHaveLength(0);
		expect(textOf(parse(source))).toBe("picture");
	});

	/**
	 * SVG is a document that can carry scripts and external entities, not an image. The repo already
	 * decided not to accept it (contracts/media.ts), and rendering does not reverse that decision.
	 */
	it("SVG is not loaded and folds to alt text", () => {
		for (const url of [
			"https://example.com/logo.svg",
			"https://example.com/logo.svgz?v=2",
		]) {
			const source = `![logo](${url})`;
			expect(nodesOf(source, "image"), url).toHaveLength(0);
			/*
			 * No link remains either. For an image that cannot be drawn, the only answer is the alt text
			 * (`altOnly`).
			 */
			expect(nodesOf(source, "link"), url).toHaveLength(0);
			expect(textOf(parse(source)), url).toBe("logo");
		}
	});
});

describe("raw HTML", () => {
	/**
	 * Not running is the point; staying as text is the next requirement. Deleting it would leave the
	 * user unable to tell whether it was markup or something the app swallowed.
	 */
	it("script tags are text", () => {
		const tree = parse("<script>alert(1)</script>");
		expect(walk(tree).some((node) => node.type === "html")).toBe(false);
		expect(textOf(tree)).toBe("<script>alert(1)</script>");
	});

	it("tags with event handlers are text too", () => {
		const tree = parse("<img src=x onerror=alert(1)>");
		expect(walk(tree).some((node) => node.type === "html")).toBe(false);
		expect(nodesOf("<img src=x onerror=alert(1)>", "image")).toHaveLength(0);
		expect(textOf(tree)).toContain("onerror");
	});

	it("iframes are text too", () => {
		expect(
			textOf(parse('<iframe src="https://evil.example"></iframe>')),
		).toContain("iframe");
	});

	/**
	 * HTML in block position is wrapped in a paragraph. Text must never sit as a direct child of root.
	 */
	it("block-level HTML becomes a paragraph", () => {
		expect(parse("<script>alert(1)</script>").children[0]?.type).toBe(
			"paragraph",
		);
	});
});

describe("references and footnotes", () => {
	it("a reference with a definition becomes a link", () => {
		const link = first<{ url: string }>(
			"[text][id]\n\n[id]: https://example.com",
			"link",
		);
		expect(link.url).toBe("https://example.com");
	});

	it("a dangerous definition does not become a link", () => {
		const source = "[text][id]\n\n[id]: javascript:alert(1)";
		expect(nodesOf(source, "link")).toHaveLength(0);
		expect(textOf(parse(source))).toContain("text");
	});

	it("resolves image references too", () => {
		const source = "![cat][c]\n\n[c]: https://example.com/cat.png";
		expect(first<{ url: string }>(source, "image").url).toBe(
			"https://example.com/cat.png",
		);
		expect(nodesOf(source, "link")).toHaveLength(0);
	});

	/**
	 * Definition nodes are not rendered. If they stayed in the tree, renderers would encounter them.
	 */
	it("definition nodes do not remain", () => {
		const tree = parse("[text][id]\n\n[id]: https://example.com");
		expect(walk(tree).some((node) => node.type === "definition")).toBe(false);
	});

	it("footnotes fold to text without losing the body", () => {
		const tree = parse("body[^1]\n\n[^1]: note text");
		const types = new Set(walk(tree).map((node) => node.type));
		expect(types.has("footnoteReference")).toBe(false);
		expect(types.has("footnoteDefinition")).toBe(false);
		expect(textOf(tree)).toContain("[^1]");
		expect(textOf(tree)).toContain("note text");
	});
});

describe("normalization", () => {
	it("folds CRLF", () => {
		expect(nodesOf("first line\r\nsecond line", "break")).toHaveLength(1);
	});

	it("plain text stays a plain paragraph", () => {
		const tree = parse("hello");
		expect(tree.children).toHaveLength(1);
		expect(tree.children[0]?.type).toBe("paragraph");
		expect(textOf(tree)).toBe("hello");
	});
});
