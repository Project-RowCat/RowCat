/**
 * The rule that decides what the panel draws, extracted as a pure function.
 *
 * Order inside a component cannot be checked without rendering, and a wrong order fails silently.
 * Two orders matter:
 * - If stopped came after loading, offline users would see a placeholder that never ends.
 * - If failed came after empty, a failed query would show `No stories to analyze yet`. A creator with ten
 *   works would read one network error as losing their data.
 *
 * Held values are never replaced. Stopped and failed take over the screen only when no values are
 * held. If data is held, the panel keeps drawing it and gains a retry path (`retryable`). Covering
 * performance numbers with an error screen loses information for nothing.
 *
 * Failures are never drawn as zero. This file has no path that creates `views: 0`, because zero
 * would claim nobody viewed the work, which cannot be known during a failure.
 */

import {
	type CreatorAnalyticsWindow,
	isOwnWorkViewable,
	playStartConversion,
	type StoryVisibility,
} from "@rowcat/domain";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { translator } from "#/lib/i18n/current.ts";
import { formatNumber } from "#/lib/i18n/format.ts";
import { periodLabel, visibilityLabel } from "#/lib/i18n/vocab.ts";

export type CreatorAnalyticsPanelState =
	/** No connection and no held values. It is a wait, not an error, and the UI says so. */
	| "offline"
	| "error"
	| "loading"
	/** The server reports zero works. This must stay distinct from a failure. */
	| "empty"
	| "ready";

/**
 * Accepts only the query fields read here, not the whole `UseInfiniteQueryResult`. That keeps the
 * rules testable without the library, and the type records exactly which fields are used.
 */
export interface CreatorAnalyticsQueryView {
	/**
	 * TanStack Query paused the fetch because it judged the network unavailable (`fetchStatus` is
	 * paused). It has stopped retrying until the connection returns.
	 */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	hasData: boolean;
	workCount: number;
}

export interface CreatorAnalyticsPanelView {
	state: CreatorAnalyticsPanelState;
	/**
	 * Whether the last refresh failed or was interrupted even though values are drawn.
	 *
	 * The flag exists only to attach a retry action instead of clearing rows. The numbers on screen
	 * are still server-confirmed, though possibly not current. The UI neither hides that nor discards
	 * the values because of it.
	 */
	retryable: boolean;
}

/**
 * Maps query state to what to draw. The order is the whole function: held values, stopped, failed,
 * loading, empty.
 */
export function creatorAnalyticsPanelView(
	q: CreatorAnalyticsQueryView,
): CreatorAnalyticsPanelView {
	if (q.hasData)
		return {
			state: q.workCount === 0 ? "empty" : "ready",
			retryable: q.isError || q.isPaused,
		};
	/**
	 * Stopped comes before failed. The two need different actions: stopped only needs waiting, since
	 * the query resumes when the connection returns, while failed needs a manual retry.
	 *
	 * Stopped still reports `isPending`, so checking it after loading would read it as loading and
	 * produce a placeholder that never ends.
	 */
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	/**
	 * Reached when the query finished with nothing accumulated, such as a cancelled query. It renders
	 * as empty. Because the branches above already ran, this is not a path that draws a failure as an
	 * empty list.
	 */
	return { state: "empty", retryable: false };
}

/**
 * Formats one metric as the exact count. No abbreviations such as `12.4K` or `1.2M`.
 *
 * A creator uses this screen to know how many times their work was read. Abbreviation makes 12,400
 * and 12,449 look the same, trading accuracy for a bigger-looking dashboard. There are no decimals
 * either, since every value is a full count. Thousands separators are included, because a bare
 * `12450` is hard to read at a glance.
 *
 * The contract already requires non-negative integers, so the guards below are a last net against
 * formatting failures, not policy. If NaN or Infinity reached the screen, users would read it as
 * our calculation failing.
 */
export function formatMetric(value: number): string {
	if (!Number.isFinite(value)) return "0";
	return formatNumber(Math.max(0, Math.trunc(value)));
}

/**
 * The vocabulary and the order live in one place. Three places read this table now: the total, the
 * column headers, and the labels inside each row. If each kept its own copy, one could change order
 * or wording and drift. The defect would appear as another metric's value under a column heading.
 * Every number would still be valid, so review would not catch it, and a creator would read their
 * favorites count as views.
 *
 * Wording is also a rule. `Traffic`, `Interest`, and `Engagement` are broader
 * than what we measure, so using them would make the screen appear to measure what it does not. All
 * three names are concrete and countable.
 *
 * The meaning does not live here. That `views` is a cumulative event while the other two are
 * current state is owned by the contract in `@rowcat/domain`. If display code restated the
 * relationship, code treating the three as the same kind of value would eventually appear beside
 * it.
 */
export type CreatorAnalyticsMetric =
	| "views"
	| "playStarts"
	| "favorites"
	| "comments";

export const metricLabel = (metric: CreatorAnalyticsMetric): string =>
	translator("create")(`analytics.metric.${metric}`);

