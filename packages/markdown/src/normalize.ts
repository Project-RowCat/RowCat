/** Tabs and newlines are markdown syntax (indented code, paragraphs). */
const KEEP = new Set([0x09, 0x0a]);

/** Judged by code point: control characters inside a regex literal are invisible in review. */
const unrenderable = (code: number): boolean =>
	(code < 0x20 && !KEEP.has(code)) || code === 0x7f;

/**
 * Folds CRLF to LF and drops control characters the renderers cannot draw. Nothing that changes the
 * text's meaning happens here.
 *
 * NUL is removed rather than left to the parser, which would show U+FFFD as if the model emitted
 * garbage. Render path only: copy, edit and search keep using the stored original.
 */
export function normalizeChatMarkdown(source: string): string {
	const lines = source.replace(/\r\n?/g, "\n");
	// Return the same string when there is nothing to drop — this runs on every render.
	let clean = "";
	let start = 0;
	for (let index = 0; index < lines.length; index += 1) {
		if (!unrenderable(lines.charCodeAt(index))) continue;
		clean += lines.slice(start, index);
		start = index + 1;
	}
	return start === 0 ? lines : clean + lines.slice(start);
}
