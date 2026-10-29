import type { ChatRole } from "./model.ts";

/**
 * Rules for finding messages in a room. Pure: it works on an in-memory array and knows nothing of
 * markup.
 *
 * - Lives in the package because these are product rules: what counts as the same text (case,
 *   whitespace, line breaks), how many results a message yields, and where a preview is cut and
 *   highlighted. A later Expo screen re-implementing them would let the two platforms disagree
 *   about what counts as found.
 * - No server endpoint. Message bodies cannot be read by the server (sync uses envelope
 *   encryption), and the query is as private as the content.
 * - No index. Nothing derived is stored, so results are recomputed from current messages and
 *   cannot go stale after edits, deletes or sync.
 * - No stemming, fuzzy matching or embeddings. With plain substring matching the user can predict
 *   results; other approaches cannot explain why something did or did not match. The room list's
 *   title search already made this decision (`features/chat-library/room-library.ts`).
 *
 * The room list searches titles only, because a list screen should not start reading message bodies
 * in passing. Here the user is already inside a room reading its text and looking for an earlier
 * scene, so searching bodies is the point.
 */

/**
 * The fields search actually reads, not the full message record. Sync metadata (`rev`, `dirty`,
 * `serverVersion`) is deliberately not required: search does not use it, and requiring it would
 * make tests fill in meaningless fields.
 */
export interface SearchableMessage {
	id: string;
	role: ChatRole;
	/** The persona name of a user message. Empty for assistant messages. */
	speaker: string;
	content: string;
	createdAt: string;
	/** Null means the message is alive. Tombstones are excluded from search. */
	deletedAt: string | null;
}

/**
 * A highlight range inside `snippet`, in UTF-16 code units rather than code points, because
 * rendering slices by code unit. The offset calculation never produces a boundary in the middle of
 * a surrogate pair (see `alignStart`, `alignEnd` and the offset map), so emoji are not split.
 */
export interface ChatSearchRange {
	start: number;
	end: number;
}

export interface ChatSearchResult {
	/**
	 * The identity of a result: the message id, not the array position. When messages are inserted or
	 * removed, a position immediately points at a different message, while the id stays the same.
	 */
	messageId: string;
	/**
	 * The position in the searched array (ascending). It is a coordinate, not an identity, and is used
	 * only to compute how many messages from the end a result is (`total - index`) when jumping to it.
	 */
	index: number;
	role: ChatRole;
	speaker: string;
	createdAt: string;
	/** A preview cut around the first match. Ellipses are added at a cut end. */
	snippet: string;
	/** All match ranges inside the snippet. Matches pushed outside the window are not included. */
	matchRanges: ChatSearchRange[];
}

/**
 * What one search returns. Counts and previews are separate axes: `matched` counts every hit, while
 * `results` builds only a fixed number from the start. Merging them would break one of the two.
 * Building every preview would spend the typing budget on previews that are never drawn for a
 * common word (see search.perf.test.ts), and counting only the built previews would make the
 * screen's `N messages` a lie. This mirrors the room library's `roomLibraryView`, because how many
 * matched and what to draw are different questions.
 */
export interface ChatSearchView {
	/** The number of matched messages. The screen's `N messages` shows this value. */
	matched: number;
	/** The results actually built, newest first, never more than the requested limit. */
	results: ChatSearchResult[];
	/** Whether unbuilt results remain, for the `Show more` control. */
	hasMore: boolean;
}

/**
 * The number of previews built at once. People scan far fewer results than this, and the consumer
 * opens more in steps of the same size with `Show more`. The room list uses the same value for the same
 * reason.
 */
export const CHAT_SEARCH_RESULT_PAGE_SIZE = 50;

/**
 * The minimum query length to start a search: one character. Not three, because for Korean and
 * Chinese a single character is already a word (for example `밤` "night" or `검` "sword"), and a larger minimum would
 * make search effectively unusable for those users. A single character is cheap: the scan makes two
 * strings per message, and `search.perf.test.ts` measures it.
 */
export const CHAT_SEARCH_MIN_QUERY_LENGTH = 1;

/** Characters kept before the match in a preview: only enough to hint where the sentence starts. */
const SNIPPET_LEAD_CHARS = 40;
/** Characters kept after the match. What a passage was about is usually said later. */
const SNIPPET_TRAIL_CHARS = 80;

const ELLIPSIS = "…";

/**
 * Tests a single whitespace character. No global flag: `test` on a `g` regex carries `lastIndex`.
 */
