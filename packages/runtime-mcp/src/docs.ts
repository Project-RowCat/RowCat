import {
	findRuntimeAiDoc,
	findRuntimeAiSymbol,
	type RuntimeAiCorpus,
	type RuntimeAiGroupId,
	searchRuntimeDocs,
} from "@rowcat/runtime-ai-docs";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "./errors.ts";
import { RUNTIME_MCP_LIMITS } from "./limits.ts";

/**
 * Documentation tools: search only within RowCat's corpus.
 *
 * There is no web search, no path for fetching arbitrary URLs, and no answering from model memory.
 * This tool exists because of those three absences. The agent sees this language's actual
 * vocabulary instead of fabricating answers from React or React Native memory.
 *
 * Bodies are not poured in whole. Search returns only title, address, score, and excerpt. If the
 * body is needed, the agent reads that document separately. If one search dumped the corpus into
 * context, the agent's context would fill with docs and push out the code that needs fixing.
 */

export interface RuntimeMcpDocResult {
	readonly slug: string;
	readonly title: string;
	readonly url: string;
	readonly description: string;
	readonly body: string;
	readonly symbols: readonly string[];
}

export function searchDocs(
	corpus: RuntimeAiCorpus,
	input: { query: string; group?: RuntimeAiGroupId; limit?: number },
): {
	readonly query: string;
	readonly results: readonly ReturnType<typeof searchRuntimeDocs>[number][];
} {
	const results = searchRuntimeDocs(corpus, {
		query: input.query,
		...(input.group === undefined ? {} : { group: input.group }),
		limit: Math.min(RUNTIME_MCP_LIMITS.searchResults, input.limit ?? 5),
	});
	return { query: input.query, results };
}

/**
 * Body of one document. An unknown slug also returns nearby candidates, so the agent can call
 * again.
 */
export function readDoc(
	corpus: RuntimeAiCorpus,
	slug: string,
): RuntimeMcpDocResult {
	const normalized = slug
		.replace(/^\/?docs\/runtime\/?/, "")
		.replace(/\/$/, "");
	const doc = findRuntimeAiDoc(corpus, normalized);
	if (doc === null)
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.docNotFound,
			`There is no ${slug} doc.`,
			{
				slug: normalized,
				candidates: searchRuntimeDocs(corpus, {
					query: normalized,
					limit: 3,
				}).map((hit) => hit.slug),
			},
		);
	return {
		slug: doc.slug,
		title: doc.title,
		url: doc.url,
		description: doc.description,
		body: doc.body,
		symbols: doc.symbols,
	};
}

export interface RuntimeMcpApiReference {
	readonly apiVersion: number;
	readonly symbols: readonly {
		readonly name: string;
		readonly kind: string;
		readonly summary: string;
		readonly signature?: string;
		readonly doc: string;
		readonly url: string;
	}[];
	/** Set only when no name was given. Counts the entries in the full list. */
	readonly total?: number;
}

/**
 * API reference: one name, or all of them.
 *
 * When all are returned, signatures are omitted. Pouring eighty declarations into one response
 * would fill the agent's context and bury the single name it needs. With names and one-line
 * summaries, the next call can pick exactly one.
 */
export function apiReference(
	corpus: RuntimeAiCorpus,
	input: { name?: string; kind?: string },
): RuntimeMcpApiReference {
	if (input.name !== undefined) {
		const symbol = findRuntimeAiSymbol(corpus, input.name);
		if (symbol === null)
			throw new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.symbolNotFound,
				`@rowcat/runtime has no ${input.name}. This name does not exist in this language.`,
				{
					name: input.name,
					/**
					 * Names that differ only in letter case are a common mistake, so only those are pointed out.
					 */
					similar: corpus.symbols
						.filter(
							(candidate) =>
								candidate.name.toLowerCase() === input.name?.toLowerCase(),
						)
						.map((candidate) => candidate.name),
				},
			);
		return {
			apiVersion: corpus.apiVersion,
			symbols: [
				{
					name: symbol.name,
					kind: symbol.kind,
					summary: symbol.summary,
					signature: symbol.signature,
					doc: symbol.doc,
					url: symbol.url,
				},
			],
		};
	}
	const pool =
		input.kind === undefined
			? corpus.symbols
			: corpus.symbols.filter((symbol) => symbol.kind === input.kind);
	return {
		apiVersion: corpus.apiVersion,
		total: pool.length,
		symbols: pool.map((symbol) => ({
			name: symbol.name,
			kind: symbol.kind,
			summary: symbol.summary,
			doc: symbol.doc,
			url: symbol.url,
		})),
	};
}

/**
 * One example project described in the docs. Examples enter the corpus only if they passed the real
 * compiler (doc generation enforces this), so pasted code that fails to compile does not come from
 * here.
 */
export function readExample(
	corpus: RuntimeAiCorpus,
	id: string,
): {
	readonly id: string;
	readonly doc: string;
	readonly entry: string;
	readonly files: readonly {
		readonly path: string;
		readonly content: string;
	}[];
} {
	const example = corpus.examples.find((candidate) => candidate.id === id);
	if (example === undefined)
		throw new RuntimeMcpError(
			RUNTIME_MCP_ERROR_CODE.exampleNotFound,
			`There is no ${id} example.`,
			{ id, available: corpus.examples.map((candidate) => candidate.id) },
		);
	return {
		id: example.id,
		doc: example.doc,
		entry: example.entry,
		files: example.files.map((file) => ({
			path: file.path,
			content: file.content,
		})),
	};
}
