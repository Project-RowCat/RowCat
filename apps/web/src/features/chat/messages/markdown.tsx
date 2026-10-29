import { chatRemarkPlugins, markdownUrlTransform } from "@rowcat/markdown";
import { cn } from "@rowcat/ui-web/lib/utils";
import { type ComponentPropsWithoutRef, memo } from "react";
import Markdown from "react-markdown";
import { PROSE_BLOCK_GAP, PROSE_SOFT_BREAKS } from "../chat-geometry.ts";
import { ChatImage } from "./image.tsx";

/**
 * Markdown renderer for conversation body text.
 *
 * For a while this spot did not exist, and the body was one text node with `whitespace-pre-wrap`.
 * The reason was "no suitable renderer in the dependencies", which stopped holding once the public
 * runtime docs arrived: react-markdown and remark-gfm are already dependencies, and the decision to
 * use an established parser was already made (`features/docs/runtime-docs-markdown.tsx`).
 *
 * ## The rules are not in this file
 *
 * Syntax, safety and normalization all live in `@rowcat/markdown`. What stays here is presentation.
 * The boundary exists because of the second platform: once mobile drew the same body, which syntax
 * is read and how dangerous URLs are folded had room to become two copies, and if they diverged,
 * **one side would loosen** (and that direction is the vulnerability).
 *
 * So this component passes the shared plugin array through unchanged, leaving no place for parser
 * config to diverge. The node kinds after folding are a closed list (`CHAT_MARKDOWN_NODE_TYPES`),
 * and `markdown.test.ts` checks by value that `COMPONENTS` covers all of them.
 *
 * ## No hand-written parser
 *
 * The roleplay manuscripts that actually occur use `*action*`, `**emphasis**`, `> recollection` and
 * lists. Handling those with regexes would eventually render someone's manuscript wrongly, and the
 * failure is silent: a lost asterisk still leaves a paragraph that looks normal.
 *
 * ## Raw HTML is not rendered, and that matters most on this screen
 *
 * The text here is written by other people (works) and by the model (responses). The public
 * docs are markdown the repository owns, but this side is the opposite, so a plugin such as
 * `rehype-raw` would run a `<script>` written in someone's work on our page. The shared folding
 * already turns those tags into characters, so this file has no branch for them. The rule against
 * `dangerouslySetInnerHTML` in `message-row.tsx` did not loosen when the renderer arrived.
 *
 * ## Images are drawn, and that is a reversed decision
 *
 * Images were once reduced to alt text on privacy grounds: markdown image syntax fetches bytes from
 * an arbitrary host, and that request tells a server we do not control the viewer's IP (the same
 * axis as having no remote URL field on avatars).
 *
 * They are drawn now, with narrower conditions for when a request goes out:
 *
 * ```text
 * scheme     http and https only (no `data:`, which could carry an SVG document)
 * format     SVG is refused (`contracts/media.ts` already made that decision)
 * referrer   `no-referrer`: the host has no business knowing which conversation is being read
 * loading    `loading="lazy"`: no request at all before the image enters the viewport
 * ```
 *
 * The last line matters most. The list is virtualized, so off-screen rows are not in the DOM, and
 * an old conversation's images are never requested unless the user scrolls far back.
 *
 * Links stay too: removing them would lose the source the author wrote, and that value is readable.
 * They get `nofollow` and `noopener noreferrer`, so a new tab cannot manipulate this document and
 * our ranking is not passed on to others.
 *
 * ## Both roles use the same renderer
 *
 * User bubbles pass through here too. Typing `*opens the door*` is more common on the user side in roleplay,
 * and splitting by role would make **the same text render differently depending on who wrote it.**
 * The bubble decides the color (`text-primary-foreground`), and the classes here must hold on any
 * background, so surfaces and borders are built from `currentColor` instead of fixed colors.
 *
 * ## The stored original is untouched
 *
 * Rendering is presentation, not the value. Copy takes the stored original (`use-copy-message.ts`),
 * search scans the stored body (`search.ts` in `@rowcat/chat`), and the edit form receives the
 * original. Replacing any of those with rendered text would make it impossible for the user to get
 * back the asterisks they typed.
 */

