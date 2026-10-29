import {
	type AppliedGalleryFilter,
	appliedGalleryFilters,
	type CalendarWindow,
	effectiveGallerySort,
	type GalleryFilterAxis,
	type GalleryFilters,
	isStoryVisibleOnCreatorProfile,
	type Orientation,
	periodApplies,
	type StoryPlayMode,
	type StoryRating,
	type StorySort,
	type StoryVisibility,
	storyVisibilityBadgeLabel,
} from "@rowcat/domain";
import { translator } from "./current.ts";

/**
 * Names for the domain's product vocabulary, in the render's language.
 *
 * The domain keeps the **decisions** (which filters are applied, whether a period applies, whether a
 * visibility gets a badge) and this module only **names** their codes. Reading the domain's own
 * label tables here would draw one language regardless of the viewer, and rebuilding the decisions
 * here would let the web and mobile disagree about what is applied. So every function below calls
 * the domain for the decision and the dictionary for the word.
 */

const t = () => translator("vocab");

export const orientationLabel = (value: Orientation): string =>
	t()(`orientation.${value}`);

export const ratingLabel = (value: StoryRating): string =>
	t()(`rating.${value}`);

export const sortLabel = (value: StorySort): string => t()(`sort.${value}`);

export const periodLabel = (value: CalendarWindow): string =>
	t()(`period.${value}`);

export const filterAxisLabel = (axis: GalleryFilterAxis): string =>
	t()(`filterAxis.${axis}`);

export const visibilityLabel = (value: StoryVisibility): string =>
	t()(`visibility.${value}`);

/** Null exactly when the domain says no badge stands (public). */
export const visibilityBadgeLabel = (value: StoryVisibility): string | null =>
	storyVisibilityBadgeLabel(value) === null ? null : visibilityLabel(value);

export const startLabel = (mode: StoryPlayMode): string => t()(`start.${mode}`);

export const deletedCreatorLabel = (): string => t()("deletedCreator");

export const unnamedProfileLabel = (): string => t()("unnamedProfile");

export const adultBadge = (): string => t()("adultBadge");

/** The same fallback as `draftDisplayTitle` in `@rowcat/authoring`, named in the render's locale. */
export const draftTitleLabel = (draft: { title: string }): string =>
	draft.title.trim() || t()("untitled");

/**
 * The same decision as `pinnedWorkNotice` in `@rowcat/domain`: hidden first, then visibility that
 * keeps the work off the profile. The domain decides; this names.
 */
export function pinnedWorkNoticeLabel(work: {
	hidden: boolean;
	visibility: StoryVisibility;
}): string | null {
	if (work.hidden) return t()("pinnedNotice.hidden");
	if (isStoryVisibleOnCreatorProfile(work.visibility)) return null;
	return t()(`pinnedNotice.${work.visibility}`);
}

/** The sort menu trigger: the sort the query actually runs, plus the window when one applies. */
export function sortTriggerLabel(
	filters: Pick<GalleryFilters, "sort" | "period" | "query">,
): string {
	const sort = sortLabel(effectiveGallerySort(filters));
	if (!periodApplies(filters) || filters.period === "all") return sort;
	return t()("sortTrigger", { sort, period: periodLabel(filters.period) });
}

/**
 * The domain's applied filters with their token text and remove-button name in this language. The
 * set, order and patches are the domain's; only `text` and `removeLabel` are replaced.
 */
export function localizedAppliedFilters(
	filters: GalleryFilters,
	followingAvailable: boolean,
): AppliedGalleryFilter[] {
	return appliedGalleryFilters(filters, followingAvailable).map((applied) => {
		const axis = filterAxisLabel(applied.axis);
		const value =
			applied.axis === "orientation" && filters.orientation !== null
				? orientationLabel(filters.orientation)
				: applied.axis === "rating"
					? ratingLabel(filters.rating)
					: applied.axis === "tag"
						? (filters.tag ?? "")
						: null;
		if (value === null)
			return {
				...applied,
				text: axis,
				removeLabel: t()("filterRemoveAxis", { axis }),
			};
		return {
			...applied,
			text:
				applied.axis === "tag"
					? t()("filterTag", { axis, value })
					: t()("filterToken", { axis, value }),
			removeLabel: t()("filterRemove", { axis, value }),
		};
	});
}
