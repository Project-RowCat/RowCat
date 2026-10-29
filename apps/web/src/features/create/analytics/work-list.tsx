import type {
	CreatorAnalyticsWindow,
	CreatorAnalyticsWork,
} from "@rowcat/domain";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { Link } from "@tanstack/react-router";
import { EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	creatorAnalyticsMetrics,
	creatorAnalyticsRowView,
	formatMetric,
	METRIC_ORDER,
	metricLabelFor,
} from "./state.ts";

/**
 * The per-work performance list, designed for vertical comparison.
 *
 * Previously each work was a bordered card, and the three metrics sat at different x positions. The
 * values were correct, but the question this screen exists to answer (which work was read most)
 * required reading each card in turn. Now it is a list of rows: rules between rows replace card
 * borders, and each metric sits in a fixed-width column, right-aligned so the digits compare by
 * place value.
 *
 * Why not `<table>`: on narrow screens four columns cannot fit (three `999,999,999` values do not
 * fit at 390px at any size). Forcing table elements into `display: block` or grid would strip their
 * table role and break the link between headings and cells, which is worse than having no table.
 *
 * Instead every row always carries its own labels. On narrow screens the labels appear above the
 * values. From `sm`, labels are `sr-only` and a column header row shows. That header row is
 * `aria-hidden`, because assistive tech already gets the per-row labels, and reading both would
 * repeat the words.
 *
 * Not here:
 * - No sort control (`by views`). Sorting only the loaded rows would give a partial ranking the screen
 *   cannot admit is partial, and ranking authority is the server's. The words `TOP`, `Popular`, and `#1`
 *   are avoided for the same reason: nothing in the contract guarantees server ordering.
 * - No bar chart. It would claim the overall distribution while showing only the loaded works.
 * - No actions. The title link is the only movement to the work detail. Editing the title,
 *   rating, or visibility here would duplicate the `Published` panel's actions.
 */
