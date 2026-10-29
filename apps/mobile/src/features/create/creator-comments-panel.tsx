import { space } from "@rowcat/design";
import type { CreatorCommentInboxItem } from "@rowcat/domain";
import {
	creatorCommentInboxItems,
	creatorCommentsInfiniteQueryOptions,
} from "@rowcat/query";
import {
	Avatar,
	Button,
	DropdownMenu,
	EmptyState,
	ErrorState,
	Notice,
	Spinner,
	screenPadding,
	Text,
} from "@rowcat/ui-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { useReportAction } from "../moderation/report-menu.tsx";
import { CREATOR_ROUTE } from "../profile/creator-route.ts";
import { CREATOR_COMMENTS, SERVER_PANEL } from "./create-copy.ts";
import {
	CREATOR_COMMENTS_RETURN_PATH,
	type CreatorCommentRowView,
	creatorCommentRowView,
	creatorCommentsView,
} from "./creator-comments-state.ts";

/**
 * Comments tab: what others said on my works. Same resource and rules as the web tab (one endpoint,
 * query policy in `@rowcat/query`, state order and row reasons in `@rowcat/domain`); this file only
 * draws.
 *
 * - Not a messaging system: no read state, reply, assignment or status. Notifications already
 *   announce new comments.
 * - The only row action is the existing report (`useReportAction`). No delete: that power belongs
 *   to the author.
 * - Keys, report target and destination come from comment and story ids, never list position,
 *   which shifts when a page is appended.
 * - The cache key sits under `["viewer", …]`, so sign-in and sign-out reset it (`@rowcat/query`'s
 *   `viewer.ts`).
 */
export function CreatorCommentsPanel() {
	const router = useRouter();
	/** Mounted only while the tab is active, so opening /create does not run this query. */
	const query = useInfiniteQuery(
		creatorCommentsInfiniteQueryOptions(getRowCatClient()),
	);
	const items = useMemo(
		() => (query.data ? creatorCommentInboxItems(query.data) : EMPTY),
		[query.data],
	);
	const view = creatorCommentsView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		itemCount: items.length,
		error: query.error,
	});

	if (view.state === "loading")
		return (
			<View style={panel.center}>
				<Spinner />
			</View>
		);

	if (view.state === "offline" || view.state === "error")
		return (
			<View style={panel.center}>
				<ErrorState
					message={
						view.state === "offline" ? SERVER_PANEL.offline : SERVER_PANEL.error
					}
					actionLabel={SERVER_PANEL.retry}
					onAction={() => void query.refetch()}
				/>
			</View>
		);

	/** Session lost: sign-in is the answer, not `Try again`. */
	if (view.state === "reauth")
		return (
			<View style={panel.center}>
				<EmptyState
					icon="account"
					title={CREATOR_COMMENTS.reauth.title}
					description={CREATOR_COMMENTS.reauth.description}
					actionLabel={CREATOR_COMMENTS.reauth.action}
					onAction={() =>
						router.push({
							pathname: "/login",
							params: { redirect: CREATOR_COMMENTS_RETURN_PATH },
						})
					}
				/>
			</View>
		);

	if (view.state === "empty")
		return (
			<View style={panel.center}>
				<EmptyState
					icon="comment"
					title={CREATOR_COMMENTS.empty.title}
					description={CREATOR_COMMENTS.empty.description}
				/>
			</View>
		);

	return (
		<PageEnter style={panel.fill}>
			<FlatList
				data={items}
				keyExtractor={keyOf}
				renderItem={({ item }) => (
					<InboxRow item={item} view={creatorCommentRowView(item)} />
				)}
				contentContainerStyle={panel.content}
				ListHeaderComponent={
					/** A failed `Show more` also sets isError; without this filter the stale line would sit over held rows and its retry would restart from page one. The tail reports that failure. */
					view.retryable && !query.isFetchNextPageError ? (
						<Notice
							message={SERVER_PANEL.stale}
							actionLabel={SERVER_PANEL.retry}
							onAction={() => void query.refetch()}
						/>
					) : null
				}
				ListFooterComponent={
					/** A failed `Show more` is reported beside that boundary; folding it into the top stale line would hide it from someone pressing at the list end. */
					<View style={panel.footer}>
						{query.isFetchNextPageError ? (
							<Notice
								message={CREATOR_COMMENTS.moreFailed}
								tone="destructive"
							/>
						) : null}
						{query.hasNextPage ? (
							<View style={panel.more}>
								<Button
									label={SERVER_PANEL.more}
									variant="outline"
									busy={query.isFetchingNextPage}
									onPress={() => void query.fetchNextPage()}
								/>
							</View>
						) : null}
					</View>
				}
			/>
		</PageEnter>
	);
}

/** One row: author, body, story title, time and report. The body is plain text folded at three lines, as on the story detail. */
function InboxRow({
	item,
	view,
}: {
	item: CreatorCommentInboxItem;
	view: CreatorCommentRowView;
}) {
	const router = useRouter();
	const { comment, story } = item;
	const name = comment.author.nickname || "No name";
	const title = story.title || "Untitled";
	const report = useReportAction({
		target: { type: "comment", storyId: story.id, commentId: comment.id },
		targetLabel: view.kindLabel,
	});
	const storyId = view.storyId;

	return (
		<View style={row.root}>
			<Avatar name={comment.author.nickname} uri={comment.author.avatarUrl} />
			<View style={row.body}>
				<View style={row.head}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Open ${name}'s profile`}
						hitSlop={space.sm}
						onPress={() =>
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
					<Text variant="caption" tone="muted-foreground">
						{view.kindLabel}
					</Text>
					{view.at ? (
						<Text variant="caption" tone="muted-foreground">
							{view.at}
						</Text>
					) : null}
					<View style={row.menu}>
						<DropdownMenu
							label={`${view.kindLabel} menu for ${name}`}
							align="end"
							size="sm"
							tone="muted-foreground"
						>
							{report.item}
						</DropdownMenu>
					</View>
				</View>

				<Text variant="body" leading="reading" numberOfLines={3}>
					{comment.body}
				</Text>

				{storyId ? (
					<Pressable
						accessibilityRole="link"
						accessibilityLabel={`Open ${title}`}
						hitSlop={space.xs}
						onPress={() =>
							router.push({
								pathname: "/stories/[storyId]",
								params: { storyId },
							})
						}
					>
						<Text
							variant="caption"
							tone="muted-foreground"
							numberOfLines={1}
							style={row.link}
						>
							{title}
						</Text>
					</Pressable>
				) : (
					<Text variant="caption" tone="muted-foreground" numberOfLines={1}>
						{view.unreachableReason
							? `${title} · ${view.unreachableReason}`
							: title}
					</Text>
				)}
			</View>
			{report.dialog}
		</View>
	);
}

const keyOf = (item: CreatorCommentInboxItem) => item.comment.id;
const EMPTY: CreatorCommentInboxItem[] = [];

const panel = StyleSheet.create({
	fill: { flex: 1 },
	content: { gap: space.md, padding: screenPadding },
	center: { paddingHorizontal: screenPadding, paddingTop: space.xl },
	footer: { gap: space.sm },
	more: { alignItems: "center", paddingTop: space.md },
});

const row = StyleSheet.create({
	root: { flexDirection: "row", gap: space.sm },
	body: { flex: 1, gap: space.xs, minWidth: 0 },
	head: { alignItems: "center", flexDirection: "row", gap: space.xs },
	name: { flexShrink: 1 },
	menu: { marginLeft: "auto" },
	link: { textDecorationLine: "underline" },
});
