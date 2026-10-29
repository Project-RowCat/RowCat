import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { headingAnchor } from "../heading-anchor.ts";

/**
 * The one implementation that reads and validates `docs/public/runtime/**\/*.md`.
 *
 * It lives in the package, not the app, because the markdown is a repository asset. Three consumers
 * read it:
 * - apps/web: doc screens draw bodies, manifests, and examples (gen-runtime-docs.ts)
 * - @rowcat/runtime-ai-docs: the corpus and llms.txt (scripts/generate.ts)
 * - the MCP server: runtime.search_docs searches that corpus
 *
 * Two readers would let frontmatter key rules, link validation, and example collection drift apart,
 * and the symptom would be one output going stale without any error.
 *
 * Only this file knows Node. `node:fs` stays out of the pure layer (../corpus.ts, ../llms.ts),
 * matching the environment/node.ts split in runtime-compiler: reading is a file system job, while
 * what is built from the corpus is pure.
 *
 * Validation is part of reading. Missing required frontmatter keys, unknown groups, duplicate
 * slugs, links to missing pages, anchors to missing headings, and example projects without an entry
 * file all fail the read. Failing here, with the name written out, is cheaper than finding a dead
 * link on screen.
 *
 * Deterministic: same input, same output. No clock, randomness, or environment reads; the sort is
 * total (group order, then `order`, then slug).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repository root. This file lives in `packages/<pkg>/src/source/`, four levels down. */
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
export const RUNTIME_DOCS_DIR = join(REPO_ROOT, "docs", "public", "runtime");

/** Group order and labels. The navigation list is drawn in this order. */
export const RUNTIME_DOC_GROUPS = [
	{ id: "getting-started", label: "Getting started" },
	{ id: "concepts", label: "Core concepts" },
	{ id: "guides", label: "Guides" },
	{ id: "reference", label: "API reference" },
	{ id: "runtime-model", label: "Runtime model" },
] as const;

export type RuntimeDocGroupId = (typeof RUNTIME_DOC_GROUPS)[number]["id"];

export interface RuntimeDocHeading {
	level: number;
	text: string;
	id: string;
}

export interface RuntimeDocSource {
	slug: string;
	title: string;
	description: string;
	group: RuntimeDocGroupId;
	order: number;
	symbols: readonly string[];
	headings: readonly RuntimeDocHeading[];
	body: string;
}

export interface RuntimeDocExampleFile {
	path: string;
	content: string;
}

export interface RuntimeDocExample {
	id: string;
	/** Slug of the doc that contains this example, so failure messages can name the page to fix. */
	doc: string;
	entry: string;
	files: readonly RuntimeDocExampleFile[];
}

const EXAMPLE_ENTRY = "src/main.tsx";
const DOC_FILE_RE = /^[a-z0-9-]+\.md$/;
const SLUG_RE = /^(?:[a-z0-9-]+)(?:\/[a-z0-9-]+)*$/;
const SYMBOL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXAMPLE_ID_RE = /^[a-z0-9-]+$/;
const EXAMPLE_PATH_RE = /^src\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.tsx?$/;
const FENCE_OPEN_RE = /^```([A-Za-z0-9-]*)(?:\s+(.*))?$/;
const DOC_LINK_RE = /\]\((\/docs\/runtime[^)\s]*)\)/g;
const RELATIVE_MD_LINK_RE =
	/\]\((?:\.{1,2}\/)?[A-Za-z0-9/_-]+\.md(?:#[^)]*)?\)/;

const GROUP_IDS = new Set<string>(RUNTIME_DOC_GROUPS.map((group) => group.id));

interface Frontmatter {
	data: Record<string, string>;
	body: string;
}

function parseFrontmatter(raw: string, file: string): Frontmatter {
	const text = raw
		.replace(/^﻿/, "")
		.replace(/\r\n/g, "\n")
		.replace(/^\s*\n/, "");
	if (!text.startsWith("---\n"))
		throw new Error(`${file}: must start with frontmatter (---)`);
	const end = text.indexOf("\n---", 3);
	if (end === -1) throw new Error(`${file}: the frontmatter is not closed`);
	const head = text.slice(4, end);
	const body = text.slice(end + 4).replace(/^\n/, "");
	const data: Record<string, string> = {};
	for (const line of head.split("\n")) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const colon = line.indexOf(":");
		if (colon === -1)
			throw new Error(
				`${file}: a frontmatter line is not 'key: value': ${line}`,
			);
		const key = line.slice(0, colon).trim();
		const value = line
			.slice(colon + 1)
			.trim()
			.replace(/^["'](.*)["']$/, "$1");
		data[key] = value;
	}
	return { data, body };
}

function listDocFiles(dir: string, base = dir): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	)) {
		if (entry.name.startsWith("_") || entry.name === "README.md") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listDocFiles(full, base));
			continue;
		}
		if (!DOC_FILE_RE.test(entry.name))
			throw new Error(
				`${relative(base, full)}: doc file names must be lowercase letters, digits and hyphens, ending in .md`,
			);
		files.push(full);
	}
	return files;
}

function slugOf(file: string): string {
	const rel = relative(RUNTIME_DOCS_DIR, file).replace(/\\/g, "/");
	const withoutExtension = rel.slice(0, -".md".length);
	if (withoutExtension === "index") return "";
	if (withoutExtension.endsWith("/index"))
		return withoutExtension.slice(0, -"/index".length);
	return withoutExtension;
}

interface FenceScan {
	headings: RuntimeDocHeading[];
	examples: Map<string, RuntimeDocExampleFile[]>;
}

/**
 * Scans the body once to collect headings and example files. A `#` inside a code block is not a
 * heading, so the scan tracks fence state. Of the `key=value` tokens in a fence info string, only
 * `example=` and `file=` mean anything here; the rest belong to the renderer.
 */
