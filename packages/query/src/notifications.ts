import type { Notification, NotificationPage } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	type InfiniteData,
	infiniteQueryOptions,
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * Server state for in-app notifications: query keys, appended pages, and the read-mark cache
 * policy.
 *
 * Notifications are server-owned private state, and this file depends on that. Conversations and
 * drafts use IndexedDB as the source of truth and stay out of Query. Notifications are the
 * opposite: if read state diverged per device, a notification read on a Mac would turn new again on
 * a phone, and the state would never heal by itself.
 *
 * Two queries are split:
 * - list: paged by cursor; needed only while the list screen is open
 * - unread count: always drawn by the header; polled periodically
 *
 * The badge is not derived from the list (§156). The client may hold only the first 20 rows, and a
 * count computed from them is always lower than the real one, so the count has its own endpoint.
 *
 * Everything sits under `["viewer", ...]`. Logout and login cleanup already own that prefix
 * (`viewer.ts`). A separate cleanup for notifications would create a second logout path, and one
 * would eventually be fixed while the other is not. The symptom would be Alice's notifications on
 * Bob's screen.
 */

export const NOTIFICATIONS_QUERY_KEY_PREFIX = [
	"viewer",
	"notifications",
] as const;

/**
 * The cursor is not in the key. The next page is a slice of the same query, not a different query
 * (same reason as the gallery and comments).
 */
export const NOTIFICATIONS_LIST_QUERY_KEY = [
	...NOTIFICATIONS_QUERY_KEY_PREFIX,
	"list",
] as const;

export const NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY = [
	...NOTIFICATIONS_QUERY_KEY_PREFIX,
	"unread-count",
] as const;

/** Cache shape of the appended notifications. Read-mark updates also operate on this type. */
export type NotificationsInfiniteData = InfiniteData<NotificationPage, string>;

/**
 * Inbox, paged by cursor. `initialPageParam` is an empty string because the contract's 'no cursor'
 * means the first page. The next page passes the server's `nextCursor` through unchanged.
 *
 * staleTime is short (30 seconds). The inbox keeps growing while it is open, and read marks can
 * change on other devices. With a long staleTime, like the gallery uses, a notification read on a
 * phone would stay unread on the desktop for a long time.
 */
