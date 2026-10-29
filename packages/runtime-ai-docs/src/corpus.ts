/**
 * The shape of the AI corpus: pure types and lookup functions only.
 *
 * Sources: docs/public/runtime (prose, symbol ownership, examples) and the runtime source (names,
 * kinds, signatures, summaries) are merged at generation time. The result feeds llms.txt,
 * llms-full.txt, runtime-api.json, and the MCP doc tools.
 *
 * Why a separate corpus: the three consumers (web /llms.txt, runtime-api.json, and the MCP tools
 * runtime.search_docs and runtime.get_api_reference) must state the same facts. If each read the
 * docs separately, an agent could see one API through a tool and a different one in the docs. That
 * mismatch shows up as agents using names that do not exist, and the compiler only catches it after
 * the agent has written code against them.
 *
 * Deliberately excluded:
 * - `node:fs`. Reading lives in ./source; this module is also loaded in the browser.
 * - The TypeScript compiler. Signature extraction runs at generation time; the corpus holds its
 *   string output.
 * - Network, clock, randomness. Same input, same corpus.
 * - Prose copies. Bodies come from docs/public/runtime unchanged. Rewriting them would create a
 *   second source of sentences.
 */

export const RUNTIME_AI_GROUPS = [
	"getting-started",
	"concepts",
	"guides",
	"reference",
	"runtime-model",
] as const;

export type RuntimeAiGroupId = (typeof RUNTIME_AI_GROUPS)[number];

export interface RuntimeAiHeading {
	readonly level: number;
	readonly text: string;
	readonly id: string;
}

/** One public doc page. An empty `slug` denotes the root page (`/docs/runtime`). */
export interface RuntimeAiDoc {
	readonly slug: string;
	readonly url: string;
	readonly title: string;
	readonly description: string;
	readonly group: RuntimeAiGroupId;
	readonly order: number;
	/** Public API names this page owns. Only reference pages carry this list. */
	readonly symbols: readonly string[];
	readonly headings: readonly RuntimeAiHeading[];
	/** Body with frontmatter removed (GFM). Kept verbatim from the source, not rewritten. */
	readonly body: string;
}

/**
 * Kind of a public API name, derived from the shape of its signature. `component` is kept separate
 * because it describes where a value is used, not what it is. `Screen` is a constant meant to be
 * placed inside TSX; `useState` is a function that follows the hook rules. Without the split the
 * reference becomes one flat list.
 */
export type RuntimeAiSymbolKind =
	| "component"
	| "hook"
	| "function"
	| "constant"
	| "class"
	| "type"
	| "interface";

export interface RuntimeAiSymbol {
	readonly name: string;
	readonly kind: RuntimeAiSymbolKind;
	/**
	 * The declaration text, with the implementation omitted. Functions keep their signature, `const`
	 * keeps its name and type annotation, and types and interfaces are included whole. Including
	 * implementations makes agents read them as part of the API, which does happen: agents try to call
	 * internal helper names.
	 */
	readonly signature: string;
	/** One-sentence summary: the first sentence of the source JSDoc, or an empty string if none. */
	readonly summary: string;
	/**
	 * Slug of the doc that explains this name. Generation fails without an owner, so it is always set.
	 */
	readonly doc: string;
	readonly url: string;
}

export interface RuntimeAiExampleFile {
	readonly path: string;
	readonly content: string;
}

/**
 * An example project from the docs. Only examples that passed the real compiler reach this point.
 */
export interface RuntimeAiExample {
	readonly id: string;
	readonly doc: string;
	readonly entry: string;
	readonly files: readonly RuntimeAiExampleFile[];
}

export interface RuntimeAiCorpus {
	/** Version of the language contract this corpus describes, taken from `RUNTIME_API_VERSION`. */
	readonly apiVersion: number;
	/**
	 * Agent-only guidance (`_agents.md`), which is not in the public doc list. It is not a public page
	 * because the readers differ. It holds work procedures (search the docs first, compile after
	 * editing, check the preview). Putting such sentences in a human-facing doc would blur that doc's
	 * purpose.
	 */
	readonly agentGuide: string;
	readonly docs: readonly RuntimeAiDoc[];
	readonly symbols: readonly RuntimeAiSymbol[];
	readonly examples: readonly RuntimeAiExample[];
	/**
	 * Names that `@rowcat/runtime` exports but no doc explains. A non-empty list is a defect, and the
	 * test reports it by name. Generation still does not fail, because of the direction of failure.
	 * Stopping here would let one runtime slice that landed ahead of its docs block the whole
	 * `llms.txt`, leaving agents unable to read the names that are already documented. Instead these
	 * names are left out of `symbols`. A reference entry for an undocumented name would tell agents it
	 * is usable, and it may only run on one platform so far. Silence costs less than a wrong promise.
	 */
	readonly undocumented: readonly string[];
}

export const runtimeDocUrl = (slug: string): string =>
	slug.length === 0 ? "/docs/runtime" : `/docs/runtime/${slug}`;

export const findRuntimeAiDoc = (
	corpus: RuntimeAiCorpus,
	slug: string,
): RuntimeAiDoc | null => corpus.docs.find((doc) => doc.slug === slug) ?? null;

/**
 * Finds one API by name, case-sensitively. Case-insensitive matching would let `text` find `Text`,
 * and agents would then believe the lowercase name exists. This language only has `Text`.
 */
export const findRuntimeAiSymbol = (
	corpus: RuntimeAiCorpus,
	name: string,
): RuntimeAiSymbol | null =>
	corpus.symbols.find((symbol) => symbol.name === name) ?? null;

/**
 * Groups public names by kind; used to build the reference's table of contents. Order is the corpus
 * order, unchanged.
 */
export function runtimeSymbolsByKind(
	corpus: RuntimeAiCorpus,
): ReadonlyMap<RuntimeAiSymbolKind, readonly RuntimeAiSymbol[]> {
	const out = new Map<RuntimeAiSymbolKind, RuntimeAiSymbol[]>();
	for (const symbol of corpus.symbols) {
		const bucket = out.get(symbol.kind);
		if (bucket === undefined) out.set(symbol.kind, [symbol]);
		else bucket.push(symbol);
	}
	return out;
}

/** Docs grouped by section. Navigation and the llms.txt sections share this one order. */
export function runtimeDocsByGroup(
	corpus: RuntimeAiCorpus,
): readonly { group: RuntimeAiGroupId; docs: readonly RuntimeAiDoc[] }[] {
	return RUNTIME_AI_GROUPS.map((group) => ({
		group,
		docs: corpus.docs.filter((doc) => doc.group === group),
	})).filter((entry) => entry.docs.length > 0);
}
