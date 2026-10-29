import { radiusScale, space } from "@rowcat/design";
import { isFavorited, isOwnStory, type StoryComment } from "@rowcat/domain";
import {
	deleteCommentMutationOptions,
	personalizationQueryOptions,
	storyComments,
	storyCommentsInfiniteQueryOptions,
	storyQueryOptions,
} from "@rowcat/query";
import {
	AppBar,
	Button,
	CenteredArea,
	ErrorState,
	Icon,
	KeyboardLayout,
	ListSection,
	Notice,
	Screen,
	Separator,
	Spinner,
	screenPadding,
	Text,
} from "@rowcat/ui-native";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { viewerAction } from "../../lib/viewer-action.ts";
import { ReportMenu } from "../moderation/report-menu.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { ShellUtilities } from "../shell/shell-utilities.tsx";
import { CommentComposer } from "./comments/comment-composer.tsx";
import { COMMENTS_LOAD_FAILURE } from "./comments/comment-error.ts";
import { CommentThread } from "./comments/comment-thread.tsx";
import { resolveCommentsState } from "./comments/comments-state.ts";
import { FavoriteControl } from "./favorite-control.tsx";
import { recordStoryView, shouldRecordStoryView } from "./record-view.ts";
import { RelatedStories } from "./related-stories.tsx";
import { StoryShareControl } from "./share-control.tsx";
import { StoryCover } from "./story-cover.tsx";
import {
	StoryDescription,
	StoryHeading,
	StoryMetadata,
	StoryTags,
} from "./story-meta.tsx";
import { StoryStartControl } from "./story-start-control.tsx";
import { resolveStoryState, type StoryState } from "./story-state.ts";

/**
 * Work detail — **public metadata and the public discussion.**
 *
 * ## One identity is the source of truth
 *
 * The route's `storyId` decides what this screen draws, and `storyQueryOptions` answers with the
 * content. The story object handed over from the list is not treated as authoritative, for two
 * reasons: when the screen is reached by address there is no such object at all, and when there is
 * one it is a copy from that moment, so it does not follow the totals when a heart press changes
 * them.
 *
 * ## Visibility is not decided again
 *
 * The server answers 404 for works the viewer cannot see, so a work that reaches this screen is
 * already "a work this viewer may see". Re-checking `story.adult && !viewer.showAdult` here would
 * someday make the two checks disagree, and on that day there would be no way to decide which one
 * is right.
 *
 * ## This screen does not wait for identity or SQLite either
 *
 * Same rule as the discovery screen (see the header of `discover-state.ts`). The decision lives in
 * `resolveStoryState`; identity enters only the heart, comment writing and the "my work" marker.
 *
 * ## The vertical list is **one**
 *
 * The work info is `ListHeaderComponent`, the comments are `data`, and the composer and the
 * load-more control are `ListFooterComponent`. Putting the comment `FlatList` inside a `ScrollView`
 * gives the outside an unbounded height, which turns virtualization off, and RN warns about that
 * combination.
 */
