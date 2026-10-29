import type { StoryDraft } from "@rowcat/authoring";
import { space } from "@rowcat/design";
import {
	type CreatorWork,
	type StoryLifecycleAction,
	storyLifecycleActions,
} from "@rowcat/domain";
import {
	creatorWorks,
	creatorWorksInfiniteQueryOptions,
	creatorWorksTotal,
	storyLifecycleMutationOptions,
} from "@rowcat/query";
import {
	AlertDialog,
	Badge,
	Button,
	EmptyState,
	ErrorState,
	Notice,
	Panel,
	Spinner,
	screenPadding,
	Text,
} from "@rowcat/ui-native";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { AnimatedLabel } from "../../lib/motion/animated-label.tsx";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { CoverManageDialog } from "./cover-manage-dialog.tsx";
import {
	PUBLISHED_COVER,
	PUBLISHED_EDIT_DRAFT,
	PUBLISHED_EMPTY,
	PUBLISHED_NO_DRAFT,
	SERVER_PANEL,
	WORK_HIDDEN_BADGE,
} from "./create-copy.ts";
import {
	draftIdIndex,
	editableDraftIdFor,
	serverPanelView,
} from "./server-panel-state.ts";
import {
	WORK_LIFECYCLE_LABEL,
	WORK_LIFECYCLE_PENDING_LABEL,
	WORK_VISIBILITY_BADGE,
	WORK_VISIBILITY_LABEL,
	workLifecycleConfirm,
	workLifecycleErrorMessage,
} from "./work-lifecycle-copy.ts";

/**
 * The `Published` panel. The server is the source of truth.
 *
 * Its resource is `GET /v2/me/stories` alone. The public gallery and the public profile grid are
 * not reused: both answer "what can be seen" and strip private, archived and operator-hidden works
 * on purpose, while this panel asks "what is mine".
 *
 * Query, invalidation and lifecycle cache policy all live in `@rowcat/query`, and the web calls the
 * same functions. Do not hand-edit the cache here: the package already knows that a withdrawing
 * transition removes the work at once, that a raising transition is not spliced in, and that
 * `hidden` is untouched. Restating those rules here would make the two apps diverge.
 *
 * ## Authored content is not edited here
 *
 * Title, rating, body, lore and scenes belong to the **source draft**. Editing them from this row
 * would split the draft's title from the work's, leaving the next publish no basis to tell which
 * one the creator meant. There is no `Publish again` button either: that operation needs an ordered
 * sequence (flush pending autosave, assemble the snapshot, validate, recheck ownership), and
 * `publishDraft` in the editor owns that order.
 *
 * ## Keep what is held
 *
 * If a background refresh fails, the list already received stays on screen with one staleness line
 * (`serverPanelView`). The count is the **server's total**: counting the loaded rows would make
 * "20 stories" become 40 with each `Show more` press, and the user would read that as works having been added.
 */
