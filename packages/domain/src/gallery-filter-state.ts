import {
	effectiveGallerySort,
	type GalleryFilters,
	ORIENTATION_LABEL,
	STORY_PERIOD_LABEL,
	STORY_RATING_LABEL,
	STORY_SORT_LABEL,
} from "./story.ts";

/**
 * The pure decision of which filters are active, as drawn by the toolbar. Once the controls move
 * into a menu, the active filters must be drawn outside it. If each component decided on its own
 * which axis is a filter, how it reads, and what × undoes, the two sides would drift (a token
 * shows, but × clears another axis). This file decides once; the screens only draw.
 *
 * Defaults are not filters: orientation null, rating any, and following off produce no token. The
 * authority for defaults is hasActiveFilters and DEFAULT_GALLERY_FILTERS in @rowcat/domain; nothing
 * is redefined here. Search text, sort, and period are not tokens, because the input and the sort
 * trigger already show them as text.
 *
 * The file does not import React, so the whole table can be checked without rendering.
 *
 * It lives in the domain rather than apps/web because there are two consumers. It used to live in
 * apps/web, which was correct then, but the mobile toolbar now asks the same questions. Per-app
 * copies would drop the rating token on one side or let × clear another axis on the other, which
 * only shows when the two screens are compared side by side. filtersForViewer sits in the same
 * place for that reason.
 */

export type GalleryFilterAxis = "orientation" | "rating" | "tag" | "following";

/** Name of each axis. Tokens and menu titles use the same words. */
export const GALLERY_FILTER_AXIS_LABEL: Record<GalleryFilterAxis, string> = {
	orientation: "Orientation",
	rating: "Rating",
	tag: "Tag",
	following: "Following",
};

export interface AppliedGalleryFilter {
	axis: GalleryFilterAxis;
	/** Sentence drawn on the token, e.g. `Orientation: For women` or `Following`. */
	text: string;
	/** Accessible name of the remove button, e.g. `Remove Orientation For women filter`. */
	removeLabel: string;
	/** Patch that resets only this one axis to its default. The other axes are left untouched. */
	patch: Partial<GalleryFilters>;
}

/**
 * Active filters, in the order the toolbar draws them. When `followingAvailable` is false,
 * following never appears, whatever its value. Guests have no such axis (filtersForViewer already
 * removed it during the query). Drawing a token the user cannot change would make its × a control
 * that does nothing.
 */
export function appliedGalleryFilters(
	filters: GalleryFilters,
	followingAvailable: boolean,
): AppliedGalleryFilter[] {
	const applied: AppliedGalleryFilter[] = [];

	if (filters.orientation !== null) {
		const value = ORIENTATION_LABEL[filters.orientation];
		applied.push({
			axis: "orientation",
			text: `${GALLERY_FILTER_AXIS_LABEL.orientation}: ${value}`,
			removeLabel: `Remove ${GALLERY_FILTER_AXIS_LABEL.orientation} ${value} filter`,
			patch: { orientation: null },
		});
	}

	if (filters.rating !== "any") {
		const value = STORY_RATING_LABEL[filters.rating];
		applied.push({
			axis: "rating",
			text: `${GALLERY_FILTER_AXIS_LABEL.rating}: ${value}`,
			removeLabel: `Remove ${GALLERY_FILTER_AXIS_LABEL.rating} ${value} filter`,
			patch: { rating: "any" },
		});
	}

	/**
	 * Tag is the only axis without a control in the menu: it is set only by tapping a tag on the story
	 * detail page. So this token is the only place that axis can be reverted. Without it, the user
	 * could clear a tag only by editing the URL by hand.
	 */
	if (filters.tag !== null) {
		applied.push({
			axis: "tag",
			text: `${GALLERY_FILTER_AXIS_LABEL.tag}: #${filters.tag}`,
			removeLabel: `Remove ${GALLERY_FILTER_AXIS_LABEL.tag} ${filters.tag} filter`,
			patch: { tag: null },
		});
	}

	if (followingAvailable && filters.followingOnly) {
		applied.push({
			axis: "following",
			text: GALLERY_FILTER_AXIS_LABEL.following,
			removeLabel: `Remove ${GALLERY_FILTER_AXIS_LABEL.following} filter`,
			patch: { followingOnly: false },
		});
	}

	return applied;
}

/**
 * Whether the popularity period changes results. The server reads it only for popularity sorting.
 */
export function periodApplies(filters: Pick<GalleryFilters, "sort">): boolean {
	return filters.sort === "popular";
}

/**
 * Text for the sort trigger. The period appears only for popularity, and the default period (all)
 * is omitted: `Popular · All time` says no more than `Popular`.
 */
export function sortTriggerLabel(
	filters: Pick<GalleryFilters, "sort" | "period" | "query">,
): string {
	/**
	 * Relevance without a query is effectively newest-first. The trigger names the sort the query
	 * actually runs, so it never writes a different word.
	 */
	const sort = STORY_SORT_LABEL[effectiveGallerySort(filters)];
	if (!periodApplies(filters) || filters.period === "all") return sort;
	return `${sort} · ${STORY_PERIOD_LABEL[filters.period]}`;
}
