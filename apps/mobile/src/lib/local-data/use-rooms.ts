import type { ChatRoom, ChatStore } from "@rowcat/chat";
import { useMemo } from "react";
import { type LocalLive, useLocalLive } from "./live.ts";
import { useChatScope } from "./scope.tsx";

/**
 * Subscribes to **every live conversation** of this account and device. This app's single place
 * that reads them.
 *
 * ## Why there must be one hook
 *
 * This query takes **all** the conversation titles of the account. With two call sites, one would
 * apply the scope check and the other would forget the subscription, and the forgetful one goes
 * stale silently: the sidebar keeps drawing a room that was deleted, or a name changed on another
 * device shows up only in the list.
 *
 * There are two consumers now, and they **ask different things**:
 *
 * ```text
 * conversation list (/chats)     find, sort, manage        features/chat-library/use-room-library.ts
 * recent conversations (drawer)  return to the last few    features/shell/use-recent-rooms.ts
 * ```
 *
 * The only difference between them is **the rule that picks which rows to draw**, and both rules
 * live in pure packages (`roomLibraryView` and `recentSidebarRooms` in `@rowcat/chat`; the web
 * calls the same functions). What remains here is subscribing to one store.
 *
 * ## No server
 *
 * There is no room-list endpoint, none will be added, and no copy is kept in the query cache. The
 * local truth for records is this device's SQLite alone (see the header of `lib/query.ts`). The
 * subscription's signal is the write signal the assembly point already attached (`live.ts`), so
 * there is no "read again after writing" here. Such code would reflect only its own writes, so a
 * rename on another screen or a remote delete applied by sync would not appear. The same signal
 * wakes automatic sync, so screens have no reason to call `syncNow()`.
 *
 * ## It reads no messages
 *
 * The only store operation called is `listRooms()`. Drawing previews would attach a message lookup
 * to every row (N+1), and more importantly, once the list starts reading conversation content, what
 * is visible over the shoulder becomes the conversation rather than its title.
 */

export interface LocalRooms extends LocalLive<ChatRoom[]> {
	/**
	 * The owner of this list is the store **instance**, not the member id.
	 *
	 * Consumers attach their own state to this value, so it travels with the data (the reveal sheet of
	 * the conversation list does this). Comparing member ids would make `Alice → sign out → Alice` the
	 * same value, and a list from a newly opened scope would inherit the previous session's state.
	 */
	store: ChatStore | null;
}

export function useLocalRooms(): LocalRooms {
	const { store } = useChatScope();

	/**
	 * Memoizes the read function. A new function per render would make the subscription re-read on
	 * every render, and that result would change state and render again (`live.ts` records this rule).
	 */
	const load = useMemo(() => (store ? () => store.listRooms() : null), [store]);
	const live = useLocalLive<ChatRoom[]>(load, EMPTY);

	return useMemo(() => ({ ...live, store }), [live, store]);
}

/** A stable empty array: a new array per render would make consumers redraw every time. */
const EMPTY: ChatRoom[] = [];
