import {
	isStoryDirectlyViewable,
	STORY_COMMENTS_ANCHOR,
	type Story,
	type StoryComment,
	type Viewer,
} from "@rowcat/domain";
import {
	deleteCommentMutationOptions,
	storyComments,
	storyCommentsInfiniteQueryOptions,
	storyCommentsQueryKey,
} from "@rowcat/query";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { StaleNotice } from "#/lib/query/stale-notice.tsx";
import { CommentComposer } from "./comment-composer.tsx";
import { commentsLoadFailure } from "./comment-error.ts";
import { commentPanelView } from "./comment-panel-state.ts";
import { CommentThread } from "./comment-thread.tsx";
import { DeleteCommentDialog } from "./delete-comment-dialog.tsx";
import { useHashArrival } from "./hash-arrival.ts";

/**
 * The band says `state` rather than `comments`, because it also appears on empty lists.
 * 'Previously loaded comments' would contradict a screen where the server answered zero.
 */
const commentsStaleMessage = (): string =>
	translator("comments")("section.stale");

/**
 * The comment query is not `useSuspenseQuery`, and the route loader does not prefetch it, so this
 * section never holds up the work page.
 * - The work info and the `Start conversation` button are the main content, and discussion sits below them.
 *   One comment round trip must not delay the main content.
 * - Server rendering sends only a placeholder and the list fills in the browser. Relative times
 *   therefore cannot cause a hydration mismatch, since the server has no lines to render.
 *
 * Private works get nothing drawn. The server makes the same decision
 * (`story_comments_unavailable`). Hiding it here is for guidance, not authorization: showing an
 * empty comment box and a failure message to the creator of a private work is less accurate than
 * showing nothing.
 */
