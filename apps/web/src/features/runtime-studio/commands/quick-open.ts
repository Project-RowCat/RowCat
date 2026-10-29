import { runtimeFileName } from "@rowcat/authoring";

/**
 * Answers one question: for the typed text, which files are shown and in what order. Keeping that
 * in a pure function makes the order checkable without the screen.
 * - No fuzzy-search framework. A project has tens of files, and users type a few leading letters.
 *   The five ranks below are enough, and a library's ranking could not be explained to the user.
 * - Ranks, best first: exact file name, file name prefix, file name contains, path prefix, path
 *   contains.
 * - Ties go to the shorter path, then to plain code-point order. Path characters are ASCII-only,
 *   so code-point order is lexicographic. `localeCompare` is avoided because locale-dependent order
 *   would sort the same project differently on different devices.
 * - Excluded: commands (they would need per-kind ranking), recent-file weighting (it needs stored
 *   state, which breaks purity), and highlight ranges (ranking and display stay separate).
 *   Highlighting shares the same normalization (`runtimeSearchNeedle`), so it marks the letters the
 *   ranking actually matched.
 */

export interface RuntimeQuickOpenFile {
	id: string;
	path: string;
}

/**
 * Which rule matched; lower is higher. Not a `const enum`: this app builds one file at a time
 * (`isolatedModules`), and const enums need values inlined from other files, which a single-file
 * transform does not have.
 */
const RANK = {
	exactName: 0,
	namePrefix: 1,
	nameSubstring: 2,
	pathPrefix: 3,
	pathSubstring: 4,
	none: 5,
} as const;

type Rank = (typeof RANK)[keyof typeof RANK];

/**
 * Normalizes the query for comparison. Ranking and highlighting both pass through this one
 * function. It is exported to prevent copies: if highlighting had its own trim and lowercasing, the
 * two could drift apart silently, leaving a listed row with no highlighted letters, or the reverse.
 */
export const runtimeSearchNeedle = (query: string): string =>
	query.trim().toLowerCase();

function rankOf(path: string, query: string): Rank {
	const name = runtimeFileName(path).toLowerCase();
	const lower = path.toLowerCase();
	if (name === query) return RANK.exactName;
	if (name.startsWith(query)) return RANK.namePrefix;
	if (name.includes(query)) return RANK.nameSubstring;
	if (lower.startsWith(query)) return RANK.pathPrefix;
	if (lower.includes(query)) return RANK.pathSubstring;
	return RANK.none;
}

/**
 * Ordering for this list must be a total order, which is why path is the last key. Rank and length
 * alone leave two equal-length paths unordered, and then the result of `sort` would depend on the
 * engine.
 */
const compare = (
	left: { rank: Rank; path: string },
	right: { rank: Rank; path: string },
): number => {
	if (left.rank !== right.rank) return left.rank - right.rank;
	if (left.path.length !== right.path.length)
		return left.path.length - right.path.length;
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
};

/**
 * Files matching the query, in rank order.
 *
 * An empty query returns everything, in path order. A list that is empty on open would not tell
 * users what they can type.
 *
 * Case is folded on both the query and the targets. Folding only one side would stop `main` from
 * finding `Main.tsx`.
 *
 * `limit` caps the rendered rows, not the search. Truncation happens after sorting, so the best
 * match is never cut off.
 */
export function searchRuntimeFiles(
	files: readonly RuntimeQuickOpenFile[],
	query: string,
	limit = 50,
): RuntimeQuickOpenFile[] {
	const needle = runtimeSearchNeedle(query);

	const scored = files
		.map((file) => ({
			file,
			path: file.path,
			rank: needle === "" ? RANK.exactName : rankOf(file.path, needle),
		}))
		.filter((entry) => entry.rank !== RANK.none);

	scored.sort(compare);
	return scored.slice(0, limit).map((entry) => entry.file);
}
