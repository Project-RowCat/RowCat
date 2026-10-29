import {
	type RuntimeAiCorpus,
	type RuntimeAiSymbolKind,
	runtimeDocsByGroup,
	runtimeSymbolsByKind,
} from "./corpus.ts";

/**
 * Turns the corpus into the three files agents read. Pure and deterministic.
 * - llms.txt: one-page bootstrap with rules, the doc list, and every public name.
 * - llms-full.txt: the whole corpus concatenated, for loading into context at once.
 * - runtime-api.json: machine-readable reference, for exact lookup of one name.
 *
 * This module writes no product sentences; it contributes only the table of contents and cover
 * pages. Every explanation comes unchanged from docs/public/runtime, and `_agents.md` also keeps
 * its raw markdown as the single source.
 *
 * Default addresses are root-relative (`/docs/runtime/...`) because each deployment has a different
 * origin. A hardcoded absolute URL would turn a deployment fact into code, and a staging build's
 * llms.txt would point at production. The caller that passes `origin` (the web generation script)
 * makes that decision.
 */

export interface RuntimeLlmsOptions {
	/** Source origin such as `https://example.com`. When empty, links stay root-relative. */
	readonly origin?: string;
}

const KIND_LABEL: Readonly<Record<RuntimeAiSymbolKind, string>> = {
	component: "component",
	hook: "hook",
	function: "function",
	constant: "constant",
	class: "class",
	type: "type",
	interface: "interface",
};

/** Order in which llms.txt lists public names: the order agents look up most often. */
const KIND_ORDER: readonly RuntimeAiSymbolKind[] = [
	"component",
	"hook",
	"function",
	"constant",
	"class",
	"type",
	"interface",
];

const GROUP_LABEL = {
	"getting-started": "Getting started",
	concepts: "Core concepts",
	guides: "Guides",
	reference: "API reference",
	"runtime-model": "Runtime model",
} as const;

const absolute = (origin: string | undefined, url: string): string =>
	origin === undefined || origin.length === 0
		? url
		: `${origin.replace(/\/+$/, "")}${url}`;

/**
 * Adds the origin to document links inside markdown. Bodies come unchanged from the markdown
 * sources, so their links are root-relative. An agent reading this file elsewhere cannot reach such
 * an address, so whoever knows the origin adds it here. With no origin, nothing is changed.
 */
const withOrigin = (markdown: string, origin: string | undefined): string =>
	origin === undefined || origin.length === 0
		? markdown
		: markdown.replaceAll(
				"](/docs/runtime",
				`](${origin.replace(/\/+$/, "")}/docs/runtime`,
			);

/** Strips the first `# title` line from the body, since the outer document already has a title. */
const withoutTitle = (body: string): string =>
	body.replace(/^#\s+.*\n+/, "").trimEnd();

export function renderLlmsTxt(
	corpus: RuntimeAiCorpus,
	options: RuntimeLlmsOptions = {},
): string {
	const { origin } = options;
	const index = corpus.docs.find((doc) => doc.slug === "");
	const out: string[] = [];

	out.push("# RowCat creator runtime");
	out.push("");
	out.push(
		`> ${index?.description ?? "How to build a RowCat story's screens, state and interaction in TypeScript and TSX."} (language contract v${corpus.apiVersion})`,
	);
	out.push("");
	out.push(withOrigin(withoutTitle(corpus.agentGuide), origin));
	out.push("");

	for (const { group, docs } of runtimeDocsByGroup(corpus)) {
		out.push(`## ${GROUP_LABEL[group]}`);
		out.push("");
		for (const doc of docs)
			out.push(
				`- [${doc.title}](${absolute(origin, doc.url)}): ${doc.description}`,
			);
		out.push("");
	}

	const byKind = runtimeSymbolsByKind(corpus);
	out.push(`## The whole public API (${corpus.symbols.length} names)`);
	out.push("");
	out.push(
		"The names below are everything `@rowcat/runtime` exports. **A name not here does not exist in this language.**",
	);
	out.push("");
	for (const kind of KIND_ORDER) {
		const symbols = byKind.get(kind);
		if (symbols === undefined || symbols.length === 0) continue;
		out.push(`### ${KIND_LABEL[kind]}`);
		out.push("");
		for (const symbol of symbols)
			out.push(
				`- \`${symbol.name}\` — [${symbol.doc === "" ? "Introduction" : symbol.doc}](${absolute(origin, symbol.url)})`,
			);
		out.push("");
	}

	out.push("## Optional");
	out.push("");
	out.push(
		`- [llms-full.txt](${absolute(origin, "/llms-full.txt")}): the full text of all ${corpus.docs.length} public docs, for putting the whole thing in context.`,
	);
	out.push(
		`- [runtime-api.json](${absolute(origin, "/runtime-api.json")}): a machine-readable API reference: names, kinds, signatures and doc comments.`,
	);
	out.push("");
	return `${out
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd()}\n`;
}

export function renderLlmsFullTxt(
	corpus: RuntimeAiCorpus,
	options: RuntimeLlmsOptions = {},
): string {
	const { origin } = options;
	const out: string[] = [];
	out.push("# RowCat creator runtime: full public docs");
	out.push("");
	out.push(
		`> Language contract v${corpus.apiVersion} · ${corpus.docs.length} docs · ${corpus.symbols.length} public names. The source is \`docs/public/runtime\` in the repository.`,
	);
	out.push("");
	out.push(withOrigin(withoutTitle(corpus.agentGuide), origin));

	for (const doc of corpus.docs) {
		out.push("");
		out.push("---");
		out.push("");
		out.push(
			`<!-- ${absolute(origin, doc.url)} · docs/public/runtime/${doc.slug === "" ? "index" : doc.slug}.md -->`,
		);
		out.push("");
		out.push(withOrigin(doc.body.trimEnd(), origin));
	}
	out.push("");
	return `${out.join("\n").trimEnd()}\n`;
}

/**
 * Machine-readable reference. Keys are written out by hand in a fixed order, because
 * `JSON.stringify` follows insertion order: the shape of the object built here is the file's bytes.
 */
export function renderRuntimeApiJson(
	corpus: RuntimeAiCorpus,
	options: RuntimeLlmsOptions = {},
): string {
	const { origin } = options;
	return `${JSON.stringify(
		{
			apiVersion: corpus.apiVersion,
			package: "@rowcat/runtime",
			docs: corpus.docs.map((doc) => ({
				slug: doc.slug,
				title: doc.title,
				description: doc.description,
				group: doc.group,
				url: absolute(origin, doc.url),
				symbols: doc.symbols,
			})),
			symbols: corpus.symbols.map((symbol) => ({
				name: symbol.name,
				kind: symbol.kind,
				summary: symbol.summary,
				signature: symbol.signature,
				doc: symbol.doc,
				url: absolute(origin, symbol.url),
			})),
		},
		null,
		"\t",
	)}\n`;
}
