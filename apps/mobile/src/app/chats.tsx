import { ChatLibraryScreen } from "../features/chat-library/chat-library-screen.tsx";

/**
 * Conversation list: a real destination, not a dialog, sheet, drawer or branch of discovery. It
 * must be addressable because deleting the open room leaves for this address (`chat-screen.tsx`),
 * so does opening a missing room's address, and login returns here.
 *
 * The route file is only a route; the screen belongs to the feature. No parameters: conversation
 * titles are private strings that must not ride deep links, and sort may vanish when leaving the
 * list. Guests are not bounced to login; they first read why the list is unavailable (same as web
 * `/chats`).
 */
export default function ChatsRoute() {
	return <ChatLibraryScreen />;
}