export function CreatorAnalyticsWorkList({
	window,
	works,
	total,
	hasNextPage,
	isFetchingNextPage,
	nextPageFailed,
	onLoadMore,
}: {
	window: CreatorAnalyticsWindow;
	works: CreatorAnalyticsWork[];
	/**
	 * Total works counted by the server. Not the number of loaded rows, which would grow with each `Show
	 * more` click and read as new works. If it cannot be read, it is not drawn.
	 */
	total: number | null;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	/**
	 * The next page failed. The message appears beside the button just pressed, not in the stale band
	 * above.
	 */
	nextPageFailed: boolean;
	onLoadMore: () => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	return (
		<section aria-labelledby="analytics-works-heading">
			<div className="flex items-baseline justify-between gap-3">
				<h2
					id="analytics-works-heading"
					className="text-sm font-semibold text-muted-foreground"
				>
					{t("workList.performanceByStory")}
				</h2>
				{total !== null && (
					<p className="text-xs tabular-nums text-muted-foreground">
						{t("analyticsWorkList.count", { count: formatMetric(total) })}
					</p>
				)}
			</div>

			<WorkListHeader window={window} />

			{/*
			 * Rows are not boxed. Users compare rows, and what helps that is the shared alignment line, not
			 * each row's border.
			 *
			 * Narrow screens have no column header, so the list gets its own top border (`border-y`). From
			 * `sm`, the header's bottom rule already occupies that position, so the top border is dropped.
			 */}
			<ul className="divide-y border-y sm:border-t-0">
				{works.map((work) => (
					<li key={work.id}>
						<AnalyticsWorkRow work={work} window={window} />
					</li>
				))}
			</ul>

			{/*
			 * Not infinite scroll. The owner's own performance list is not for discovery, and
			 * scroll-triggered fetches would keep the aggregate queries running while the user reads down
			 * the page.
			 */}
			{hasNextPage && (
				<div className="flex flex-col gap-2 pt-3">
					{nextPageFailed && (
						<p role="alert" className="text-sm text-destructive">
							{t("workList.couldnTLoadMoreStories")}
						</p>
					)}
					<Button
						variant="outline"
						className="w-full"
						disabled={isFetchingNextPage}
						onClick={onLoadMore}
					>
						{isFetchingNextPage ? <Spinner /> : null}
						{isFetchingNextPage
							? t("common:state.loading")
							: t("workList.showMore")}
					</Button>
				</div>
			)}
		</section>
	);
}

/**
 * Width of the metric columns. The header and the rows use the same constant. Two separate copies
 * would eventually diverge, and the symptom would not be an error but another column's value
 * sitting under a heading. At `sm`, a cell's inner width is about 100px, so `999,999,999` fits in
 * 14px monospaced digits (83px).
 */
const METRIC_COLUMNS =
	"grid grid-cols-2 gap-2 sm:w-96 sm:shrink-0 sm:grid-cols-4";

/**
 * Column headers are visual only. They are `aria-hidden` because each row's labels already reach
 * assistive tech. Exposing both would make screen readers say the same word twice per metric. Row
 * labels are visually hidden (`sr-only`) from `sm` up, which concerns sight only.
 *
 * On narrow screens the header is not rendered at all, because labels sit directly above values at
 * that width.
 */
function WorkListHeader({ window }: { window: CreatorAnalyticsWindow }) {
	const { t } = useTranslation(["create", "common"]);
	return (
		<div
			aria-hidden="true"
			className="mt-2 hidden items-center gap-4 border-b pb-2 sm:flex"
		>
			<span className="flex-1 text-xs font-medium text-muted-foreground">
				{t("workList.story")}
			</span>
			<div className={METRIC_COLUMNS}>
				{METRIC_ORDER.map((metric) => (
					<span
						key={metric}
						className="text-right text-xs font-medium text-muted-foreground"
					>
						{metricLabelFor(metric, window)}
					</span>
				))}
			</div>
		</div>
	);
}

/**
 * One work row. Identity (title and status) and metrics sit side by side, stacking vertically on
 * narrow screens. A pure function decides what to draw (`creatorAnalyticsRowView`), including
 * whether the title is a link.
 */
function AnalyticsWorkRow({
	work,
	window,
}: {
	work: CreatorAnalyticsWork;
	window: CreatorAnalyticsWindow;
}) {
	const { t } = useTranslation(["create", "common"]);
	const row = creatorAnalyticsRowView(work);
	const metrics = creatorAnalyticsMetrics(work);

	return (
		<div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
			<div className="min-w-0 sm:flex-1">
				<div className="flex min-w-0 items-center gap-2">
					{/*
					 * The title is the link. It replaces a `View story` button at the end of each row: in a table, a
					 * button takes a whole column and pushes the metrics over, and it repeats per row, making the
					 * list noisy.
					 *
					 * The whole row is not made clickable. Users could not select text or see where the link ends,
					 * and normal link behavior such as opening in a new tab would be lost.
					 */}
					{row.linked ? (
						<Link
							to="/stories/$storyId"
							params={{ storyId: work.id }}
							className="min-w-0 truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{work.title}
						</Link>
					) : (
						<span className="min-w-0 truncate text-sm font-medium">
							{work.title}
						</span>
					)}

					{/*
					 * Only exceptional states stay as badges. Ordinary visibility (`Public`, `Private`, `Archived`) moved to
					 * the quiet text on the line below.
					 *
					 * Moderator hiding stays a badge. The creator did not cause it, and it may explain zero views;
					 * folding it into the update time would bury it. The reason for hiding is not shown here (see
					 * `/v2/me/moderation`).
					 */}
					{row.moderatorHidden && (
						<Badge variant="destructive">
							<EyeOff aria-hidden="true" />
							{t("workList.hiddenByOperators")}
						</Badge>
					)}
				</div>
				{/*
				 * The update time is context for reading the row, not a metric. The eye should land on the title
				 * and the numbers, so this line stays quiet. Merging it with visibility on one line followed from
				 * that judgment: fewer lines make the table denser.
				 */}
				<p className="mt-0.5 truncate text-xs text-muted-foreground">
					{row.meta}
				</p>
			</div>

			{/*
			 * Metrics are a description list (`dl`) of paired labels and values. Bare numbers would read as
			 * '8,240 260 61' to screen readers and lose their meaning. A visible column header cannot
			 * substitute, because that header row does not exist for assistive tech.
			 */}
			<dl className={METRIC_COLUMNS}>
				{METRIC_ORDER.map((metric) => (
					<div key={metric} className="min-w-0">
						<dt className="text-xs text-muted-foreground sm:sr-only">
							{metricLabelFor(metric, window)}
						</dt>
						<dd className="mt-0.5 text-sm font-semibold tabular-nums sm:mt-0 sm:text-right">
							{formatMetric(metrics[metric])}
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

/**
 * Placeholder for the per-work table, with the same geometry as the arriving rows. The old two-card
 * placeholder is not kept. The real screen is now a list of rows, so the old placeholder would
 * reflow the list when values arrive.
 */
export function CreatorAnalyticsWorkListSkeleton() {
	return (
		<div aria-hidden="true">
			<Skeleton className="h-5 w-24" />
			<WorkListHeader window="all" />
			<ul className="divide-y border-y sm:border-t-0">
				{[0, 1, 2].map((row) => (
					<li key={row}>
						<div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
							<div className="min-w-0 sm:flex-1">
								<Skeleton className="h-5 w-48" />
								<Skeleton className="mt-1 h-4 w-40" />
							</div>
							<div className={METRIC_COLUMNS}>
								{METRIC_ORDER.map((metric) => (
									<Skeleton key={metric} className="h-5 w-full" />
								))}
							</div>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
