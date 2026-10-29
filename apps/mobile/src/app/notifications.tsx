import { NotificationsScreen } from "../features/notifications/notifications-screen.tsx";

/**
 * All received notifications: a real destination. It must be addressable because the header bell
 * pushes here, login returns here (`?redirect=/notifications`), and old deep links and history
 * return to this address.
 *
 * The route file is only a route; the screen belongs to the feature. No parameters: the list is one
 * chronological stream, and highlighting a row would tangle with finding it in a cursor list.
 * Guests are not bounced to login; they first read why the inbox is unavailable (same as `/chats`).
 */
export default function NotificationsRoute() {
	return <NotificationsScreen />;
}
