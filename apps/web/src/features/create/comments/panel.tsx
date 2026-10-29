import type { CreatorCommentInboxItem } from "@rowcat/domain";
import {
	CREATOR_COMMENTS_QUERY_KEY_PREFIX,
	creatorCommentInboxItems,
	creatorCommentsInfiniteQueryOptions,
} from "@rowcat/query";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Flag, MessageSquare, MoreHorizontal } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { feedbackEnter } from "#/lib/motion/feedback.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { type RetrySurface, StaleNotice } from "#/lib/query/stale-notice.tsx";
import { ReportDialog } from "../../moderation/report-dialog.tsx";
import { CommentAvatar } from "../../story/comments/comment-row.tsx";
import {
	type CreatorCommentRowView,
	creatorCommentRowView,
	creatorCommentsPanelView,
} from "./state.ts";

/**
 * Comments: which comments have been left on the creator's works.
 *
 * This is the fourth panel in the workspace. Like the two neighbors (`Published`, `Analytics`), the server is
 * the source of truth and TanStack Query caches it. The one resource is `GET
 * /v2/me/creator-comments`.
 *
 * Not a new messaging system: there are no read marks, reply box, assignment, or status. The panel
 * scans recent comments and jumps to that work's comment section. Replies happen there, and
 * notifications already announce new comments. Doing the same here would give two inboxes tracking
 * the same fact as 'read'.
 *
 * The only action on a row is the existing report (`ReportDialog`, target `(storyId, commentId)`),
 * the same one the work detail's comment rows have. There is no delete, because that permission
 * belongs to the author: creators have no path to delete comments on their works, and this panel is
 * not the place to create one. There is no heart either. Reactions are part of participating in the
 * conversation and happen where that conversation is.
 *
 * Navigation is by id. Row keys, report targets, and links all come from the comment id and work id
 * (`creatorCommentRowView`). List position is never used: when another page appends or a new row
 * lands at the top, a position would point at a different comment.
 */
