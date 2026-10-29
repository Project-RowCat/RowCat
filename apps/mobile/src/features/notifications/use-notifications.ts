import type { Notification } from "@rowcat/domain";
import {
	notifications as flatten,
	markAllNotificationsReadMutationOptions,
	markNotificationReadMutationOptions,
	NOTIFICATIONS_LIST_QUERY_KEY,
	notificationsInfiniteQueryOptions,
	notificationUnreadCountQueryOptions,
	refreshNotifications,
} from "@rowcat/query";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import {
	type NotificationActivationPlan,
	notificationActivationPlan,
} from "./notification-destination.ts";

/**
 * Wiring for the notification surfaces. The full list (`/notifications`) and the bell read the same
 * cache cells.
 *
 * This file holds only the composition of queries and mutations. How the cache changes (the
 * optimistic read, the non-optimistic read-all, the unread-count floor, rollback) lives in
 * `@rowcat/query`, and the web calls the same functions. If `setQueryData` were written here, the
 * same notification would update under different rules on the two apps, and that difference only
 * shows when the two screens are compared side by side.
 *
 * ## `enabled` is the identity gate
 *
 * Notifications are server-owned private state, so no request is sent before the member is
 * confirmed. A guest or unconfirmed request returns 401, which would show "failed to load" and hide
 * the fact that login is needed.
 */
export function useNotifications({ enabled }: { enabled: boolean }) {
	const client = getRowCatClient();
	const queryClient = useQueryClient();

	const list = useInfiniteQuery({
		...notificationsInfiniteQueryOptions(client),
		enabled,
	});

	/**
	 * The unread count is not derived from the list. A client holding only the first 20 rows would
	 * always count low. The interval (60s) and freshness come from the shared options, so no
	 * `refetchInterval` is repeated here.
	 */
	const unread = useQuery({
		...notificationUnreadCountQueryOptions(client),
		enabled,
	});

	const read = useMutation(
		markNotificationReadMutationOptions(client, queryClient),
	);
	/**
	 * `mark all read`. Not optimistic, per the shared policy. The screen draws any failure: this app
	 * has no toast system, and this one action does not justify adding one, so the inline notice is
	 * the place for it.
	 */
	const markAllRead = useMutation(
		markAllNotificationsReadMutationOptions(client, queryClient),
	);

	/**
	 * A row was pressed. **It does not wait for the read request.**
	 *
	 * The decision is a pure function (`notificationActivationPlan`), and here the plan is simply
	 * sent. `mutate` (fire and forget) is required: navigation must happen right after this call. A
	 * failure is handled by the shared policy, which rolls back the optimistic value. The user asked
	 * to navigate, and that succeeded, so no failure notice is layered onto the destination screen.
	 */
	const activate = useCallback(
		(notification: Notification): NotificationActivationPlan => {
			const plan = notificationActivationPlan(notification);
			if (plan.markReadId) read.mutate(plan.markReadId);
			return plan;
		},
		[read],
	);

	/**
	 * `retry`. **On a paused query, `refetch()` creates no request.**
	 *
	 * With no data, the query is restarted from scratch, discarding the paused retryer. With data, a
	 * plain refetch is enough: that path works, and `resetQueries` would also clear the rows already
	 * on screen. The web wires this in `panel-retry.ts`, which touches `navigator.onLine` in the
	 * browser, so it is not ported.
	 */
	const retry = useCallback(() => {
		if (list.data === undefined) {
			void queryClient.resetQueries({ queryKey: NOTIFICATIONS_LIST_QUERY_KEY });
			return;
		}
		void list.refetch();
	}, [list.data, list.refetch, queryClient]);

	/** Refresh stale values when the surface opens. This is not a read. */
	const refresh = useCallback(
		() => void refreshNotifications(queryClient),
		[queryClient],
	);

	return {
		list,
		items: list.data ? flatten(list.data) : [],
		/**
		 * `null` until known, and **not 0**. Folding the two would present "no unread" as a fact before
		 * the query finishes, and then reverse it the moment the value arrives.
		 */
		unreadCount: unread.data ?? null,
		markAllRead,
		activate,
		retry,
		refresh,
	};
}