const WHITESPACE = /\s/u;
const WHITESPACE_RUN = /\s+/gu;

/**
 * Normalizes text for comparison, applying only two folds.
 * 1. Runs of whitespace, including line breaks, collapse to one space. Roleplay splits scenes by
 *    paragraphs and line breaks, so without this a phrase that reads as one line would fail to
 *    match. It is the only fold that never changes meaning.
 * 2. Case, with the locale pinned to `ko-KR`. The default locale maps `I` to a dotless letter on
 *    Turkish devices only, which would make the same query return different results. Korean is
 *    unaffected, and room-list title search already uses the same value.
 *
 * Punctuation is left intact. Characters such as `...`, `—` or `?!` carry meaning in roleplay, and
 * stripping them would stop text typed exactly as it appears on screen from matching.
 */
export const normalizeSearchText = (input: string): string =>
	input.replace(WHITESPACE_RUN, " ").toLocaleLowerCase("ko-KR");

/**
 * Query-side normalization: the same rules as for text, plus trimming. Pasted leading and trailing
 * line breaks or spaces are not characters the user meant to search for. Text is not trimmed,
 * because its offsets must still line up with the original for the offset map below.
 */
export const normalizeSearchQuery = (input: string): string =>
	normalizeSearchText(input).trim();

/**
 * A normalized text plus a map from its characters back to offsets in the original text (UTF-16
 * units).
 */
interface MappedText {
	text: string;
	/**
	 * `text[i]` is the original UTF-16 index that character `i` came from. Its length equals
	 * `text.length`.
	 */
	map: number[];
}

/**
 * Collapses runs of whitespace while recording each character's original position. It iterates per
 * UTF-16 code unit, so each half of a surrogate pair gets its own map entry, and boundaries around
 * emoji always fall on exact positions.
 */
function collapseWithMap(raw: string): MappedText {
	let text = "";
	const map: number[] = [];
	let index = 0;
	while (index < raw.length) {
		const unit = raw[index] as string;
		if (WHITESPACE.test(unit)) {
			text += " ";
			// A collapsed space points to the first character of its run, so highlighting does not leak
			// forward.
			map.push(index);
			while (index < raw.length && WHITESPACE.test(raw[index] as string))
				index += 1;
			continue;
		}
		text += unit;
		map.push(index);
		index += 1;
	}
	return { text, map };
}

/**
 * Normalizes with an offset map, built only for messages that matched. It must produce the same
 * string as the fast check (`normalizeSearchText`), so lowercasing runs once on the whole string.
 * Per-code-point lowercasing would break context-sensitive rules such as the Greek final sigma, so
 * a message judged to match could fail to find its match. Only the one character that changes
 * length when lowercased (`İ`) forces the slower per-code-point rebuild, and its cost does not
 * matter.
 */
function normalizeWithMap(raw: string): MappedText {
	const collapsed = collapseWithMap(raw);
	const text = collapsed.text.toLocaleLowerCase("ko-KR");
	if (text.length === collapsed.text.length)
		return { text, map: collapsed.map };
	return lowerPerCodePoint(collapsed);
}

/**
 * Offset map for lowercasing that changes length. It is the exception path described in
 * `normalizeWithMap`.
 */
function lowerPerCodePoint(collapsed: MappedText): MappedText {
	let text = "";
	const map: number[] = [];
	let index = 0;
	while (index < collapsed.text.length) {
		const point = collapsed.text.codePointAt(index) as number;
		const char = String.fromCodePoint(point);
		const lower = char.toLocaleLowerCase("ko-KR");
		text += lower;
		for (let unit = 0; unit < lower.length; unit += 1)
			map.push(collapsed.map[index] as number);
		index += char.length;
	}
	return { text, map };
}

/** All non-overlapping matches. One message often contains the same word several times. */
function findMatches(text: string, needle: string): ChatSearchRange[] {
	const found: ChatSearchRange[] = [];
	let from = 0;
	for (;;) {
		const at = text.indexOf(needle, from);
		if (at < 0) return found;
		found.push({ start: at, end: at + needle.length });
		from = at + needle.length;
	}
}

const isHighSurrogate = (code: number): boolean =>
	code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean =>
	code >= 0xdc00 && code <= 0xdfff;

/**
 * If the cut lands in the middle of a surrogate pair, steps back one unit so an emoji is never
 * split in half.
 */
