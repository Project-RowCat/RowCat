/**
 * URL safety policy. A destination the parser recognized is not a trusted one: `javascript:` and
 * `data:text/html` are valid CommonMark destinations.
 *
 * - Tabs and newlines are stripped before reading the scheme, as browsers do; otherwise
 *   `java\tscript:` looks schemeless here and runs as script in the browser.
 * - `new URL()` is avoided because React Native's implementation differs from the browser's.
 * - Relative paths are rejected: the author is not RowCat, so `/account` would be a lure.
 */

export const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"] as const;

/** Narrower than links: `data:` can carry an SVG document. */
export const SAFE_IMAGE_SCHEMES = ["http:", "https:"] as const;

/** Characters browsers strip from URL attribute values. */
const STRIPPED = /[\t\n\r]/g;

/** RFC 3986 §3.1. */
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** The cleaned value is what gets judged and rendered — checking one and rendering another is a bypass. */
const clean = (url: string): string => url.replace(STRIPPED, "").trim();

export function schemeOf(url: string): string | null {
	const match = SCHEME.exec(clean(url));
	return match ? `${match[1].toLowerCase()}:` : null;
}

/** Returns `null` rather than `""`: an empty `href` links to the current page. */
export function safeLinkUrl(url: string): string | null {
	const value = clean(url);
	const scheme = schemeOf(value);
	if (!scheme) return null;
	return (SAFE_LINK_SCHEMES as readonly string[]).includes(scheme)
		? value
		: null;
}

export function safeImageUrl(url: string): string | null {
	const value = clean(url);
	const scheme = schemeOf(value);
	if (!scheme) return null;
	return (SAFE_IMAGE_SCHEMES as readonly string[]).includes(scheme)
		? value
		: null;
}

/**
 * react-markdown's `urlTransform`. The tree is already folded by `safety.ts`, so this is a second
 * layer stating the same rule. It checks the attribute because the library uses one function for
 * both `href` and `src`, and `mailto:` is not an image.
 */
export const markdownUrlTransform = (url: string, key: string): string =>
	(key === "src" ? safeImageUrl(url) : safeLinkUrl(url)) ?? "";