/** Block that holds text directly. Keeps line breaks inside a paragraph. */
const TEXT_BLOCK = `${PROSE_BLOCK_GAP} ${PROSE_SOFT_BREAKS}`;

/** Container. Does not preserve whitespace, so the newline nodes between children do not become blank lines. */
const CONTAINER_BLOCK = PROSE_BLOCK_GAP;

/**
 * Headings are **only slightly bolder than the body.**
 *
 * The document renderer's scale (2xl, lg, base) is not imported. This is a conversation, not a
 * document: if a response starting with `# Chapter 1` made that line the largest text on screen, the
 * conversation's rhythm would bend around that one line. Folding to three levels is for the same
 * reason: roleplay manuscripts rarely mean anything below h4.
 */
const HEADING_CLASS = ["text-[1.125em]", "text-[1.0625em]", "text-[1em]"];

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
	const Tag = `h${level}` as const;
	const size = HEADING_CLASS[Math.min(level, 3) - 1];
	return ({ children }: ComponentPropsWithoutRef<"h2">) => (
		<Tag className={cn(TEXT_BLOCK, size, "font-semibold")}>{children}</Tag>
	);
};

/**
 * One markdown image. **`ChatImage` does the drawing; this only holds the policy.**
 *
 * Box limits, referrer, lazy loading and failure folding belong to the same component as scene
 * images (`image.tsx`). What stays here is specific to this syntax: using the author's alt text as
 * the label and as the fallback, and applying block spacing.
 *
 * Folding has already filtered scheme and format (`safety.ts` in `@rowcat/markdown`), so the `src`
 * arriving here is http or https and not SVG. Not repeating that list in this file is the point.
 */
function MarkdownImage({ src, alt, title }: ComponentPropsWithoutRef<"img">) {
	const caption = alt?.trim() ?? "";
	/**
	 * With no alt text, a failed image leaves **nothing behind**. There is no description to invent
	 * (the address is not a description), and scene images do the same.
	 */
	const missing = caption ? <p className={TEXT_BLOCK}>{caption}</p> : null;

	if (!src) return missing;

	return (
		<ChatImage
			src={src}
			alt={caption}
			title={title}
			className={CONTAINER_BLOCK}
			fallback={missing}
		/>
	);
}