export function StoryDetailScreen({ storyId }: { storyId: string }) {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const router = useRouter();
	const identity = useMobileIdentity();
	const scope = useMobileLocalScope();

	const { session } = identity;
	const isMember = session.phase === "authenticated";
	const action = viewerAction(session);

	const story = useQuery(storyQueryOptions(client, storyId));

	const personalization = useQuery({
		...personalizationQueryOptions(client),
		enabled: isMember,
	}).data;

	const comments = useInfiniteQuery(
		storyCommentsInfiniteQueryOptions(client, storyId),
	);

	const removal = useMutation(
		deleteCommentMutationOptions(client, queryClient, storyId),
	);

	/**
	 * View record — sent **only after the work has actually been drawn.**
	 *
	 * Putting it in `queryFn` or a prefetch would count every fetch as a view. The decision and the
	 * failure handling live in `record-view.ts`. Failures are swallowed: a viewable work must not
	 * disappear because one network request blipped.
	 */
	useEffect(() => {
		if (!shouldRecordStoryView(story.status)) return;
		void recordStoryView((id) => client.stories.recordView(id), storyId);
	}, [client, storyId, story.status]);

	/**
	 * The id of a comment just posted.
	 *
	 * A comment written while the last page has not been seen is not spliced into the cache (doing so
	 * would show it twice after `Show more` — `@rowcat/query` holds that rule). From the screen it then
	 * looks as if nothing happened, so the fact that it was saved is stated separately.
	 */
	const [createdId, setCreatedId] = useState<string | null>(null);

	const rows = useMemo(
		() => (comments.data ? storyComments(comments.data) : []),
		[comments.data],
	);

	const state = resolveStoryState({
		/** Identity and device storage are passed in **but do not decide anything** (see `story-state.ts`). */
		context: { session: session.phase, localScope: scope.status },
		story: {
			status: story.status,
			paused: story.fetchStatus === "paused",
			error: story.error,
			data: story.data,
		},
	});

	/** Where a sign-in should return to — this work, right now. */
	const returnPath = `/stories/${encodeURIComponent(storyId)}`;

	const viewerId = session.viewer?.id ?? null;

	const renderComment = useCallback(
		({ item }: { item: StoryComment }) => (
			/**
			 * The thread holds the state of its own replies (expanded, form, next page). If this screen held
			 * that state, it would be a map of twenty entries keyed by comment id, and the screen would have
			 * to remember to clear the entry when the row disappears (the web makes the same call).
			 */
			<CommentThread
				storyId={storyId}
				comment={item}
				/**
				 * The thread decides ownership with `isOwnComment` — not by comparing nicknames. Which trigger
				 * appears on the row is decided by `commentRowAction`; that decision needs a third input
				 * (guest) that `own` alone cannot express, so the id is passed.
				 */
				viewerId={viewerId}
				action={action}
				returnPath={returnPath}
				/**
				 * Passes **which row** the pending delete belongs to. Locking the whole list with one mutation
				 * would stop other rows from being pressed while one is being deleted.
				 */
				deleting={removal.isPending ? (removal.variables?.id ?? null) : null}
				onDelete={(target) => {
					/**
					 * No optimistic delete — `deleteCommentMutationOptions` waits for server confirmation. If the
					 * row came back after a failure, the user could not tell what is true.
					 *
					 * **Only two axes are passed (`id`, `parentId`).** Which cache cell the result is applied to
					 * is decided by those two, and the screen does not restate that decision.
					 */
					removal.mutate({ id: target.id, parentId: target.parentId });
				}}
			/>
		),
		[
			action,
			removal.isPending,
			removal.variables,
			removal.mutate,
			returnPath,
			storyId,
			viewerId,
		],
	);

	/** Hearts for related-work cards — kept as an array in the cache and turned into a Set only for lookup (same as the discovery screen). */
	const relatedFavorites = useMemo(
		() => new Set(personalization?.favorites ?? []),
		[personalization],
	);

	if (state.kind !== "story")
		return (
			<Screen>
				<DetailBar onBack={() => router.back()} />
				<CenteredArea>
					<StoryUnavailable
						state={state}
						onRetry={() => void story.refetch()}
					/>
				</CenteredArea>
			</Screen>
		);

	/** From here on there is a work — `state` holds that value, so no assertion is needed. */
	const value = state.story;
	const favorited = personalization
		? isFavorited(personalization, value.id)
		: false;
	const commentsState = resolveCommentsState({
		status: comments.status,
		paused: comments.fetchStatus === "paused",
		commentCount: rows.length,
	});
	const createdOutOfView =
		createdId !== null && !rows.some((row) => row.id === createdId);

	/**
	 * **The body has arrived.** The exit path (`DetailBar`) is used by both branches, so it stays
	 * outside (`lib/motion/page-enter.tsx`).
	 *
	 * In this app `PageEnter` signals not the route but **the resolution of content**. The native
	 * stack transition already signals the screen's arrival (`docs/motion/ARCHITECTURE.md`, "intended differences").
	 * It does not attach to the placeholder, missing and error branches above: those are states of
	 * "not yet", and animating their appearance too would double the wait.
	 *
	 * **The box moves, not the rows.** List cards arrive as a page-by-page growing sequence and do not
	 * each rise on their own (otherwise each `Show more` would bring twenty rows in one by one). Only the
	 * one layer holding that list moves here — the heights the virtualizer measures do not change by a
	 * pixel.
	 */
	return (
		<Screen>
			<DetailBar onBack={() => router.back()} />
			<KeyboardLayout>
				<PageEnter style={detail.fill}>
					<FlatList
						data={commentsState === "list" ? rows : []}
						keyExtractor={keyOf}
						renderItem={renderComment}
						contentContainerStyle={detail.content}
						ItemSeparatorComponent={CommentSeparator}
						ListHeaderComponent={
							<View style={detail.head}>
								<View style={detail.coverBox}>
									<StoryCover
										uri={value.coverUrl}
										title={value.title}
										style={detail.cover}
										placeholderSize="2xl"
									/>
								</View>

								<StoryHeading story={value} own={isOwnStory(value, viewerId)} />

								{/**
								 * The primary action is **start a conversation**, with favourite beside it. That
								 * order is the screen's claim: someone opening a work mostly wants to start, not
								 * just read.
								 *
								 * Starting does not invalidate the favourite or comment queries. What this action
								 * creates is **a room on the device**; no server state moves (reading the play
								 * snapshot is a read).
								 */}
								<StoryStartControl
									story={value}
									action={action}
									returnPath={returnPath}
								/>

								{/**
								 * Favourite, share and report sit on one row — and they are **not the same
								 * weight.** Report is pushed to the end (`marginLeft: "auto"`) and sits behind a
								 * menu layer: set beside start and favourite, the screen would read as recommending
								 * three things. The web's same row has the same layout (`sm:ml-auto` in
								 * `story-hero.tsx`).
								 *
								 * The triggers are **always visible** — fingers have no hover, and a hidden action
								 * is no action.
								 */}
								<View style={detail.actions}>
									<FavoriteControl
										story={value}
										favorited={favorited}
										returnPath={returnPath}
										size="md"
									/>
									{/**
									 * Share — **a secondary action that does not compete with the primary one.**
									 *
									 * It is a single icon with no label. Adding another filled button would read as two
									 * things recommended; the one recommendation is `Start conversation` above.
									 *
									 * **It removes itself when it cannot be handed over** (private or archived, or a
									 * deployment with no origin). `Link only`, by contrast, does hand over — someone who
									 * chose that state wants exactly to share. The decision lives in a pure function, not
									 * in the screen (`share-story.ts`). Reading the visibility state here again would keep
									 * the same rule in two places, and one of them would send out a link that 404s for
									 * the recipient.
									 */}
									<StoryShareControl story={value} />
									<View style={detail.overflow}>
										{/**
										 * What goes out is **the work id alone.** The contract has no slot for title,
										 * description or rating (`ReportTarget`); the snapshot is fetched by the server
										 * from its own row. If a reporter could invent evidence, that evidence would not
										 * be evidence.
										 *
										 * Not drawn for guests, unverified identity or one's own work. That decision lives
										 * in `report-visibility.ts`, and ownership is judged by **member id** only
										 * (nicknames are not unique).
										 */}
										<ReportMenu
											target={{ type: "story", storyId: value.id }}
											targetLabel="Story"
											triggerLabel="Story report menu"
											viewerId={viewerId}
											ownerId={value.creator?.id ?? null}
										/>
									</View>
								</View>

								<StoryDescription description={value.description} />
								<StoryTags tags={value.tags} />
								<StoryMetadata story={value} />

								{/**
								 * Related works sit **between** the body and the comments (same place as the web).
								 * Without them the section does not exist.
								 */}
								<RelatedStories
									storyId={value.id}
									favorites={relatedFavorites}
									returnPath={returnPath}
								/>

								<ListSection title="Comments" style={detail.commentsHead}>
									{/**
									 * The composer sits **above** the list. The list grows downward in oldest-first
									 * order, so with the input at the end, the more comments there are, the more
									 * someone who came to write has to scroll.
									 */}
									<CommentComposer
										storyId={value.id}
										action={action}
										returnPath={returnPath}
										onCreated={(comment) => setCreatedId(comment.id)}
									/>
									{createdOutOfView && (
										<Text variant="caption" tone="muted-foreground">
											Comment posted. You can see it at the end of the list.
										</Text>
									)}
									{/**
									 * A comment failure **ends inside this section.** The work stays as it is.
									 */}
									<CommentsNotice
										state={commentsState}
										onRetry={() => void comments.refetch()}
									/>
								</ListSection>
							</View>
						}
						ListFooterComponent={
							comments.hasNextPage && commentsState === "list" ? (
								<View style={detail.more}>
									{/**
									 * One button — no scroll watcher. Comments sit at the **end** of the page, so
									 * auto-loading would grow the list every time the bottom is reached and the page
									 * would never finish.
									 */}
									<Button
										label={
											comments.isFetchingNextPage ? "Loading" : "More comments"
										}
										variant="outline"
										fullWidth
										onPress={() => void comments.fetchNextPage()}
										busy={comments.isFetchingNextPage}
									/>
								</View>
							) : null
						}
						keyboardDismissMode="on-drag"
						keyboardShouldPersistTaps="handled"
					/>
				</PageEnter>
			</KeyboardLayout>
		</Screen>
	);
}

