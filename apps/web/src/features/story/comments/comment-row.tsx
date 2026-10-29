import {
	commentLikeLabel,
	type StoryComment,
	type VisibleStoryComment,
} from "@rowcat/domain";
import { reactToCommentMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Flag, Heart, MoreHorizontal, Trash2 } from "lucide-react";
import * as m from "motion/react-m";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReportDialog } from "#/features/moderation/report-dialog.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime } from "#/lib/format/date-time.ts";
import { relativeTime } from "#/lib/format/relative-time.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowExit } from "#/lib/motion/list-motion.ts";
import { layoutTransition } from "#/lib/motion/transitions.ts";
import { commentErrorMessage } from "./comment-error.ts";

/**
 * One component for top-level comments and replies.
 * - The body is plain text: no `dangerouslySetInnerHTML` and no markdown renderer. The repo has
 *   no trusted markdown pipeline yet, and adding one for comments would make the least trusted
 *   input its first consumer. Line breaks come from `whitespace-pre-wrap`; `break-words` stops a
 *   long URL from scrolling the page sideways.
 * - Not shown: email, internal member id, moderation state. The first two are absent from the
 *   contract (`StoryCommentDto`), and moderation is an operator concern, not a public value.
 * - Replies reuse this row. They have an author, a body, and report, delete and like actions. A
 *   separate row would duplicate those rules, and the one that goes missing would usually be
 *   report. Indentation comes from the parent, since a row that knows its own depth would
 *   eventually disagree.
 * - A tombstone is a deleted comment kept only as structure because replies remain. Its type has
 *   no author or body, so they cannot be drawn by mistake. A neutral sentence is shown instead
 *   (`comments.deleted`). Avatar, profile link, like, report,
 *   delete and reply are all omitted, since no action attaches to deleted speech.
 * - Rows only exit and reflow; they never animate in. A removal follows the user's own delete.
 *   'Load more' adds up to twenty rows at once, and animating them in would make the list look
 *   newly built.
 */
