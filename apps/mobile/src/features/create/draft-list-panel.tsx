import { draftDisplayTitle, type StoryDraft } from "@rowcat/authoring";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import {
	AlertDialog,
	Button,
	EmptyState,
	ErrorState,
	Icon,
	Spinner,
	screenPadding,
	Text,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { formatDateTime } from "../../lib/format.ts";
import {
	useAuthoringScope,
	useDraftCoverScope,
} from "../../lib/local-data/scope.tsx";
import type { useLocalDrafts } from "../../lib/local-data/use-drafts.ts";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import type { MobileAppPhase } from "../../lib/session-state.ts";
import {
	CREATE_DRAFTS_EMPTY,
	CREATE_NEW_LABEL,
	CREATE_NEW_PENDING_LABEL,
	CREATE_STORAGE_ERROR,
	DRAFT_DELETE,
	DRAFT_DELETE_FAILURE,
	DRAFT_PUBLISH_STATE,
} from "./create-copy.ts";
import { resolveDraftListState } from "./create-home-state.ts";

/**
 * Drafts tab: a list that opens without the network. It makes no server query, so it still draws
 * when the other two tabs fail offline, which is why drafts are `Create`'s default tab.
 *
 * - Order comes from `listDrafts()` (`compareDraftsByRecency`); re-sorting here would let web and
 *   mobile diverge when one rule changes.
 * - A row draws only title, last-modified time and published state. No body preview
 *   (shoulder-surfing would expose the manuscript), and no tags/tendency/rating because this list
 *   is for resuming writing, not browsing.
 */
export function DraftListPanel({
	phase,
	drafts,
	onRetryScope,
	onCreate,
	creating,
}: {
	phase: MobileAppPhase;
	drafts: ReturnType<typeof useLocalDrafts>;
	onRetryScope: () => void;
	onCreate: () => Promise<void>;
	creating: boolean;
}) {
	const router = useRouter();
	const { store, ownsStore } = useAuthoringScope();
	/** Deleting a draft also clears its pre-publication cover (see `confirmDelete`). */
	const { store: coverStore } = useDraftCoverScope();
	const [target, setTarget] = useState<StoryDraft | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const state = resolveDraftListState({
		phase,
		drafts: { status: drafts.status, total: drafts.value.length },
	});

	const open = useCallback(
		(draftId: string) => router.push(`/create/${encodeURIComponent(draftId)}`),
		[router],
	);

	/**
	 * Soft delete; the store removes children (lore, scenes, scene images) in one transaction. The
	 * screen must not delete them one by one, or a process death in between leaves parentless records
	 * that the next push uploads. The server work is not deleted (a different resource); the confirm
	 * dialog says so.
	 */
	const confirmDelete = useCallback(async () => {
		if (!store || !target) return;
		setDeleting(true);
		try {
			await store.deleteDraft(target.id);
			/**
			 * Clear the pre-publication cover too. It is outside the store transaction because it lives in
			 * two places (row and file). A failure does not undo the delete: the leftover file is read by no
			 * screen and vanishes when the member leaves (`purge.ts`).
			 */
			await coverStore?.clear(target.id).catch(() => undefined);
			/** An account switch mid-delete is not drawn as a failure; nothing was lost. */
			if (!ownsStore(store)) return;
			setFailure(null);
			setTarget(null);
		} catch {
			setFailure(DRAFT_DELETE_FAILURE);
		} finally {
			setDeleting(false);
		}
	}, [store, target, ownsStore, coverStore]);

	if (state.kind === "booting" || state.kind === "loading")
		return (
			<View style={list.center}>
				<Spinner />
			</View>
		);

	if (state.kind === "storage-error" || state.kind === "read-error")
		return (
			<View style={list.center}>
				<ErrorState
					message={CREATE_STORAGE_ERROR.message}
					actionLabel={CREATE_STORAGE_ERROR.action}
					onAction={
						state.kind === "storage-error" ? onRetryScope : drafts.reload
					}
				/>
			</View>
		);

	if (state.kind === "empty")
		return (
			<View style={list.center}>
				<EmptyState
					icon="create"
					title={CREATE_DRAFTS_EMPTY.title}
					description={CREATE_DRAFTS_EMPTY.description}
					/**
					 * The wording differs from the header button, as on web: that one is always standing and
					 * short, this is the only next step after a sentence and takes a predicate (`create-copy.ts`).
					 * It calls the same operation; a second create path would leave the duplicate-create lock on
					 * one side only.
					 */
					actionLabel={
						creating ? CREATE_NEW_PENDING_LABEL : CREATE_DRAFTS_EMPTY.action
					}
					/** Web's `Create a new story` is `outline` too (`draft-list.tsx`). */
					actionVariant="outline"
					onAction={() => void onCreate()}
				/>
			</View>
		);

	/** Guest and unsettled states are handled above; only the list reaches here. */
	if (state.kind !== "list") return null;

	/**
	 * The body has arrived; the header and tab picker stay outside (`lib/motion/page-enter.tsx`). Here
	 * `PageEnter` signals content resolution, not a route (the native stack transition already signals
	 * arrival; see `docs/motion/ARCHITECTURE.md`), so it is not on the placeholder, guest or error
	 * branches. It earns its keep when `?view=` changes: no route transition runs then.
	 */
	return (
		<>
			<PageEnter style={list.fill}>
				<FlatList
					data={drafts.value}
					keyExtractor={keyOf}
					renderItem={({ item }) => (
						<DraftRow
							draft={item}
							onOpen={() => open(item.id)}
							onDelete={() => {
								setFailure(null);
								setTarget(item);
							}}
						/>
					)}
					contentContainerStyle={list.content}
					ListFooterComponent={
						/** Create path below the list too, so a scrolled user need not go back up. */
						<View style={list.footer}>
							<Button
								label={CREATE_NEW_LABEL}
								icon="add"
								variant="outline"
								busy={creating}
								onPress={() => void onCreate()}
							/>
						</View>
					}
				/>
			</PageEnter>

			{/**
			 * `AlertDialog`, not `Alert.alert`: the latter is imperative and freezes its sentence on
			 * open, but this copy depends on published state, and sync can bring a publish link in
			 * meanwhile.
			 */}
			<AlertDialog
				open={target !== null}
				title={DRAFT_DELETE.title}
				description={deleteDescription(target)}
				confirmLabel={DRAFT_DELETE.confirm}
				destructive
				busy={deleting}
				error={failure}
				onConfirm={() => void confirmDelete()}
				onCancel={() => {
					setTarget(null);
					setFailure(null);
				}}
			/>
		</>
	);
}

/**
 * Delete confirmation copy; the published notice is added only for published drafts. Showing it on
 * every deletion would make it unread for the people who need it.
 */
function deleteDescription(draft: StoryDraft | null): string {
	if (!draft) return DRAFT_DELETE.description;
	return draft.publishedStoryId
		? `${DRAFT_DELETE.description} ${DRAFT_DELETE.publishedNotice}`
		: DRAFT_DELETE.description;
}

/**
 * One row. The two press targets (whole row, delete) are siblings: nesting would make the winner
 * platform-dependent and read as a button inside a button to assistive technology.
 */
function DraftRow({
	draft,
	onOpen,
	onDelete,
}: {
	draft: StoryDraft;
	onOpen: () => void;
	onDelete: () => void;
}) {
	const { colors } = useTheme();
	const title = draftDisplayTitle(draft);
	const at = formatDateTime(draft.updatedAt);

	return (
		<View style={row.root}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={title}
				onPress={onOpen}
				style={({ pressed }) => [
					row.body,
					{ borderColor: colors.border },
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<View style={row.text}>
					<Text variant="body" weight="semibold" numberOfLines={1}>
						{title}
					</Text>
					<View style={row.meta}>
						{at ? (
							<Text variant="caption" tone="muted-foreground">
								{at}
							</Text>
						) : null}
						{/**
						 * Published state is one word. Address, views and exposure belong to the
						 * `Published` tab; the draft record only knows a link exists. This was
						 * once a badge with nothing for unpublished; web writes both as text and
						 * varies only weight (`create-copy.ts`).
						 */}
						{draft.publishedStoryId ? (
							<Text variant="caption" weight="medium">
								{DRAFT_PUBLISH_STATE.published}
							</Text>
						) : (
							<Text variant="caption" tone="muted-foreground">
								{DRAFT_PUBLISH_STATE.unpublished}
							</Text>
						)}
					</View>
				</View>
				<Icon name="chevron-right" size="md" tone="muted-foreground" />
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Delete ${title}`}
				onPress={onDelete}
				style={({ pressed }) => [
					row.delete,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Icon name="delete" size="md" tone="muted-foreground" />
			</Pressable>
		</View>
	);
}

const keyOf = (draft: StoryDraft) => draft.id;

const list = StyleSheet.create({
	/**
	 * The wrapper must take part in layout: `ScrollView` has its own `flexGrow: 1` but gets no
	 * remaining height unless its parent does (`PageEnter` has no default style).
	 */
	fill: { flex: 1 },
	content: { gap: space.sm, padding: screenPadding },
	center: { paddingHorizontal: screenPadding, paddingTop: space.xl },
	footer: { alignItems: "center", paddingTop: space.md },
});

const row = StyleSheet.create({
	root: { alignItems: "center", flexDirection: "row", gap: space.xs },
	body: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		flex: 1,
		flexDirection: "row",
		gap: space.sm,
		minHeight: touchTarget,
		minWidth: 0,
		paddingHorizontal: space.md,
		paddingVertical: space.sm,
	},
	text: { flex: 1, gap: space.px, minWidth: 0 },
	meta: { alignItems: "center", flexDirection: "row", gap: space.xs },
	delete: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		height: touchTarget,
		justifyContent: "center",
		width: touchTarget,
	},
});