const keyOf = (comment: StoryComment) => comment.id;

const CommentSeparator = () => <Separator />;

/**
 * One exit path.
 *
 * The native stack's header is not turned on because this app has its own colours (the default
 * header draws in the light theme). iOS's edge swipe works with `headerShown: false` anyway, so the
 * button here is for people who do not know about it and for Android.
 */
function DetailBar({ onBack }: { onBack: () => void }) {
	/**
	 * The title is not drawn. The work title is already the largest text on the canvas, and drawing
	 * the same words twice makes screen readers read them twice. This is the same rule as the web
	 * shell's: where the canvas already has an h1, the header's slot is left empty.
	 */
	return (
		<AppBar
			navigation={<AppSidebarTrigger />}
			onBack={onBack}
			backLabel="Back to Discover"
			/**
			 * Global utilities (notifications, account). The screen only composes this one row; counts,
			 * badges and active state are handled by each component. They disappear on their own for
			 * non-members, so this public screen's "do not wait for auth" rule holds.
			 */
			actions={<ShellUtilities />}
		/>
	);
}

/**
 * When the work cannot be drawn.
 *
 * **404 does not say why.** The server returns the same 404 for a missing work and for one the
 * viewer cannot see (private, blocked, adult gate, operator-hidden). If the screen guessed the
 * reason, the response would become an existence detector. There is no retry button either — the
 * same request gets the same 404, and a button would only suggest that pressing a few more times
 * might work.
 */
