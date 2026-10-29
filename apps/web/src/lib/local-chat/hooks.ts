import {
	CHAT_MESSAGE_PAGE_SIZE,
	type ChatCharacter,
	type ChatMemory,
	type ChatMessage,
	type ChatPersona,
	type ChatRoom,
} from "@rowcat/chat";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useState } from "react";
import { useChatScope } from "./scope.ts";

/**
 * Hook that subscribes to local data.
 *
 * TanStack Query is deliberately not used in this file. That library is a cache for remote server
 * state, but the values here are the source itself, not a cache. Wrapping them in `useQuery` would
 * create two sources of truth: one copy in IndexedDB and one in the query cache. Every database
 * change would then require manually invalidating the cache, and missing that invalidation in a
 * single place would make the screen draw a stale conversation.
 *
 * `liveQuery` listens to IndexedDB changes directly. So when a message written to the database
 * later arrives through sync, the conversation updates without any separate code to notify the
 * screen. That is the reason for this choice.
 */

export type LocalRoomState =
	| { status: "loading"; room: null }
	| { status: "missing"; room: null }
	| { status: "ready"; room: ChatRoom };

/**
 * Subscribes to one room.
 *
 * It returns `loading`, not `missing`, while the scope is still opening. Merging the two would
 * flash `Conversation not found` for the few dozen milliseconds the database takes to open right after
 * login.
 *
 * That rule applies only to scopes that can open. `unavailable` means a guest (see `scope.tsx`),
 * and a guest has no database to open at all. Folding that into `loading` would never end the wait:
 * a logged-out visitor who opens a conversation link, or a user whose session dropped, would keep
 * seeing a placeholder and `Loading the conversation`. A wait that never ends is worse than an error, because
 * the screen never says what to do.
 *
 * So guests get `missing`. The empty-state copy already describes exactly this case: `This conversation isn't in
 * this device's current account. If you started it in another account, sign in with that account.` The flashing concern does not return: when
 * membership is confirmed but the scope is still opening, the state is `activating`, not
 * `unavailable`, and that state stays `loading`.
 */
export function useLocalRoom(roomId: string): LocalRoomState {
	const { store, status } = useChatScope();
	const room = useLiveQuery(
		() => (store ? store.getRoom(roomId) : Promise.resolve(undefined)),
		[store, roomId],
	);

	if (status === "unavailable") return { status: "missing", room: null };
	if (status !== "ready") return { status: "loading", room: null };
	// liveQuery returns undefined until the first result arrives. That is distinct from null (not
	// found).
	if (room === undefined) return { status: "loading", room: null };
	if (room === null) return { status: "missing", room: null };
	return { status: "ready", room };
}

export interface LocalListState<T> {
	items: T[];
	/**
	 * Whether the first result has not arrived yet. This differs from an empty list (`items.length ===
	 * 0`).
	 */
	loading: boolean;
}

/**
 * The account's room list, most recent activity first. Deleted rooms are not returned (a storage
 * contract).
 *
 * There must be one subscription. The sidebar calls this hook once and every row shares its result.
 * A `liveQuery` per row would turn a list of ten rooms into ten IndexedDB subscriptions, and those
 * subscriptions stay alive on the app shell across every screen.
 *
 * Trimming is not done here. The store answers 'this account's rooms', and how many rows to draw is
 * the screen's decision (`sidebar-rooms.ts` in `@rowcat/chat`).
 */
export function useLocalRooms(): LocalListState<ChatRoom> {
	const { store, status } = useChatScope();
	const items = useLiveQuery(
		() => (store ? store.listRooms() : Promise.resolve(undefined)),
		[store],
	);
	return {
		items: items ?? [],
		loading: status !== "ready" || items === undefined,
	};
}

export interface LocalMessagesState {
	messages: ChatMessage[];
	/**
	 * The first page has not arrived yet. This differs from an empty conversation (`messages.length
	 * === 0`).
	 */
	loading: boolean;
	/** Whether there is actually more history above to load. */
	hasMore: boolean;
	loadOlder: () => void;
	/**
	 * Widens the window by at least this many items, used when jumping to a search result.
	 *
	 * That differs from calling `loadOlder` repeatedly. Jumping to a message from months ago can mean
	 * dozens of pages' worth, and opening them one page at a time would run that many renders and
	 * queries back to back.
	 */
	ensureWindow: (count: number) => void;
}

/**
 * Subscribes to a room's recent messages.
 *
 * Not the whole history. A conversation can span years and cannot be drawn in full anyway. A recent
 * page is subscribed instead, and the window widens when the user scrolls up.
 *
 * What matters is that widening means widening the subscription window itself, not fetching the
 * older page separately and prepending it. Prepending would create two lists on screen (the
 * subscribed newest messages plus a hand-gathered past), and new messages arriving at that seam
 * would land out of order. With a widened window, the source of truth remains one subscription.
 */
