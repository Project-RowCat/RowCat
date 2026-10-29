import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	readRuntimeDocs,
	RUNTIME_DOC_GROUPS,
	type RuntimeDocsSource,
} from "@rowcat/runtime-ai-docs/source";

/**
 * Generates the creator runtime's public docs (`docs/public/runtime/**\/*.md`) as data modules the
 * app can import.
 *
 * The markdown is the single source and the TSX does not copy sentences. There are three outputs:
 *
 * ```text
 * runtime-docs.ts            manifest: slug, title, group, order, headings. The route's beforeLoad
 *                            and the navigation list read it. Small, because it carries no bodies
 * runtime-docs-content.ts    bodies: only the docs screen imports it. Route components are
 *                            code-split, so this module loads only when a doc is opened
 * runtime-docs-examples.ts   example projects: only tests import it (they run the real compiler)
 * ```
 *
 * One module would bring every body into the main bundle the moment the route tree imports the
 * manifest; this set has more than twenty pages and keeps growing.
 *
 * Reading is not this file's job. Scanning markdown, validating frontmatter and collecting examples
 * live in `@rowcat/runtime-ai-docs/source`, because there are two consumers: this generator and the
 * AI-docs generator that builds `llms.txt` from the same corpus. Two readers would make the docs a
 * screen shows and the docs an agent reads different things, validated by different rules, with no
 * error raised.
 *
 * What remains here is rendering only: the corpus becomes the text of the three modules.
 *
 * Deterministic: the same input yields byte-identical output. `runtime-docs-source.test.ts` runs it
 * again and compares.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const GENERATED_DIR = join(HERE, "..", "src", "generated");
export const MANIFEST_FILE = join(GENERATED_DIR, "runtime-docs.ts");
export const CONTENT_FILE = join(GENERATED_DIR, "runtime-docs-content.ts");
export const EXAMPLES_FILE = join(GENERATED_DIR, "runtime-docs-examples.ts");

export { readRuntimeDocs, RUNTIME_DOC_GROUPS };

const BANNER = (source: string, purpose: string): string =>
	`// Generated from docs/public/runtime/**/*.md — ${purpose}.\n// Do not edit directly.\n//\n// Edit the source md and regenerate with \`pnpm --filter web gen:runtime-docs\`. If this file drifts\n// from its source, runtime-docs-source.test.ts breaks. (${source})\n\n`;

const literal = (value: unknown): string => JSON.stringify(value);

export function renderRuntimeDocsManifest(source: RuntimeDocsSource): string {
	let out = BANNER("manifest", "the manifest the navigation list and routes read");
	out += "export type RuntimeDocGroupId =\n";
	out += RUNTIME_DOC_GROUPS.map((group) => `\t| ${literal(group.id)}`).join("\n");
	out += ";\n\n";
	out += "export interface RuntimeDocGroup {\n\tid: RuntimeDocGroupId;\n\tlabel: string;\n}\n\n";
	out +=
		"export interface RuntimeDocHeading {\n\tlevel: number;\n\ttext: string;\n\tid: string;\n}\n\n";
	out += "/** One doc's header; the body lives separately in `runtime-docs-content.ts`. */\n";
	out +=
		"export interface RuntimeDocEntry {\n\tslug: string;\n\ttitle: string;\n\tdescription: string;\n\tgroup: RuntimeDocGroupId;\n\torder: number;\n\t/** Public API names this page owns; only reference pages have them. */\n\tsymbols: readonly string[];\n\theadings: readonly RuntimeDocHeading[];\n}\n\n";
	out += "/** Group order for the navigation list. Groups without docs are not drawn. */\n";
	out += "export const RUNTIME_DOC_GROUPS: readonly RuntimeDocGroup[] = [\n";
	for (const group of RUNTIME_DOC_GROUPS)
		out += `\t{ id: ${literal(group.id)}, label: ${literal(group.label)} },\n`;
	out += "];\n\n";
	out += "/** Ordered by group, then order, then slug. The navigation list and previous/next use this order. */\n";
	out += "export const RUNTIME_DOC_ENTRIES: readonly RuntimeDocEntry[] = [\n";
	for (const doc of source.docs) {
		out += "\t{\n";
		out += `\t\tslug: ${literal(doc.slug)},\n`;
		out += `\t\ttitle: ${literal(doc.title)},\n`;
		out += `\t\tdescription: ${literal(doc.description)},\n`;
		out += `\t\tgroup: ${literal(doc.group)},\n`;
		out += `\t\torder: ${doc.order},\n`;
		out += `\t\tsymbols: ${literal(doc.symbols)},\n`;
		out += "\t\theadings: [\n";
		for (const heading of doc.headings)
			out += `\t\t\t{ level: ${heading.level}, text: ${literal(heading.text)}, id: ${literal(heading.id)} },\n`;
		out += "\t\t],\n";
		out += "\t},\n";
	}
	out += "];\n\n";
	out += "/** Looks up by slug. The root (`/docs/runtime`) is the empty string; an unknown slug is `null`. */\n";
	out +=
		"export function findRuntimeDocEntry(slug: string): RuntimeDocEntry | null {\n\treturn RUNTIME_DOC_ENTRIES.find((doc) => doc.slug === slug) ?? null;\n}\n";
	return out;
}