function StoryUnavailable({
	state,
	onRetry,
}: {
	/** Only the **missing** branches arrive here — the caller already separated the cases, and the type holds that fact. */
	state: Exclude<StoryState, { kind: "story" }>;
	onRetry: () => void;
}) {
	if (state.kind === "loading") return <Spinner />;

	if (state.kind === "offline")
		return (
			<Notice message="You're not connected to a network. It continues automatically once connected." />
		);

	/**
	 * A missing work is **not a failure** — retrying gets the same 404. So it is an empty-state
	 * sentence rather than an error box, and there is no retry button (its presence would suggest that
	 * pressing a few more times might work).
	 */
	if (state.kind === "missing")
		return (
			/**
			 * The web's `story-detail-error.tsx` places `FileQuestion` here. The picture is decoration and
			 * the sentence below states the fact — so the `alert` role stays on the title (swapping in
			 * `EmptyState` would lose that role).
			 *
			 * The copy still does not state a reason: a missing work and one the viewer cannot see are the
			 * same 404, and `StoryState` has no slot for a reason.
			 */
			<View style={detail.missing}>
				<Icon name="missing" size="2xl" tone="muted-foreground" />
				<Text accessibilityRole="alert" variant="title">
					The story couldn't be found.
				</Text>
				<Text variant="label" tone="muted-foreground">
					This story doesn't exist or can't be viewed right now.
				</Text>
			</View>
		);

	return (
		<ErrorState
			message="Couldn't load stories."
			actionLabel="Try again"
			onAction={onRetry}
			/** Carries neither the stack nor the response body. The request id is the only clue the user can bring along. */
			detail={
				state.requestId ? (
					<Text variant="caption" tone="muted-foreground">
						Request ID: {state.requestId}
					</Text>
				) : null
			}
		/>
	);
}