const alignStart = (raw: string, at: number): number =>
	at > 0 && isLowSurrogate(raw.charCodeAt(at)) ? at - 1 : at;

const alignEnd = (raw: string, at: number): number =>
	at > 0 && at < raw.length && isHighSurrogate(raw.charCodeAt(at - 1))
		? at - 1
		: at;

/**
 * Builds one result: the preview and its highlight ranges. The full body is not carried in the
 * result, because one response can span many paragraphs and copying it would make the result list a
 * copy of the whole conversation. Returns null if the fast check passed but no match is found here.
 * That can only happen on the exception path in `normalizeWithMap`, and the result is dropped: a
 * result that highlights the wrong place would tell the user that search is broken.
 */
function buildResult(
	message: SearchableMessage,
	index: number,
	needle: string,
): ChatSearchResult | null {
	const raw = message.content;
	const normalized = normalizeWithMap(raw);
	const matches = findMatches(normalized.text, needle);
	if (matches.length === 0) return null;

	const rawRanges = matches.map((match) => ({
		start: normalized.map[match.start] as number,
		end: (normalized.map[match.end - 1] as number) + 1,
	}));
	const anchor = rawRanges[0] as ChatSearchRange;

	const from = alignStart(raw, Math.max(0, anchor.start - SNIPPET_LEAD_CHARS));
	const to = alignEnd(
		raw,
		Math.min(raw.length, anchor.end + SNIPPET_TRAIL_CHARS),
	);
	const lead = from > 0 ? ELLIPSIS : "";
	const snippet = `${lead}${raw.slice(from, to)}${to < raw.length ? ELLIPSIS : ""}`;
	// Shifted by the length of the leading ellipsis, so highlight coordinates are always relative to
	// the snippet.
	const shift = lead.length - from;

	return {
		messageId: message.id,
		index,
		role: message.role,
		speaker: message.speaker,
		createdAt: message.createdAt,
		snippet,
		matchRanges: rawRanges
			// Matches outside the window are dropped. They would be coordinates for text that is not drawn.
			.filter((range) => range.start >= from && range.end <= to)
			.map((range) => ({ start: range.start + shift, end: range.end + shift })),
	};
}

/**
 * A cheap candidate check. A query with no whitespace skips folding: folding only collapses
 * whitespace runs, so such a query matches the folded text exactly when it matches the original.
 * Because it crosses no whitespace, folding cannot join or split the spot where it matches. The
 * branch exists for speed: the regex is the most expensive part of the scan (see
 * `search.perf.test.ts`), and most real queries contain no spaces.
 */
const containsNeedle = (
	content: string,
	needle: string,
	spanning: boolean,
): boolean =>
	(spanning
		? normalizeSearchText(content)
		: content.toLocaleLowerCase("ko-KR")
	).includes(needle);

/**
 * Searches one room's messages: one result per message, newest first. One result per message keeps
 * the list honest, since a response repeating a word five times would otherwise produce five rows
 * that jump to the same place. The preview is cut around the first match, and other matches inside
 * that window are highlighted too.
 *
 * Newest first because users usually reopen search to find recent exchanges. Jumping still uses the
 * true conversation order, since list order is display only (`index` carries the ascending
 * coordinate). Every message is counted, but previews are built only for the first `limit` results,
 * because counting is cheap and cutting previews is not. Deleted messages are filtered here as
 * well, so a caller that passes them cannot revive them in search.
 */
export function searchMessages(
	messages: readonly SearchableMessage[],
	query: string,
	options?: { limit?: number },
): ChatSearchView {
	const needle = normalizeSearchQuery(query);
	if ([...needle].length < CHAT_SEARCH_MIN_QUERY_LENGTH)
		return { matched: 0, results: [], hasMore: false };

	const limit = Math.max(0, options?.limit ?? CHAT_SEARCH_RESULT_PAGE_SIZE);
	const spanning = needle.includes(" ");
	const results: ChatSearchResult[] = [];
	let matched = 0;

	// Iterates from the end: this is the list order, and also the order in which previews fill.
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as SearchableMessage;
		if (message.deletedAt !== null) continue;
		if (!containsNeedle(message.content, needle, spanning)) continue;
		if (results.length < limit) {
			const result = buildResult(message, index, needle);
			// The exception path where the offset map finds no match. Such a result does not exist, so it is
			// not counted either.
			if (!result) continue;
			results.push(result);
		}
		matched += 1;
	}
	return { matched, results, hasMore: matched > results.length };
}
