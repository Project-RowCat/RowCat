import { runtimeSearchNeedle } from "../commands/quick-open.ts";

/**
 * The position of the query inside this string, as fragments for the renderer.
 *
 * Ranking (runtime-quick-open.ts) is a separate function because the questions differ: ranking
 * decides which file sits on top, and this decides which characters to bold. One function doing
 * both would add a parts field to the ranking result, and changes to ranking would break drawing.
 *
 * Highlighting must explain ranking. Normalization is the same function (runtimeSearchNeedle), not
 * a copy. Without trim, a query with spaces loses its highlight while the row stays listed; without
 * case folding, Main.tsx gets no bold. Neither case raises an error.
 *
 * Matching is substring-based (includes), so highlighting never joins scattered characters. A fuzzy
 * highlight would claim search does something it does not. If search becomes fuzzy, this function
 * changes in the same commit.
 *
 * Every occurrence is highlighted, not just the first.
 */

export interface RuntimeTextMatchPart {
	text: string;
	matched: boolean;
}

/**
 * Splits text into highlight fragments without losing any character. Joining the fragments always
 * gives back the text. The renderer draws only these fragments, so a dropped character would make
 * the file name the user typed disappear from the screen.
 *
 * An empty query yields one unhighlighted fragment. Returning [] would blank every row the moment
 * the palette opens with an empty query.
 */
export function highlightRuntimeMatch(
	text: string,
	query: string,
): RuntimeTextMatchPart[] {
	if (text === "") return [];

	const needle = runtimeSearchNeedle(query);
	if (needle === "") return [{ text, matched: false }];

	const haystack = text.toLowerCase();
	/**
	 * Positions are counted in the folded string and sliced from the original. That mapping holds only
	 * when the lengths match, but some characters change length when folded (ß to ss, İ to i̇). File
	 * path characters are limited to ASCII, so this does not occur in practice, but the function must
	 * not rely on that. On a mismatch the highlight is skipped: a wrong bold span would look like
	 * shifted text and is hard to reproduce.
	 */
	if (haystack.length !== text.length) return [{ text, matched: false }];

	const parts: RuntimeTextMatchPart[] = [];
	let at = 0;
	for (;;) {
		const hit = haystack.indexOf(needle, at);
		if (hit === -1) break;
		if (hit > at) parts.push({ text: text.slice(at, hit), matched: false });
		parts.push({ text: text.slice(hit, hit + needle.length), matched: true });
		at = hit + needle.length;
	}

	/** No match gives one fragment. An empty array would make the row vanish from the screen. */
	if (parts.length === 0) return [{ text, matched: false }];
	if (at < text.length) parts.push({ text: text.slice(at), matched: false });
	return parts;
}
