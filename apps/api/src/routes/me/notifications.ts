import {
	type NotificationReadAllResponse,
	type NotificationReadResponse,
	type NotificationsPage,
	NotificationsQuery,
	type NotificationUnreadCountDto,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { invalidInput, notFound } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { readLimit } from "../../lib/http.ts";
import { getViewer } from "../../middleware/viewer.ts";
import {
	countUnreadNotifications,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
} from "../../services/notifications.ts";

/**
 * In-app notifications: `/v2/me/notifications/*`.
 *
 * - Ownership comes only from the session. No path, query, body or header names a target member,
 *   and the contract schema has no such field.
 * - Someone else's notification gets the same 404 as a nonexistent one: the service's UPDATE
 *   predicate pins the recipient and updates 0 rows. A 403 would reveal that the notification
 *   exists.
 * - All four routes are `requireViewer`, not `requireActiveViewer`. A suspended or blocked
 *   member's inbox holds why they were sanctioned and how their appeal went. Marking read is a
 *   write, but it is private state of the member's own inbox and shows nothing to others, unlike
 *   commenting.
 * - Everything is `no-store`, stronger than the `private, no-cache` of moderation state and
 *   comments, because the list spells out the person's social relations and sanction history and
 *   has no reason to hit disk or revive on back navigation.
 */

/** Query string to contract; `z.coerce` is avoided for the same reason as in the comments route. */
function parseQuery(url: string) {
	const sp = new URL(url).searchParams;
	const limit = readLimit(sp);
	return NotificationsQuery.safeParse({
		cursor: sp.get("cursor") ?? undefined,
		limit,
	});
}

export const notifications = new Hono<AppEnv>()
	/** One page of the inbox, newest first, continued by cursor. An empty inbox is a normal response (empty array), not a 404. */
	.get("/", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const parsed = parseQuery(c.req.url);
		if (!parsed.success) throw invalidInput(parsed.error);

		const body: NotificationsPage = await listNotifications({
			recipientId: viewer.id,
			cursor: parsed.data.cursor,
			limit: parsed.data.limit,
		});
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Unread count, a separate resource from the list. The header asks every 60 seconds, so its
	 * lifetime differs from the list's. A total on the list response would force fetching twenty rows
	 * to refresh it, and would invite a client holding only page one to count in its own cache, which
	 * is always too low.
	 */
	.get("/unread-count", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: NotificationUnreadCountDto = {
			unread: await countUnreadNotifications(viewer.id),
		};
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Mark everything read. Declared before `/:notificationId/read` because Hono matches in
	 * registration order, and after it `read-all` would be captured as a notification id and 404.
	 *
	 * The server owns the cutoff: the request has no "until" slot, so a notification arriving at the
	 * same moment stays unread. A client-supplied cutoff would let a skewed clock mark unseen
	 * notifications read.
	 */
	.put("/read-all", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const body: NotificationReadAllResponse = {
			updated: await markAllNotificationsRead(viewer.id),
		};
		c.header("Cache-Control", "no-store");
		return c.json(body);
	})

	/**
	 * Mark one read; idempotent. An already-read row also succeeds and keeps its first read time;
	 * making the second call a conflict would turn retries into errors, and restamping would quietly
	 * move a value unrelated to list ordering. There is no body because V1 has no "mark unread".
	 */
	.put("/:notificationId/read", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		const readAt = await markNotificationRead(
			viewer.id,
			c.req.param("notificationId"),
		);
		/** Someone else's and a nonexistent notification give the same response; distinguishing them would be an existence probe. */
		if (!readAt) throw notFound("Notification not found.");

		const body: NotificationReadResponse = { readAt: readAt.toISOString() };
		c.header("Cache-Control", "no-store");
		return c.json(body);
	});
