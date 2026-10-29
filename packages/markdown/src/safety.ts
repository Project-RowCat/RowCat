import type {
	Definition,
	Image,
	Link,
	Paragraph,
	PhrasingContent,
	Root,
	RootContent,
} from "mdast";
import { isRefusedImageUrl, looksLikeImageUrl } from "./image-url.ts";
import { safeImageUrl, safeLinkUrl } from "./url-policy.ts";

/**
 * Folds the parsed tree into the closed vocabulary of `nodes.ts`, so both renderers draw it with
 * the same rules. Every decision here would otherwise be written twice, once per renderer.
 *
 * - Raw HTML becomes text: neither executed nor stripped (stripping makes the author's text
 *   vanish with no way to tell why).
 * - References are resolved here because mobile has no react-markdown to do it; an undefined
 *   reference stays as text.
 * - Footnotes are a document affordance; they fold to literal `[^1]` text and prefixed
 *   paragraphs.
 */

/** Definitions can appear anywhere (inside quotes and lists), so collect them first. */
function collectDefinitions(
	nodes: readonly RootContent[],
	into: Map<string, Definition>,
): void {
	for (const node of nodes) {
		if (node.type === "definition")
			into.set(node.identifier.toLowerCase(), node);
		else if ("children" in node)
			collectDefinitions(node.children as RootContent[], into);
	}
}

const hasChildren = (
	node: RootContent,
): node is RootContent & { children: RootContent[] } =>
	"children" in node &&
	Array.isArray((node as { children?: unknown }).children);

const text = (value: string): PhrasingContent => ({ type: "text", value });

/**
 * An image that cannot be drawn folds to its alt text, or to nothing — the same answer as an image
 * that fails to load.
 *
 * This replaced an "open external image" link, which in practice showed up as a stray phrase in the
 * middle of model replies. What reaches here: refused formats (SVG), unsafe destinations, and
 * images in seats where no block can stand (headings, table cells, inside links).
 */
const altOnly = (alt: string | null | undefined): RootContent[] => {
	const caption = alt?.trim();
	return caption ? [text(caption) as RootContent] : [];
};

/**
 * An image node if drawable: http(s) only and not SVG. No extension is required — the author said
 * it is an image, and content-addressed CDNs have no extension. Whether the bytes are really an
 * image is the renderer's load failure to answer.
 */
function renderableImage(
	url: string,
	alt: string | null | undefined,
	title: string | null | undefined,
): Image | null {
	const safe = safeImageUrl(url);
	if (!safe || isRefusedImageUrl(safe)) return null;
	return {
		type: "image",
		url: safe,
		title: title ?? null,
		alt: alt?.trim() || null,
	};
}

/**
 * Whether a link's text is its address verbatim (a GFM autolink), the condition for promoting a
 * bare URL. A named link like `[here](cat.png)` would lose its words if promoted.
 */
function isBareUrl(node: Link): boolean {
	if (node.children.length !== 1) return false;
	const child = node.children[0];
	if (!child || child.type !== "text") return false;
	const label = child.value.trim();
	return (
		label === node.url ||
		`http://${label}` === node.url ||
		`https://${label}` === node.url
	);
}

/**
 * Whether a paragraph piece is a drawable image: explicit image, defined image reference, or a bare
 * image URL. Only the bare URL requires `lineOnly` — the author never wrote image syntax there, so
 * splitting a sentence around it would be editing the text.
 */
function renderableImageNode(
	node: RootContent,
	ctx: Context,
	lineOnly: boolean,
): Image | null {
	switch (node.type) {
		case "image":
			return renderableImage(node.url, node.alt, node.title);
		case "imageReference": {
			const definition = ctx.definitions.get(node.identifier.toLowerCase());
			return definition
				? renderableImage(definition.url, node.alt, definition.title)
				: null;
		}
		case "link":
			return lineOnly && isBareUrl(node) && looksLikeImageUrl(node.url)
				? renderableImage(node.url, null, node.title)
				: null;
		default:
			return null;
	}
}

/**
 * Splits paragraph children on `break` nodes. With `remark-breaks` on, a line and a paragraph
 * differ, and roleplay text rarely uses blank lines.
 */
function splitLines(children: readonly RootContent[]): RootContent[][] {
	const lines: RootContent[][] = [[]];
	for (const child of children) {
		if (child.type === "break") lines.push([]);
		else lines[lines.length - 1]?.push(child);
	}
	return lines;
}

const isBlank = (node: RootContent): boolean =>
	node.type === "text" && node.value.trim() === "";

/**
 * Lifts every drawable image out of its paragraph; `null` if there are none.
 *
 * Images cannot stay inline because a mobile paragraph is one `Text`, and a size-less `Image`
 * inside it disappears.
 *
 * Images inline in a sentence are lifted too (a reversed decision). Models write `*The door opens.*
 * ![](night.png)` on one line; refusing to split that line hid the picture entirely, which costs more
 * than one unwritten line break. Surrounding lines keep their original breaks; only the line the
 * image sat on changes.
 */