export function CommentSection({
	story,
	viewer,
}: {
	story: Story;
	viewer: Viewer | null;
}) {
	const { t } = useTranslation("comments");
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	// Current in-app path, used as the return target for the login screen.
	const here = useRouterState({ select: (state) => state.location.href });
	/**
	 * Keeps focus on this section when the inbox arrives via `#comments`, even if content above grows
	 * later. The hook sits above the early `return` to keep hook order stable.
	 */
	const arrivalRef = useHashArrival<HTMLElement>(STORY_COMMENTS_ANCHOR);

	/**
	 * This uses the same predicate as the server (`requireCommentableStory` in
	 * `routes/stories/access.ts`). Link-shared works (`Link only`) accept comments, so the question is not
	 * 'is it visible' but 'can anyone with the address open it'. Only private differs: a private work
	 * has one viewer, the owner, so comments there would be public replies that nobody else can see.
	 * The screen does not re-check the private visibility value itself, because the decision belongs
	 * to the shared predicate.
	 */
	const commentable = isStoryDirectlyViewable(story.visibility);

	/**
	 * No query is issued for private works. The hook runs before the early return, so without
	 * `enabled` a creator opening their own private work would send a request that always ends in 404.
	 * The server makes the same decision, so this saves a wasted request and is not an authorization
	 * check.
	 */
	const query = useInfiniteQuery({
		...storyCommentsInfiniteQueryOptions(client, story.id),
		enabled: commentable,
	});
	/**
	 * Retry (`Try again`). On a paused query, `query.refetch()` does nothing, so the rule lives in
	 * `lib/query/panel-retry.ts`, shared with the workspace and notifications panels.
	 */
	const retry = usePanelRetry(storyCommentsQueryKey(story.id), query);

	const removal = useMutation(
		deleteCommentMutationOptions(client, queryClient, story.id),
	);

	/**
	 * The comment the delete dialog points at. There is one dialog per section, not per row. The whole
	 * row is stored, not just id and body, because the mutation requires `parentId`. That decides
	 * which cache slot receives the result (top-level list or that thread), and the screen does not
	 * re-derive it. Tombstones never arrive here, since their row has no delete item.
	 */
	const [pendingDelete, setPendingDelete] = useState<StoryComment | null>(null);
	/**
	 * A comment created before the list has reached its last page is not attached to the cache.
	 * Attaching it would show it twice once 'load more' runs, per `@rowcat/query`. Nothing would
	 * visibly change, so the fact of saving is announced separately.
	 */
	const [createdId, setCreatedId] = useState<string | null>(null);

	if (!commentable) return null;

	const comments = query.data ? storyComments(query.data) : [];
	const createdOutOfView =
		createdId !== null && !comments.some((comment) => comment.id === createdId);

	/**
	 * The panel state is chosen by a pure function (`comment-panel-state.ts`). The earlier code
	 * checked `isPending`, then `isError`, then empty, which was wrong in two ways. A paused query
	 * read as loading and never ended. And a failed background refresh or 'load more' covered the
	 * whole list even while lines were held.
	 */
	const panel = commentPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		commentCount: comments.length,
	});

	/**
	 * The 'load more' failure is announced next to that boundary. Folding it into the stale band above
	 * would leave the user who pressed the button at the end of the list without the notice on screen,
	 * and they would read the result as nothing having happened.
	 */
	const nextPageFailed = query.isFetchNextPageError;
	const staleVisible = panel.retryable && !nextPageFailed;

	return (
		/*
		 * Reading width is capped. On a wide screen a body line over 1000px holds more than 70 Korean
		 * characters, and the eye loses the start of the next line. The work description uses `max-w-2xl`
		 * for the same reason. The whole section is capped so the input, list and 'load more' share one
		 * left edge and read as one column.
		 */
		<section
			/*
			 * The section id is the inbox anchor (`/stories/:id#comments`). Its name is a domain constant.
			 * Changing only one side would keep the link working while silently breaking the scroll.
			 */
			id={STORY_COMMENTS_ANCHOR}
			ref={arrivalRef}
			aria-labelledby="story-comments-heading"
			className="flex max-w-3xl scroll-mt-20 flex-col gap-4"
		>
			<h2
				id="story-comments-heading"
				className="text-lg font-bold tracking-tight"
			>
				{t("section.title")}
			</h2>

			{/*
			 * The composer sits above the list. The list grows downward oldest-first, so putting the input at
			 * the end
			 * would make writers scroll further as comments accumulate.
			 */}
			{viewer ? (
				<CommentComposer
					storyId={story.id}
					onCreated={(comment) => setCreatedId(comment.id)}
				/>
			) : (
				/*
				 * Guests are not blocked after the input is drawn. Showing a login requirement only after they
				 * write is the worst order. The current path is sent along, so logging in returns them to this
				 * work.
				 */
				<p className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
					{t("section.signInRequired")}
					<Link
						to="/login"
						search={{ redirect: here }}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{t("section.signIn")}
					</Link>
				</p>
			)}

			{createdOutOfView && (
				<output className="text-sm text-muted-foreground">
					{t("section.posted")}
				</output>
			)}

			{panel.state === "loading" ? (
				<CommentListSkeleton />
			) : panel.state === "offline" ? (
				/*
				 * A pause is not a failure. The browser already knows the connection is gone and resumes on its
				 * own, so there is no destructive colour and no alert role.
				 */
				<div className="flex flex-wrap items-center gap-3 rounded-md border p-4">
					<p className="text-sm text-muted-foreground">
						{t("section.offline")}
					</p>
					<Button
						variant="outline"
						size="sm"
						disabled={query.isFetching}
						onClick={retry}
					>
						{query.isFetching ? t("loading") : t("retry")}
					</Button>
				</div>
			) : panel.state === "error" ? (
				<div className="flex flex-wrap items-center gap-3 rounded-md border p-4">
					<p role="alert" className="text-sm text-destructive">
						{commentsLoadFailure()}
					</p>
					<Button
						variant="outline"
						size="sm"
						disabled={query.isFetching}
						onClick={retry}
					>
						{query.isFetching ? t("loading") : t("retry")}
					</Button>
				</div>
			) : panel.state === "empty" ? (
				<>
					{/*
					 * An empty list is also a held value. If the refresh after the server answered 0 failed or was
					 * aborted,
					 * that zero is still confirmed but may not be current. It is the same fact as a failure with lines,
					 * so
					 * the same band is used, matching the notification surface.
					 */}
					{staleVisible && (
						<StaleNotice
							message={commentsStaleMessage()}
							isRetrying={query.isFetching}
							onRetry={retry}
						/>
					)}
					{/* No placeholder card for an empty list. One line is enough. */}
					<p className="py-6 text-sm text-muted-foreground">
						{t("section.empty")}
					</p>
				</>
			) : (
				<>
					{staleVisible && (
						<StaleNotice
							message={commentsStaleMessage()}
							isRetrying={query.isFetching}
							onRetry={retry}
						/>
					)}
					{/*
					 * `mode` is not set to popLayout. It was on for a while, and the `relative` on the `<ul>` existed
					 * only for
					 * it, but the two never ran together in this list. popLayout clones the exiting child with a ref to
					 * measure
					 * its DOM. `CommentRow` is a function component that does not accept a ref, so the ref stays null
					 * and the
					 * exit runs without measurement. React 19 treats `ref` as a normal prop, so there is no warning.
					 * The chat
					 * and draft lists made the same call; the procedure is in `docs/motion/ARCHITECTURE.md` under
					 * `touching the list`. Removal and filling the gap therefore happen in order. That rhythm is accepted here
					 * even
					 * though focus is not at risk, because that alone does not justify wiring the ref.
					 */}
					<ul className="divide-y">
						<AnimatePresence initial={false}>
							{comments.map((comment) => (
								/*
								 * The thread owns its reply state (expanded, form open, next page). If the list held that
								 * state it would be a map of twenty entries keyed by comment id, and the list would have to
								 * clear the matching entry whenever a line disappears.
								 */
								<CommentThread
									key={comment.id}
									storyId={story.id}
									comment={comment}
									viewer={viewer}
									onDelete={setPendingDelete}
								/>
							))}
						</AnimatePresence>
					</ul>
				</>
			)}

			{query.hasNextPage && (
				<div className="flex flex-col items-center gap-2">
					{/*
					 * A 'load more' failure does not replace the list. Already-held lines stay, and only the next page
					 * failed.
					 * The message sits next to the button just pressed, so the cause is visible.
					 */}
					{nextPageFailed && (
						<p role="alert" className="text-sm text-destructive">
							{t("section.loadMoreFailed")}
						</p>
					)}
					{/*
					 * A single button, with no scroll sentinel. Comments sit at the very end of the page, unlike the
					 * gallery.
					 * Auto-loading would make the list grow every time the scroll reached the bottom, and the page
					 * would never
					 * end.
					 */}
					<Button
						variant="outline"
						size="sm"
						disabled={query.isFetchingNextPage}
						onClick={() => void query.fetchNextPage()}
					>
						{query.isFetchingNextPage
							? t("loading")
							: nextPageFailed
								? t("retry")
								: t("section.more")}
					</Button>
				</div>
			)}

			{pendingDelete && (
				<DeleteCommentDialog
					body={pendingDelete.state === "visible" ? pendingDelete.body : ""}
					/**
					 * A top-level comment with replies stays as a row (tombstone). Say so before the press.
					 * Otherwise the person who deletes it sees the row still there and thinks the deletion failed.
					 * The judgment uses `replyCount`, but the server decides the outcome (the response is a
					 * tombstone or null). This value is advice, not a prediction.
					 */
					tombstoneNotice={
						pendingDelete.parentId === null && pendingDelete.replyCount > 0
					}
					onClose={() => setPendingDelete(null)}
					onDelete={async () => {
						await removal.mutateAsync({
							id: pendingDelete.id,
							parentId: pendingDelete.parentId,
						});
					}}
				/>
			)}
		</section>
	);
}

/**
 * Three placeholder lines. Drawing a full page (20 rows) would make the screen jump when content
 * arrives.
 */
function CommentListSkeleton() {
	return (
		<ul aria-hidden="true" className="divide-y">
			{[0, 1, 2].map((index) => (
				<li key={index} className="flex gap-3 py-4">
					<Skeleton className="size-9 shrink-0 rounded-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-2/3" />
					</div>
				</li>
			))}
		</ul>
	);
}
