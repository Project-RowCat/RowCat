/**
 * Length limit for the social preview line (`description` and `og:description`). Text past this
 * length gets cut by the platform anyway. Cutting it here puts an ellipsis at the break, so the
 * truncation is visible.
 */
export const META_DESCRIPTION_MAX = 160;

/**
 * Turns human-written body text into one line for a meta tag.
 *
 * Runs of whitespace and line breaks are collapsed, since a meta tag is one line and would
 * otherwise keep the gaps. Empty input returns an empty string instead of a fallback. The route
 * that knows the resource picks the substitute (a work uses its creator's name, a profile uses a
 * product line).
 */
export function metaDescription(raw: string | null | undefined): string {
	const text = (raw ?? "").replace(/\s+/g, " ").trim();
	return text.length > META_DESCRIPTION_MAX
		? `${text.slice(0, META_DESCRIPTION_MAX - 1).trimEnd()}…`
		: text;
}