export function useLocalMessages(roomId: string): LocalMessagesState {
	const { store, status } = useChatScope();
	const [limit, setLimit] = useState(CHAT_MESSAGE_PAGE_SIZE);

	const page = useLiveQuery(async () => {
		if (!store) return undefined;
		const messages = await store.listRecentMessages(roomId, { limit });
		/**
		 * Asks whether there is actually more. Judging by `messages.length === limit` alone would show
		 * `Load earlier messages` even for a conversation exactly one page long, and pressing it would do nothing.
		 *
		 * This query also runs inside the same `liveQuery`, so it is tracked together. If a message
		 * arrives above (for example, from future sync), the button appears on its own.
		 */
		const first = messages[0];
		const older = first
			? await store.listRecentMessages(roomId, { before: first.id, limit: 1 })
			: [];
		return { messages, hasMore: older.length > 0 };
	}, [store, roomId, limit]);

	const loadOlder = useCallback(
		() => setLimit((current) => current + CHAT_MESSAGE_PAGE_SIZE),
		[],
	);

	/**
	 * The window never shrinks. Collapsing what has already been drawn would make the spot the user
	 * was reading disappear. The window grows in page-sized steps to match `loadOlder`'s increments.
	 * If the two paths grew it by different amounts, `Load earlier messages` would open only half a page on some
	 * days.
	 */
	const ensureWindow = useCallback(
		(count: number) =>
			setLimit((current) =>
				Math.max(
					current,
					Math.ceil(count / CHAT_MESSAGE_PAGE_SIZE) * CHAT_MESSAGE_PAGE_SIZE,
				),
			),
		[],
	);

	return {
		messages: page?.messages ?? [],
		loading: status !== "ready" || page === undefined,
		hasMore: page?.hasMore ?? false,
		loadOlder,
		ensureWindow,
	};
}

export interface LocalRoomHistoryState {
	/** All of this room's live messages, in ascending order. */
	messages: ChatMessage[];
	loading: boolean;
}

/**
 * Subscribes to a room's full history. This is the only hook search uses.
 *
 * It sits next to the window subscription above, which looks odd, but they answer different
 * questions. The screen asks 'what to draw now', which is why it uses a window. Search asks 'does
 * this room contain that phrase'. Searching only a window would report a conversation as lacking a
 * phrase the user knows is there, which is worse than having no search at all.
 *
 * Mount this only while the search panel is open. It is the only place where the whole room goes
 * into memory. If the conversation screen held it all the time, every visit would pay that cost,
 * growing with the room's size. When the panel closes, the component unmounts, taking the
 * subscription and the array with it, so no copy of the history is left behind.
 *
 * Being a subscription matters. While the panel is open, a new message being saved, sync applying a
 * change from another device, or the user editing a message recomputes the results automatically.
 * The screen contains no code that tells search about these changes.
 */
export function useAllLocalMessages(roomId: string): LocalRoomHistoryState {
	const { store, status } = useChatScope();
	const messages = useLiveQuery(
		() => (store ? store.listAllMessages(roomId) : Promise.resolve(undefined)),
		[store, roomId],
	);
	return {
		messages: messages ?? [],
		loading: status !== "ready" || messages === undefined,
	};
}

/**
 * Subscribes to one room's memories, only while open.
 *
 * `roomId` can be passed as null, and that is the point of this hook. Memories are needed only
 * while the memory panel is open. If the hook were called unconditionally, the conversation screen
 * would subscribe to this table on every visit. While the panel is closed the subscription does
 * nothing, since no screen draws it, yet each time sync applies a memory, the conversation screen
 * re-renders.
 *
 * Ordering is done by the store (`sortMemories`). Re-sorting here could split the order on screen
 * from the order that goes into the prompt, and the resulting mismatch would be unpredictable to
 * the user.
 */
export function useLocalMemories(
	roomId: string | null,
): LocalListState<ChatMemory> {
	const { store, status } = useChatScope();
	const items = useLiveQuery(
		() =>
			store && roomId ? store.listMemories(roomId) : Promise.resolve(undefined),
		[store, roomId],
	);
	return {
		items: items ?? [],
		loading: roomId !== null && (status !== "ready" || items === undefined),
	};
}

/**
 * Subscribes to a room's characters. Ordering is done by the store (`sortCharacters`).
 *
 * The shape and reasoning match memories. There are two consumers (the settings screen and prompt
 * assembly), so re-sorting here would make the order the user sees differ from the order the model
 * reads.
 */
export function useLocalCharacters(
	roomId: string | null,
): LocalListState<ChatCharacter> {
	const { store, status } = useChatScope();
	const items = useLiveQuery(
		() =>
			store && roomId
				? store.listCharacters(roomId)
				: Promise.resolve(undefined),
		[store, roomId],
	);
	return {
		items: items ?? [],
		loading: roomId !== null && (status !== "ready" || items === undefined),
	};
}

/**
 * Subscribes to the account's persona library. Ordering is done by the store (`sortPersonas`).
 *
 * There are two consumers: the library screen and the room settings' pick list. Re-sorting here
 * would draw the same library in two different orders on two screens. The difference only shows
 * when they are compared side by side (memories made the same decision).
 *
 * The hook takes no argument such as `roomId`, by design. Personas are assets of the account rather
 * than children of a room, so the conversation they are opened from does not change the list.
 */
export function useLocalPersonas(): LocalListState<ChatPersona> {
	const { store, status } = useChatScope();
	const items = useLiveQuery(
		() => (store ? store.listPersonas() : Promise.resolve(undefined)),
		[store],
	);
	return {
		items: items ?? [],
		loading: status !== "ready" || items === undefined,
	};
}