/** One status line for the comments section. Draws nothing for `list` (the list already speaks for itself). */
function CommentsNotice({
	state,
	onRetry,
}: {
	state: ReturnType<typeof resolveCommentsState>;
	onRetry: () => void;
}) {
	if (state === "loading") return <Spinner />;
	if (state === "offline")
		return (
			<Notice message="You're not connected to a network, so comments couldn't be loaded." />
		);
	if (state === "failed")
		return (
			<ErrorState
				message={COMMENTS_LOAD_FAILURE}
				actionLabel="Try again"
				onAction={onRetry}
			/>
		);
	if (state === "empty")
		return (
			<Text variant="label" tone="muted-foreground">
				No comments yet.
			</Text>
		);
	return null;
}

const detail = StyleSheet.create({
	/**
	 * The wrapping box has to take part in layout — `ScrollView` has `flexGrow: 1` itself, but without
	 * a flexible parent it gets no leftover height (`PageEnter` has no default style).
	 */
	fill: { flex: 1 },
	/**
	 * 40 is off the spacing scale — a tail gap so the last comment does not touch the home indicator.
	 *
	 * The top is on the scale and **is the same value as the other screens** (`screenPadding`). This
	 * slot used to be empty, so the cover sat 3pt below the header's rule. The conversation list,
	 * which has the same shape (one list below `AppBar`), gives the same slot 16pt. Looking at one
	 * screen, the difference reads as "the cover is just large"; only moving between the two screens
	 * reveals the content jumping up.
	 */
	content: {
		paddingBottom: 40,
		paddingHorizontal: screenPadding,
		paddingTop: screenPadding,
	},
	head: { gap: space.lg, paddingBottom: space.sm },
	/**
	 * Caps the cover width so it does not take the whole first screen — the title and key information
	 * must show together.
	 */
	/**
	 * **The same box as the web's `max-w-48` (192).** At 390 width both screens draw covers of the
	 * same physical size.
	 *
	 * ⚠️ This value used to be `width: "60%" · maxWidth: 220`, and that combination produces 214.8 on
	 * this device — a cover 12% larger than the web's. The aspect ratio (3:4) matched, so screenshots
	 * looked plausible on their own, but side by side the title and the primary action sat that much
	 * lower.
	 */
	coverBox: { alignSelf: "center", maxWidth: 192, width: "100%" },
	/** The radius is also the web's `rounded-lg` (`xl` looked noticeably round in this box). */
	cover: { aspectRatio: 3 / 4, borderRadius: radiusScale.lg },
	/**
	 * The heart and the overflow share one row. `alignItems: "center"` because the heart slot can
	 * stretch the failure text sideways, and even then the two controls' vertical centres must line
	 * up.
	 */
	actions: { alignItems: "center", flexDirection: "row" },
	/** Report is at the **end** of the row — the placement described in the comment above lives in this line. */
	overflow: { marginLeft: "auto" },
	commentsHead: { paddingTop: space.sm },
	more: { paddingTop: space.lg },
	missing: { gap: space.sm },
});
