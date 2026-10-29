/**
 * Converts heading text to an anchor id. The generator and the renderer both call this function.
 * The generator checks that `#anchor` links in docs hit real headings, and the renderer uses it to
 * set heading ids. With two separate versions, the check could pass while on-screen anchors differ,
 * and links would silently scroll nowhere.
 *
 * The function lives in this package because it has three consumers: the web markdown renderer, the
 * web doc generator, and the AI doc table of contents (llms.txt links to heading anchors). Keeping
 * it in the app would make the package import the app.
 *
 * Hangul is kept as-is, matching the legal document renderer (`legal-markdown.tsx`), so support
 * answers can link to a heading anchor such as `/docs/runtime/concepts/state#<heading>`.
 */
export function headingAnchor(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}
