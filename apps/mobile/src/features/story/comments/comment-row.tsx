import { space } from "@rowcat/design";
import {
	commentLikeLabel,
	DELETED_COMMENT_PLACEHOLDER,
	type StoryComment,
	type VisibleStoryComment,
} from "@rowcat/domain";
import { reactToCommentMutationOptions } from "@rowcat/query";
import {
	AlertDialog,
	Avatar,
	DropdownMenu,
	Icon,
	MenuItem,
	Text,
	targetSlop,
} from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useReportAction } from "../../moderation/report-menu.tsx";
import { commentRowAction } from "../../moderation/report-visibility.ts";
import { CREATOR_ROUTE } from "../../profile/creator-route.ts";
import { commentErrorMessage } from "./comment-error.ts";

/**
 * One comment row.
 *
 * The body is drawn **as plain text.** No markdown renderer and no HTML: this repository has no
 * trusted markdown pipeline yet, and setting one up for a comment would make the least trustworthy
 * input the first consumer of that pipeline. React Native's `<Text>` draws the string as-is, so
 * nothing needs blocking here.
 *
 * Not shown: email, the internal member id, and moderation state. The first two are not in the
 * contract at all (`StoryCommentDto`), and the last is an operator axis, not a value for public
 * screens.
 *
 * ## The actions collapse into **one overflow**
 *
 * This row once had a delete icon directly on it and no report. When reporting came in, the obvious
 * answer was another flag beside it. But then two 44pt targets would sit at the row's right end,
 * and one of them would **never be drawn** (delete on your own row, report on someone else's). A
 * reader scanning the list would see the meaning of the right end change from row to row. Web's
 * same row uses one menu for the same reason.
 *
 * ```text
 * my comment                ⋯ → delete
 * someone else's + member   ⋯ → report
 * guest                     no trigger
 * ```
 *
 * **Exclusive.** Neither a report item on your own comment nor a delete item on someone else's is
 * drawn. The latter would be a 404 when pressed (ownership is in the server predicate), so a screen
 * that appears to let you delete someone else's comment is itself a defect. The former the server
 * does not block, but it means nothing. That table is owned by `commentRowAction` alone; rewriting
 * `own ? … : …` inside the row would silently drop the third slot (guest).
 *
 * Ownership is still judged by the caller with `isOwnComment` (comparing member ids). Nicknames are
 * not unique and can change, so judging ownership by them would show someone else's comment as
 * deletable to a person with the same name.
 *
 * ## The author's name goes to the profile
 *
 * The target is **the same address** as the work's byline, with the same identity (the member id).
 * Nicknames are not used because they are neither unique nor stable: renaming must not break links
 * others saved, and there is no way to tell which of two people with the same name owns that
 * address.
 *
 * **The author cannot be null.** Deleting an account deletes that person's comments too, so an
 * ownerless-comment state does not exist (the opposite of works). So there is no "unlinked branch"
 * like `StoryByline`'s.
 *
 * **The whole row does not go to the profile.** The body is content, not a button to the profile,
 * and making the whole row pressable would turn the spot where a finger stopped while scrolling
 * through a long comment into a profile link. The face is not a second target either: two routes to
 * the same place in one row would make screen readers read two buttons with the same name. Web's
 * same row also makes only the name a link and hides the face with `aria-hidden`.
 *
 * ## The same hierarchy as web comments
 *
 * ```text
 * avatar | name (semibold) · time (caption, muted) ········ ⋯
 *        | body (body)
 * ```
 *
 * What differs is how the actions surface. Web reveals them on hover; here they are **always
 * visible**, because fingers have no hover. The target is 44pt, which the trigger primitive makes
 * with `hitSlop` (a box grown to 44 would make this header line taller by that much, and the
 * vertical rhythm of name and time would shift per author; it did, for a while).
 */