export function renderRuntimeDocsContent(source: RuntimeDocsSource): string {
	let out = BANNER("content", "doc bodies; only the docs screens import this");
	out += "/** slug → GFM markdown body, without front matter. */\n";
	out += "export const RUNTIME_DOC_BODIES: Readonly<Record<string, string>> = {\n";
	for (const doc of source.docs) out += `\t${literal(doc.slug)}: ${literal(doc.body)},\n`;
	out += "};\n";
	return out;
}

export function renderRuntimeDocsExamples(source: RuntimeDocsSource): string {
	let out = BANNER("examples", "example projects from the docs; tests run them through the real compiler");
	out +=
		"export interface RuntimeDocExampleFile {\n\tpath: string;\n\tcontent: string;\n}\n\n";
	out +=
		"export interface RuntimeDocExample {\n\tid: string;\n\t/** Slug of the doc this example is written in. */\n\tdoc: string;\n\tentry: string;\n\tfiles: readonly RuntimeDocExampleFile[];\n}\n\n";
	out += "export const RUNTIME_DOC_EXAMPLES: readonly RuntimeDocExample[] = [\n";
	for (const example of source.examples) {
		out += "\t{\n";
		out += `\t\tid: ${literal(example.id)},\n`;
		out += `\t\tdoc: ${literal(example.doc)},\n`;
		out += `\t\tentry: ${literal(example.entry)},\n`;
		out += "\t\tfiles: [\n";
		for (const file of example.files)
			out += `\t\t\t{ path: ${literal(file.path)}, content: ${literal(file.content)} },\n`;
		out += "\t\t],\n";
		out += "\t},\n";
	}
	out += "];\n";
	return out;
}

function main(): void {
	const check = process.argv.includes("--check");
	const source = readRuntimeDocs();
	const outputs: [string, string][] = [
		[MANIFEST_FILE, renderRuntimeDocsManifest(source)],
		[CONTENT_FILE, renderRuntimeDocsContent(source)],
		[EXAMPLES_FILE, renderRuntimeDocsExamples(source)],
	];
	let stale = false;
	for (const [file, expected] of outputs) {
		let current: string | null = null;
		try {
			current = readFileSync(file, "utf8");
		} catch {
			current = null;
		}
		if (current === expected) continue;
		stale = true;
		if (check) {
			process.stderr.write(
				`${relative(ROOT, file)} differs from its source; run pnpm --filter web gen:runtime-docs\n`,
			);
			continue;
		}
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, expected);
	}
	if (check && stale) process.exit(1);
	process.stdout.write(
		`runtime docs: ${stale ? "regenerated" : "up to date"} (${source.docs.length} pages, ${source.examples.length} examples)\n`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
