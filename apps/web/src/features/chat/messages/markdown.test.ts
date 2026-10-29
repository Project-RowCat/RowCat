import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CHAT_MARKDOWN_FIXTURE,
	CHAT_MARKDOWN_NODE_TYPES,
	type ChatMarkdownNodeType,
	collectNodeTypes,
	parseChatMarkdown,
} from "@rowcat/markdown";
import { describe, expect, it } from "vitest";
import { CHAT_MARKDOWN_TAGS } from "./markdown.tsx";

/**
 * Whether the web renderer covers the whole shared vocabulary. This is the web half of parity.
 *
 * The first half lives in the shared package (the fixture generates the whole vocabulary). The
 * third half is on mobile (`apps/mobile` … `markdown-view.test.ts`). All three must hold for "the
 * same text arrives with the same meaning on both screens" to be confirmed.
 *
 * This file does not look at rendered output, because the web tests in this repository have no
 * React rendering (`vitest.config.ts`). It checks **policy** instead: every kind of vocabulary has
 * a place to be drawn. The symptom of a missing kind is not an error but text quietly leaking into
 * default styles, which nobody notices until they look at it.
 */

/**
 * Node kind → the tags that must be in the table for that kind to be drawn.
 *
 * mdast is a tree and react-markdown draws HTML, so a table is needed between them. This table is
 * **the web's own** for that reason: mobile has no concept of tags and covers the same vocabulary
 * with a different table.
 *
 * `text` is absent on purpose. Text nodes are drawn as strings, not tags, so there is no component
 * slot to override.
 */
const TAGS_FOR_NODE: Record<ChatMarkdownNodeType, readonly string[]> = {
	blockquote: ["blockquote"],
	break: ["br"],
	code: ["pre", "code"],
	delete: ["del"],
	emphasis: ["em"],
	heading: ["h1", "h2", "h3", "h4", "h5", "h6"],
	image: ["img"],
	inlineCode: ["code"],
	link: ["a"],
	list: ["ul", "ol"],
	listItem: ["li"],
	paragraph: ["p"],
	strong: ["strong"],
	table: ["table", "thead", "tbody"],
	tableCell: ["th", "td"],
	tableRow: ["tr"],
	text: [],
	thematicBreak: ["hr"],
};

describe("the web renderer covers the shared vocabulary", () => {
	it("every node kind has a place to draw", () => {
		for (const type of CHAT_MARKDOWN_NODE_TYPES)
			for (const tag of TAGS_FOR_NODE[type])
				expect(CHAT_MARKDOWN_TAGS, `${type} → <${tag}>`).toContain(tag);
	});

	/**
	 * The task list checkbox is not in the vocabulary. It is not a node but the **value**
	 * `listItem.checked`, which GFM draws as an `<input>`. If the table did not own that tag, the
	 * screen would show an unstyled checkbox, and worse, a checkbox that **can be pressed**.
	 */
	it("owns the task list checkbox", () => {
		expect(CHAT_MARKDOWN_TAGS).toContain("input");
	});

	/** A tag in the table that no vocabulary node produces is a dead entry. */
	it("the table has no dead tags", () => {
		const owned = new Set(Object.values(TAGS_FOR_NODE).flat());
		owned.add("input");
		for (const tag of CHAT_MARKDOWN_TAGS)
			expect(owned, `no node in the vocabulary makes <${tag}>`).toContain(tag);
	});

	/** The shared package checks that the fixture really produces that vocabulary; this checks it here too. */
	it("the fixture tree stays inside the table's vocabulary", () => {
		for (const type of collectNodeTypes(
			parseChatMarkdown(CHAT_MARKDOWN_FIXTURE),
		))
			expect(Object.keys(TAGS_FOR_NODE), type).toContain(type);
	});
});

