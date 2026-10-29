import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	RuntimeAiCorpus,
	RuntimeAiDoc,
	RuntimeAiSymbol,
} from "../corpus.ts";
import { runtimeDocUrl } from "../corpus.ts";
import { extractRuntimeApi } from "./api.ts";
import { RUNTIME_DOCS_DIR, readRuntimeDocs } from "./docs.ts";

/**
 * Where the corpus is assembled. The two sources meet here and stop on mismatch.
 *
 * - docs/public/runtime supplies prose, ownership (`symbols` frontmatter), and examples.
 * - The runtime source supplies names, kinds, signatures, and one-line summaries.
 * - The cross-check runs both ways. A name in the source that no page owns fails: no public API
 *   ships undocumented. A page claiming a name the source lacks fails: agents must not trust an API
 *   that does not exist. The second direction matters because a misspelled or removed name in a
 *   hand-written doc would make an agent write code against it; the compiler catches that only
 *   after the agent has already written it across several files.
 * - `_agents.md` is skipped by the doc reader (underscore prefix, not a public page). The same
 *   rule keeps agent-only guidance as raw markdown; this file does not write those sentences.
 */

const AGENT_GUIDE = "_agents.md";

export function buildRuntimeAiCorpus(
	docsDir: string = RUNTIME_DOCS_DIR,
): RuntimeAiCorpus {
	const source = readRuntimeDocs(docsDir);
	const api = extractRuntimeApi();

	const docs: RuntimeAiDoc[] = source.docs.map((doc) => ({
		slug: doc.slug,
		url: runtimeDocUrl(doc.slug),
		title: doc.title,
		description: doc.description,
		group: doc.group,
		order: doc.order,
		symbols: [...doc.symbols].sort(),
		headings: doc.headings.map((heading) => ({ ...heading })),
		body: doc.body,
	}));

	/**
	 * Maps each name to the page that owns it. The doc reader has already enforced unique ownership.
	 */
	const owner = new Map<string, RuntimeAiDoc>();
	for (const doc of docs) for (const name of doc.symbols) owner.set(name, doc);

	const exported = new Set(api.symbols.map((symbol) => symbol.name));
	const phantom = [...owner.keys()]
		.filter((name) => !exported.has(name))
		.sort();
	if (phantom.length > 0)
		throw new Error(
			`a name the docs claim to own is not in @rowcat/runtime: ${phantom.join(", ")}; fix the frontmatter symbols`,
		);

	const undocumented: string[] = [];
	const symbols: RuntimeAiSymbol[] = [];
	for (const symbol of api.symbols) {
		const page = owner.get(symbol.name);
		if (page === undefined) {
			undocumented.push(symbol.name);
			continue;
		}
		symbols.push({
			name: symbol.name,
			kind: symbol.kind,
			signature: symbol.signature,
			summary: symbol.summary,
			doc: page.slug,
			url: page.url,
		});
	}

	return {
		apiVersion: api.apiVersion,
		agentGuide: readFileSync(join(docsDir, AGENT_GUIDE), "utf8")
			.replace(/\r\n/g, "\n")
			.trimEnd(),
		docs,
		symbols,
		undocumented,
		examples: source.examples.map((example) => ({
			id: example.id,
			doc: example.doc,
			entry: example.entry,
			files: example.files.map((file) => ({ ...file })),
		})),
	};
}
