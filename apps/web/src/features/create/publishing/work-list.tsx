import type { StoryDraft } from "@rowcat/authoring";
import {
	CREATOR_WORKS_QUERY_KEY_PREFIX,
	creatorWorks,
	creatorWorksInfiniteQueryOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BookMarked } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { StaleNotice } from "#/lib/query/stale-notice.tsx";

import { creatorWorkRows, draftIdIndex } from "./work.ts";
import { CreatorWorkCard, CreatorWorkCardSkeleton } from "./work-card.tsx";

/**
 * Shown when the list has data but the last refresh failed or was interrupted. Worded the same way
 * as the stale band in the analytics panel.
 */
const workListStaleMessage = (): string =>
	translator("create")("workList.stale");

/**
 * - Published works. The server is the source of truth here, the opposite of the drafts column
 *   next to it.
 * - Values come from Postgres through the TanStack Query cache. There is no IndexedDB copy: it
 *   would go stale unnoticed, and it would survive an account switch on the device.
 * - Queries `GET /v2/me/stories` only. Not the public profile grid, which deliberately omits
 *   private works, and not the gallery, since ownership is not a discovery axis. The list must
 *   include archived works, otherwise they cannot be restored.
 * - This file owns only the four list states (paused, error, placeholder, empty) and `Show more` (load
 *   more). Card layout and actions live in `creator-work-card.tsx`.
 * - The card changes only visibility. Title, rating and body are not editable here: that would
 *   split the draft title from the work title, leaving the next publish no basis to decide which is
 *   the creator's intent. The card has no `Publish again` button for the same reason: that
 *   action must flush pending autosave, then assemble and validate a snapshot in order, and the
 *   editor owns that order.
 */

