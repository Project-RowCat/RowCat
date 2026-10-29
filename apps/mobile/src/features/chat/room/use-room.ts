import {
	CHAT_MESSAGE_PAGE_SIZE,
	type ChatMessage,
	type ChatStore,
} from "@rowcat/chat";
import { useCallback, useMemo, useState } from "react";
import {
	type LocalLiveStatus,
	useLocalLive,
} from "../../../lib/local-data/live.ts";
import type { RoomLookup } from "../chat-state.ts";

/**
 * Subscribes to one room and its recent messages from the local store. There is no server query:
 * conversations live only on this device (`lib/query.ts` header).
 *
 * The room and the messages are read separately on purpose. A streaming turn changes the message
 * list several times while the room record stays the same; reading them together would give the
 * room a new identity each time and rebuild the conversation session every turn, which makes the
 * ownership check fail and cuts generation off. For that reason session ownership is the pair of
 * store instance and effective role (`token` in `chat-conversation.ts`), not the room object.
 */

export interface ChatRoomView {
	/** Read by `resolveChatScreenState`. */
	lookup: RoomLookup;
	/** Ascending (oldest first); tombstones already filtered. */
	messages: ChatMessage[];
	messagesStatus: LocalLiveStatus;
	hasOlder: boolean;
	loadOlder: () => void;
	/**
	 * Widens the window to hold at least this many messages, for jumping to a search result. It never
	 * shrinks, so a wider window already on screen is kept.
	 */
	ensureWindow: (count: number) => void;
	reload: () => void;
}

export function useChatRoom(
	store: ChatStore | null,
	roomId: string | null,
): ChatRoomView {
	/**
	 * Number of recent messages on screen. The window is widened and re-read rather than paged with a
	 * cursor: local reads are cheap, and a cursor would need its own state that breaks once sync fills
	 * older ranges.
	 */
	const [limit, setLimit] = useState(CHAT_MESSAGE_PAGE_SIZE);

	/* Memoized: a new read function per render would re-subscribe and re-render on every render. */
	const loadRoom = useMemo(
		() => (store && roomId ? () => store.getRoom(roomId) : null),
		[store, roomId],
	);
	const loadMessages = useMemo(
		() =>
			store && roomId
				? () => store.listRecentMessages(roomId, { limit })
				: null,
		[store, roomId, limit],
	);

	const room = useLocalLive(loadRoom, null);
	const messages = useLocalLive<ChatMessage[]>(loadMessages, EMPTY);

	const reload = useCallback(() => {
		room.reload();
		messages.reload();
	}, [room.reload, messages.reload]);

	return {
		lookup: { status: room.status, room: room.value },
		messages: messages.value,
		messagesStatus: messages.status,
		/* A full window may have more. Counting exactly would cost one more query, so the button hides only when widening yields nothing new. */
		hasOlder: messages.value.length >= limit,
		loadOlder: useCallback(
			() => setLimit((current) => current + CHAT_MESSAGE_PAGE_SIZE),
			[],
		),
		/*
		 * Rounds up to a whole page: the window may count deleted rows, so the exact count can leave the
		 * target message just outside it, and later page loads stay aligned.
		 */
		ensureWindow: useCallback((count: number) => {
			const wanted =
				Math.ceil(Math.max(1, count) / CHAT_MESSAGE_PAGE_SIZE) *
				CHAT_MESSAGE_PAGE_SIZE;
			setLimit((current) => (wanted > current ? wanted : current));
		}, []),
		reload,
	};
}

/** Stable empty array; a new array per render would redraw the list every time. */
const EMPTY: ChatMessage[] = [];
