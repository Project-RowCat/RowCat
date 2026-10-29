import type { Root, RootContent } from "mdast";

/** Re-exported so apps never depend on `mdast` directly. */
export type { Nodes, Root, RootContent } from "mdast";

/**
 * The closed list of node kinds that can survive `safety.ts` — the contract both renderers cover.
 * Without it, a renderer missing a kind drops that text silently.
 *
 * `image` always stands as a block (`liftImageLines`); renderers never see an image inside a
 * paragraph, which on mobile would vanish inside `Text`.
 *
 * Growing this list breaks both apps' coverage tests first, by design.
 */
export const CHAT_MARKDOWN_NODE_TYPES = [
	"blockquote",
	"break",
	"code",
	"delete",
	"emphasis",
	"heading",
	"image",
	"inlineCode",
	"link",
	"list",
	"listItem",
	"paragraph",
	"strong",
	"table",
	"tableCell",
	"tableRow",
	"text",
	"thematicBreak",
] as const;

export type ChatMarkdownNodeType = (typeof CHAT_MARKDOWN_NODE_TYPES)[number];

/** Used to check the fixture exercises every kind above. */
export function collectNodeTypes(tree: Root): Set<string> {
	const seen = new Set<string>();
	const walk = (nodes: readonly RootContent[]): void => {
		for (const node of nodes) {
			seen.add(node.type);
			if ("children" in node) walk(node.children as RootContent[]);
		}
	};
	walk(tree.children);
	return seen;
}