export function PublishedWorkPanel({
	drafts,
}: {
	/** This device's drafts. Used only to build an id index; their content is never read. */
	drafts: readonly StoryDraft[];
}) {
	const client = getRowCatClient();
	const query = useInfiniteQuery(creatorWorksInfiniteQueryOptions(client));

	const localDraftIds = useMemo(() => draftIdIndex(drafts), [drafts]);
	const works = query.data ? creatorWorks(query.data) : EMPTY;
	const total = query.data ? creatorWorksTotal(query.data) : null;

	const view = serverPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		rowCount: works.length,
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

	if (view.state === "empty")
		return (
			<View style={panel.center}>
				<EmptyState
					icon="library"
					title={PUBLISHED_EMPTY.title}
					description={PUBLISHED_EMPTY.description}
				/>
			</View>
		);

	/**
	 * The body has arrived. The header and the tab selector stay outside
	 * (`lib/motion/page-enter.tsx`).
	 *
	 * On this app `PageEnter` marks content resolving, not the route: native stack transitions already
	 * signal arrival (see the intended differences in `docs/motion/ARCHITECTURE.md`). It does not wrap
	 * the placeholder, error or empty branches above; the transition only matters when `?view=`
	 * changes.
	 */
	return (
		<PageEnter style={panel.fill}>
			<FlatList
				data={works}
				keyExtractor={keyOf}
				renderItem={({ item }) => (
					<WorkCard
						work={item}
						editableDraftId={editableDraftIdFor(item, localDraftIds)}
					/>
				)}
				contentContainerStyle={panel.content}
				ListHeaderComponent={
					<View style={panel.head}>
						{total !== null ? (
							<Text variant="caption" tone="muted-foreground">
								{`${total.toLocaleString("en-US")} stories`}
							</Text>
						) : null}
						{/**
						 * Keeps the value but does not pretend it is current. If a background refresh failed and
						 * only the value is drawn, minutes-old state reads as current and actions happen on top of it.
						 */}
						{/**
						 * A `Show more` failure is not staleness. TanStack sets `isError` for it too, so without this
						 * filter the line would stand over the loaded values, and its retry would re-ask from page one.
						 * The footer reports that failure.
						 */}
						{view.retryable && !query.isFetchNextPageError ? (
							<Notice
								message={SERVER_PANEL.stale}
								actionLabel={SERVER_PANEL.retry}
								onAction={() => void query.refetch()}
							/>
						) : null}
					</View>
				}
				ListFooterComponent={
					/**
					 * `Show more` (load more), not infinite scroll. This screen is for managing, not browsing, and a
					 * list that grows on every bottom touch makes it impossible to tell that nothing is below. The
					 * web made the same call.
					 */
					query.hasNextPage ? (
						<View style={panel.more}>
							{query.isFetchNextPageError ? (
								<Notice message={SERVER_PANEL.moreFailed} tone="destructive" />
							) : null}
							<Button
								label={SERVER_PANEL.more}
								variant="outline"
								busy={query.isFetchingNextPage}
								onPress={() => void query.fetchNextPage()}
							/>
						</View>
					) : null
				}
			/>
		</PageEnter>
	);
}

/**
 * One work row. Reads and lifecycle actions only.
 *
 * Which actions are available is decided by `storyLifecycleActions` in `@rowcat/domain`. If the
 * screen re-wrote `visibility === "public" ? … : …`, this app would keep the old rules when the
 * transition table changes, and the symptom would be a button that presses and silently gets a 409.
 */
