import {
	RUNTIME_DOC_ENTRIES,
	RUNTIME_DOC_GROUPS,
	type RuntimeDocEntry,
	type RuntimeDocGroup,
	type RuntimeDocGroupId,
} from "#/generated/runtime-docs.ts";
import { runtimeDocsCopy } from "./runtime-docs-copy.ts";

/**
 * The docs' single navigation model. The wide-screen left list, the narrow drawer, previous and
 * next links, and the breadcrumb all go through this file.
 *
 * If each re-derived order from the generated output, one could follow different rules, and the
 * drawer order could disagree with what `next` points to, with no error. The order is set by the
 * generator (group, then order, then slug). This file only slices and groups.
 */

export interface RuntimeDocNavGroup {
	group: RuntimeDocGroup;
	entries: readonly RuntimeDocEntry[];
}

/**
 * Only groups that contain at least one doc, in defined order. Empty groups would be dead headings,
 * so they are not drawn.
 */
export function runtimeDocNav(): RuntimeDocNavGroup[] {
	return RUNTIME_DOC_GROUPS.map((group) => ({
		group,
		entries: RUNTIME_DOC_ENTRIES.filter((entry) => entry.group === group.id),
	})).filter((section) => section.entries.length > 0);
}

export function runtimeDocGroupLabel(id: RuntimeDocGroupId): string {
	return RUNTIME_DOC_GROUPS.find((group) => group.id === id)?.label ?? id;
}

export function runtimeDocNeighbors(slug: string): {
	previous: RuntimeDocEntry | null;
	next: RuntimeDocEntry | null;
} {
	const index = RUNTIME_DOC_ENTRIES.findIndex((entry) => entry.slug === slug);
	if (index === -1) return { previous: null, next: null };
	return {
		previous: RUNTIME_DOC_ENTRIES[index - 1] ?? null,
		next: RUNTIME_DOC_ENTRIES[index + 1] ?? null,
	};
}

/**
 * The root is `/docs/runtime` and every other doc sits under it by slug. No trailing slash: each
 * doc has exactly one address.
 */
export function runtimeDocHref(slug: string): string {
	return slug.length === 0 ? "/docs/runtime" : `/docs/runtime/${slug}`;
}

/**
 * Converts the route splat to a slug. The route may arrive with a trailing slash, as in
 * `/docs/runtime/concepts/state/`; that is the same doc. Two addresses must never draw different
 * docs, or one of them 404s.
 */
export function runtimeDocSlugFromSplat(splat: string | undefined): string {
	return (splat ?? "").replace(/^\/+|\/+$/g, "");
}

/** Title for the tab and link preview, e.g. `Quick start | Creator runtime | RowCat`. */
export function runtimeDocDocumentTitle(entry: RuntimeDocEntry): string {
	return entry.slug.length === 0
		? `${runtimeDocsCopy().title} | ${runtimeDocsCopy().product}`
		: `${entry.title} | ${runtimeDocsCopy().title} | ${runtimeDocsCopy().product}`;
}
