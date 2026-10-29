/**
 * Chooses the recent-conversation rows of the global shell. It is a single boundary rule.
 *
 * - Lives in the pure package because the web sidebar (and its narrow-screen drawer) and the
 *   mobile navigation drawer are the same product; only the container differs (list vs View, hover
 *   vs press). Per-app rules would drift silently, for example one app showing 20 rows or one
 *   dropping the open room outside the window.
 * - The sidebar is a transitional surface, not a list screen. Cutting the list is cheaper than
 *   virtual scrolling, which would add a second scroll owner competing with the chat's virtual
 *   list.
 * - The open room is kept even when it is outside the window. Activity time moves only when
 *   messages are sent, so an old conversation opened by address is normally outside the window;
 *   dropping it would leave no row showing where the user is.
 * - Order is not sorted here. Storage's order (most recent activity, see `listRooms`) is the
 *   contract, and re-sorting in the sidebar would let it disagree with the room list.
 * - No copy, styling or navigation lives here. Labels such as `Recent chats` and `All chats` belong to each
 *   app, since Korean copy in a pure package would bind the rules to one locale.
 * - Drafts are not covered, because the sidebar has no recent-drafts section.
 */

/**
 * The maximum number of rows shown at once. On a 720px-tall window, after the brand, global
 * navigation, section label, the `All chats` row and padding are subtracted, about 486px remain. A
 * one-line row is 32px, so ten rows fit without scrolling; more would cut off the first screen.
 * Mobile being scrollable does not justify a larger number. The cap follows the nature of the
 * surface (a transitional list, not a list screen), and anyone who needs more should go to the full
 * conversation list at `/chats`. Do not raise this until the sidebar becomes a list screen.
 */
export const SIDEBAR_RECENT_CHAT_LIMIT = 10;

/**
 * Returns the most recent N rooms plus the currently open room. If the open room is outside the
 * window, it is appended at the end. Inserting it in the middle would make 'most recent first'
 * false, and putting it first would reshuffle the whole list on every navigation. At the end, the
 * position matches what happened: it was pulled in as an exception.
 */
export function recentSidebarRooms<T extends { id: string }>(
	rooms: readonly T[],
	activeRoomId: string | null,
	limit: number = SIDEBAR_RECENT_CHAT_LIMIT,
): T[] {
	const window = rooms.slice(0, Math.max(0, limit));
	if (!activeRoomId || window.some((room) => room.id === activeRoomId))
		return window;

	const active = rooms.find((room) => room.id === activeRoomId);
	// If the active room is not in the list at all (deleted, or another account's address), it is left
	// out rather than invented. The canvas's 'not found' state reports that.
	return active ? [...window, active] : window;
}
