import { AccountScreen } from "../features/account/account-screen.tsx";

/**
 * Account: a real destination, not a dialog, sheet or drawer entry. It must be addressable because
 * the header's account menu pushes here, login returns here (`?redirect=/account`), and four
 * moderation notifications point at it (`features/notifications/notification-destination.ts`).
 *
 * The route file is only a route; the screen belongs to the feature. No parameters: section deep
 * links belong to the slice that builds those screens. Guests are not bounced to login; they first
 * read why the account is unavailable (same as `/chats` and `/notifications`).
 */
export default function AccountRoute() {
	return <AccountScreen />;
}
