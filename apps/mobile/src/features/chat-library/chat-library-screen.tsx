import { space } from "@rowcat/design";
import {
	AppBar,
	Button,
	EmptyState,
	ErrorState,
	Notice,
	Screen,
	Separator,
	Spinner,
	screenPadding,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { resolveAppPhase } from "../../lib/session-state.ts";
import { useRoomManagement } from "../chat/room/use-management.tsx";
import { PrimaryNav } from "../shell/primary-nav.tsx";
import { ShellUtilities } from "../shell/shell-utilities.tsx";
import {
	type ChatLibraryState,
	resolveChatLibraryState,
} from "./chat-library-state.ts";
import { LibraryToolbar } from "./library-toolbar.tsx";
import {
	CHAT_LIBRARY_EMPTY,
	CHAT_LIBRARY_GUEST,
	CHAT_LIBRARY_SEARCH_EMPTY,
	CHAT_LIBRARY_STORAGE_ERROR,
	CHAT_LIBRARY_TITLE,
	CHAT_LIBRARY_UNAVAILABLE,
	ROOM_LIBRARY_MORE_LABEL,
} from "./room-library-copy.ts";
import { RoomRow } from "./room-row.tsx";
import { RuntimeConversationRow } from "./runtime-conversation-row.tsx";
import type { ConversationEntry } from "./use-conversation-library.ts";
import { useRoomLibrary } from "./use-room-library.ts";
import { useRuntimeConversationRemoval } from "./use-runtime-conversation-removal.ts";

/**
 * The conversation list: every conversation of this account on this device. Same place and rules as
 * the web's `/chats`; it finds, sorts and manages, and it is the only destination for returning to
 * an existing conversation (the story detail's `Start conversation` always creates a new room).
 *
 * - Opposite of the public screens: conversations live only in the per-member database, so this
 *   waits for identity and SQLite. The decision is the pure `resolveChatLibraryState`; stacked in
 *   the component it is untestable, and a wrong branch shows someone with many conversations "no
 *   conversations yet".
 * - No server query: there is no room-list endpoint and none is cached. Sync writes the same
 *   database and the subscription (`useRoomLibrary`) hears it, so this file never changes with
 *   sync.
 * - One library, two row kinds: runtime playthrough rows stand in the same activity-ordered list
 *   as rooms (merging is `@rowcat/domain`, shared with the web). Search, counts and `Show more` run on
 *   the merged list. A runtime row's only action is `Remove from list` and it skips the room management hook
 *   (`runtime-conversation-row.tsx`).
 * - One virtualized list: search/sort/count go in `ListHeaderComponent`. A `FlatList` inside a
 *   `ScrollView` gets infinite height, which turns virtualization off entirely.
 * - No `onEndReached` auto-expansion: this screen is for finding, and auto-growth would make it
 *   impossible to confirm there is nothing below (same call as the web).
 * - Query and sort are not put in the address, a deep link or device storage: conversation titles
 *   are private strings and the state is not worth recovering.
 */
export function ChatLibraryScreen() {
	const router = useRouter();
	const { session } = useMobileIdentity();
	const localScope = useMobileLocalScope();
	const library = useRoomLibrary();

	/**
	 * The screen owns management, not each row: per-row ownership would mount 500 windows for 500
	 * rooms. Rows draw only triggers and one window is ever open.
	 *
	 * Nothing navigates after a delete; the room leaves the list and this screen stays (unlike the
	 * conversation screen, which leaves because its open room vanished).
	 */
	const management = useRoomManagement();
	/** The runtime row's only action; no playthrough is open here, so there is nowhere to leave. */
	const runtimeRemoval = useRuntimeConversationRemoval();

	const state = resolveChatLibraryState({
		phase: resolveAppPhase(session, localScope.status),
		rooms: {
			status: library.status,
			total: library.view.total,
			matched: library.view.matched,
			searching: library.searching,
		},
	});

	const open = useCallback(
		(roomId: string) => router.push(`/chat/${encodeURIComponent(roomId)}`),
		[router],
	);
	const openRuntime = useCallback(
		(storyId: string) =>
			router.push(`/chat/runtime/${encodeURIComponent(storyId)}`),
		[router],
	);

	const renderRow = useCallback(
		({ item }: { item: ConversationEntry }) =>
			item.kind === "chat" ? (
				<RoomRow
					room={item.room}
					management={management}
					onOpen={() => open(item.id)}
				/>
			) : (
				<RuntimeConversationRow
					conversation={item.conversation}
					onOpen={() => openRuntime(item.storyId)}
					onRemove={runtimeRemoval.remove}
				/>
			),
		[management, open, openRuntime, runtimeRemoval.remove],
	);

	/** The toolbar stands only where a list is drawn; a search box is noise with no conversations. */
	const listing = state.kind === "list" || state.kind === "search-empty";

	return (
		<Screen>
			{/**
			 * No drawer trigger: this screen is a primary destination with the bottom nav, and only
			 * one global navigation surface stands at a time (`features/shell/primary-nav.tsx`).
			 * Back stays because other screens push into here (deleting a room leaves to it), and
			 * "where can I go" and "where did I come from" do not replace each other.
			 */}
			<AppBar
				title={CHAT_LIBRARY_TITLE}
				onBack={() => router.back()}
				/** Global utilities (notifications, account); each decides member-ness itself. */
				actions={<ShellUtilities />}
			/>
			<FlatList
				/** The bottom nav is a sibling; the list takes the remaining height so it sticks to the bottom. */
				style={list.fill}
				data={state.kind === "list" ? library.view.visible : EMPTY}
				keyExtractor={keyOf}
				renderItem={renderRow}
				/**
				 * One rule between rows, as the web's `ul.divide-y.border-y`; it makes this a continuous roster
				 * rather than a pile of cards (`room-row.tsx`).
				 */
				ItemSeparatorComponent={RoomSeparator}
				contentContainerStyle={list.content}
				ListHeaderComponent={
					listing ? (
						<>
							<LibraryToolbar
								query={library.query}
								onQuery={library.setQuery}
								sort={library.sort}
								onSort={library.setSort}
								matched={library.view.matched}
							/>
							{runtimeRemoval.failure ? (
								<Notice
									message={runtimeRemoval.failure}
									tone="destructive"
									actionLabel="Close"
									onAction={runtimeRemoval.dismissFailure}
								/>
							) : null}
							{/**
							 * Closes the list top and bottom (the web's `border-y`); with only
							 * between-row rules the surface does not show where the list starts and ends.
							 */}
							{state.kind === "list" ? <Separator /> : null}
						</>
					) : null
				}
				ListEmptyComponent={
					<LibraryPlaceholder
						state={state}
						onRetryScope={localScope.retry}
						onRetryRead={library.reload}
						onClearQuery={() => library.setQuery("")}
						onDiscover={() => router.replace("/")}
						onSignIn={() =>
							router.push({
								pathname: "/login",
								params: { redirect: "/chats" },
							})
						}
					/>
				}
				ListFooterComponent={
					state.kind === "list" && !library.view.hasMore ? (
						<Separator />
					) : state.kind === "list" && library.view.hasMore ? (
						<View style={list.more}>
							<Button
								label={ROOM_LIBRARY_MORE_LABEL}
								variant="outline"
								onPress={library.showMore}
							/>
						</View>
					) : null
				}
				keyboardDismissMode="on-drag"
				keyboardShouldPersistTaps="handled"
			/>

			{/**
			 * The one open window, drawn in the same place whichever row opened it; its target is
			 * the room id that row pointed at (`useRoomManagement`).
			 */}
			{management.surfaces}

			{/** Bottom primary nav; this screen is home of the `Conversations` section. */}
			<PrimaryNav />
		</Screen>
	);
}

/** The entity id is the key; an index key would let rows take each other's place when the list changes. */
const keyOf = (entry: ConversationEntry) => entry.id;

const EMPTY: ConversationEntry[] = [];

/**
 * When there are no rows; each branch states a different fact. `resolveChatLibraryState` already
 * decided, and the ordering is not rebuilt here because a wrong order fails silently.
 */
function LibraryPlaceholder({
	state,
	onRetryScope,
	onRetryRead,
	onClearQuery,
	onDiscover,
	onSignIn,
}: {
	state: ChatLibraryState;
	onRetryScope: () => void;
	onRetryRead: () => void;
	onClearQuery: () => void;
	onDiscover: () => void;
	onSignIn: () => void;
}) {
	if (state.kind === "booting" || state.kind === "loading")
		return (
			<View style={list.center}>
				<Spinner />
			</View>
		);

	if (state.kind === "guest")
		return (
			<View style={list.center}>
				<EmptyState
					icon="chats"
					title={CHAT_LIBRARY_GUEST.title}
					description={CHAT_LIBRARY_GUEST.description}
					actionLabel={CHAT_LIBRARY_GUEST.action}
					onAction={onSignIn}
				/>
			</View>
		);

	/** Not signed out: no sign-in button; asking again is the task. */
	if (state.kind === "unavailable")
		return (
			<View style={list.center}>
				<Notice message={CHAT_LIBRARY_UNAVAILABLE} />
			</View>
		);

	/** Storage-open and list-read failures retry different things but share copy, since the user's task is the same. */
	if (state.kind === "storage-error" || state.kind === "read-error")
		return (
			<View style={list.center}>
				<ErrorState
					message={CHAT_LIBRARY_STORAGE_ERROR.message}
					actionLabel={CHAT_LIBRARY_STORAGE_ERROR.action}
					onAction={state.kind === "storage-error" ? onRetryScope : onRetryRead}
				/>
			</View>
		);

	if (state.kind === "search-empty")
		return (
			<View style={list.center}>
				<EmptyState
					icon="no-results"
					title={CHAT_LIBRARY_SEARCH_EMPTY.title}
					description={CHAT_LIBRARY_SEARCH_EMPTY.description}
					actionLabel={CHAT_LIBRARY_SEARCH_EMPTY.action}
					/** The web's `Clear search` is `outline` (`chat-library-page.tsx`). */
					actionVariant="outline"
					onAction={onClearQuery}
				/>
			</View>
		);

	if (state.kind !== "empty") return null;

	/**
	 * No `+ New conversation`: a room is created from a story with its playback snapshot, so an empty room does
	 * not exist, and adding that button would change the conversation product rule.
	 */
	return (
		<View style={list.center}>
			<EmptyState
				icon="chats"
				title={CHAT_LIBRARY_EMPTY.title}
				description={CHAT_LIBRARY_EMPTY.description}
				actionLabel={CHAT_LIBRARY_EMPTY.action}
				onAction={onDiscover}
			/>
		</View>
	);
}

/** The rule between rows, inside the list's horizontal padding (the web's `divide-y` uses the `ul` width). */
function RoomSeparator() {
	return <Separator />;
}

const list = StyleSheet.create({
	fill: { flex: 1 },
	/** No gap between rows: the web list is divided by rules alone, and a gap would leave the rule floating (`room-row.tsx`). */
	content: { padding: screenPadding },
	center: { paddingTop: space.xl },
	more: { alignItems: "center", paddingTop: space.md },
});
