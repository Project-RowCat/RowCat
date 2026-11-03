import {
	type AppliedGalleryFilter,
	appliedGalleryFilters,
	type CalendarWindow,
	effectiveGallerySort,
	type GalleryFilterAxis,
	type GalleryFilters,
	type Orientation,
	periodApplies,
	type Story,
	type StoryPlayMode,
	type StoryRating,
	type StorySort,
	type StoryVisibility,
	storyVisibilityBadgeLabel,
} from "@rowcat/domain";
import { translator } from "./instance.ts";

/**
 * Names for the domain's product vocabulary, in the language being drawn — the web's
 * `apps/web/src/lib/i18n/vocab.ts`, function for function.
 *
 * The domain keeps the **decisions** (which filters are applied, whether a period applies, whether a
 * visibility gets a badge) and this module only **names** their codes. Reading the domain's own
 * label tables would draw English whatever the person chose, and rebuilding the decisions here would
 * let the app and the web disagree about what is applied. So each function calls the domain for the
 * decision and the dictionary for the word.
 *
 * These are called while drawing, from components that call `useTranslation()` (which is what
 * redraws them when the language changes).
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

/** Null exactly when the domain says no badge stands (public). */
export const visibilityBadgeLabel = (value: StoryVisibility): string | null =>
	storyVisibilityBadgeLabel(value) === null ? null : t()(`visibility.${value}`);

export const adultBadge = (): string => t()("adultBadge");

export const startLabel = (mode: StoryPlayMode): string => t()(`start.${mode}`);

/** The domain's `creatorLabel`: the nickname, or the deleted-creator state named in this language. */
export const creatorName = (story: Story): string =>
	story.creator?.nickname ?? t()("deletedCreator");

export const deletedCommentLabel = (): string => t()("deletedComment");

/**
 * The domain's `commentRepliesLabel`: null for 0, so no button that does nothing stands. The count
 * is passed as `total`, not `count`, so i18next's plural machinery (which needs `Intl.PluralRules`)
 * is not involved — the singular is its own key.
 */
export const repliesLabel = (count: number): string | null =>
	count <= 0
		? null
		: count === 1
			? t()("viewReply")
			: t()("viewReplies", { total: count });

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