function liftImageLines(node: Paragraph, ctx: Context): RootContent[] | null {
	const lines = splitLines(node.children);
	// Decide up front: `lineOnly` needs the whole line.
	const lifted = lines.map((line) => {
		const lineOnly = line.filter((child) => !isBlank(child)).length === 1;
		return line.map((child) => renderableImageNode(child, ctx, lineOnly));
	});
	if (!lifted.some((line) => line.some(Boolean))) return null;

	const out: RootContent[] = [];
	let prose: RootContent[] = [];

	const flush = (): void => {
		if (prose.length === 0) return;
		const children = transformAll(prose, ctx, "inline");
		if (children.length > 0) out.push({ ...node, children } as Paragraph);
		prose = [];
	};

	lines.forEach((line, index) => {
		if (line.every(isBlank)) return;
		const images = lifted[index] ?? [];
		let started = false;
		let afterImage = false;
		line.forEach((child, position) => {
			const image = images[position];
			if (image) {
				flush();
				out.push(image);
				started = false;
				afterImage = true;
				return;
			}
			if (!started && isBlank(child)) return;
			// Keep line breaks between prose lines.
			if (!started && prose.length > 0)
				prose.push({ type: "break" } as RootContent);
			// The space right after an image separates it from prose; left in, mobile's `Text` draws it
			// before the paragraph's first letter.
			const piece =
				afterImage && child.type === "text"
					? { ...child, value: child.value.replace(/^\s+/, "") }
					: child;
			started = true;
			afterImage = false;
			prose.push(piece);
		});
	});
	flush();

	return out;
}

interface Context {
	definitions: Map<string, Definition>;
}

/**
 * A link whose children all folded away (e.g. wrapping an alt-less image) shows its address; an
 * empty `<a>` is in the accessibility tree but nowhere on screen.
 */
function linkLabel(
	children: PhrasingContent[],
	url: string,
): PhrasingContent[] {
	return children.length > 0 ? children : [text(url)];
}

/**
 * Raw HTML is `html` in both seats; folded to text at block level it must be wrapped in a
 * paragraph, or a bare `text` sits under the root and the two renderers disagree.
 */
type Position = "block" | "inline";

function transform(
	node: RootContent,
	ctx: Context,
	position: Position,
): RootContent[] {
	switch (node.type) {
		case "html":
			return position === "block"
				? [{ type: "paragraph", children: [text(node.value)] } as RootContent]
				: [text(node.value) as RootContent];

		// Already used to resolve references.
		case "definition":
			return [];

		case "footnoteReference":
			return [text(`[^${node.label ?? node.identifier}]`) as RootContent];

		case "footnoteDefinition": {
			const children = transformAll(
				node.children as RootContent[],
				ctx,
				"block",
			);
			const label = `[^${node.label ?? node.identifier}]: `;
			const first = children[0];
			if (first && first.type === "paragraph")
				first.children.unshift(text(label));
			else
				children.unshift({
					type: "paragraph",
					children: [text(label)],
				} satisfies Paragraph as RootContent);
			return children;
		}

		case "linkReference": {
			const definition = ctx.definitions.get(node.identifier.toLowerCase());
			const url = definition ? safeLinkUrl(definition.url) : null;
			const children = transformAll(
				node.children as RootContent[],
				ctx,
				"inline",
			) as PhrasingContent[];
			if (!url) return children as RootContent[];
			return [
				{
					type: "link",
					url,
					title: definition?.title ?? null,
					children: linkLabel(children, url),
				} satisfies Link as RootContent,
			];
		}

		// Drawable ones were already lifted at the paragraph.
		case "imageReference":
			return altOnly(node.alt);

		case "link": {
			const url = safeLinkUrl(node.url);
			const children = transformAll(
				node.children as RootContent[],
				ctx,
				"inline",
			) as PhrasingContent[];
			// Strip only the link, keeping the author's text (and harmless typos).
			if (!url) return children as RootContent[];
			return [{ ...node, url, children: linkLabel(children, url) }];
		}

		// Drawable ones were already lifted at the paragraph.
		case "image":
			return altOnly(node.alt);

		case "paragraph": {
			const lifted = liftImageLines(node, ctx);
			if (lifted) return lifted;
			const children = transformAll(
				node.children as RootContent[],
				ctx,
				"inline",
			);
			return [{ ...node, children } as Paragraph];
		}

		default: {
			if (!hasChildren(node)) return [node];
			// Headings and cells hold inline content; quotes and list items hold blocks; emphasis inherits
			// its seat.
			const inner: Position = INLINE_CONTAINERS.has(node.type)
				? "inline"
				: BLOCK_CONTAINERS.has(node.type)
					? "block"
					: position;
			return [
				{
					...node,
					children: transformAll(node.children, ctx, inner),
				} as RootContent,
			];
		}
	}
}

function transformAll(
	nodes: readonly RootContent[],
	ctx: Context,
	position: Position,
): RootContent[] {
	const out: RootContent[] = [];
	for (const node of nodes) out.push(...transform(node, ctx, position));
	return out;
}

const INLINE_CONTAINERS = new Set(["heading", "tableCell"]);

const BLOCK_CONTAINERS = new Set(["blockquote", "listItem"]);

/** Folds the tree in place. */
export function applyChatMarkdownSafety(tree: Root): Root {
	const definitions = new Map<string, Definition>();
	collectDefinitions(tree.children, definitions);
	tree.children = transformAll(tree.children, { definitions }, "block");
	return tree;
}

export function remarkChatSafety() {
	return (tree: Root) => {
		applyChatMarkdownSafety(tree);
	};
}