export function PublishedWorkList({ drafts }: { drafts: StoryDraft[] }) {
	const { t } = useTranslation(["create", "common"]);
	/**
	 * Not a suspense query. If this column suspended, the whole screen would become a placeholder and
	 * the drafts column could not be reached. This query is the only part that can fail (offline), so
	 * its boundary stays inside this section.
	 */
	const query = useInfiniteQuery(
		creatorWorksInfiniteQueryOptions(getRowCatClient()),
	);

	/**
	 * Rebuild the draft id index only when the list changes. The liveQuery emits a new array on every
	 * autosave in other tabs. Without memoization, the per-work mapping would run on every keystroke.
	 * The index is a cheap Set, but that is not a reason to rebuild it on each render.
	 */
	const localDraftIds = useMemo(() => draftIdIndex(drafts), [drafts]);
	const rows = useMemo(
		() =>
			query.data
				? creatorWorkRows(creatorWorks(query.data), localDraftIds)
				: [],
		[query.data, localDraftIds],
	);

	/**
	 * Where `Try again` (retry) actually retries, instead of `query.refetch()`. A stalled query keeps a
	 * pending retryer attached. With no data, refetch() returns that retryer and makes no request, so
	 * the button does nothing, and the section stays on the stalled screen even after the connection
	 * returns. The rule lives in `panel-retry.ts`.
	 */
	const retry = usePanelRetry(CREATOR_WORKS_QUERY_KEY_PREFIX, query);

	/**
	 * Separate stalled from failed, and check both before the placeholder. TanStack Query pauses
	 * retries when it believes there is no network (fetchStatus 'paused', default networkMode
	 * 'online'). That is not an error; the query is still pending. A placeholder alone would show
	 * offline users a loading state that never ends, which is worse than an error because it does not
	 * say what to do.
	 *
	 * So this branch comes before isPending. If data is present we never get here; showing the stale
	 * list is better.
	 */
	if (query.isPaused && !query.data)
		return (
			<WorkListNotice
				tone="offline"
				title={t("workList.youReNotConnectedRight")}
				detail={t("workList.yourPublishedStoriesReloadOnce")}
				isRetrying={query.isFetching}
				onRetry={retry}
			/>
		);

	/**
	 * Failure stays inside this section. The drafts remain usable, and the next step is retry or going
	 * to the drafts column. Covering the whole screen with an error would kill the workspace offline.
	 *
	 * If data is present, we never get here. An earlier version ignored data in this branch, so one
	 * failed background refresh replaced the cached list with an error box. The analytics column keeps
	 * its values in the same situation and adds one stale line; this column behaved differently.
	 */
	if (query.isError && !query.data)
		return (
			<WorkListNotice
				tone="error"
				title={t("workList.couldnTLoadYourPublished")}
				detail={t("workList.yourDraftsStayOnThis")}
				isRetrying={query.isFetching}
				onRetry={retry}
			/>
		);

	if (query.isPending)
		return (
			<div>
				<output className="sr-only">
					{t("workList.loadingYourPublishedStories")}
				</output>
				{/*
				 * The card's geometry belongs to the card (`creator-work-card.tsx`). Drawing it here would
				 * leave this file with the old shape whenever the card changes. The list decides only the
				 * container (`ul`), the gap (`gap-2`) and the count.
				 *
				 * Three placeholders because that is what fills the first screen. More would draw space that
				 * is never visible; fewer would push content down when cards arrive.
				 */}
				<ul aria-hidden="true" className="flex flex-col gap-2">
					{[0, 1, 2].map((index) => (
						<li key={index}>
							<CreatorWorkCardSkeleton />
						</li>
					))}
				</ul>
			</div>
		);

	/**
	 * Values are present, but the last refresh failed or was interrupted. Instead of clearing the
	 * list, show one stale line in the same shape as `StaleNotice` in the analytics column. This also
	 * applies to an empty list: the server confirmed zero, which is loaded data, and the question of
	 * whether it is current is the same.
	 */
	const nextPageFailed = query.isFetchNextPageError;
	/**
	 * A failed `Show more` (load more) is not stale. TanStack also sets isError on next-page failures.
	 * Without this filter, a stale banner would appear over a still-valid list, and its retry would
	 * re-request from the first page. The failure belongs to the next page only, and its message is
	 * shown next to the button.
	 */
	const stale = (query.isError && !nextPageFailed) || query.isPaused;

	if (rows.length === 0)
		return (
			<div className="flex flex-col gap-4">
				{stale && (
					<StaleNotice
						message={workListStaleMessage()}
						isRetrying={query.isFetching}
						onRetry={retry}
					/>
				)}
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<BookMarked />
						</EmptyMedia>
						<EmptyTitle>{t("workList.noPublishedStoriesYet")}</EmptyTitle>
						{/*
						 * Spell out what the user can actually do here. Publishing can now produce two states, so
						 * describing only the private case would make this list look narrower than the actions
						 * available.
						 */}
						<EmptyDescription>
							{t("workList.finishADraftAndPublish")}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);

	return (
		<div>
			{stale && (
				<div className="pb-3">
					<StaleNotice
						message={workListStaleMessage()}
						isRetrying={query.isFetching}
						onRetry={retry}
					/>
				</div>
			)}
			{/*
			 * No layout motion. If cards already on screen re-enter each time `Show more` appends, users
			 * read the list as rebuilt. The key is the work id, so React keeps existing cards in place.
			 *
			 * The narrow gap (`gap-2`) is why this reads as one management list. The adjacent columns
			 * connect rows with a rule line; this list does not, because each card is a management unit
			 * with cover, status and actions together (`creator-work-card.tsx`). But a card must not look
			 * like a widget floating in whitespace: the wider the gap, the more the list becomes separate
			 * boxes.
			 */}
			<ul className="flex flex-col gap-2">
				{rows.map(({ work, editableDraftId }) => (
					<li key={work.id}>
						<CreatorWorkCard work={work} editableDraftId={editableDraftId} />
					</li>
				))}
			</ul>

			{/*
			 * The position of `Show more` is the same in all three columns; the analytics per-work table
			 * also uses `pt-3`.
			 */}
			{query.hasNextPage && (
				<div className="flex flex-col gap-2 pt-3">
					{nextPageFailed && (
						<p role="alert" className="text-sm text-destructive">
							{t("workList.couldnTLoadMoreStories")}
						</p>
					)}
					<Button
						variant="outline"
						className="w-full"
						disabled={query.isFetchingNextPage}
						onClick={() => {
							void query.fetchNextPage();
						}}
					>
						{query.isFetchingNextPage ? <Spinner /> : null}
						{query.isFetchingNextPage
							? t("common:state.loading")
							: t("workList.showMore")}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * One shared surface for the two states that cannot draw the list: paused and error.
 *
 * They differ only in wording, so the structure is shared. Writing the same markup twice would
 * eventually drop `role="alert"` from one side or lose the retry button, and that difference would
 * appear only to people with a dropped network, invisible in review.
 *
 * The two carry different weight, the same judgment as the analytics column and notice surfaces.
 * Only the error variant has `role="alert"` and destructive color: it replaces the placeholder, so
 * people not watching the screen must learn that waiting has ended. Paused (offline) is a wait, not
 * a fault, so it is a quiet box.
 */
function WorkListNotice({
	tone,
	title,
	detail,
	isRetrying,
	onRetry,
}: {
	tone: "offline" | "error";
	title: string;
	detail: string;
	isRetrying: boolean;
	/**
	 * Takes a handler, not a query. Passing `refetch` would make the button do nothing on a stalled
	 * query (`panel-retry.ts`), and that cannot be detected from inside this surface.
	 */
	onRetry: () => void;
}) {
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