const COMPONENTS = {
	p: ({ children }: ComponentPropsWithoutRef<"p">) => (
		<p className={TEXT_BLOCK}>{children}</p>
	),
	h1: heading(1),
	h2: heading(2),
	h3: heading(3),
	h4: heading(4),
	h5: heading(5),
	h6: heading(6),
	/*
	 * Task lists have no bullet: the checkbox takes that place. The `contains-task-list` marker GFM
	 * adds to such a list is read to tell them apart, because one response can contain a plain list
	 * and a task list side by side.
	 */
	ul: ({ children, className }: ComponentPropsWithoutRef<"ul">) => (
		<ul
			className={cn(
				CONTAINER_BLOCK,
				"space-y-1 pl-5",
				className?.includes("contains-task-list")
					? "list-none pl-1"
					: "list-disc",
			)}
		>
			{children}
		</ul>
	),
	ol: ({ children, start }: ComponentPropsWithoutRef<"ol">) => (
		/*
		 * The start number is the author's value (a list starting with `5.` begins at the fifth item).
		 * Without passing it, the browser counts from 1, which would be us editing the text.
		 */
		<ol
			start={start}
			className={cn(CONTAINER_BLOCK, "list-decimal space-y-1 pl-5")}
		>
			{children}
		</ol>
	),
	/*
	 * No whitespace preservation on items. In a loose list (items containing paragraphs) the `li`
	 * holds newline nodes between its children, so preserving whitespace here would add a blank line
	 * to every item. The inner `p` already preserves that list's text.
	 */
	li: ({ children, className }: ComponentPropsWithoutRef<"li">) => (
		<li
			className={cn(
				"[&>p]:mt-0",
				className?.includes("task-list-item") && "flex items-baseline gap-2",
			)}
		>
			{children}
		</li>
	),
	/*
	 * Task checkboxes cannot be toggled. What is stored is the original text, and this box is a
	 * picture of it. The moment pressing appears to change something, the screen makes a promise it
	 * cannot keep: there is nowhere to save the result, since saving means editing the original, which
	 * is message editing. `disabled` tells mouse and screen-reader users the same thing.
	 */
	input: ({ checked, type }: ComponentPropsWithoutRef<"input">) =>
		type === "checkbox" ? (
			<input
				type="checkbox"
				checked={checked ?? false}
				disabled
				readOnly
				className="pointer-events-none translate-y-[0.1em] accent-current"
			/>
		) : null,
	/*
	 * Quotes carry recollections and monologue. They get one left rule instead of a filled surface,
	 * because filled surfaces are already the vocabulary of user bubbles here: a gray box inside a
	 * response would read as someone's utterance.
	 */
	blockquote: ({ children }: ComponentPropsWithoutRef<"blockquote">) => (
		<blockquote
			className={cn(
				CONTAINER_BLOCK,
				"border-l-2 border-current/25 pl-4 opacity-90",
			)}
		>
			{children}
		</blockquote>
	),
	/*
	 * Emphasis reads as a **dimmed layer**, because in a conversation asterisks mark what is not
	 * speech.
	 *
	 * In this product's body, asterisks in practice mark actions, descriptions and asides. Legacy also
	 * showed them as dimmed text (the composer's action-marker button inserts this exact character).
	 * Weight and slant alone break two things: Korean has no true italic face, so slant is barely
	 * distinguishable from body text (synthetic slant only shifts the spacing), and weight alone reads
	 * as "emphasis", so the speech and action layers do not separate.
	 *
	 * So both are dimmed the same way and **differ from each other** (weight vs slant). This layers
	 * the conversation's convention onto a spot without reversing the standard meaning. The value
	 * belongs to the same dimming family as the others in this table (quotes 90, strikethrough 60).
	 * Mobile uses the same value (`markdown-view.tsx`).
	 */
	strong: ({ children }: ComponentPropsWithoutRef<"strong">) => (
		<strong className="font-semibold opacity-75">{children}</strong>
	),
	em: ({ children }: ComponentPropsWithoutRef<"em">) => (
		<em className="italic opacity-75">{children}</em>
	),
	del: ({ children }: ComponentPropsWithoutRef<"del">) => (
		<del className="opacity-60">{children}</del>
	),
	/*
	 * Surfaces and borders are built from `currentColor`. Writing `bg-muted` would make a gray patch
	 * on a user bubble (a filled primary surface) and sink the text into the background. This is the
	 * cost of both roles sharing one renderer.
	 */
	code: ({ children }: ComponentPropsWithoutRef<"code">) => (
		<code className="rounded bg-current/10 px-1.5 py-0.5 font-mono text-[0.9em]">
			{children}
		</code>
	),
	pre: ({ children }: ComponentPropsWithoutRef<"pre">) => (
		<pre
			className={cn(
				CONTAINER_BLOCK,
				/*
				 * Code scrolls horizontally only inside its own box. Without it, one long line would push the
				 * whole conversation sideways, the same axis as `break-words` on prose.
				 */
				"overflow-x-auto rounded-lg bg-current/10 p-3 font-mono text-[0.875em]",
				/* Inside code, whitespace and line breaks are part of the text, so the prose folding rules must not apply. */
				"whitespace-pre [word-break:normal]",
				"[&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]",
			)}
		>
			{children}
		</pre>
	),
	hr: () => <hr className={cn(CONTAINER_BLOCK, "border-current/20")} />,
	br: () => <br />,
	img: MarkdownImage,
	a: ({ href, children, title }: ComponentPropsWithoutRef<"a">) => (
		<a
			href={href}
			title={title}
			target="_blank"
			rel="nofollow noopener noreferrer"
			className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		>
			{children}
		</a>
	),
	/*
	 * Tables are rare in conversations (some works use them for status panels), but they can appear
	 * now that GFM is on. Scrolling inside their own box is for the same reason as code blocks.
	 */
	table: ({ children }: ComponentPropsWithoutRef<"table">) => (
		<div className={cn(CONTAINER_BLOCK, "w-full overflow-x-auto")}>
			<table className="w-full border-collapse text-left text-[0.9em]">
				{children}
			</table>
		</div>
	),
	thead: ({ children }: ComponentPropsWithoutRef<"thead">) => (
		<thead>{children}</thead>
	),
	tbody: ({ children }: ComponentPropsWithoutRef<"tbody">) => (
		<tbody>{children}</tbody>
	),
	tr: ({ children }: ComponentPropsWithoutRef<"tr">) => <tr>{children}</tr>,
	/*
	 * Alignment is the author's value (`| ---: |`). GFM sends it as an inline style, and if this
	 * component discarded attributes, a column aligned right would fall back to the left. That
	 * mismatch would read as "the table is shaped that way", not as an error.
	 */
	th: ({ children, style }: ComponentPropsWithoutRef<"th">) => (
		<th
			style={style}
			className={cn(
				PROSE_SOFT_BREAKS,
				"border border-current/20 px-2 py-1 font-semibold",
			)}
		>
			{children}
		</th>
	),
	td: ({ children, style }: ComponentPropsWithoutRef<"td">) => (
		<td
			style={style}
			className={cn(
				PROSE_SOFT_BREAKS,
				"border border-current/20 px-2 py-1 align-top",
			)}
		>
			{children}
		</td>
	),
};