export function CommentRow({
	storyId,
	comment,
	own,
	canReport,
	canReact,
	onDelete,
	footer,
}: {
	storyId: string;
	comment: StoryComment;
	/**
	 * The caller computes `own` by comparing member ids with the viewer, not by comparing nicknames.
	 */
	own: boolean;
	/**
	 * Whether the report item can be shown: a signed-in member, on someone else's comment. The row
	 * does not receive the full viewer, since one row has no reason to know all of it. `own` already
	 * comes in with the same shape.
	 */
	canReport: boolean;
	/**
	 * Guests still see the count, since it is public. Only clickability differs: a guest gets text,
	 * not a button. A button that always returns 401 would make the guest lose their place after the
	 * login round trip.
	 */
	canReact: boolean;
	onDelete: () => void;
	/**
	 * The footer slot carries every reply-related action. The row deliberately does not know about
	 * replies. Thread state (expanded, form open, next page) lives in the parent, which gives the row
	 * one slot to fill. If the row rendered replies itself, recursion would become expressible.
	 */
	footer?: ReactNode;
}) {
	const { t } = useTranslation("comments");
	const [reporting, setReporting] = useState(false);
	const iso = comment.createdAt;
	const deleted = comment.state === "deleted";

	return (
		<m.li
			layout="position"
			exit={rowExit}
			transition={{ layout: layoutTransition }}
			/*
			 * Exiting rows are not guarded against presses. Putting the guard on the `exit` target would
			 * never apply in tabs where frames do not arrive, and those are the cases where a deleted row
			 * lingers longest (`lib/motion/exit-guard.ts`).
			 */
			style={useExitGuard()}
			className="flex gap-3 py-4"
		>
			<CommentAvatar comment={comment} />

			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2">
					{comment.state === "visible" ? (
						/*
						 * The author name links to the public profile. It is the same address as the work byline and
						 * the same identity (member id). Commenters who never published a work also need a profile,
						 * so the destination is the member's public projection, not a creator profile. That is why
						 * the model is named `PublicProfile`.
						 */
						<Link
							to="/creators/$creatorId"
							params={{ creatorId: comment.author.id }}
							className="truncate rounded-sm text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{comment.author.nickname || t("unnamed")}
						</Link>
					) : (
						/*
						 * A tombstone has no name, and it does not say who deleted the comment (author, operator, or
						 * account removal). That is not for other people to see, and the row no longer holds it
						 * anyway.
						 */
						<span className="truncate text-sm font-medium text-muted-foreground">
							{t("deleted")}
						</span>
					)}
					{/*
					 * Relative time is shown, and the machine-readable value sits in `dateTime`. An absolute time goes
					 * in
					 * `title`, since 'three days ago' alone does not say when. Tombstones keep the time, because it
					 * explains
					 * the thread order.
					 */}
					<time
						dateTime={iso}
						title={formatDateTime(iso)}
						className="shrink-0 text-xs text-muted-foreground"
					>
						{relativeTime(iso)}
					</time>

					{!deleted && (own || canReport) && (
						<div className="ml-auto shrink-0">
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant="ghost"
											size="icon-sm"
											/**
											 * The menu trigger's label names the comment it belongs to. A plain 'menu' label would
											 * give the same name to every trigger in the list, which is useless to someone not
											 * looking at the screen.
											 */
											aria-label={
												own
													? t("manageOwn", { when: relativeTime(iso) })
													: t("reportMenu", {
															name:
																comment.state === "visible"
																	? comment.author.nickname || t("unnamed")
																	: "",
														})
											}
											className="size-9 sm:size-8"
										/>
									}
								>
									<MoreHorizontal aria-hidden="true" />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{/*
									 * Own and others' menu items are mutually exclusive. The owner gets no report item and others get
									 * no
									 * delete item. Deleting someone else's comment would return 404, since ownership is part of the
									 * server
									 * predicate. Reporting your own comment is not blocked by the server but means nothing. Edit and
									 * pin
									 * are absent.
									 */}
									{own ? (
										<DropdownMenuItem variant="destructive" onClick={onDelete}>
											<Trash2 aria-hidden="true" />
											{t("delete")}
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem onClick={() => setReporting(true)}>
											<Flag aria-hidden="true" />
											{t("report")}
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					)}
				</div>

				{comment.state === "visible" ? (
					<p className="text-[0.9375rem] leading-7 break-words whitespace-pre-wrap">
						{comment.body}
					</p>
				) : (
					/*
					 * The original-text slot is not left empty, since an empty line reads as 'no text came in'. It
					 * cannot be greyed out either: the server cleared the value, and the contract has no field for
					 * it.
					 */
					<p className="text-[0.9375rem] leading-7 text-muted-foreground italic">
						{t("deleted")}
					</p>
				)}

				{/*
				 * The action row: heart on the left, reply actions supplied by the parent. Tombstones have no
				 * action
				 * row at all, since no actions attach to deleted speech.
				 */}
				{!deleted && (
					<div className="mt-0.5 flex flex-wrap items-center gap-1">
						<CommentLikeButton
							storyId={storyId}
							comment={comment}
							canReact={canReact}
						/>
						{footer}
					</div>
				)}
				{deleted && footer}

				{reporting && (
					<ReportDialog
						/**
						 * The story id is sent alongside the comment id. The server checks the pair `(storyId,
						 * commentId)`, so a comment from another work cannot be presented as belonging to this one.
						 * That pair is the ownership relation. Replies are the same target kind; not widening the
						 * report target vocabulary was a deliberate decision of this slice.
						 */
						target={{
							type: "comment",
							storyId: comment.storyId,
							commentId: comment.id,
						}}
						targetLabel={
							comment.parentId ? t("reportReply") : t("reportComment")
						}
						onClose={() => setReporting(false)}
					/>
				)}
			</div>
		</m.li>
	);
}

/**
 * A heart, not optimistic. The pressed state and the count come from the server-confirmed row, and
 * the cache policy (`@rowcat/query`) replaces them. If the screen applied plus or minus one, five
 * quick presses would show 5 while the server's truth is always 0 or 1. The button is locked while
 * in flight so the round trip is visible.
 *
 * Guests see the count only. A button that returns 401 would make a guest lose which comment they
 * tried to like after the login detour, the same reasoning as hiding report items from guests.
 *
 * Failures are reported next to the row. A toast would not show which heart failed in a 20-row
 * list.
 */
function CommentLikeButton({
	storyId,
	comment,
	canReact,
}: {
	storyId: string;
	comment: VisibleStoryComment;
	canReact: boolean;
}) {
	const { t } = useTranslation("comments");
	const queryClient = useQueryClient();
	const mutation = useMutation(
		reactToCommentMutationOptions(getRowCatClient(), queryClient, storyId, {
			id: comment.id,
			parentId: comment.parentId,
		}),
	);
	const label =
		commentLikeLabel(comment) === null
			? null
			: comment.state === "visible" && comment.viewerLiked
				? t("unlike", { count: comment.likeCount })
				: t("like", { count: comment.likeCount });

	if (!canReact)
		return (
			<span className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
				<Heart aria-hidden="true" className="size-3.5" />
				{/*
				 * Shows 0 as well. The value is a confirmed fact, not 'unknown'. A bare number would read as a bare
				 * `3`
				 * to a screen reader user with no context. An `aria-label` on a span is not an option, since a span
				 * has
				 * no role and browsers handle that attribute inconsistently. A visually hidden sentence is the
				 * narrowest
				 * answer.
				 */}
				<span aria-hidden="true">{comment.likeCount}</span>
				<span className="sr-only">
					{t("likes", { count: comment.likeCount })}
				</span>
			</span>
		);

	return (
		<span className="inline-flex items-center gap-1">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={mutation.isPending}
				/**
				 * The current state goes into the accessible name. Assistive tech reads the state, not the
				 * result of the action, and `aria-pressed` carries the same state.
				 */
				aria-label={label ?? undefined}
				aria-pressed={comment.viewerLiked}
				className="h-8 gap-1 px-2 text-xs text-muted-foreground"
				onClick={() => mutation.mutate(!comment.viewerLiked)}
			>
				<Heart
					aria-hidden="true"
					className={
						comment.viewerLiked
							? "size-3.5 fill-current text-primary"
							: "size-3.5"
					}
				/>
				{comment.likeCount}
			</Button>
			{mutation.isError && (
				<span role="alert" className="text-xs text-destructive">
					{commentErrorMessage(mutation.error)}
				</span>
			)}
		</span>
	);
}

/**
 * Without an avatar, the first letter of the nickname is drawn. That keeps the line's geometry
 * steadier than a broken image or empty space. It is decorative and hidden from screen readers,
 * since the name is right next to it.
 *
 * Tombstones have no face, but the space is kept so the line does not shift left and break the
 * thread alignment. A neutral circle with no letter is drawn instead.
 */
export function CommentAvatar({ comment }: { comment: StoryComment }) {
	if (comment.state === "deleted")
		return (
			<div
				aria-hidden="true"
				className="size-9 shrink-0 rounded-full border border-dashed bg-muted/40"
			/>
		);

	const { avatarUrl, nickname } = comment.author;
	if (avatarUrl)
		return (
			<img
				src={avatarUrl}
				referrerPolicy="no-referrer"
				alt=""
				aria-hidden="true"
				decoding="async"
				loading="lazy"
				className="size-9 shrink-0 rounded-full border bg-muted object-cover"
			/>
		);

	return (
		<div
			aria-hidden="true"
			className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium text-muted-foreground"
		>
			{nickname.trim().slice(0, 1) || "?"}
		</div>
	);
}
