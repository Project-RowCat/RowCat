import { borderWidth, space } from "@rowcat/design";
import {
	canReplyToComment,
	commentRepliesLabel,
	isOwnComment,
	type StoryComment,
} from "@rowcat/domain";
import {
	storyCommentRepliesInfiniteQueryOptions,
	storyComments,
} from "@rowcat/query";
import {
	Button,
	Notice,
	Separator,
	Spinner,
	useTheme,
} from "@rowcat/ui-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import type { ViewerAction } from "../../../lib/viewer-action.ts";
import { CommentComposer } from "./comment-composer.tsx";
import { REPLIES_LOAD_FAILURE } from "./comment-error.ts";
import { CommentRow } from "./comment-row.tsx";
import { resolveCommentsState } from "./comments-state.ts";

/**
 * One top-level comment and **its thread**. Same rules and state axes as the web's `CommentThread`.
 *
 * ## Replies load on expand
 *
 * If each of the twenty rows in the list prefetched its replies, one screen would issue twenty-one
 * requests, and that cost is paid even on the common row with no replies. So the query is tied to
 * the expanded state (`enabled`), and while collapsed **no bytes go out at all.**
 *
 * ## One level, so no recursion
 *
 * This component does not render itself. A reply row ends at one `CommentRow` and gets no `footer`,
 * so no reply button appears. Once depth becomes the screen's call, the two apps' thread shapes
 * diverge (the server enforces the same rule with a predicate).
 *
 * ## A row that grows inside virtualization
 *
 * This component is one `FlatList` item, and expanding grows that item's height. `FlatList`
 * measures the change itself, so no height is passed by hand: a `getItemLayout` would freeze the
 * value and expanded threads would overlap.
 */
export function CommentThread({
	storyId,
	comment,
	viewerId,
	action,
	returnPath,
	deleting,
	onDelete,
}: {
	storyId: string;
	comment: StoryComment;
	/** The confirmed member's id. `null` for guests and unverified identities. */
	viewerId: string | null;
	/** `viewerAction(session)`; the reply composer uses the same four branches. */
	action: ViewerAction;
	returnPath: string;
	/** Id of the deletion in progress, matched against every row in this thread including replies. */
	deleting: string | null;
	onDelete: (target: StoryComment) => void;
}) {
	/**
	 * Whether expanded. This is screen state, kept neither in route params nor in storage: which
	 * thread is open is part of this visit's reading flow, not a place to return to.
	 */
	const [expanded, setExpanded] = useState(false);
	/** Whether the reply form is open. A separate axis from expansion: you can reply while collapsed. */
	const [replying, setReplying] = useState(false);

	const canReply = canReplyToComment(comment) && action === "allowed";
	const repliesLabel = commentRepliesLabel(comment.replyCount);

	const replies = useInfiniteQuery({
		...storyCommentRepliesInfiniteQueryOptions(
			getRowCatClient(),
			storyId,
			comment.id,
		),
		enabled: expanded,
	});
	/** The line color comes from tokens; `StyleSheet.create` cannot see the theme, so it is applied here. */
	const { colors } = useTheme();
	const rows = replies.data ? storyComments(replies.data) : [];
	const state = resolveCommentsState({
		status: replies.status,
		paused: replies.fetchStatus === "paused",
		commentCount: rows.length,
	});

	return (
		<CommentRow
			storyId={storyId}
			comment={comment}
			own={isOwnComment(comment, viewerId)}
			viewerId={viewerId}
			deleting={deleting === comment.id}
			onDelete={() => onDelete(comment)}
			footer={
				<>
					{canReply && !replying && (
						<Button
							label="Reply"
							variant="ghost"
							size="sm"
							onPress={() => setReplying(true)}
						/>
					)}
					{repliesLabel && (
						<Button
							label={expanded ? "Hide replies" : repliesLabel}
							variant="ghost"
							size="sm"
							onPress={() => setExpanded((open) => !open)}
						/>
					)}

					{/*
					 * The form and list sit **below** the action row. The only indent is the left
					 * rule; adding more (cards, backgrounds) would turn the detail screen into a forum.
					 */}
					{(replying || expanded) && (
						<View style={[thread.body, { borderLeftColor: colors.border }]}>
							{replying && (
								<CommentComposer
									storyId={storyId}
									parentId={comment.id}
									action={action}
									returnPath={returnPath}
									onCreated={() => {
										/**
										 * Writing a reply **expands the thread**. Leaving it collapsed hides the new reply, and
										 * the user reads the save as having failed.
										 */
										setExpanded(true);
										setReplying(false);
									}}
									onCancel={() => setReplying(false)}
								/>
							)}

							{expanded &&
								(state === "loading" ? (
									<Spinner />
								) : state === "offline" ? (
									<Notice
										message="You're not connected right now. Replies reload once you're connected."
										actionLabel="Try again"
										onAction={() => void replies.refetch()}
									/>
								) : state === "failed" ? (
									<Notice
										message={REPLIES_LOAD_FAILURE}
										actionLabel="Try again"
										onAction={() => void replies.refetch()}
									/>
								) : state === "empty" ? (
									/*
									 * An empty list can arrive although the count was nonzero: a thread holding only replies
									 * from a blocked author. Drawing nothing there would make an expanded thread look like a
									 * failed load.
									 */
									<Notice message="No replies to show." />
								) : (
									<View>
										{rows.map((reply, index) => (
											<View key={reply.id}>
												{index > 0 && <Separator />}
												<CommentRow
													storyId={storyId}
													comment={reply}
													own={isOwnComment(reply, viewerId)}
													viewerId={viewerId}
													deleting={deleting === reply.id}
													onDelete={() => onDelete(reply)}
												/>
											</View>
										))}
									</View>
								))}

							{expanded && replies.hasNextPage && (
								<Button
									label={
										replies.isFetchingNextPage ? "Loading" : "More replies"
									}
									variant="outline"
									size="sm"
									busy={replies.isFetchingNextPage}
									onPress={() => void replies.fetchNextPage()}
								/>
							)}
						</View>
					)}
				</>
			}
		/>
	);
}

const thread = StyleSheet.create({
	/**
	 * One indent level: a single left rule. Width is 100% because this box sits below the action row's
	 * `flexWrap`; taking only the remaining width would wedge replies beside the heart.
	 */
	body: {
		borderLeftWidth: borderWidth,
		gap: space.sm,
		marginTop: space.sm,
		paddingLeft: space.md,
		width: "100%",
	},
});