function WorkCard({
	work,
	editableDraftId,
}: {
	work: CreatorWork;
	editableDraftId: string | null;
}) {
	const router = useRouter();
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const lifecycle = useMutation(
		storyLifecycleMutationOptions(client, queryClient, work.id),
	);
	const [confirming, setConfirming] = useState<StoryLifecycleAction | null>(
		null,
	);
	/**
	 * Whether the cover dialog is open. This action is independent of the source draft.
	 *
	 * The cover belongs to the publication, so the dialog opens even when this device has no draft
	 * (same as the web). It sends no authored content, so the rule that the work row carries no
	 * authoring edits still holds: this dialog changes only the picture.
	 */
	const [managingCover, setManagingCover] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const run = (action: StoryLifecycleAction) => {
		setFailure(null);
		lifecycle.mutate(action, {
			onError: (error) => setFailure(workLifecycleErrorMessage(action, error)),
			onSuccess: () => setConfirming(null),
		});
	};

	const confirm = confirming
		? workLifecycleConfirm(confirming, work.title)
		: null;
	const at = formatDateTime(work.updatedAt);

	return (
		<Panel style={card.root}>
			<View style={card.head}>
				<Text variant="body" weight="semibold" numberOfLines={2}>
					{work.title}
				</Text>
				<View style={card.badges}>
					{/**
					 * The same badge changes state: one is not removed and another added (`lib/motion/animated-label.tsx`).
					 * When a visibility-changing action succeeds, the word changes in place.
					 *
					 * The words never stand together: they differ in length (`Public`·`Private`·`archive`), and since they
					 * must be read, overlapping them would make assistive technology read both.
					 */}
					<AnimatedLabel value={work.visibility}>
						<Badge
							label={WORK_VISIBILITY_LABEL[work.visibility]}
							variant={WORK_VISIBILITY_BADGE[work.visibility]}
						/>
					</AnimatedLabel>
					{/**
					 * Operator hiding is a different axis from the creator's visibility, so it is not folded in. Left
					 * silent, zero views could never be explained, and a lifecycle action would read as if it lifted
					 * the hiding (the server does not touch that column).
					 */}
					{work.hidden ? (
						<Badge label={WORK_HIDDEN_BADGE} variant="destructive" />
					) : null}
				</View>
				{at ? (
					<Text variant="caption" tone="muted-foreground">
						{`Updated ${at}`}
					</Text>
				) : null}
			</View>

			<View style={card.actions}>
				{storyLifecycleActions(work).map((action) => (
					<Button
						key={action}
						label={
							lifecycle.isPending && lifecycle.variables === action
								? WORK_LIFECYCLE_PENDING_LABEL[action]
								: WORK_LIFECYCLE_LABEL[action]
						}
						accessibilityLabel={`${work.title} ${WORK_LIFECYCLE_LABEL[action]}`}
						variant="outline"
						size="sm"
						busy={lifecycle.isPending && lifecycle.variables === action}
						onPress={() => {
							const needsConfirm = workLifecycleConfirm(action, work.title);
							if (needsConfirm) setConfirming(action);
							else run(action);
						}}
					/>
				))}
				<Button
					label={PUBLISHED_COVER}
					accessibilityLabel={`${work.title} ${PUBLISHED_COVER}`}
					variant="ghost"
					size="sm"
					onPress={() => setManagingCover(true)}
				/>
				{/**
				 * Drawn only when the source draft is on this device. A missing draft is never recreated: a draft
				 * restored from the playback snapshot uses the publication's representation, not the authoring one,
				 * so publishing again would turn content the creator never wrote into their own work.
				 */}
				{editableDraftId ? (
					<Button
						label={PUBLISHED_EDIT_DRAFT}
						accessibilityLabel={`${work.title} ${PUBLISHED_EDIT_DRAFT}`}
						variant="ghost"
						size="sm"
						onPress={() =>
							router.push(`/create/${encodeURIComponent(editableDraftId)}`)
						}
					/>
				) : null}
			</View>

			{editableDraftId ? null : (
				<Text variant="caption" tone="muted-foreground">
					{PUBLISHED_NO_DRAFT}
				</Text>
			)}

			{failure ? <Notice message={failure} tone="destructive" /> : null}

			{managingCover ? (
				<CoverManageDialog
					work={work}
					onClose={() => setManagingCover(false)}
				/>
			) : null}

			<AlertDialog
				open={confirm !== null}
				title={confirm?.title ?? ""}
				description={confirm?.description ?? ""}
				confirmLabel={confirm?.confirmLabel ?? ""}
				busy={lifecycle.isPending}
				onConfirm={() => {
					if (confirming) run(confirming);
				}}
				onCancel={() => setConfirming(null)}
			/>
		</Panel>
	);
}

const keyOf = (work: CreatorWork) => work.id;
const EMPTY: CreatorWork[] = [];

const panel = StyleSheet.create({
	/**
	 * The wrapper must take part in layout. The scroll container grows to fill it, but only if its
	 * parent passes down the remaining height. `PageEnter` has no default style.
	 */
	fill: { flex: 1 },
	content: { gap: space.sm, padding: screenPadding },
	head: { gap: space.sm, paddingBottom: space.xs },
	center: { paddingHorizontal: screenPadding, paddingTop: space.xl },
	more: { alignItems: "center", gap: space.sm, paddingTop: space.md },
});

const card = StyleSheet.create({
	root: { gap: space.sm, padding: space.md },
	head: { gap: space.px },
	badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
});
