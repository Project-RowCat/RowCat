import type { StoryVisibility } from "./story.ts";
import {
	CALENDAR_WINDOW_LABEL,
	CALENDAR_WINDOWS,
	type CalendarWindow,
	calendarWindowStart,
} from "./time-window.ts";

/**
 * A creator's view of their own works' performance: the vocabulary shared by web and the Expo app.
 * Kept apart from CreatorWork, which is the management view. Metrics on that type would make the
 * management screen carry counts it never draws, and every query would pay to aggregate them.
 *
 * The metrics mean different things:
 * - views: cumulative events, folded by (work, viewer, UTC date); the owner's own views excluded
 * - favorites: current state, members who have it saved now
 * - comments: current state, comments that still remain (deleted ones are not counted)
 * - playStarts: cumulative events after the device creates a local session; owner's excluded
 *
 * All four are absolute values now. The period window applies only to views and playStarts, the two
 * metrics with an event ledger. Favorites and comments have no ledger to answer a window question.
 * The window type states which metrics it applies to, so the wording stays true.
 */

/**
 * Period window. It applies only to the two metrics that have an event ledger.
 * - all: whole period; the window value equals the cumulative value
 * - day: today, one UTC calendar day
 * - week: the last 7 days, UTC calendar days including today
 * - month: the last 30 days, UTC calendar days including today
 *
 * Views come from a ledger folded by (work, viewer, UTC date) (story_view_log). Play starts come
 * from a ledger with timestamps (story_play_log). Both are cut at the same UTC day boundary, the
 * resolution of the view ledger, so the two metrics count the same days and the conversion ratio
 * stays honest. Favorites and comments are current state and cannot answer a window: 'favorites in
 * the last 7 days' would need the removals, and their ledger does not exist. Choosing a window
 * moves only the first two.
 */
export const CREATOR_ANALYTICS_WINDOWS = CALENDAR_WINDOWS;
export type CreatorAnalyticsWindow = CalendarWindow;

export const DEFAULT_CREATOR_ANALYTICS_WINDOW: CreatorAnalyticsWindow = "all";

export const CREATOR_ANALYTICS_WINDOW_LABEL: Record<
	CreatorAnalyticsWindow,
	string
> = CALENDAR_WINDOW_LABEL;

/**
 * Start of the window: the first UTC midnight of the N days including today. null for all. Not now
 * minus 7 × 86400000: the view ledger stores dates as strings, so it cannot be cut by timestamp.
 * Cutting at midnight makes both ledgers count the same days.
 *
 * The server builds this boundary with this function and returns it as `since`; the screen only
 * draws it. It goes through the same function as storyPeriodStart, used by the discovery popularity
 * sort (time-window.ts), so a last-7-days range on the two screens cannot count different days.
 */
export function creatorAnalyticsWindowStart(
	window: CreatorAnalyticsWindow,
	now: Date,
): Date | null {
	return calendarWindowStart(window, now);
}

/**
 * Views-to-play-start ratio, built only from two numbers in the same window. A zero denominator
 * returns null. 0% means 'viewed, but nobody started'; null means 'nobody viewed', a different
 * fact. It can exceed 100%: views fold by (viewer, day) while play starts count per session, so one
 * person creating three chat rooms in a day counts as three. The value is not capped, because
 * capping would misstate what was counted. This is not a usual unique-visitor conversion rate. The
 * screen avoids that word, and PLAY_START_CONVERSION_NOTE states the difference.
 */
export function playStartConversion(input: {
	views: number;
	playStarts: number;
}): number | null {
	if (input.views <= 0) return null;
	return input.playStarts / input.views;
}

/**
 * The one sentence stating what this ratio divides, shared word for word by web and mobile. It says
 * two things: the ratio can exceed 100% (views fold by viewer and day, starts count per session),
 * and a session means something different per play mode (a chat session is per room, a runtime
 * session is per account). The second clause carries the point: without it, a chat work and a
 * runtime work with the same number look comparable. The ratio is not turned into a people count,
 * because the creator asks how many times their work was started, not how many people started it.
 * Ranking therefore does not read this number (services/story/ranking.ts). The screen labels it `Play starts per
 * view`, not `conversion rate`.
 */
export const PLAY_START_CONVERSION_NOTE =
	"Views are folded by viewer and date; play starts count each room for conversations and each account for runtime stories. So this ratio can exceed 100%, and stories with different playback modes can't be compared.";

/**
 * Totals across all of the viewer's works, not the sum of what is on screen. The first four are
 * cumulative or current state. windowViews and windowPlayStarts are counted within the response's
 * window; with `all` they equal the cumulative values.
 */
export interface CreatorAnalyticsSummary {
	views: number;
	favorites: number;
	comments: number;
	/**
	 * Cumulative play starts: recorded after the device creates a local session. The owner's are
	 * excluded.
	 */
	playStarts: number;
	windowViews: number;
	windowPlayStarts: number;
}

export interface CreatorAnalyticsWork {
	id: string;
	title: string;
	/**
	 * The creator's chosen exposure state. Metrics alone cannot make a row readable, so this travels
	 * with them. Zero views could mean 'nobody has seen it yet' or 'private, so it cannot be seen'.
	 * Those are very different facts.
	 */
	visibility: StoryVisibility;
	/** Operator hide. This is an axis independent of the creator's visibility. */
	hidden: boolean;
	/**
	 * Cumulative detail-page views, deduplicated by viewer and date, excluding the owner's own views.
	 */
	views: number;
	/** Members who have favorited it right now. */
	favorites: number;
	/** Comments that currently remain. Deleted comments are not counted. */
	comments: number;
	playStarts: number;
	/** Views in the window. Equal to `views` when the window is `all`. */
	windowViews: number;
	/** Play starts in the window. Equal to `playStarts` when the window is `all`. */
	windowPlayStarts: number;
	/** ISO 8601. */
	updatedAt: string;
}

/**
 * Collapses accumulated pages into one row per work, keeping the first occurrence. The list is
 * paged by offset, since sorting by performance would need a cursor carrying a score, which is not
 * worth it at this size. So once the first page is loaded, a view or favorite change can push a
 * work across the page boundary, and it appears again on the next page. Drawing both would show it
 * twice, and keying rows by work id would make React reuse one row by mistake.
 *
 * The first occurrence is kept because the screen already drew that row there. Replacing it with
 * the later copy would change the values above when 'load more' is pressed, which the user would
 * read as the metric moving. The opposite case (a work pushed past the boundary and never received)
 * cannot be fixed here, since that row was never fetched; a reload brings it back.
 *
 * Both apps call this same function, so the same account is not drawn with different row counts per
 * app.
 */
export function uniqueCreatorAnalyticsWorks(
	works: readonly CreatorAnalyticsWork[],
): CreatorAnalyticsWork[] {
	const seen = new Set<string>();
	const out: CreatorAnalyticsWork[] = [];
	for (const work of works) {
		if (seen.has(work.id)) continue;
		seen.add(work.id);
		out.push(work);
	}
	return out;
}

/** One page: the totals the server counted, together with the items. */
export interface CreatorAnalyticsPage {
	window: CreatorAnalyticsWindow;
	/** Start of the window (ISO 8601, UTC midnight). null when the window is `all`. */
	since: string | null;
	summary: CreatorAnalyticsSummary;
	items: CreatorAnalyticsWork[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}
