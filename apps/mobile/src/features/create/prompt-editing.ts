/**
 * Cursor hand-off between the inline and the full-screen prompt field. They are different native
 * views over the same value, so opening or closing the window resets the cursor unless the position
 * is carried across.
 *
 * Positions are clamped because the value can shrink off-screen (autosave echo, sync from another
 * device); an out-of-range RN `selection` is silently ignored or jumps to the end.
 *
 * Not a shared package: the web sets the selection imperatively, while here the `selection` prop is
 * seeded once and released, since controlling it continuously breaks Hangul composition. The two
 * apps' same-named clamps run the same value table (`prompt-editing.test.ts`).
 */

export interface TextSelection {
	start: number;
	end: number;
}

/**
 * Clamps the position into this value; `null` when there is none.
 *
 * A reversed range is kept as is, since flipping it would move the anchor of someone extending the
 * selection. Negatives and fractions are folded: ranges built from them are not totally ordered.
 */
export function clampTextSelection(
	selection: TextSelection | null | undefined,
	length: number,
): TextSelection | null {
	if (!selection) return null;
	const within = (at: number): number =>
		Math.min(Math.max(Math.round(Number.isFinite(at) ? at : 0), 0), length);
	return { start: within(selection.start), end: within(selection.end) };
}

/** Caret at the end of the text, the default when there is no position to inherit (first open). */
export function caretAtEnd(text: string): TextSelection {
	return { start: text.length, end: text.length };
}
