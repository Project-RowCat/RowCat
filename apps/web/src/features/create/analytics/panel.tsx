import {
	CREATOR_ANALYTICS_WINDOWS,
	type CreatorAnalyticsWindow,
	uniqueCreatorAnalyticsWorks,
} from "@rowcat/domain";
import {
	CREATOR_ANALYTICS_QUERY_KEY_PREFIX,
	creatorAnalyticsInfiniteQueryOptions,
	creatorAnalyticsSummary,
	creatorAnalyticsTotal,
	creatorAnalyticsWorks,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { periodLabel } from "#/lib/i18n/vocab.ts";
import { feedbackEnter } from "#/lib/motion/feedback.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { type RetrySurface, StaleNotice } from "#/lib/query/stale-notice.tsx";

import {
	CreatorAnalyticsOverview,
	CreatorAnalyticsOverviewSkeleton,
} from "./overview.tsx";
import { creatorAnalyticsPanelView } from "./state.ts";
import {
	CreatorAnalyticsWorkList,
	CreatorAnalyticsWorkListSkeleton,
} from "./work-list.tsx";

/**
 * Analytics: how the creator's works are being read.
 *
 * Same ownership as the adjacent `Published` panel: the server is the source of truth and TanStack
 * Query caches it. The one resource is `GET /v2/me/creator-analytics`.
 *
 * Three metrics, with different meanings:
 * - views: cumulative detail views, de-duplicated by (work, viewer, UTC date). The owner's own
 *   views of their work are excluded.
 * - favorites: members who have saved the work right now. Not cumulative clicks.
 * - comments: comments that remain right now. Deleted comments are not counted.
 *
 * All three are absolute values as of now, which is why they can sit side by side in one row.
 * Adding a time axis would make that side-by-side false, since the last two have no event ledger to
 * answer a period. So there is no `Today`, `7 days`, or `30 days`, no chart, no change rate, and no conversion
 * here.
 *
 * This file owns only the panel's five states: stopped, failed, placeholder, empty list, and
 * values. What is drawn lives in two files: the overview (the server-counted total) and the work
 * list (the per-work comparison table). They are split by the question each answers, not by file
 * length. Merging them would eventually lead to code deriving the total from the rows.
 *
 * No invented scores (performance scores, engagement, popularity). Every value is measured;
 * invented formulas would be decoration, and creators could not know what to change to move them.
 *
 * No downloads metric. The column (`story.downloads`), logs, and record function exist, but no live
 * path calls them, so the value stays 0. Renaming that 0 to `Start conversation` would claim to measure
 * something that is not measured.
 *
 * No actions. The only movement is to the work detail page, carried by the title. Title edits,
 * republishing, draft editing, and visibility changes belong to the `Published` panel; having them
 * here would blur which panel does what.
 */

export function CreatorAnalyticsPanel({
	window,
	onWindowChange,
}: {
	/** The current window. The URL decides it (`?window=`); no shadow state is kept. */
	window: CreatorAnalyticsWindow;
	onWindowChange: (window: CreatorAnalyticsWindow) => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	/**
	 * Not a suspense query. If loading this panel replaced the whole screen with a placeholder, the
	 * user could not reach the drafts panel, and this query can fail (offline). The loading boundary
	 * is confined to this section, so the workspace stays usable.
	 */
	const query = useInfiniteQuery(
		creatorAnalyticsInfiniteQueryOptions(getRowCatClient(), window),
	);

	const works = useMemo(
		() =>
			query.data
				? uniqueCreatorAnalyticsWorks(creatorAnalyticsWorks(query.data))
				: [],
		[query.data],
	);
	/**
	 * Both the summary and the total are counted by the server across all of the owner's works. Do not
	 * sum or count loaded rows here: that would grow the total views and work count with each `Show more`
	 * click, which users would read as new activity.
	 */
	const summary = query.data ? creatorAnalyticsSummary(query.data) : null;
	const total = query.data ? creatorAnalyticsTotal(query.data) : null;

	const panel = creatorAnalyticsPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		workCount: works.length,
	});

	/**
	 * This is what makes `Try again` actually retry. It does not call `query.refetch()`.
	 *
	 * A stopped query still holds an unfinished retryer. With no data held, `refetch()` returns that
	 * retryer without making a request, so the button does nothing even after the connection returns.
	 * The adjacent published-works panel follows the same rule via `panel-retry.ts` (see
	 * `published-work-list.tsx`), because its stopped state behaves the same way.
	 *
	 * The `StaleNotice` that shows held values uses the same handler. There data is held, so the rule
	 * takes the refetch path, and retrying does not clear the metrics.
	 */
	const retry = usePanelRetry(CREATOR_ANALYTICS_QUERY_KEY_PREFIX, query);
	/**
	 * A failed `Show more` is not staleness. TanStack sets `isError` on next-page failures too. Left
	 * unfiltered, a `Last refresh failed` band would sit over the totals and per-work values, and its retry
	 * would re-query from page one. Only the next page failed, so the message belongs at the end of
	 * the list.
	 */
	const nextPageFailed = query.isFetchNextPageError;
	const staleVisible = panel.retryable && !nextPageFailed;

	if (panel.state === "offline")
		return (
			<AnalyticsNotice
				tone="offline"
				title={t("panel.youReNotConnectedRight")}
				/*
				 * Does not draw 0. Having no connection does not mean performance is zero, and a 0 here would
				 * be a fact we cannot know.
				 */
				detail={t("panel.analyticsReloadOnceYouRe")}
				isRetrying={query.isFetching}
				onRetry={retry}
			/>
		);

	if (panel.state === "error")
		return (
			<AnalyticsNotice
				tone="error"
				title={t("panel.couldnTLoadAnalytics")}
				detail={t("panel.yourDraftsAndPublishedStories")}
				isRetrying={query.isFetching}
				onRetry={retry}
			/>
		);

	/**
	 * The period selector outlives the placeholder.
	 *
	 * Two paths lead into this branch, and they differ: opening the panel for the first time, and
	 * changing the period just now. On the second, covering the area with a placeholder would remove
	 * the control just pressed, so the chosen period would no longer be visible and could not be
	 * changed again. On the first, nothing is lost, because the control works without waiting for
	 * data.
	 *
	 * Values from the previous period are not kept. Keeping them would put old-period numbers under
	 * the new period's label, which is worse than a placeholder: it states something false as fact.
	 * The mobile app makes the same decision (`apps/mobile/.../creator-analytics-panel.tsx`).
	 */
	if (panel.state === "loading")
		return (
			<div className="flex flex-col gap-6">
				<WindowSelector value={window} onChange={onWindowChange} />
				<AnalyticsSkeleton />
			</div>
		);

	if (panel.state === "empty")
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<BarChart3 />
					</EmptyMedia>
					<EmptyTitle>{t("panel.noStoriesToAnalyzeYet")}</EmptyTitle>
					{/*
					 * Does not say `make it public`. Publishing is open, but it is not something this
					 * screen should suggest. Private published works also accumulate views, favorites, and
					 * comments, so an empty metric and visibility are separate axes. Changing visibility belongs
					 * to the `Published` panel; drawing that path here would create the same action in two
					 * places.
					 */}
					<EmptyDescription>{t("panel.onceYouPublishAStory")}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);

	return (
		<div className="flex flex-col gap-6">
			{/*
			 * Values are still drawn, but the last refresh failed or was interrupted. Instead of clearing
			 * the rows, only a retry path is attached. The numbers on screen are still server-confirmed.
			 */}
			<AnimatePresence initial={false}>
				{staleVisible && (
					<m.div
						key="stale"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
					>
						<StaleNotice
							message={t("panel.theLastRefreshFailedSo")}
							isRetrying={query.isFetching}
							onRetry={retry}
						/>
					</m.div>
				)}
			</AnimatePresence>

			<WindowSelector value={window} onChange={onWindowChange} />

			<CreatorAnalyticsOverview summary={summary} window={window} />

			<CreatorAnalyticsWorkList
				window={window}
				works={works}
				total={total}
				hasNextPage={query.hasNextPage}
				isFetchingNextPage={query.isFetchingNextPage}
				nextPageFailed={nextPageFailed}
				onLoadMore={() => {
					void query.fetchNextPage();
				}}
			/>
		</div>
	);
}