/**
 * Drawing order: cumulative views come first. Hierarchy comes from position, not size. Since counts
 * are never abbreviated, varying the font size would overflow first for whoever has the largest
 * count.
 */
export const METRIC_ORDER: readonly CreatorAnalyticsMetric[] = [
	"views",
	"playStarts",
	"favorites",
	"comments",
] as const;

/**
 * Content drawn in a row that is not a metric. In a table, in-row noise competes with the values:
 * fourteen rows each carrying two bordered badges would keep the eye from reaching the numbers in a
 * table meant for vertical comparison.
 *
 * So it is split into two layers. Ordinary visibility drops to quiet text on the same line as the
 * update time. Only moderator hiding stays a badge: the creator did not cause it, and if it were
 * quietly listed, a zero view count would never be explainable.
 */
export interface CreatorAnalyticsRowView {
	/** Example: `Public · Updated August 23, 2026, 02:22 PM`. Visibility and update time share one line. */
	meta: string;
	/**
	 * Moderator hiding. It is a different axis from the creator's visibility, so it is not folded into
	 * it.
	 */
	moderatorHidden: boolean;
	/**
	 * Whether the work's detail page is reachable. The check is not restated here; it passes through
	 * the domain predicate `isOwnWorkViewable`. If the detail boundary changes, this screen will not
	 * draw a dead link.
	 */
	linked: boolean;
}

/**
 * Maps a work to its row's display values. It is built outside the component because this screen's
 * tests do not render React. `linked` matters most: a link to a work the user cannot view always
 * ends in a 404, which looks like a broken product.
 */
export function creatorAnalyticsRowView(work: {
	visibility: StoryVisibility;
	hidden: boolean;
	updatedAt: string;
}): CreatorAnalyticsRowView {
	/**
	 * An unreadable time takes no space. Joining it anyway would produce `Public · Updated `, which says
	 * something is missing without saying what.
	 */
	const at = formatDateTime(work.updatedAt);
	return {
		meta: [
			visibilityLabel(work.visibility),
			at ? translator("create")("analytics.updated", { at }) : null,
		]
			.filter((part): part is string => part !== null)
			.join(" · "),
		moderatorHidden: work.hidden,
		linked: isOwnWorkViewable(work),
	};
}

/**
 * Metrics that move with the window. Only the two with an event ledger do: `views` and play starts.
 * The other two are current state and stay the same whatever window is chosen (see the header of
 * `CreatorAnalyticsWindow` in `@rowcat/domain`).
 */
export const WINDOWED_METRICS: ReadonlySet<CreatorAnalyticsMetric> = new Set([
	"views",
	"playStarts",
]);

/**
 * The four values the screen draws. This is the single place where window values and current values
 * are combined.
 *
 * When the window is `all`, the server sets window values equal to the cumulative ones
 * (`windowViews === views`), so this function always reads window values. If the component chose
 * between `views` and `windowViews` per window, the total and a row could read different fields,
 * and the mismatch would not be an error: the total would simply stop adding up to the rows.
 */
export function creatorAnalyticsMetrics(source: {
	windowViews: number;
	windowPlayStarts: number;
	favorites: number;
	comments: number;
}): Record<CreatorAnalyticsMetric, number> {
	return {
		views: source.windowViews,
		playStarts: source.windowPlayStarts,
		favorites: source.favorites,
		comments: source.comments,
	};
}

/**
 * Label for a windowed metric. Only metrics the window applies to get its wording (`Views · Last 7 days`).
 * Attaching it to a non-windowed metric would write a value we do not have, such as `Favorites, last 7 days`.
 */
export function metricLabelFor(
	metric: CreatorAnalyticsMetric,
	window: CreatorAnalyticsWindow,
): string {
	const label = metricLabel(metric);
	if (window === "all" || !WINDOWED_METRICS.has(metric)) return label;
	return translator("create")("analytics.windowed", {
		label,
		window: periodLabel(window),
	});
}

/**
 * The conversion line. With no denominator it returns `null` and no line is drawn; neither `—` nor
 * 0% is correct. One decimal place. Values can exceed 100 (one person can start three rooms in a
 * day), so the value is not clipped.
 */
export function formatConversion(
	summary: { windowViews: number; windowPlayStarts: number } | null,
): string | null {
	if (!summary) return null;
	const rate = playStartConversion({
		views: summary.windowViews,
		playStarts: summary.windowPlayStarts,
	});
	if (rate === null) return null;
	return `${formatNumber(rate * 100, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	})}%`;
}

/**
 * The caption under the total. It states, per window, which figures are cumulative and which are
 * window counts. When a window is active, cumulative views and play starts are shown too, since
 * window values alone would read as 'my views dropped to 12'.
 */
export function summaryCaption(
	summary: { views: number; playStarts: number },
	window: CreatorAnalyticsWindow,
): string {
	if (window === "all") return translator("create")("analytics.captionAll");
	return translator("create")("analytics.captionWindow", {
		window: periodLabel(window),
		views: formatMetric(summary.views),
		playStarts: formatMetric(summary.playStarts),
	});
}