export function CreatorCommentsPanel() {
	const { t } = useTranslation(["create", "common"]);
	/**
	 * Not a suspense query. If this panel fails (offline), the workspace must stay usable. The panel
	 * mounts only while active, so opening `/create` does not trigger this query.
	 */
	const query = useInfiniteQuery(
		creatorCommentsInfiniteQueryOptions(getRowCatClient()),
	);
	const items = useMemo(
		() => (query.data ? creatorCommentInboxItems(query.data) : []),
		[query.data],
	);
	const panel = creatorCommentsPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		itemCount: items.length,
		error: query.error,
	});
	/**
	 * The rule that makes retrying a stopped query actually re-ask. It is the same path the adjacent
	 * panels take.
	 */
	const retry = usePanelRetry(CREATOR_COMMENTS_QUERY_KEY_PREFIX, query);
	/**
	 * A failed `Show more` is not staleness of the list. TanStack sets `isError` on next-page failures too.
	 * Left alone, a `Last refresh failed` band would sit over the loaded rows, and its retry would re-ask
	 * from page one. The failure belongs to the next page, so the message goes at the list end (the
	 * same split as the work detail comment section).
	 */
	const staleVisible = panel.retryable && !query.isFetchNextPageError;

	if (panel.state === "offline")
		return (
			<InboxNotice
				tone="offline"
				title={t("panel.youReNotConnectedRight")}
				detail={t("panel.receivedCommentsReloadOnceYou")}
				isRetrying={query.isFetching}
				onRetry={retry}
			/>
		);

	if (panel.state === "reauth")
		return (
			<div className="rounded-lg border p-4">
				<p className="text-sm font-medium">{t("panel.youNeedToSignIn")}</p>
				<p className="mt-1 text-sm text-muted-foreground">
					{t("panel.yourSignInExpiredSo")}
				</p>
				<Link
					to="/login"
					search={{ redirect: "/create?view=comments" }}
					className={buttonVariants({
						variant: "outline",
						size: "sm",
						className: "mt-3",
					})}
				>
					{t("panel.signIn")}
				</Link>
			</div>
		);

	if (panel.state === "error")
		return (
			<InboxNotice
				tone="error"
				title={t("panel.couldnTLoadReceivedComments")}
				detail={t("panel.yourDraftsAndPublishedStories")}
				isRetrying={query.isFetching}
				onRetry={retry}
			/>
		);

	if (panel.state === "loading") return <InboxSkeleton />;

	if (panel.state === "empty")
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<MessageSquare />
					</EmptyMedia>
					<EmptyTitle>{t("panel.noCommentsReceivedYet")}</EmptyTitle>
					<EmptyDescription>
						{t("panel.whenOthersCommentOnOr")}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);

	return (
		<div className="flex flex-col gap-4">
			<AnimatePresence initial={false}>
				{staleVisible && (
					<m.div
						key="stale"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						transition={feedbackEnter.transition}
					>
						<StaleNotice
							message={t("panel.theLastRefreshFailedSo2")}
							isRetrying={query.isFetching}
							onRetry={retry}
						/>
					</m.div>
				)}
			</AnimatePresence>

			<section aria-labelledby="creator-comments-heading">
				<h2 id="creator-comments-heading" className="sr-only">
					{t("panel.receivedComments")}
				</h2>
				{/*
				 * Rows appended by `Show more` get no entrance animation. Twenty rows fading in one at a time would
				 * read as a freshly built list (same judgment as the ops console tables).
				 */}
				<ul className="divide-y">
					{items.map((item) => (
						<InboxRow
							key={item.comment.id}
							item={item}
							view={creatorCommentRowView(item)}
						/>
					))}
				</ul>

				{/*
				 * A failed `Show more` is reported beside the boundary where the user pressed it. If it were folded
				 * into the stale band above, a user at the end of the list would miss the notice off-screen.
				 * Loaded rows stay as they are.
				 */}
				{query.isFetchNextPageError && (
					<p role="alert" className="mt-3 text-sm text-destructive">
						{t("panel.couldnTLoadMoreComments")}
					</p>
				)}
				{query.hasNextPage && (
					<div className="mt-4 flex justify-center">
						<Button
							variant="outline"
							size="sm"
							disabled={query.isFetchingNextPage}
							onClick={() => {
								void query.fetchNextPage();
							}}
						>
							{query.isFetchingNextPage ? <Spinner /> : null}
							{query.isFetchingNextPage
								? t("common:state.loading")
								: t("panel.showMore")}
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}

/**
 * One row: author, body, work title, time, and the report action. The body is plain text, clipped
 * to three lines. It follows the same render rules as work-detail comments (no markdown, no
 * `dangerouslySetInnerHTML`). Clipping suits a scanning list; the full text lives in that work's
 * comment section.
 */
function InboxRow({
	item,
	view,
}: {
	item: CreatorCommentInboxItem;
	view: CreatorCommentRowView;
}) {
	const { t } = useTranslation(["create", "common"]);
	const [reporting, setReporting] = useState(false);
	const { comment, story } = item;

	return (
		<li className="flex gap-3 py-3">
			<CommentAvatar comment={comment} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2 text-sm">
					<Link
						to="/creators/$creatorId"
						params={{ creatorId: comment.author.id }}
						className="truncate rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
					>
						{comment.author.nickname || t("comments.unnamed")}
					</Link>
					<span className="shrink-0 text-xs text-muted-foreground">
						{view.kindLabel}
					</span>
					{view.at && (
						<time
							dateTime={comment.createdAt}
							className="shrink-0 text-xs text-muted-foreground tabular-nums"
						>
							{view.at}
						</time>
					)}
					<div className="ml-auto">
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={t("comments.menu", {
											name: comment.author.nickname || t("comments.unnamed"),
											kind: view.kindLabel,
										})}
									/>
								}
							>
								<MoreHorizontal aria-hidden="true" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={() => setReporting(true)}>
									<Flag aria-hidden="true" />
									{t("panel.report")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				<p className="line-clamp-3 text-sm leading-6 break-words whitespace-pre-wrap">
					{comment.body}
				</p>

				<p className="truncate text-xs text-muted-foreground">
					{view.destination ? (
						<Link
							to="/stories/$storyId"
							params={{ storyId: view.destination.storyId }}
							hash={view.destination.hash}
							className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{story.title || t("comments.untitled")}
						</Link>
					) : (
						<>
							<span>{story.title || t("comments.untitled")}</span>
							{view.unreachableReason && (
								<span> · {view.unreachableReason}</span>
							)}
						</>
					)}
				</p>
			</div>

			{reporting && (
				<ReportDialog
					/**
					 * Same target as a comment row on the work detail page. The server checks the `(storyId,
					 * commentId)` pair, so a comment from another work cannot be passed off as this work's.
					 */
					target={{
						type: "comment",
						storyId: story.id,
						commentId: comment.id,
					}}
					targetLabel={view.kindLabel}
					onClose={() => setReporting(false)}
				/>
			)}
		</li>
	);
}

/**
 * Stopped and failed states. Same surface as the analytics panel; only the copy about what remains
 * visible differs.
 */
function InboxNotice({
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

function InboxSkeleton() {
	const { t } = useTranslation(["create", "common"]);
	return (
		<div>
			<output className="sr-only">{t("panel.loadingReceivedComments")}</output>
			<ul aria-hidden="true" className="divide-y">
				{["a", "b", "c", "d"].map((key) => (
					<li key={key} className="flex gap-3 py-3">
						<Skeleton className="size-9 shrink-0 rounded-full" />
						<div className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-4 w-full" />
							<Skeleton className="h-3 w-32" />
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
