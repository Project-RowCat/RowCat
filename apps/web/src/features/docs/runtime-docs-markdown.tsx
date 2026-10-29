import { schemeOf } from "@rowcat/markdown";
import { headingAnchor } from "@rowcat/runtime-ai-docs/heading-anchor";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ownedDocumentUrlTransform } from "#/lib/owned-markdown-url.ts";
import { type CodeTokenKind, tokenizeCode } from "./code-tokens.ts";
import { RuntimeDocLink } from "./runtime-doc-link.tsx";
import { runtimeDocsCopy } from "./runtime-docs-copy.ts";

/**
 * - Not the chat renderer (it renders other people's manuscripts under a policy built for that
 *   risk). Docs need syntax highlighting, file-name code blocks and router links, so this is
 *   its own renderer. It keeps the
 *   same parser (react-markdown with GFM).
 * - URL policy is the repo-owned document policy (`ownedDocumentUrlTransform`). Without it none of this renderer's internal links would resolve; the file
 *   header explains why it is wider.
 * - Raw HTML is not rendered. The input is repo-owned markdown and is safe today, but a raw HTML
 *   plugin would turn one typo into executable markup. The boundary check blocks that plugin by
 *   name.
 * - Heading anchors come from `headingAnchor`, the same function the generator uses to validate
 *   `#anchor` links. A different id rule here would pass validation while links lead nowhere.
 * - Code blocks are drawn entirely by `code`. react-markdown emits `<pre><code>`, but the caption
 *   and scroll region must sit outside `pre`, so `pre` is emptied and `code` renders the figure.
 *   Block vs inline is decided by the `language-*` class; the generator requires a language on
 *   every fence, so a block without the class cannot occur.
 */

const isExternalHref = (href: string | undefined): boolean => {
	if (!href) return false;
	const scheme = schemeOf(href);
	return scheme === "http" || scheme === "https";
};

const HEADING_SCROLL = "scroll-mt-[calc(var(--shell-header)+1rem)]";

function flatten(node: ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean")
		return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(flatten).join("");
	if (typeof node === "object" && "props" in node) {
		const props = (node as { props?: { children?: ReactNode } }).props;
		return flatten(props?.children);
	}
	return "";
}

const heading =
	(level: 1 | 2 | 3 | 4, className: string) =>
	({ children }: ComponentPropsWithoutRef<"h2">) => {
		const Tag = `h${level}` as const;
		const id = headingAnchor(flatten(children));
		return (
			<Tag
				id={id.length > 0 ? id : undefined}
				className={`${className} ${HEADING_SCROLL}`}
			>
				{children}
			</Tag>
		);
	};

/**
 * Token styling uses design tokens only. For people who cannot tell colors apart, keywords are bold
 * and comments italic, so color is not the only signal.
 */
const TOKEN_CLASS: Record<CodeTokenKind, string> = {
	plain: "",
	keyword: "font-semibold text-primary",
	string: "text-chart-2",
	comment: "italic text-muted-foreground",
	number: "text-chart-4",
	punctuation: "text-muted-foreground",
	tag: "text-chart-1",
	attribute: "text-chart-3",
	type: "text-chart-1",
	function: "text-chart-5",
};

/**
 * The `file=path` option in the info string. Other options (`example=`) belong to the tests, and
 * the screen does not read them.
 */
function fileOf(meta: unknown): string | null {
	if (typeof meta !== "string") return null;
	for (const token of meta.split(/\s+/)) {
		if (token.startsWith("file=")) return token.slice("file=".length);
	}
	return null;
}

function CodeBlock({
	language,
	file,
	code,
}: {
	language: string;
	file: string | null;
	code: string;
}) {
	const tokens = tokenizeCode(code.replace(/\n$/, ""), language);
	return (
		<figure className="my-4 overflow-hidden rounded-lg border bg-muted/40">
			{file !== null && (
				<figcaption className="border-b bg-muted/60 px-3 py-1.5 font-mono text-xs text-muted-foreground">
					{file}
				</figcaption>
			)}
			{/*
			 * Overflowing code scrolls only inside this box. The scroll region must also be reachable by
			 * keyboard (WCAG 2.1.1: without a mouse there is no other way to see the end of a long line),
			 * so it is a named `section` that takes focus. The lint rule treats this as a non-interactive
			 * element with a tabIndex, but scrolling is itself an interaction.
			 */}
			<section
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrolling region must be able to receive keyboard focus
				tabIndex={0}
				aria-label={file ?? runtimeDocsCopy().codeBlock}
				className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
			>
				<pre className="p-4 text-[13px] leading-6 text-foreground">
					<code className="font-mono">
						{tokens.map((token, index) =>
							token.kind === "plain" ? (
								// biome-ignore lint/suspicious/noArrayIndexKey: the token list is static and is never reordered
								<span key={index}>{token.text}</span>
							) : (
								// biome-ignore lint/suspicious/noArrayIndexKey: same reason as above
								<span key={index} className={TOKEN_CLASS[token.kind]}>
									{token.text}
								</span>
							),
						)}
					</code>
				</pre>
			</section>
		</figure>
	);
}