function scanBody(body: string, file: string): FenceScan {
	const headings: RuntimeDocHeading[] = [];
	const examples = new Map<string, RuntimeDocExampleFile[]>();
	const lines = body.split("\n");
	let fence: {
		example: string | null;
		path: string | null;
		lines: string[];
	} | null = null;

	for (const line of lines) {
		if (fence !== null) {
			if (line.trimEnd() === "```") {
				if (fence.example !== null && fence.path !== null) {
					const files = examples.get(fence.example) ?? [];
					if (files.some((existing) => existing.path === fence?.path))
						throw new Error(
							`${file}: example ${fence.example} has ${fence.path} twice`,
						);
					files.push({
						path: fence.path,
						content: `${fence.lines.join("\n")}\n`,
					});
					examples.set(fence.example, files);
				}
				fence = null;
				continue;
			}
			fence.lines.push(line);
			continue;
		}

		const open = FENCE_OPEN_RE.exec(line);
		if (open) {
			const language = open[1] ?? "";
			if (language.length === 0)
				throw new Error(
					`${file}: a code block has no language; write it like \`\`\`text`,
				);
			const meta = (open[2] ?? "").trim();
			let example: string | null = null;
			let path: string | null = null;
			for (const token of meta.length === 0 ? [] : meta.split(/\s+/)) {
				const equals = token.indexOf("=");
				if (equals === -1)
					throw new Error(
						`${file}: a code block info string is not key=value: ${token}`,
					);
				const key = token.slice(0, equals);
				const value = token.slice(equals + 1);
				if (key === "example") {
					if (!EXAMPLE_ID_RE.test(value))
						throw new Error(
							`${file}: the example name breaks the rules: ${value}`,
						);
					example = value;
				} else if (key === "file") {
					if (!EXAMPLE_PATH_RE.test(value))
						throw new Error(
							`${file}: the example file path breaks the rules: ${value}`,
						);
					path = value;
				} else throw new Error(`${file}: unknown code block option: ${key}`);
			}
			if ((example === null) !== (path === null))
				throw new Error(
					`${file}: an example block needs both example= and file=: ${meta}`,
				);
			if (example !== null && language !== "ts" && language !== "tsx")
				throw new Error(
					`${file}: an example block's language must be ts or tsx: ${language}`,
				);
			fence = { example, path, lines: [] };
			continue;
		}

		const heading = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) {
			const level = heading[1]?.length ?? 1;
			const text = (heading[2] ?? "").replace(/`/g, "");
			headings.push({ level, text, id: headingAnchor(text) });
		}
	}
	if (fence !== null) throw new Error(`${file}: a code block is not closed`);
	return { headings, examples };
}

export interface RuntimeDocsSource {
	docs: RuntimeDocSource[];
	examples: RuntimeDocExample[];
}

export function readRuntimeDocs(dir = RUNTIME_DOCS_DIR): RuntimeDocsSource {
	const docs: RuntimeDocSource[] = [];
	const examples: RuntimeDocExample[] = [];
	const seenSlugs = new Set<string>();
	const seenSymbols = new Map<string, string>();
	const seenExamples = new Map<string, string>();
	const seenOrders = new Set<string>();

	for (const file of listDocFiles(dir)) {
		const label = relative(dir, file);
		const { data, body } = parseFrontmatter(readFileSync(file, "utf8"), label);
		const slug = slugOf(file);
		if (slug.length > 0 && !SLUG_RE.test(slug))
			throw new Error(`${label}: the slug breaks the rules: ${slug}`);
		if (seenSlugs.has(slug))
			throw new Error(`${label}: duplicate slug: ${slug}`);
		seenSlugs.add(slug);

		for (const key of ["title", "description", "group", "order"] as const)
			if (!data[key])
				throw new Error(`${label}: the frontmatter has no ${key}`);
		const group = data.group ?? "";
		if (!GROUP_IDS.has(group))
			throw new Error(`${label}: unknown group: ${group}`);
		const order = Number(data.order);
		if (!Number.isInteger(order) || order < 1)
			throw new Error(
				`${label}: order must be an integer of at least 1: ${data.order}`,
			);
		const orderKey = `${group}:${order}`;
		if (seenOrders.has(orderKey))
			throw new Error(
				`${label}: two docs in the same group share an order: ${orderKey}`,
			);
		seenOrders.add(orderKey);

		const symbols = (data.symbols ?? "")
			.split(",")
			.map((symbol) => symbol.trim())
			.filter((symbol) => symbol.length > 0);
		for (const symbol of symbols) {
			if (!SYMBOL_RE.test(symbol))
				throw new Error(`${label}: a non-name value in symbols: ${symbol}`);
			const owner = seenSymbols.get(symbol);
			if (owner !== undefined)
				throw new Error(
					`${label}: ${symbol} is already owned by ${owner}; a public API belongs to one page only`,
				);
			seenSymbols.set(symbol, label);
			/**
			 * Checks that the body actually names the symbol, written as `name`, `name(…)`, or `name<T>`.
			 */
			if (!new RegExp(`\`${symbol}[\`(<]`).test(body))
				throw new Error(
					`${label}: ${symbol} in symbols never appears in the body as \`${symbol}\``,
				);
		}

		if (RELATIVE_MD_LINK_RE.test(body))
			throw new Error(
				`${label}: links between docs use absolute /docs/runtime/… paths (no relative .md links)`,
			);

		const { headings, examples: found } = scanBody(body, label);
		const ids = new Set<string>();
		for (const heading of headings) {
			if (ids.has(heading.id))
				throw new Error(`${label}: duplicate heading anchor: #${heading.id}`);
			ids.add(heading.id);
		}
		if (headings[0]?.level !== 1)
			throw new Error(`${label}: the body must start with one # heading`);
		if (headings.filter((heading) => heading.level === 1).length !== 1)
			throw new Error(`${label}: there must be only one # heading`);

		for (const [id, files] of found) {
			const owner = seenExamples.get(id);
			if (owner !== undefined && owner !== label)
				throw new Error(`${label}: example ${id} is already in ${owner}`);
			seenExamples.set(id, label);
			if (!files.some((entry) => entry.path === EXAMPLE_ENTRY))
				throw new Error(
					`${label}: example ${id} has no entry file ${EXAMPLE_ENTRY}`,
				);
			examples.push({
				id,
				doc: slug,
				entry: EXAMPLE_ENTRY,
				files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
			});
		}

		docs.push({
			slug,
			title: data.title ?? "",
			description: data.description ?? "",
			group: group as RuntimeDocGroupId,
			order,
			symbols,
			headings,
			body,
		});
	}

	/** Links are checked after every doc is read, because an earlier doc may link to a later one. */
	const bySlug = new Map(docs.map((doc) => [doc.slug, doc] as const));
	for (const doc of docs) {
		for (const match of doc.body.matchAll(DOC_LINK_RE)) {
			const href = match[1] ?? "";
			const hash = href.indexOf("#");
			const path = hash === -1 ? href : href.slice(0, hash);
			const anchor = hash === -1 ? null : href.slice(hash + 1);
			const target = path.replace(/^\/docs\/runtime\/?/, "").replace(/\/$/, "");
			const targetDoc = bySlug.get(target);
			if (targetDoc === undefined)
				throw new Error(
					`${doc.slug || "index"}: a link to a doc that does not exist: ${href}`,
				);
			if (
				anchor !== null &&
				!targetDoc.headings.some((heading) => heading.id === anchor)
			)
				throw new Error(
					`${doc.slug || "index"}: an anchor to a heading that does not exist: ${href}`,
				);
		}
	}

	const groupRank = new Map(
		RUNTIME_DOC_GROUPS.map((group, index) => [group.id, index]),
	);
	docs.sort((left, right) => {
		const byGroup =
			(groupRank.get(left.group) ?? 0) - (groupRank.get(right.group) ?? 0);
		if (byGroup !== 0) return byGroup;
		if (left.order !== right.order) return left.order - right.order;
		return left.slug < right.slug ? -1 : 1;
	});
	examples.sort((left, right) => (left.id < right.id ? -1 : 1));
	if (!bySlug.has(""))
		throw new Error(
			"index.md is missing; the first screen of /docs/runtime would be empty",
		);
	return { docs, examples };
}
