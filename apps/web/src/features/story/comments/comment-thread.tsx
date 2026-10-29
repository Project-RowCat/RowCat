import {
	canReplyToComment,
	commentRepliesLabel,
	isOwnComment,
	type StoryComment,
	type Viewer,
} from "@rowcat/domain";
import {
	storyCommentRepliesInfiniteQueryOptions,
	storyCommentRepliesQueryKey,
	storyComments,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { CommentComposer } from "./comment-composer.tsx";
import { repliesLoadFailure } from "./comment-error.ts";
import { commentPanelView } from "./comment-panel-state.ts";
import { CommentRow } from "./comment-row.tsx";

/**
 * A top-level comment and its thread.
 *
 * - Replies load on demand. Fetching replies for every row up front costs one request per row,
 *   even rows with no replies. The query is gated on `enabled` (expanded), so nothing is requested
 *   while the thread is collapsed.
 * - No reply preview. A preview would need the list response to embed replies per row, which the
 *   contract rejects. The list carries only `replyCount`, from one aggregate query.
 * - One level only. The component does not render itself, and reply rows do not open another
 *   thread. The server enforces the same rule: a reply to a reply returns 409.
 * - Indentation is one step: a left margin and one vertical line. Cards, backgrounds, or collapse
 *   arrows would make the work page read like a forum.
 */
export function CommentThread({
	storyId,
	comment,
	viewer,
	onDelete,
}: {
	storyId: string;
	comment: StoryComment;
	viewer: Viewer | null;
	onDelete: (target: StoryComment) => void;
}) {
	const { t } = useTranslation("comments");
	/**
	 * Expanded state is screen-only. It is stored neither in the URL nor in storage.
	 *
	 * It belongs to this visit's reading flow, not to a place to return to. In the URL, each expansion
	 * would add a history entry.
	 */
	const [expanded, setExpanded] = useState(false);
	/**
	 * Whether the reply form is open. This axis is separate from expansion: a reply can be written
	 * while the thread is collapsed.
	 */
	const [replying, setReplying] = useState(false);

	const viewerId = viewer?.id ?? null;
	const canReply = canReplyToComment(comment) && viewerId !== null;
	const repliesLabel =
		commentRepliesLabel(comment.replyCount) === null
			? null
			: t("viewReplies", { count: comment.replyCount });

	const replies = useInfiniteQuery({
		...storyCommentRepliesInfiniteQueryOptions(
			getRowCatClient(),
			storyId,
			comment.id,
		),
		enabled: expanded,
	});
	const retry = usePanelRetry(
		storyCommentRepliesQueryKey(storyId, comment.id),
		replies,
	);

	const rows = replies.data ? storyComments(replies.data) : [];
	const panel = commentPanelView({
		isPaused: replies.isPaused,
		isError: replies.isError,
		isPending: replies.isPending,
		hasData: replies.data !== undefined,
		commentCount: rows.length,
	});

	/**
	 * Writing a reply expands the thread and closes the form.
	 *
	 * A collapsed thread would hide the new reply, and the user would read the save as having failed.
	 * The form closes rather than staying open with an empty box: writing another reply takes one more
	 * press, which is quieter.
	 */
	const onReplyCreated = (): void => {
		setExpanded(true);
		setReplying(false);
	};

	return (
		<CommentRow
			storyId={storyId}
			comment={comment}
			own={isOwnComment(comment, viewerId)}
			/*
			 * Reporting is limited to logged-in members, and only on other people's comments.
			 *
			 * Guests do not get the control: pressing it would only lead to a login wall, and coming back
			 * from login would lose which comment the user meant to report.
			 */
			canReport={!!viewer && !isOwnComment(comment, viewer.id)}
			canReact={viewerId !== null}
			onDelete={() => onDelete(comment)}
			footer={
				<>
					{/*
					 * The `Reply` button sits beside the heart. It is not drawn on tombstones, which have no action row.
					 *
					 * canReplyToComment checks again anyway, because reply rows also receive this slot. A `Reply` button
					 * there would lead to a 409 after the user presses it.
					 */}
					{canReply && !replying && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 px-2 text-xs text-muted-foreground"
							onClick={() => setReplying(true)}
						>
							{t("reply")}
						</Button>
					)}
					{repliesLabel && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							/**
							 * The expanded state is announced through `aria-expanded`, not through the button's label.
							 */
							aria-expanded={expanded}
							className="h-8 px-2 text-xs text-muted-foreground"
							onClick={() => setExpanded((open) => !open)}
						>
							{expanded ? t("collapseReplies") : repliesLabel}
						</Button>
					)}

					{/*
					 * The form and list come below the action row. On the same row, on a narrow screen the form would
					 * push the heart and reply buttons onto the next line.
					 */}
					{(replying || expanded) && (
						<div className="mt-2 w-full border-l pl-4">
							{replying && (
								<CommentComposer
									storyId={storyId}
									parentId={comment.id}
									autoFocus
									onCreated={onReplyCreated}
									onCancel={() => setReplying(false)}
								/>
							)}

							{expanded && (
								<div className="flex flex-col gap-2">
									{panel.state === "loading" ? (
										<RepliesSkeleton />
									) : panel.state === "offline" ? (
										<ReplyNotice
											tone="muted"
											message={t("repliesOffline")}
											busy={replies.isFetching}
											onRetry={retry}
										/>
									) : panel.state === "error" ? (
										<ReplyNotice
											tone="destructive"
											message={repliesLoadFailure()}
											busy={replies.isFetching}
											onRetry={retry}
										/>
									) : panel.state === "empty" ? (
										/*
										 * A thread can have a nonzero reply count and still return an empty list. This happens
										 * when every reply is from an author the viewer has blocked. Rendering nothing would make
										 * the user think the fetch failed, so the empty state is shown.
										 */
										<p className="py-2 text-sm text-muted-foreground">
											{t("noReplies")}
										</p>
									) : (
										<ul className="divide-y">
											<AnimatePresence initial={false}>
												{rows.map((reply) => (
													<CommentRow
														key={reply.id}
														storyId={storyId}
														comment={reply}
														own={isOwnComment(reply, viewerId)}
														canReport={
															!!viewer && !isOwnComment(reply, viewer.id)
														}
														canReact={viewerId !== null}
														onDelete={() => onDelete(reply)}
													/>
												))}
											</AnimatePresence>
										</ul>
									)}

									{replies.hasNextPage && (
										<div className="flex flex-col items-start gap-1">
											{replies.isFetchNextPageError && (
												<p role="alert" className="text-xs text-destructive">
													{t("repliesLoadMoreFailed")}
												</p>
											)}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-8 px-2 text-xs"
												disabled={replies.isFetchingNextPage}
												onClick={() => void replies.fetchNextPage()}
											>
												{replies.isFetchingNextPage
													? t("loading")
													: replies.isFetchNextPageError
														? t("retry")
														: t("moreReplies")}
											</Button>
										</div>
									)}
								</div>
							)}
						</div>
					)}
				</>
			}
		/>
	);
}

/**
 * A one-line failure or stall notice for this thread. It does not cover the whole section: only
 * this thread failed.
 */
function ReplyNotice({
	tone,
	message,
	busy,
	onRetry,
}: {
	tone: "muted" | "destructive";
	message: string;
	busy: boolean;
	onRetry: () => void;
}) {
	const { t } = useTranslation("comments");
	return (
		<div className="flex flex-wrap items-center gap-2 py-2">
			<p
				/* A stall is not a failure, so it gets neither the destructive color nor the `alert` role. */
				role={tone === "destructive" ? "alert" : undefined}
				className={
					tone === "destructive"
						? "text-xs text-destructive"
						: "text-xs text-muted-foreground"
				}
			>
				{message}
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-7 px-2 text-xs"
				disabled={busy}
				onClick={onRetry}
			>
				{busy ? t("loading") : t("retry")}
			</Button>
		</div>
	);
}

/**
 * A one-line placeholder. A card is about ten lines, so drawing all of them would make the whole
 * thread jump when the data arrives.
 */
function RepliesSkeleton() {
	return (
		<div aria-hidden="true" className="flex gap-3 py-3">
			<Skeleton className="size-9 shrink-0 rounded-full" />
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-4 w-3/4" />
			</div>
		</div>
	);
}