/**
 * **The comments are stripped before reading.** This repository's comments explain boundaries by
 * naming the forbidden words ("do not attach `rehype-raw`"). Reading the raw text would flag the
 * rule's own explanation as a violation, and everyone would then edit the comments away to pass
 * (mobile's `boundaries.test.ts` does the same for the same reason).
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("does not run HTML", () => {
	const source = stripComments(
		readFileSync(
			fileURLToPath(new URL("./markdown.tsx", import.meta.url)),
			"utf8",
		),
	);

	/**
	 * This file **renders other people's text**: works and model output. The public-docs renderer
	 * is the other side of this boundary, since its markdown is owned by the repository, but here the
	 * text is not. If any one of the three checks below were removed, that boundary would vanish
	 * entirely.
	 */
	it("opens no raw HTML path", () => {
		expect(source).not.toMatch(/dangerouslySetInnerHTML/);
		expect(source).not.toMatch(/rehype-raw/);
		expect(source).not.toMatch(/rehypePlugins/);
	});

	/**
	 * Syntax and safety rules belong to the shared package. If this file started building its own
	 * plugin array, the two platforms' parser configs would diverge, and **one side would loosen**
	 * (that direction is the vulnerability).
	 */
	it("does not rebuild the parser config here", () => {
		expect(source).toMatch(/chatRemarkPlugins/);
		expect(source).not.toMatch(/remark-gfm|remarkGfm/);
		expect(source).not.toMatch(/remark-breaks|remarkBreaks/);
	});

	/** The URL policy is the same: the scheme list must not be written out again in this file. */
	it("does not re-write the URL policy here", () => {
		expect(source).toMatch(/markdownUrlTransform/);
		/**
		 * The policy for owned documents (`ownedDocumentUrlTransform`) accepts internal absolute paths.
		 * If that gate appeared here, someone's manuscript could point at our screen as if it were its
		 * own sentence. The axis that differs is not which screen draws it but **who wrote the text**.
		 */
		expect(source).not.toMatch(/ownedDocumentUrlTransform/);
		expect(source).not.toMatch(/javascript:/);
	});

	/**
	 * Whether an image is drawn at all is also decided by the shared folding. If this file split it by
	 * extension or scheme again, the two platforms' decisions would diverge, and then only one side
	 * would loosen.
	 */
	it("does not re-decide here what to draw as a picture", () => {
		expect(source).not.toMatch(/\.svg|looksLikeImageUrl|isRefusedImageUrl/);
	});

	/** Drawing the image is not this file's job: the **same component** as situation images does it. */
	it("does not draw pictures directly here", () => {
		expect(source).toMatch(/ChatImage/);
		expect(source).not.toMatch(/<img/);
	});
});

/**
 * Whether the conversation screen's images are drawn in **one place**.
 *
 * Situation images and markdown images each drew their own `<img>`, and the size cap and radius
 * were written in two places, values that tend to be changed on one side only. What the checks
 * below verify is not layout but **that there is one place**, and the two policies applied there.
 */
describe("one component draws pictures", () => {
	const source = stripComments(
		readFileSync(
			fileURLToPath(new URL("./image.tsx", import.meta.url)),
			"utf8",
		),
	);

	/**
	 * An image is a syntax that lets the viewer's IP and **which conversation they are reading** be
	 * sent to someone else's server. The properties that narrow those two are policy rather than
	 * styling, so their disappearance would be silent.
	 */
	it("sends no referrer and requests nothing until on screen", () => {
		expect(source).toMatch(/referrerPolicy="no-referrer"/);
		expect(source).toMatch(/loading="lazy"/);
	});

	/** Building the address and re-judging safety are not done here; the caller has already passed them through. */
	it("neither builds URLs nor re-judges safety", () => {
		expect(source).not.toMatch(/media\.url\(|API_BASE_URL/);
		expect(source).not.toMatch(/\.svg|looksLikeImageUrl|isRefusedImageUrl/);
	});

	/**
	 * **Walks the whole conversation feature.** Reading only this folder would still pass if a second
	 * `<img>` appeared in a neighbouring folder, and that absence is exactly what this check exists to
	 * guard.
	 */
	it("there is no second img on the conversation screen", () => {
		const chat = fileURLToPath(new URL("..", import.meta.url));
		const walk = (dir: string, found: string[] = []): string[] => {
			for (const name of readdirSync(dir)) {
				const full = join(dir, name);
				if (statSync(full).isDirectory()) walk(full, found);
				else if (name.endsWith(".tsx") && !name.includes(".test."))
					found.push(full);
			}
			return found;
		};
		const drawn = walk(chat)
			.filter((file) =>
				stripComments(readFileSync(file, "utf8")).includes("<img"),
			)
			.map((file) => relative(chat, file));
		expect(drawn).toEqual([join("messages", "image.tsx")]);
	});
});