const LINK_CLASS =
	"font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Link destinations come in three kinds:
 *   /docs/runtime/…   router link (between docs)
 *   #…                anchor within the same doc
 *   anything else     plain <a>; external links open in a new tab
 */
function DocAnchor({ href, children }: ComponentPropsWithoutRef<"a">) {
	if (href?.startsWith("/docs/runtime")) {
		const hashIndex = href.indexOf("#");
		const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
		const hash = hashIndex === -1 ? undefined : href.slice(hashIndex + 1);
		const slug = path.replace(/^\/docs\/runtime\/?/, "").replace(/\/$/, "");
		return (
			<RuntimeDocLink slug={slug} hash={hash} className={LINK_CLASS}>
				{children}
			</RuntimeDocLink>
		);
	}
	const external = isExternalHref(href);
	return (
		<a
			href={href}
			target={external ? "_blank" : undefined}
			rel={external ? "noopener noreferrer" : undefined}
			className={LINK_CLASS}
		>
			{children}
		</a>
	);
}

const COMPONENTS = {
	h1: heading(1, "mt-0 mb-4 text-3xl font-bold tracking-tight"),
	h2: heading(
		2,
		"mt-12 mb-4 border-b pb-2 text-xl font-semibold tracking-tight",
	),
	h3: heading(3, "mt-8 mb-3 text-base font-semibold"),
	h4: heading(4, "mt-6 mb-2 text-sm font-semibold"),
	p: ({ children }: ComponentPropsWithoutRef<"p">) => (
		<p className="my-3 leading-7">{children}</p>
	),
	ul: ({ children }: ComponentPropsWithoutRef<"ul">) => (
		<ul className="my-3 list-disc space-y-1.5 pl-6 leading-7">{children}</ul>
	),
	ol: ({ children }: ComponentPropsWithoutRef<"ol">) => (
		<ol className="my-3 list-decimal space-y-1.5 pl-6 leading-7">{children}</ol>
	),
	li: ({ children }: ComponentPropsWithoutRef<"li">) => (
		<li className="pl-1">{children}</li>
	),
	strong: ({ children }: ComponentPropsWithoutRef<"strong">) => (
		<strong className="font-semibold text-foreground">{children}</strong>
	),
	em: ({ children }: ComponentPropsWithoutRef<"em">) => <em>{children}</em>,
	blockquote: ({ children }: ComponentPropsWithoutRef<"blockquote">) => (
		<blockquote className="my-5 rounded-r-lg border-l-4 border-primary/40 bg-muted/40 py-1 pl-4 pr-3 text-sm [&>p]:my-2">
			{children}
		</blockquote>
	),
	table: ({ children }: ComponentPropsWithoutRef<"table">) => (
		<div className="my-5 w-full overflow-x-auto rounded-lg border">
			<table className="w-full border-collapse text-left text-sm">
				{children}
			</table>
		</div>
	),
	thead: ({ children }: ComponentPropsWithoutRef<"thead">) => (
		<thead className="bg-muted/60">{children}</thead>
	),
	th: ({ children }: ComponentPropsWithoutRef<"th">) => (
		<th className="border-b px-3 py-2 font-semibold whitespace-nowrap">
			{children}
		</th>
	),
	td: ({ children }: ComponentPropsWithoutRef<"td">) => (
		<td className="border-b px-3 py-2 align-top last:border-b-0">{children}</td>
	),
	a: DocAnchor,
	hr: () => <hr className="my-8 border-border" />,
	pre: ({ children }: ComponentPropsWithoutRef<"pre">) => <>{children}</>,
	code: ({
		className,
		children,
		node,
	}: ComponentPropsWithoutRef<"code"> & {
		node?: { data?: { meta?: unknown } };
	}) => {
		const language = /language-([A-Za-z0-9-]+)/.exec(className ?? "")?.[1];
		if (language === undefined)
			return (
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
					{children}
				</code>
			);
		return (
			<CodeBlock
				language={language}
				file={fileOf(node?.data?.meta)}
				code={flatten(children)}
			/>
		);
	},
};

export function RuntimeDocsMarkdown({ body }: { body: string }) {
	return (
		<div className="text-[15px] text-muted-foreground [&>*:first-child]:mt-0">
			<Markdown
				remarkPlugins={[remarkGfm]}
				components={COMPONENTS}
				urlTransform={ownedDocumentUrlTransform}
			>
				{body}
			</Markdown>
		</div>
	);
}