/** Read by tests: checks that this table covers the whole folded vocabulary. */
export const CHAT_MARKDOWN_TAGS = Object.keys(COMPONENTS);

/**
 * Streaming caret: attached to the end of the last block of the markdown output.
 *
 * It used to be a sibling `<span>`. When the body was one text node, the end of the text was the
 * end of the node, so the caret sat beside the last character. Now the last child is a `<p>` (a
 * block), so a sibling falls onto the next line: a blank line sits below the text for the whole
 * response and vanishes when it commits, making the conversation jump by one line.
 *
 * So the parent receives this class and the caret becomes `::after` on the last child. No
 * `aria-hidden` is needed: generated content creates no name in the accessibility tree. The color
 * is built from `currentColor` because both roles share the renderer.
 */
export const STREAM_CARET = cn(
	"[&>*:last-child]:after:ml-1 [&>*:last-child]:after:inline-block",
	"[&>*:last-child]:after:h-[1.05em] [&>*:last-child]:after:w-[3px]",
	"[&>*:last-child]:after:translate-y-[0.2em] [&>*:last-child]:after:rounded-full",
	"[&>*:last-child]:after:animate-pulse [&>*:last-child]:after:bg-current/50",
	"[&>*:last-child]:after:content-['']",
);

/** Parser config is built once. Passing a new array on every render would rebuild the pipeline each time. */
const REMARK_PLUGINS = chatRemarkPlugins();

/**
 * Draws one chunk of body text.
 *
 * It does not create a box. It returns block elements, and the box that holds them is already
 * provided by `MessageRow` (width, line spacing, word rules and role colors all live there).
 * Wrapping one more layer here would make `STREAM_CARET`'s `> *:last-child` point at that layer, so
 * the caret would attach to the box's end rather than the paragraph's.
 *
 * ## `memo` is the whole of the performance story
 *
 * While streaming, one line changes every frame, and the whole list would re-render each time. A
 * saved message's `content` does not change in between, so memoizing here means only the one
 * streaming line is re-parsed. Without it, every token would re-parse the markdown of every row on
 * screen, and in a long conversation that cost grows with the row count.
 */
export const ChatMarkdown = memo(function ChatMarkdown({
	content,
}: {
	content: string;
}) {
	return (
		<Markdown
			remarkPlugins={REMARK_PLUGINS}
			urlTransform={markdownUrlTransform}
			components={COMPONENTS}
		>
			{content}
		</Markdown>
	);
});
