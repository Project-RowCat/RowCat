import {
	NotificationReadAllResponse,
	NotificationReadResponse,
	NotificationsPage,
	NotificationsQuery,
	NotificationUnreadCountDto,
	toNotificationsSearchParams,
} from "@rowcat/contracts";
import type { Notification, NotificationPage } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/** List query input. Axes left out are filled by the contract's defaults. */
export type NotificationsListInput = Partial<NotificationsQuery>;

/**
 * In-app notifications. This is the only place that knows the path is under `/me`.
 *
 * It sits beside `client.me` rather than inside it because lifetimes differ. The viewer (`/me`) is
 * fetched once and kept long, while notifications are paged with a cursor and polled every 60
 * seconds. Merging them would give the viewer resource pagination and write policy too, the same
 * split as comments versus the story resource.
 *
 * No method takes a member id, and the contract has no such field. Ownership comes only from the
 * session, so a request that reads someone else's inbox cannot be built.
 */
export interface NotificationsApi {
	/**
	 * Fetches one page. The first page is called without a cursor. The next page passes the server's
	 * `nextCursor` unchanged.
	 *
	 * The client must not build the cursor. Its shape (a combination of sort keys) belongs to the
	 * server. If the client assembled it, changing the server's sort order would become a client
	 * deployment-ordering problem.
	 */
	list(
		input?: NotificationsListInput,
		options?: RequestOptions,
	): Promise<NotificationPage>;

	/**
	 * The unread count is a query separate from the list.
	 *
	 * Counting in the loaded pages is why this method exists. A client holding only the first 20 rows
	 * and counting from its own cache always gets a number below the real one.
	 */
	unreadCount(options?: RequestOptions): Promise<number>;

	/**
	 * Marks one notification read and returns the confirmed timestamp.
	 *
	 * The server decides ownership: pointing at someone else's notification returns the same 404 as a
	 * missing one. The call is idempotent, so retries do not move the timestamp forward.
	 */
	markRead(notificationId: string, options?: RequestOptions): Promise<string>;

	/**
	 * Marks all read and returns the number of rows actually changed. A second call returns 0, which
	 * is not an error.
	 */
	markAllRead(options?: RequestOptions): Promise<number>;
}

const BASE = "/me/notifications";

export function createNotificationsApi({
	requestJson,
}: RowCatTransport): NotificationsApi {
	return {
		async list(input = {}, options) {
			// Input is also filtered by the contract. The serialization rule (omitting defaults) assumes
			// normalized values.
			const query = NotificationsQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: BASE,
				search: toNotificationsSearchParams(query),
				signal: options?.signal,
			});

			const parsed = NotificationsPage.safeParse(json);
			if (!parsed.success) throw invalidResponse(BASE);
			/**
			 * The contract and the domain shape are currently identical one to one. There is no identity
			 * mapper that copies fields, for the same reason as for stories and comments. If the two
			 * diverge, compilation fails at this return statement.
			 */
			return parsed.data as {
				items: Notification[];
				nextCursor: string | null;
			};
		},

		async unreadCount(options) {
			const json = await requestJson({
				method: "GET",
				path: `${BASE}/unread-count`,
				signal: options?.signal,
			});
			const parsed = NotificationUnreadCountDto.safeParse(json);
			if (!parsed.success) throw invalidResponse(`${BASE}/unread-count`);
			return parsed.data.unread;
		},

		async markRead(notificationId, options) {
			const json = await requestJson({
				method: "PUT",
				// An id containing `/` or `?` breaks the path entirely, so it is encoded before appending.
				path: `${BASE}/${encodeURIComponent(notificationId)}/read`,
				signal: options?.signal,
			});
			const parsed = NotificationReadResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse(`PUT ${BASE}/:id/read`);
			return parsed.data.readAt;
		},

		async markAllRead(options) {
			const json = await requestJson({
				method: "PUT",
				path: `${BASE}/read-all`,
				signal: options?.signal,
			});
			const parsed = NotificationReadAllResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse(`PUT ${BASE}/read-all`);
			return parsed.data.updated;
		},
	};
}
