import { isUnread, type Notification } from "@rowcat/domain";
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
import { getRowCatClient } from "#/lib/api.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { notificationsMarkAllReadFailed } from "./notification-copy.ts";

/**
 * Wiring shared by both notification surfaces: the header popover and `/notifications`.
 *
 * Only the composition of queries and mutations lives here. How the cache changes is owned by
 * `@rowcat/query`, a policy the web app and the later Expo app share. This file keeps only what the
 * screen subscribes to and what clicks call.
 *
 * The key point is that both surfaces read the same cache entry. Marking a notification read in the
 * popover updates an open list page too, and the reverse holds. Separate queries would show the
 * same notification in different states on two screens.
 */
export function useNotifications(options: { enabled?: boolean } = {}) {
	const client = getRowCatClient();
	const queryClient = useQueryClient();

	const list = useInfiniteQuery({
		...notificationsInfiniteQueryOptions(client),
		/**
		 * The popover fetches the list only while open. If a closed bell caused every screen to fetch
		 * twenty rows, the app's rule that quiet screens make no requests would break in the header. The
		 * full page calls this without the option.
		 */
		enabled: options.enabled ?? true,
	});

	const unread = useQuery(notificationUnreadCountQueryOptions(client));

	const read = useMutation(
		markNotificationReadMutationOptions(client, queryClient),
	);
	/**
	 * `Mark all read` reports its failure here.
	 *
	 * Both surfaces draw the same button. If the wiring lived on each screen, only one would get
	 * fixed, and the mismatch would show only when a failure actually happens. The wiring stays out of
	 * the policy layer (`@rowcat/query`) on purpose: that package is used as-is by the later Expo app,
	 * while a toast is this app's surface.
	 */
	const readAll = useMutation({
		...markAllNotificationsReadMutationOptions(client, queryClient),
		onError: () => showErrorToast(notificationsMarkAllReadFailed()),
	});

	/**
	 * Pressing a row sends a request only for an unread row. Pressing an already read notification
	 * again would succeed idempotently, but it changes nothing and would add a request for every press
	 * while scanning the list.
	 *
	 * The mutation is fired with `void` and not awaited. Router navigation must happen right after
	 * this call. On failure, the optimistic value is reverted and no toast is shown. The action the
	 * user requested was navigation, and that succeeded.
	 */
	const activate = useCallback(
		(notification: Notification) => {
			if (isUnread(notification)) read.mutate(notification.id);
		},
		[read],
	);

	/**
	 * Retry is not `list.refetch()`.
	 *
	 * A query paused offline (`fetchStatus` is `paused`) still has an unfinished retry scheduler
	 * attached, so `refetch()` cannot resume it. Both surfaces did exactly that when they wrote it
	 * separately, and a button that does nothing looks broken. The rule lives in one place:
	 * `lib/query/panel-retry.ts`.
	 */
	const retry = usePanelRetry(NOTIFICATIONS_LIST_QUERY_KEY, list);

	return {
		list,
		retry,
		items: list.data ? flatten(list.data) : [],
		/**
		 * Stays `null` until known, not zero. Collapsing the two would draw "no unread" as settled fact
		 * before the query finishes, and a badge would pop in when the value arrives. While `null`, the
		 * bell is drawn without a badge.
		 */
		unreadCount: unread.data ?? null,
		unreadQuery: unread,
		markAllRead: readAll,
		activate,
		/** Fetches a fresh value when the surface opens. This is not a mark-as-read action. */
		refresh: useCallback(
			() => void refreshNotifications(queryClient),
			[queryClient],
		),
	};
}