/**
 * One shared surface for the two states that show no values at all: stopped and failed.
 *
 * The adjacent published-works panel has the same structure, but the components are not shared.
 * What remains visible alongside the message differs per panel: when analytics fails, drafts and
 * published works stay intact. Both files use the same shape so they do not drift apart.
 *
 * The two states carry different weight, as the notification surface does. Only failure uses the
 * alert role and a destructive color. Failure replaces a placeholder, so people not looking at the
 * screen must still learn that the wait has ended. Stopped (offline) is a wait, not a fault, so it
 * is a quiet box. Painting it like a server fault would make the red stop standing out for real
 * failures.
 */
function AnalyticsNotice({
	tone,
	title,
	detail,
	isRetrying,
	onRetry,
}: {
	tone: "offline" | "error";
	title: string;
	detail: string;
} & RetrySurface) {
	const { t } = useTranslation(["create", "common"]);
	const failed = tone === "error";
	return (
		<div
			{...(failed ? { role: "alert" } : {})}
			className={
				failed
					? "rounded-lg border border-destructive/40 bg-destructive/5 p-4"
					: "rounded-lg border p-4"
			}
		>
			<p
				className={
					failed
						? "text-sm font-medium text-destructive"
						: "text-sm font-medium"
				}
			>
				{title}
			</p>
			<p className="mt-1 text-sm text-muted-foreground">{detail}</p>
			<Button
				size="sm"
				variant="outline"
				className="mt-3"
				disabled={isRetrying}
				onClick={onRetry}
			>
				{isRetrying ? t("common:state.loading") : t("common:actions.retry")}
			</Button>
		</div>
	);
}