export function notificationsInfiniteQueryOptions(client: RowCatClient) {
	return infiniteQueryOptions<
		NotificationPage,
		Error,
		NotificationsInfiniteData,
		readonly unknown[],
		string
	>({
		queryKey: NOTIFICATIONS_LIST_QUERY_KEY,
		// Pass the signal through so a query abandoned by leaving the screen also stops on the network.
		queryFn: ({ pageParam, signal }) =>
			client.notifications.list({ cursor: pageParam }, { signal }),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Flattens accumulated pages into the single list the screen draws. Not written per screen, because
 * this is knowledge tied to the query shape. The header popover and the full list read the same
 * cache, so if `pages` ever splits, there should be one place to fix.
 */
export const notifications = (
	data: NotificationsInfiniteData,
): Notification[] => data.pages.flatMap((page) => page.items);

/**
 * Unread count: what the header always displays.
 *
 * `refetchInterval` is all the realtime this slice has (§79, §81). There is no SSE or WebSocket.
 * Reducing notification latency is a separate problem from the durable inbox, and 60 seconds is
 * fast enough to know whether anything happened on the account.
 *
 * It does not poll in hidden tabs (`refetchIntervalInBackground` defaults to false). Dozens of
 * background tabs polling every 60 seconds would break this repo's promise that a quiet app makes
 * no requests.
 *
 * staleTime is shorter than the interval. Window focus and popover opening must re-ask in between.
 * If staleness equaled the interval, those two signals would do nothing.
 */
export function notificationUnreadCountQueryOptions(client: RowCatClient) {
	return queryOptions<number>({
		queryKey: NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY,
		queryFn: ({ signal }) => client.notifications.unreadCount({ signal }),
		staleTime: 30_000,
		refetchInterval: 60_000,
		retry: retryUnlessClientError,
	});
}

/** Patches the unread count. The floor is 0 (§84). */
function patchUnreadCount(
	queryClient: QueryClient,
	next: (current: number) => number,
): void {
	queryClient.setQueryData<number>(
		NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY,
		(current) =>
			/**
			 * Does not create a missing slot. `setQueryData` creates an entry even with no observers, and a
			 * value born that way would look present when the server was never asked for it. The header
			 * would then defer its own fetch from that moment on (same rule as profile and personalization).
			 */
			current === undefined ? current : Math.max(0, next(current)),
	);
}

function patchNotification(
	queryClient: QueryClient,
	notificationId: string,
	patch: (notification: Notification) => Notification,
): void {
	queryClient.setQueryData<NotificationsInfiniteData>(
		NOTIFICATIONS_LIST_QUERY_KEY,
		(data) =>
			data && {
				...data,
				pages: data.pages.map((page) =>
					page.items.some((item) => item.id === notificationId)
						? {
								...page,
								items: page.items.map((item) =>
									item.id === notificationId ? patch(item) : item,
								),
							}
						: page,
				),
			},
	);
}

/** Rollback data: only the previous values of the slots this mutation directly changes. */
interface ReadSnapshot {
	/**
	 * Previous `readAt`. `undefined` means the row was not in the cache, so there is nothing to roll
	 * back.
	 */
	previousReadAt: string | null | undefined;
	/** Whether this call actually lowered the count. False when the row was already read. */
	decremented: boolean;
}

/**
 * Mark one notification read, drawn **optimistically**.
 *
 * Rollback is deterministic and safe. Only the row's `readAt` and the count change, and both are
 * values this mutation raises and lowers itself (same reasoning as follow).
 *
 * Optimistic because of navigation (§109). Pressing a notification marks the row read and the
 * screen moves to its destination at once. Waiting for the request before moving would make the
 * click look dead on a slow network. If the request fails, navigation has already happened and the
 * unread state returns. The next press on that row cleans it up (§110).
 *
 * Requests are queued per `scope`, per notification. Overlapping requests for one notification
 * would be idempotent, but if responses return out of order, a late older response would roll the
 * cache back.
 */
export function markNotificationReadMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<string, Error, string, ReadSnapshot>({
		scope: { id: "notification-read" },
		mutationFn: (notificationId) =>
			client.notifications.markRead(notificationId),

		async onMutate(notificationId) {
			// Cancel in-flight queries first so they cannot overwrite the optimistic value.
			await queryClient.cancelQueries({
				queryKey: NOTIFICATIONS_QUERY_KEY_PREFIX,
			});

			const cached = queryClient
				.getQueryData<NotificationsInfiniteData>(NOTIFICATIONS_LIST_QUERY_KEY)
				?.pages.flatMap((page) => page.items)
				.find((item) => item.id === notificationId);
			const previousReadAt = cached?.readAt;

			/**
			 * Decrement only if the row was unread. Re-pressing an already read notification leaves the
			 * server count unchanged, and removing it on screen would make the badge wrong until the next
			 * poll restores it.
			 *
			 * If the row is not in the cache (the popover was opened but the list was not loaded), do not
			 * decrement. Its readness is unknown, and if it was already read, the error would persist until
			 * the next fetch.
			 */
			const decremented = previousReadAt === null;
			if (decremented) patchUnreadCount(queryClient, (n) => n - 1);
			/**
			 * The server time is not known yet, so draw now. `onSuccess` overwrites it with the confirmed
			 * value.
			 */
			if (previousReadAt !== undefined)
				patchNotification(queryClient, notificationId, (item) => ({
					...item,
					readAt: new Date().toISOString(),
				}));

			return { previousReadAt, decremented };
		},

		/**
		 * The server is authoritative. Overwrite with the confirmed timestamp so no invented value
		 * remains.
		 */
		onSuccess(readAt, notificationId) {
			patchNotification(queryClient, notificationId, (item) => ({
				...item,
				readAt,
			}));
		},

		/**
		 * Rollback restores only that row and the count, in place on the **current** cache. The old page
		 * array is not written back whole, same as follow. That would also revert new notifications that
		 * arrived in the meantime.
		 */
		onError(_error, notificationId, snapshot) {
			if (!snapshot) return;
			if (snapshot.decremented) patchUnreadCount(queryClient, (n) => n + 1);
			if (snapshot.previousReadAt !== undefined)
				patchNotification(queryClient, notificationId, (item) => ({
					...item,
					readAt: snapshot.previousReadAt ?? null,
				}));
		},
	});
}

/**
 * Mark all read, painted **only after confirmation**.
 *
 * Not optimistic because rollback is not deterministic. A failure would need a record of which rows
 * were originally unread, and new notifications or `Show more` pages may have arrived meanwhile.
 * Restoring an old snapshot would revert those changes too (the same judgement as block, which is
 * not optimistic either).
 *
 * After success, the **already accumulated pages are patched in place** (§86). Invalidation alone
 * would refetch every loaded page, though only each row's `readAt` changed, so that round trip is
 * wasted.
 *
 * The count is set to **0**, not decremented by `updated`. The server counted within the bounds of
 * its UPDATE. A notification arriving at the same moment falls outside those bounds and stays
 * unread; the next poll raises the count to 1. Subtracting `updated` would count that notification
 * twice (§87).
 */
export function markAllNotificationsReadMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<number, Error, void>({
		scope: { id: "notification-read" },
		mutationFn: () => client.notifications.markAllRead(),

		onSuccess() {
			queryClient.setQueryData<number>(
				NOTIFICATIONS_UNREAD_COUNT_QUERY_KEY,
				(current) => (current === undefined ? current : 0),
			);
			const now = new Date().toISOString();
			queryClient.setQueryData<NotificationsInfiniteData>(
				NOTIFICATIONS_LIST_QUERY_KEY,
				(data) =>
					data && {
						...data,
						pages: data.pages.map((page) => ({
							...page,
							/**
							 * Rows already read keep their timestamp. Do not touch them. The server did the same (it
							 * changed only rows where `read_at is null`), and overwriting everything with now would make
							 * yesterday's read notifications look just read.
							 */
							items: page.items.map((item) =>
								item.readAt === null ? { ...item, readAt: now } : item,
							),
						})),
					},
			);
		},
	});
}

/**
 * Refresh on screen open. Shared by the popover and the full list.
 *
 * Invalidating the prefix marks the list and count stale together, and only queries on screen
 * refetch right away (`refetchType` defaults to "active"). The sole purpose is that opening the
 * bell does not show a snapshot from a minute ago (§82).
 *
 * **This is not a read action.** Opening and reading are different operations. If opening alone
 * cleared unread state, users would lose it just by glancing (§99).
 */
export function refreshNotifications(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({
		queryKey: NOTIFICATIONS_QUERY_KEY_PREFIX,
	});
}