export function CommentRow({
	storyId,
	comment,
	own,
	viewerId,
	deleting,
	onDelete,
	footer,
}: {
	storyId: string;
	comment: StoryComment;
	/** Judged by the caller against the viewer's member id — not a nickname comparison. */
	own: boolean;
	/** The signed-in member's id. Null for guests and unconfirmed sessions, so the report item is not drawn. */
	viewerId: string | null;
	/** Whether this row's delete is running. **Other rows are not locked.** */
	deleting: boolean;
	onDelete: () => void;
	/**
	 * Whatever goes below the row. All reply actions come through this slot.
	 *
	 * The row does not know about replies: the thread's state lives in the parent, and this component
	 * only offers one place to draw its result. Otherwise the reply row could also draw its own reply
	 * list, and recursion would become expressible.
	 */
	footer?: ReactNode;
}) {
	const router = useRouter();
	const at = formatDateTime(comment.createdAt);
	const deleted = comment.state === "deleted";
	const name =
		comment.state === "visible"
			? comment.author.nickname || "No name"
			: DELETED_COMMENT_PLACEHOLDER;
	/**
	 * The confirmation dialog. It was once the platform's `Alert`, and there was a reason: Android
	 * back, screen readers and the system text size were already handled by the platform. That reason
	 * still holds in this primitive (`AlertDialog`). What remains different is the appearance: web's
	 * same confirmation draws in RowCat's surface, radius and destructive color, so the two apps read
	 * as one product.
	 */
	const [confirming, setConfirming] = useState(false);
	/**
	 * Always called (a conditional call breaks the rules of hooks). On one's own row nothing is drawn
	 * — no item and no dialog — and the cost is one closed dialog.
	 *
	 * The target carries **the work's id too.** The server checks the `(storyId, commentId)` pair, so
	 * a comment on another work cannot be pointed at as if it belonged to this one. That pair is how
	 * ownership is expressed. The body and the author's nickname are not sent (the server takes the
	 * snapshot from its own row).
	 */
	const report = useReportAction({
		target: {
			type: "comment",
			storyId: comment.storyId,
			commentId: comment.id,
		},
		/** Replies are **the same target kind** — no new report vocabulary was added (the root AGENTS rule). */
		targetLabel: comment.parentId ? "Reply" : "Comment",
	});

	/**
	 * A tombstone has no actions at all — nothing is left to delete or report. `commentRowAction`
	 * gives a member `report` whenever `own` is false, so the tombstone is folded out here first.
	 */
	const action = deleted ? null : commentRowAction({ own, viewerId });

	return (
		<View style={row.root}>
			{/**
			 * The avatar rule (a photo, falling back to initials when it fails, and which address failed) is owned by
			 * `@rowcat/ui-native`. Re-implementing it here would keep two copies of the same failure handling as the
			 * cover, and the row-reuse trap of virtualized lists would appear in two places.
			 */}
			{comment.state === "visible" ? (
				<Avatar name={comment.author.nickname} uri={comment.author.avatarUrl} />
			) : (
				/**
				 * **A tombstone has no face.** The space is not left empty — that would shift only this row
				 * left and break the thread's alignment. A neutral empty circle stands in.
				 */
				<View style={row.faceless} />
			)}
			<View style={row.body}>
				<View style={row.head}>
					{/**
					 * Only **the name** is the press target (see the header). The target is made by `hitSlop`; growing the
					 * box would make this header line taller and shake the vertical rhythm of name and time.
					 */}
					{comment.state === "visible" ? (
						<Pressable
							accessibilityRole="button"
							/** The label says where it goes — from a list, the name alone does not say it is an action. */
							accessibilityLabel={`Open ${name}'s profile`}
							hitSlop={space.sm}
							onPress={() =>
								/**
								 * **Goes by member id.** Nicknames are not unique, so they cannot be the address.
								 */
								router.push({
									pathname: CREATOR_ROUTE,
									params: { creatorId: comment.author.id },
								})
							}
							style={row.name}
						>
							<Text variant="label" weight="semibold" numberOfLines={1}>
								{name}
							</Text>
						</Pressable>
					) : (
						/**
						 * A tombstone has no name — **it does not say who deleted it.** Whether the author deleted
						 * it, an operator took it down, or it went with an account deletion is not for other people
						 * to see, and it is not in the row anyway. There is nothing to press, so it is not a link
						 * either.
						 */
						<View style={row.name}>
							<Text
								variant="label"
								weight="semibold"
								tone="muted-foreground"
								numberOfLines={1}
							>
								{name}
							</Text>
						</View>
					)}
					{at && (
						<Text variant="caption" tone="muted-foreground">
							{at}
						</Text>
					)}
					{action && (
						<View style={row.menu}>
							{/**
							 * **The label says whose row this menu is.** `Menu` alone would give the same name to as many
							 * triggers as there are rows, for a user who cannot see the screen. The name differs between my
							 * row and others' because the items inside differ. Web's same row made the same call.
							 */}
							<DropdownMenu
								label={
									action === "delete"
										? `Manage my comment (${at ?? "this one"})`
										: `Report menu for ${name}'s comment`
								}
								align="end"
								size="sm"
								tone="muted-foreground"
							>
								{action === "delete" ? (
									<MenuItem
										icon="delete"
										label="Delete"
										destructive
										/**
										 * Do not press a deleting item twice. The primitive does the locking; an `if` inside the
										 * callback alone leaves the row looking ordinary, and assistive tech reads it as
										 * ordinary.
										 */
										disabled={deleting}
										onSelect={() => setConfirming(true)}
									/>
								) : (
									report.item
								)}
							</DropdownMenu>
						</View>
					)}
				</View>
				{/** Web's comment body also uses `leading-7`: it is reading text, so the line gap is wide. */}
				{comment.state === "visible" ? (
					<Text variant="body" leading="reading">
						{comment.body}
					</Text>
				) : (
					/**
					 * The original slot is not left empty — an empty line reads as "no text came". A faded
					 * original cannot be drawn either: **the server has cleared that value**, so there is nothing
					 * to draw, and the contract has no slot for it.
					 */
					<Text variant="body" leading="reading" tone="muted-foreground">
						{DELETED_COMMENT_PLACEHOLDER}
					</Text>
				)}

				{/**
				 * Action row — the heart on the left, and reply actions from the parent. A tombstone gets no heart (no
				 * reaction attaches to a deleted utterance).
				 */}
				{(comment.state === "visible" || footer) && (
					<View style={row.actions}>
						{comment.state === "visible" && (
							<CommentLike
								storyId={storyId}
								comment={comment}
								canReact={viewerId !== null}
							/>
						)}
						{footer}
					</View>
				)}
			</View>

			{/**
			 * Mounted once per row, but cheap — when closed, the primitive draws nothing (`Content` returns `null` when
			 * `open` is false). While open, accessibility focus stays inside this dialog, and closing returns it to this
			 * row.
			 */}
			<AlertDialog
				open={confirming}
				title="Delete this comment?"
				description="A deleted comment can't be restored."
				confirmLabel="Delete"
				destructive
				busy={deleting}
				onConfirm={() => {
					setConfirming(false);
					onDelete();
				}}
				onCancel={() => setConfirming(false)}
			/>

			{/**
			 * The report dialog is **outside** the menu. When an item is pressed the primitive closes the menu
			 * (`closeOnPress`), so if the dialog lived inside it, it would open and vanish together.
			 */}
			{action === "report" ? report.dialog : null}
		</View>
	);
}

