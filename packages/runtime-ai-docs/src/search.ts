import type {
	RuntimeAiCorpus,
	RuntimeAiDoc,
	RuntimeAiGroupId,
} from "./corpus.ts";

/**
 * Lexical search limited to the corpus. Pure and deterministic.
 *
 * Why not embeddings: the corpus is just over twenty docs with a narrow vocabulary
 * (`useStoryState`, `asset`, `RuntimeStyle`). At that size vector search adds little and costs
 * three things: determinism (same query, same answer), explainability (scores can say why a page
 * matched), and offline use (no model or index build). Chat memory deduplication also avoids
 * embeddings, for the same reasons.
 *
 * Substring counting, because of Korean. Whole-token matching misses inflected forms: a query for
 * a Korean stem misses its forms with particles attached. A morphological analyzer is too heavy at this size, and substring
 * containment catches most inflected forms in a language with particles. Single-letter Latin tokens
 * are dropped: `a` appears in every document and would flatten the scores.
 *
 * Results are finite. The agent receives title, address, score, and excerpt, never the body. To
 * read the body it opens that document separately. A search that dumped the corpus into context
 * would defeat its purpose.
 */

export interface RuntimeDocSearchOptions {
	readonly query: string;
	/** Narrows to this group. An unknown value does not narrow; the query is not rejected. */
	readonly group?: RuntimeAiGroupId;
	/** Default 5, maximum 20. */
	readonly limit?: number;
}

export interface RuntimeDocSearchHit {
	readonly slug: string;
	readonly url: string;
	readonly title: string;
	readonly description: string;
	readonly group: RuntimeAiGroupId;
	readonly score: number;
	/** A slice cut from the body. With no match, the description is used instead. */
	readonly excerpt: string;
	/** Headings the query matched. The agent can jump straight to those anchors. */
	readonly headings: readonly string[];
	readonly symbols: readonly string[];
}

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 5;
const EXCERPT_RADIUS = 180;

/**
 * Non-ASCII characters. This decides whether single-character tokens are kept: a single Hangul
 * character can carry meaning, so it is kept.
 */
const NON_ASCII = /[^ -~]/;

export function tokenizeSearchQuery(query: string): readonly string[] {
	const raw = query
		.toLowerCase()
		.split(/[^\p{L}\p{N}_$]+/u)
		.filter((token) => token.length > 0);
	const out: string[] = [];
	for (const token of raw) {
		if (token.length === 1 && !NON_ASCII.test(token)) continue;
		if (!out.includes(token)) out.push(token);
	}
	return out;
}

const occurrences = (haystack: string, needle: string, cap: number): number => {
	let count = 0;
	let at = haystack.indexOf(needle);
	while (at !== -1 && count < cap) {
		count += 1;
		at = haystack.indexOf(needle, at + needle.length);
	}
	return count;
};

interface Scored {
	readonly doc: RuntimeAiDoc;
	readonly score: number;
	readonly headings: string[];
	readonly symbols: string[];
	/** Where to cut the excerpt: the first position in the body of the highest-value token. */
	readonly at: number;
	readonly rank: number;
}

function scoreDoc(
	doc: RuntimeAiDoc,
	tokens: readonly string[],
	rank: number,
): Scored | null {
	const title = doc.title.toLowerCase();
	const description = doc.description.toLowerCase();
	const body = doc.body.toLowerCase();
	let score = 0;
	let at = -1;
	let best = 0;
	const headings: string[] = [];
	const symbols: string[] = [];

	for (const token of tokens) {
		let tokenScore = 0;
		if (title.includes(token)) tokenScore += 8;
		if (description.includes(token)) tokenScore += 4;
		for (const heading of doc.headings) {
			if (!heading.text.toLowerCase().includes(token)) continue;
			tokenScore += 3;
			if (!headings.includes(heading.text)) headings.push(heading.text);
		}
		for (const symbol of doc.symbols) {
			const lowered = symbol.toLowerCase();
			if (lowered === token) tokenScore += 12;
			else if (lowered.includes(token)) tokenScore += 4;
			else continue;
			if (!symbols.includes(symbol)) symbols.push(symbol);
		}
		tokenScore += occurrences(body, token, 5);
		if (tokenScore === 0) continue;
		score += tokenScore;
		if (tokenScore > best) {
			const found = body.indexOf(token);
			if (found !== -1) {
				best = tokenScore;
				at = found;
			}
		}
	}
	if (score === 0) return null;
	return { doc, score, headings, symbols, at, rank };
}

/**
 * Excerpt: cuts on line boundaries and collapses whitespace. Cuts often fall inside code fences, so
 * the cut snaps to lines. A cut code block reads to the agent as an example that does not compile,
 * and agents do paste such fragments.
 */
function excerptAround(body: string, at: number): string {
	if (at < 0) return "";
	const from = body.lastIndexOf("\n", Math.max(0, at - EXCERPT_RADIUS));
	const toRaw = body.indexOf("\n", at + EXCERPT_RADIUS);
	const start = from === -1 ? 0 : from + 1;
	const end = toRaw === -1 ? body.length : toRaw;
	const slice = body.slice(start, end).replace(/\s+/g, " ").trim();
	if (slice.length === 0) return "";
	return `${start > 0 ? "… " : ""}${slice}${end < body.length ? " …" : ""}`;
}

export function searchRuntimeDocs(
	corpus: RuntimeAiCorpus,
	options: RuntimeDocSearchOptions,
): readonly RuntimeDocSearchHit[] {
	const tokens = tokenizeSearchQuery(options.query);
	if (tokens.length === 0) return [];
	const limit = Math.min(
		MAX_LIMIT,
		Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)),
	);
	const pool =
		options.group === undefined
			? corpus.docs
			: corpus.docs.filter((doc) => doc.group === options.group);

	const scored: Scored[] = [];
	pool.forEach((doc, rank) => {
		const hit = scoreDoc(doc, tokens, rank);
		if (hit !== null) scored.push(hit);
	});
	/**
	 * Ties in score fall back to corpus order. This makes the ordering total, so the same query always
	 * returns the same answer.
	 */
	scored.sort((left, right) =>
		left.score !== right.score
			? right.score - left.score
			: left.rank - right.rank,
	);

	return scored.slice(0, limit).map((entry) => ({
		slug: entry.doc.slug,
		url: entry.doc.url,
		title: entry.doc.title,
		description: entry.doc.description,
		group: entry.doc.group,
		score: entry.score,
		excerpt: excerptAround(entry.doc.body, entry.at) || entry.doc.description,
		headings: entry.headings.slice(0, 5),
		symbols: entry.symbols.slice(0, 10),
	}));
}
