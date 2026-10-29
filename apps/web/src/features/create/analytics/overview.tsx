import type {
	CreatorAnalyticsSummary,
	CreatorAnalyticsWindow,
} from "@rowcat/domain";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";

import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import {
	creatorAnalyticsMetrics,
	formatConversion,
	formatMetric,
	METRIC_ORDER,
	metricLabelFor,
	summaryCaption,
} from "./state.ts";

/**
 * Overall performance: one total across all of the creator's works.
 *
 * It answers a different question from the per-work table below. This total is counted by the
 * server across all of the owner's works. It is not the first table row enlarged, and it is not a
 * sum of the loaded rows: summing loaded rows would grow with every `Show more` click and read as new
 * views. The summary comes from the first page of `creatorAnalyticsSummary`.
 *
 * Drawn as one surface, not three bordered cards. The three values answer one question, and the
 * per-work table below is already long, so stacked boxes would make the whole screen a list of
 * boxes.
 *
 * No size hierarchy. Counts are never abbreviated (`formatMetric`), so larger type would overflow
 * first for the largest numbers. Position conveys the hierarchy.
 *
 * No change rates, periods, trend arrows, or conversion rate. Only `views` is a cumulative event;
 * the other two are current state. A period would claim a ledger the app does not have, and the
 * line below states this.
 *
 * The numbers animate when they are refetched (`Try again`, invalidation after publishing), so users
 * can see which values changed. The placeholder-to-value arrival does not animate: the component
 * returns null without a summary, so arrival is a mount. Animating from zero would falsely suggest
 * the counts grew from nothing on each open.
 *
 * Formatting is done only by `formatMetric`. The animated component receives text rather than a
 * number, so the no-abbreviation rule is not duplicated across files.
 */
export function CreatorAnalyticsOverview({
	summary,
	window,
}: {
	summary: CreatorAnalyticsSummary | null;
	window: CreatorAnalyticsWindow;
}) {
	const { t } = useTranslation(["create", "common"]);
	/**
	 * When the summary cannot be read, nothing is drawn as 0. Practically no path reaches this, since
	 * held data implies a summary, but that is no reason to invent a 0: zero claims that nobody viewed
	 * the work.
	 */
	if (!summary) return null;
	const metrics = creatorAnalyticsMetrics(summary);
	const conversion = formatConversion(summary);

	return (
		<section aria-labelledby="analytics-summary-heading">
			<h2
				id="analytics-summary-heading"
				className="text-sm font-semibold text-muted-foreground"
			>
				{t("overview.overallPerformance")}
			</h2>

			{/*
			 * Renders label and value pairs as a description list (`dl`). A bare list of three numbers
			 * reads as '24,821 1,204 318' to screen readers, losing which is which.
			 *
			 * On narrow screens each label sits on the same line as its value. Three columns at 390px
			 * leave about 88px per cell, and `1,247,017` overflowed into the neighboring cell. Three
			 * columns start at `sm`, and cells are divided by a single rule rather than bordered boxes.
			 */}
			<dl className="mt-2 grid grid-cols-1 divide-y rounded-lg border bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
				{METRIC_ORDER.map((metric) => (
					<div
						key={metric}
						className="flex items-baseline justify-between gap-3 px-4 py-3 sm:block sm:py-4"
					>
						<dt className="text-xs font-medium text-muted-foreground">
							{metricLabelFor(metric, window)}
						</dt>
						{/*
						 * The value text steps up only at `lg`. Near `sm` (640px) a cell's inner width is about
						 * 170px, so `999,999,999` at 30px would overflow. Fixing that by shrinking the text would
						 * contradict the purpose of this screen. The size is raised only when space allows; it is
						 * never reduced.
						 */}
						<dd className="text-2xl font-black tabular-nums sm:mt-1 lg:text-3xl">
							<AnimatedCount value={formatMetric(metrics[metric])} />
						</dd>
					</div>
				))}
			</dl>

			{/*
			 * States in one sentence that the three values have different meanings.
			 *
			 * Definitions are not attached to each metric: three always-visible descriptions under the
			 * values would turn a scan line into paragraphs. Words such as `recent`, `by period`, and
			 * `real-time` are not used, because none of them can be answered.
			 */}
			<p className="mt-2 text-xs text-muted-foreground">
				{summaryCaption(summary, window)}
			</p>
			{/*
			 * The conversion line is built only from two numbers in the same window. With no denominator
			 * the line is omitted: `—` would read as 'unknown' and 0% as 'nobody started', and neither
			 * is true.
			 *
			 * The sentence states that the value can exceed 100% and that a 'session' means something
			 * different in each playback mode. Both apps say the same sentence
			 * (`PLAY_START_CONVERSION_NOTE` in `@rowcat/domain`).
			 *
			 * The screen is not labeled `conversion rate` for the same reason: this is not the
			 * usual conversion rate of unique visitors.
			 */}
			{conversion !== null && (
				<p className="mt-1 text-xs text-muted-foreground">
					{t("overview.playStartsPerView")}{" "}
					<span className="font-medium tabular-nums text-foreground">
						{conversion}
					</span>
					<span className="sr-only">{`. ${t("analytics.playStartConversionNote")}`}</span>
				</p>
			)}
		</section>
	);
}

/**
 * Placeholder for the total, with the same geometry as the surface that will arrive.
 *
 * The three-card placeholder is not kept. The real screen is now one surface, so the old
 * placeholder would reflow the layout when values arrive, and that jump reads as something having
 * gone wrong.
 */
export function CreatorAnalyticsOverviewSkeleton() {
	return (
		<div aria-hidden="true">
			<Skeleton className="h-5 w-20" />
			<div className="mt-2 grid grid-cols-1 divide-y rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
				{METRIC_ORDER.map((metric) => (
					<div
						key={metric}
						className="flex items-baseline justify-between gap-3 px-4 py-3 sm:block sm:py-4"
					>
						<Skeleton className="h-4 w-12" />
						<Skeleton className="h-7 w-24 sm:mt-1" />
					</div>
				))}
			</div>
			<Skeleton className="mt-2 h-4 w-64" />
		</div>
	);
}