/**
 * One heart — **not optimistic.**
 *
 * The pressed state and the count come from the row the server confirmed, and the cache policy
 * swaps it in (`@rowcat/query`, the **same function** as web). If the screen did ±1, five rapid
 * taps would show 5, while the server's truth is always 0 or 1.
 *
 * Guests see **only the count**. Drawing a button that returns 401 when pressed would make the
 * person lose, after a visit to the login screen, which row they meant to press. This is the same
 * call as not drawing the report item for guests.
 *
 * `Button` is not used because this control **draws a count alongside**. That primitive's `label`
 * is one string, and there is no place to pass the icon's fill state (`filled`).
 */
function CommentLike({
	storyId,
	comment,
	canReact,
}: {
	storyId: string;
	comment: VisibleStoryComment;
	canReact: boolean;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation(
		reactToCommentMutationOptions(getRowCatClient(), queryClient, storyId, {
			id: comment.id,
			parentId: comment.parentId,
		}),
	);

	if (!canReact)
		return (
			<View
				style={row.like}
				accessible
				accessibilityLabel={`${comment.likeCount} likes`}
			>
				<Icon name="favorite" size="sm" tone="muted-foreground" />
				{/* Zero is drawn too — this value is a confirmed fact, not "unknown". */}
				<Text variant="caption" tone="muted-foreground">
					{String(comment.likeCount)}
				</Text>
			</View>
		);

	return (
		<View style={row.likeGroup}>
			<Pressable
				accessibilityRole="button"
				/** The current state goes into the name — assistive tech reads the state, not the result. */
				accessibilityLabel={commentLikeLabel(comment) ?? undefined}
				accessibilityState={{
					selected: comment.viewerLiked,
					busy: mutation.isPending,
					disabled: mutation.isPending,
				}}
				disabled={mutation.isPending}
				hitSlop={targetSlop(controlHeightSm)}
				onPress={() => mutation.mutate(!comment.viewerLiked)}
				style={row.like}
			>
				<Icon
					name="favorite"
					size="sm"
					tone={comment.viewerLiked ? "primary" : "muted-foreground"}
					filled={comment.viewerLiked}
				/>
				<Text
					variant="caption"
					tone={comment.viewerLiked ? "primary" : "muted-foreground"}
				>
					{String(comment.likeCount)}
				</Text>
			</Pressable>
			{mutation.isError && (
				<Text
					accessibilityRole="alert"
					variant="caption"
					tone="destructive"
					numberOfLines={2}
				>
					{commentErrorMessage(mutation.error)}
				</Text>
			)}
		</View>
	);
}

/** The visible box of the heart. The 44pt target is made on top of it by `hitSlop`. */
const controlHeightSm = 32;

const row = StyleSheet.create({
	/** 10 is off the spacing scale — the distance between avatar and body is geometry tied to the avatar's diameter. */
	root: { flexDirection: "row", gap: 10, paddingVertical: space.md },
	body: { flex: 1, gap: space.xs },
	head: { alignItems: "center", flexDirection: "row", gap: space.sm },
	/** Long names do not push the time and the actions away — the name is what shrinks. */
	name: { flexShrink: 1 },
	/**
	 * Overflow sits at the right end. The 44pt target is made by the trigger with `hitSlop` (the
	 * visible size is the 32pt of `size="sm"`), so the height of this header line does not depend on
	 * whether there is an action. The delete icon once pushed the line to 44pt through its box, and
	 * the symptom was that **only my own row grew 26pt taller**, silently.
	 */
	menu: { marginLeft: "auto" },
	/** Action row. On a narrow screen the reply button wraps to the next line instead of pushing the heart. */
	actions: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
	like: { alignItems: "center", flexDirection: "row", gap: space.xs },
	likeGroup: { alignItems: "center", flexDirection: "row", gap: space.sm },
	/**
	 * A placeholder for the tombstone — **must equal** the default diameter of `Avatar` (32) for the
	 * alignment to hold. It is a hard-coded number, which is unfortunate, because that primitive does
	 * not export its size as a constant.
	 */
	faceless: { borderRadius: 16, height: 32, opacity: 0.4, width: 32 },
});
