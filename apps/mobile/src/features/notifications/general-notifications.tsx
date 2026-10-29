import { space } from "@rowcat/design";
import type { Notification } from "@rowcat/domain";
import {
	Button,
	EmptyState,
	Notice,
	Separator,
	Spinner,
	screenPadding,
	Text,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { CREATOR_ROUTE } from "../profile/creator-route.ts";
import {
	canMarkAllRead,
	NOTIFICATIONS_EMPTY,
	NOTIFICATIONS_ERROR,
	NOTIFICATIONS_GUEST,
	NOTIFICATIONS_MARK_ALL_LABEL,
	NOTIFICATIONS_MARK_ALL_READ_FAILED,
	NOTIFICATIONS_MORE_BUSY_LABEL,
	NOTIFICATIONS_MORE_LABEL,
	NOTIFICATIONS_OFFLINE,
	NOTIFICATIONS_RETRY_LABEL,
	NOTIFICATIONS_STALE,
	NOTIFICATIONS_UNAVAILABLE,
	notificationUnreadSummary,
} from "./notification-copy.ts";
import type { NotificationDestination } from "./notification-destination.ts";
import { NotificationRow } from "./notification-row.tsx";
import {
	type NotificationsScreenState,
	resolveNotificationsScreenState,
} from "./notifications-state.ts";
import { useNotifications } from "./use-notifications.ts";

/**
 * The `General` tab: **the inbox exactly as the server owns it.**
 *
 * This component was split out of the screen when the notifications screen gained tabs. **Fetching,
 * cache policy and state resolution are unchanged.** It is one chronological stream with a `Show more`
 * button and a `Mark all read` control; there are no per-kind tabs, read/unread filters, search or
 * deletion. The tab existing here means **another domain sits beside it**, not that the inbox
 * gained an axis.
 *
 * ## This tab does not wait for SQLite
 *
 * Notifications are private server state, so the only thing to wait for is **identity**
 * (`session.phase`). The inbox opens even on devices whose local storage never opens. This is where
 * it diverges from the conversation list.
 *
 * ## One virtualized list is all of this tab
 *
 * The header (unread summary, `Mark all read`, stale notice) and footer (`Show more`) go in as
 * `ListHeaderComponent` and `ListFooterComponent`, staying on the same vertical surface. Putting a
 * `FlatList` inside a `ScrollView` disables virtualization entirely.
 *
 * **It does not auto-expand on `onEndReached`.** Notifications are account history: people need to
 * know how far they have read, and a list that grows each time the bottom is reached never ends.
 */
export function GeneralNotifications() {
	const router = useRouter();
	const { session, retry: retrySession } = useMobileIdentity();
	const authenticated = session.phase === "authenticated";

	const { list, items, unreadCount, markAllRead, activate, retry } =
		useNotifications({ enabled: authenticated });

	const state = resolveNotificationsScreenState(session.phase, {
		isPaused: list.isPaused,
		isError: list.isError,
		isPending: list.isPending,
		hasData: list.data !== undefined,
		itemCount: items.length,
	});

	/** The table from destination kind to actual navigation lives in this function alone. */
	const navigateTo = useCallback(
		(destination: NotificationDestination) => {
			switch (destination.kind) {
				case "creator":
					router.push({
						pathname: CREATOR_ROUTE,
						params: { creatorId: destination.creatorId },
					});
					return;
				case "story":
					router.push({
						pathname: "/stories/[storyId]",
						params: { storyId: destination.storyId },
					});
					return;
				case "account":
					/**
					 * Account screen: the canonical surface for sanctions, appeals and my reports. It carries
					 * neither a section anchor nor a target id (that address vocabulary does not exist in this
					 * product). The rule that navigation does not wait for the read request still applies: this
					 * table knows only "what".
					 */
					router.push("/account");
					return;
			}
		},
		[router],
	);

	/**
	 * The row was pressed. The read is fired by the hook (**not awaited** — `mutate`, not
	 * `mutateAsync`), and navigation happens immediately. A slow read request must not freeze the row.
	 */
	const open = useCallback(
		(notification: Notification) => {
			const { destination } = activate(notification);
			if (destination) navigateTo(destination);
		},
		[activate, navigateTo],
	);

	const renderRow = useCallback(
		({ item }: { item: Notification }) => (
			<NotificationRow notification={item} onActivate={() => open(item)} />
		),
		[open],
	);

	const listing = state.kind === "panel" && state.panel.state === "ready";

	return (
		<FlatList
			data={listing ? items : EMPTY}
			keyExtractor={keyOf}
			renderItem={renderRow}
			/**
			 * **A solid line between rows.** The web's list is `divide-y border-y`.
			 *
			 * ⚠️ This list once had no separators at all, so read rows floated without edges while only
			 * unread rows stood out as rounded cards; the same list read as two shapes. The web has **every
			 * row as the same rectangle**, and signals unread only through the surface's brightness.
			 */
			ItemSeparatorComponent={NotificationSeparator}
			contentContainerStyle={inbox.content}
			ListHeaderComponent={
				state.kind === "panel" ? (
					<InboxHeader
						unreadCount={unreadCount}
						markAllBusy={markAllRead.isPending}
						markAllFailed={markAllRead.isError}
						onMarkAll={() => markAllRead.mutate()}
						stale={state.panel.state === "ready" && state.panel.retryable}
						retrying={list.isFetching}
						onRetry={retry}
					/>
				) : null
			}
			ListEmptyComponent={
				<InboxPlaceholder
					state={state}
					retrying={list.isFetching}
					onRetry={retry}
					onRetrySession={retrySession}
					onSignIn={() =>
						router.push({
							pathname: "/login",
							params: { redirect: "/notifications" },
						})
					}
				/>
			}
			ListFooterComponent={
				listing && list.hasNextPage ? (
					<View style={inbox.more}>
						<Button
							label={
								list.isFetchingNextPage
									? NOTIFICATIONS_MORE_BUSY_LABEL
									: NOTIFICATIONS_MORE_LABEL
							}
							variant="outline"
							disabled={list.isFetchingNextPage}
							onPress={() => void list.fetchNextPage()}
						/>
					</View>
				) : null
			}
		/>
	);
}

/** The entity id is the key. Using position would make rows sit in each other's slots when a new page is appended. */
const keyOf = (notification: Notification) => notification.id;

const EMPTY: Notification[] = [];

/**
 * The header above the list: unread summary, `Mark all read`, and two notices.
 *
 * `Mark all read` is drawn **only when something is unread** (`canMarkAllRead`; an unknown count is not
 * zero, so it is absent then too). A disabled button would not say why it cannot be pressed.
 *
 * The failure notice stays where the button is because this operation is not optimistic: on failure
 * the screen changes nothing, and without a visible notice the button would look like it did
 * nothing. Retry is the button that remains.
 */
function InboxHeader({
	unreadCount,
	markAllBusy,
	markAllFailed,
	onMarkAll,
	stale,
	retrying,
	onRetry,
}: {
	unreadCount: number | null;
	markAllBusy: boolean;
	markAllFailed: boolean;
	onMarkAll: () => void;
	stale: boolean;
	retrying: boolean;
	onRetry: () => void;
}) {
	const summary = notificationUnreadSummary(unreadCount);
	const markAll = canMarkAllRead(unreadCount);
	if (!summary && !markAll && !markAllFailed && !stale) return null;

	return (
		<View style={inbox.head}>
			{summary || markAll ? (
				<View style={inbox.headRow}>
					{summary ? (
						<Text variant="label" tone="muted-foreground" style={inbox.grow}>
							{summary}
						</Text>
					) : (
						<View style={inbox.grow} />
					)}
					{markAll ? (
						<Button
							label={NOTIFICATIONS_MARK_ALL_LABEL}
							variant="outline"
							size="sm"
							busy={markAllBusy}
							onPress={onMarkAll}
						/>
					) : null}
				</View>
			) : null}

			{markAllFailed ? (
				<Notice
					tone="destructive"
					message={NOTIFICATIONS_MARK_ALL_READ_FAILED}
				/>
			) : null}

			{/**
			 * Values are held but the last refresh failed or was interrupted. Instead of erasing the rows,
			 * attach a quiet notice and a retry. The same fact in an empty inbox is drawn by the placeholder.
			 */}
			{stale ? (
				<Notice
					message={NOTIFICATIONS_STALE}
					actionLabel={NOTIFICATIONS_RETRY_LABEL}
					onAction={onRetry}
					busy={retrying}
				/>
			) : null}

			<Separator decorative={false} />
		</View>
	);
}

/**
 * Shown when there are no rows. Each branch states a different fact. The judgment is already made
 * by a pure function (`resolveNotificationsScreenState`); this only turns the value into copy.
 */
function InboxPlaceholder({
	state,
	retrying,
	onRetry,
	onRetrySession,
	onSignIn,
}: {
	state: NotificationsScreenState;
	retrying: boolean;
	onRetry: () => void;
	onRetrySession: () => void;
	onSignIn: () => void;
}) {
	if (state.kind === "booting")
		return (
			<View style={inbox.center}>
				<Spinner />
			</View>
		);

	/** Guests are not bounced to login; they first read why the inbox cannot be viewed. */
	if (state.kind === "guest")
		return (
			<View style={inbox.center}>
				<EmptyState
					icon="notifications"
					title={NOTIFICATIONS_GUEST.title}
					description={NOTIFICATIONS_GUEST.description}
					actionLabel={NOTIFICATIONS_GUEST.action}
					onAction={onSignIn}
				/>
			</View>
		);

	/** **Not a sign-out.** Asking again is the only thing to do here. */
	if (state.kind === "unavailable")
		return (
			<View style={inbox.center}>
				<Notice
					message={NOTIFICATIONS_UNAVAILABLE}
					actionLabel={NOTIFICATIONS_RETRY_LABEL}
					onAction={onRetrySession}
				/>
			</View>
		);

	const { panel } = state;

	if (panel.state === "loading")
		return (
			<View style={inbox.center}>
				<Spinner />
			</View>
		);

	/** Pause is not a failure: say that waiting resumes, and offer only the way to retry. */
	if (panel.state === "offline")
		return (
			<View style={inbox.center}>
				<Notice
					message={NOTIFICATIONS_OFFLINE}
					actionLabel={NOTIFICATIONS_RETRY_LABEL}
					onAction={onRetry}
					busy={retrying}
				/>
			</View>
		);

	if (panel.state === "error")
		return (
			<View style={inbox.center}>
				<Notice
					tone="destructive"
					message={NOTIFICATIONS_ERROR}
					actionLabel={NOTIFICATIONS_RETRY_LABEL}
					onAction={onRetry}
					busy={retrying}
				/>
			</View>
		);

	if (panel.state !== "empty") return null;

	/**
	 * **The empty list is also a held value.** If the refresh after the server reported zero failed,
	 * that zero is still a confirmed value but may not be current. That is exactly the same fact as a
	 * failure with rows, so it gets the same notice. Do not stage a large illustration in the empty
	 * state; one line is enough.
	 */
	return (
		<View style={inbox.center}>
			{panel.retryable ? (
				<Notice
					message={NOTIFICATIONS_STALE}
					actionLabel={NOTIFICATIONS_RETRY_LABEL}
					onAction={onRetry}
					busy={retrying}
				/>
			) : null}
			<Text variant="label" tone="muted-foreground" style={inbox.empty}>
				{NOTIFICATIONS_EMPTY}
			</Text>
		</View>
	);
}

/**
 * The solid line between rows sits **inside the list's horizontal padding** (the web's `divide-y`
 * uses the `ul`'s width). Rows do not carry their own border because of the last row: it would add
 * an extra line at the end of the list, or leave the first row looking empty above.
 */
function NotificationSeparator() {
	return <Separator />;
}

const inbox = StyleSheet.create({
	content: { paddingBottom: space.xl, paddingHorizontal: screenPadding },
	head: { gap: space.md, paddingBottom: space.md },
	headRow: { alignItems: "center", flexDirection: "row", gap: space.sm },
	grow: { flex: 1, minWidth: 0 },
	center: { gap: space.md, paddingTop: space.xl },
	empty: { paddingVertical: space.xl, textAlign: "center" },
	more: { alignItems: "center", paddingTop: space.md },
});
