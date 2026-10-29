import { PushMessagePayload } from "@rowcat/contracts";

/**
 * Pure rules that turn a received push into app actions.
 *
 * No second destination table. The notification-to-screen mapping already lives in one place
 * (`features/notifications/notification-destination.ts`). A push copy would send the same event to
 * different screens depending on where it was tapped, and that drift appears silently when a kind
 * is added.
 *
 * So V1 opens the inbox. The inbox re-fetches the authoritative list, and tapping a row goes
 * through the existing activation path, which handles read state and destination. That path stays
 * the only place this app interprets a `Notification`.
 *
 * The payload is not authorization. A notification id in it does not grant access; it only triggers
 * a re-query of the inbox, and the current session decides what is visible. That is why an old push
 * arriving after an account switch cannot open the previous person's notification.
 *
 * The payload has no `href` or route name, and the code does not read one if present. Navigation
 * belongs to the app; the contract has no slot for it.
 */

/**
 * Where a tap goes. Only one destination.
 *
 * A constant on purpose: any branch here would become a second destination table.
 */
export const PUSH_TAP_ROUTE = "/notifications" as const;

export interface PushResponsePlan {
	route: typeof PUSH_TAP_ROUTE;
	/**
	 * Which notification it was. Not used for navigation now: this value is the reason to re-query the
	 * inbox, but the destination is the same screen regardless.
	 *
	 * A malformed payload (old version or another app) yields `null`; navigation is unchanged.
	 */
	notificationId: string | null;
}

/** Whether the received data is our payload. Null otherwise. */
export function parsePushPayload(
	data: unknown,
): { notificationId: string } | null {
	const parsed = PushMessagePayload.safeParse(data);
	return parsed.success ? { notificationId: parsed.data.notificationId } : null;
}

/**
 * Tap to action.
 *
 * A malformed payload still goes to the inbox. The worst outcome is nothing happening for someone
 * who tapped our banner, and the inbox is the right destination in every case: the row is there
 * whatever they tapped.
 */
export function pushResponsePlan(data: unknown): PushResponsePlan {
	return {
		route: PUSH_TAP_ROUTE,
		notificationId: parsePushPayload(data)?.notificationId ?? null,
	};
}

/**
 * Foreground receipt to action.
 *
 * Does not fabricate a notification row. Splicing the payload into the cache would require
 * inventing time, actor and read state, putting values the server never created into the inbox. The
 * only output here is a signal to ask again.
 */
export function pushReceiptShouldRefreshInbox(data: unknown): boolean {
	return parsePushPayload(data) !== null;
}
