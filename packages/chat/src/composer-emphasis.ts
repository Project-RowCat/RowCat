/**
 * Rule for the emphasis marker in the input box: the `Mark action` button in roleplay.
 * - In this conversation, asterisks mark what is not speech: actions, descriptions, asides. The
 *   convention comes from legacy RowCat, whose button inserted one asterisk before and one after.
 *   The renderer draws the marker as a faint layer, continuing that convention (markdown.tsx,
 *   markdown-view.tsx).
 * - The rule is a pure function because of whitespace. CommonMark emphasis does not form when
 *   whitespace sits inside the delimiters. The marker wraps only the trimmed content and leaves the
 *   whitespace outside.
 * - Both apps call this same function, so the whitespace rule cannot be missed on one side.
 * - Not here: a toggle (pressing again would remove the marker, and that would need to answer
 *   every partial-overlap case); DOM or TextInput access (the caller passes the selection, and the
 *   function returns the next value and selection); a length limit (the contract owns
 *   CHAT_MAX_MESSAGE_CHARS, and the input predicate decides whether sending is allowed).
 */

/**
 * The marker is a single asterisk: one before and one after, two in total. This was once `**`, and
 * pressing the button without a selection produced four asterisks (`****`). The legacy add-action
 * button inserted two, and the button's job is layer separation, not emphasis.
 *
 * The layer comes from fading, not from the count. The renderer draws one or two asterisks with the
 * same faded value (markdown.tsx, markdown-view.tsx); only italic versus bold differs between them.
 * Bolding a non-speech line would make it stand out more than the dialogue beside it.
 */
export const CHAT_EMPHASIS_MARKER = "*";

export interface ChatEmphasisInput {
	text: string;
	/** Start of the selection. With only a caret, this equals the end. */
	selectionStart: number;
	selectionEnd: number;
}

export interface ChatEmphasisResult {
	text: string;
	/**
	 * The selection re-picked after wrapping, covering the wrapped content. With only a caret, the
	 * caret sits between the markers.
	 */
	selectionStart: number;
	selectionEnd: number;
}

/**
 * Clamps the range to the inside of the text, because the caller's values may be reversed or
 * overflow the text.
 */
function clampRange(
	text: string,
	start: number,
	end: number,
): [number, number] {
	const inside = (value: number): number =>
		Number.isFinite(value)
			? Math.min(Math.max(Math.trunc(value), 0), text.length)
			: 0;
	const first = inside(start);
	const second = inside(end);
	return first <= second ? [first, second] : [second, first];
}

/**
 * The next value and next selection after wrapping the selection. With no selection, an empty
 * marker is placed at that spot and the caret goes between the two. Pressing the button and typing
 * right away is the typical use.
 */
export function applyChatEmphasisMarker(
	input: ChatEmphasisInput,
): ChatEmphasisResult {
	const [start, end] = clampRange(
		input.text,
		input.selectionStart,
		input.selectionEnd,
	);
	const selected = input.text.slice(start, end);
	const core = selected.trim();
	/**
	 * Leading and trailing whitespace stays outside the marker (see the rule above). If the core is
	 * empty, meaning no selection or only whitespace, a single empty marker is placed at that spot.
	 */
	const leading = core ? selected.slice(0, selected.indexOf(core)) : selected;
	const trailing = core
		? selected.slice(selected.indexOf(core) + core.length)
		: "";

	const opened = `${CHAT_EMPHASIS_MARKER}${core}${CHAT_EMPHASIS_MARKER}`;
	const text = `${input.text.slice(0, start)}${leading}${opened}${trailing}${input.text.slice(end)}`;
	const coreStart = start + leading.length + CHAT_EMPHASIS_MARKER.length;
	return {
		text,
		selectionStart: coreStart,
		selectionEnd: coreStart + core.length,
	};
}