/**
 * Reserves the geometry of the arriving screen: the total surface plus the per-work table.
 *
 * The two placeholders live beside their components because the geometry is decided there.
 * Redrawing them here would leave this file in the old shape the day the real screen changes, and
 * the mismatch would show up only as a full reflow when values arrive.
 */
function AnalyticsSkeleton() {
	const { t } = useTranslation(["create", "common"]);
	return (
		<div>
			<output className="sr-only">{t("panel.loadingAnalytics")}</output>
			<div className="flex flex-col gap-6">
				<CreatorAnalyticsOverviewSkeleton />
				<CreatorAnalyticsWorkListSkeleton />
			</div>
		</div>
	);
}

/**
 * Period window: four buttons with `aria-pressed`, not a radio group.
 *
 * The radiogroup role brings roving tabindex and arrow-key movement with it, the same convention
 * the template gallery's cards follow. Implementing half of it would leave assistive-tech users
 * with a control that does not behave as they expect. The selected state is not conveyed by color
 * alone: a pressed button has a filled surface, and its name stays the same.
 *
 * The value lives in the URL, and `onChange` navigates. A `useState` here would lose the window on
 * reload or back navigation.
 */
function WindowSelector({
	value,
	onChange,
}: {
	value: CreatorAnalyticsWindow;
	onChange: (window: CreatorAnalyticsWindow) => void;
}) {
	const { t } = useTranslation(["create", "common"]);
	return (
		/**
		 * The `fieldset` tells assistive tech that the four buttons answer one question. Its legend is
		 * screen-reader only, so the name exists only for assistive tech.
		 */
		<fieldset className="flex flex-wrap gap-1.5">
			<legend className="sr-only">{t("panel.analyticsPeriod")}</legend>
			{CREATOR_ANALYTICS_WINDOWS.map((window) => {
				const pressed = window === value;
				return (
					<Button
						key={window}
						type="button"
						size="sm"
						variant={pressed ? "secondary" : "ghost"}
						aria-pressed={pressed}
						onClick={() => {
							if (!pressed) onChange(window);
						}}
					>
						{periodLabel(window)}
					</Button>
				);
			})}
		</fieldset>
	);
}
