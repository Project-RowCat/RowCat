import {
	CHAT_MESSAGE_PAGE_SIZE,
	type ChatMessage,
	type ChatStore,
} from "@rowcat/chat";
import { useMemo } from "react";
import { useLocalLive } from "./live.ts";
import { useChatScope } from "./scope.tsx";

/**
 * Subscribes to **only the most recent messages** of one room, and only while the window is open.
 *
 * What separates this from `useChatRoom` is the room record. That hook holds the room and its
 * messages together to decide screen state. The place that uses this hook (the room management
 * window) already holds the room through another path, and a second subscription would give one
 * value two identities that drift apart by a frame each while streaming.
 *
 * **If `roomId` is `null`, there is no subscription.** The character subscription has the same
 * shape for the same reason (`use-characters.ts`). While the window is closed, a subscription held
 * by the conversation screen would re-render that screen every time sync applies a message.
 *
 * The window is fixed at one page. There is no control to widen it, because the only thing this
 * value feeds is the **usage table**, and the question that table answers is "did tokens spike on a
 * recent turn". A question needing a longer list would also need a period and sort, and that
 * belongs to another screen.
 *
 * The table moved from the generation settings pane to the room info pane, but the size stays the
 * same: the place changed, the question did not. The web uses the same size. If the windows
 * diverged, the same conversation's totals would differ between apps, and nothing would raise an
 * error.
 */
export function useRoomMessages(roomId: string | null): ChatMessage[] {
	const { store } = useChatScope();
	const load = useMemo(() => loader(store, roomId), [store, roomId]);
	return useLocalLive<ChatMessage[]>(load, EMPTY).value;
}

const loader = (
	store: ChatStore | null,
	roomId: string | null,
): (() => Promise<ChatMessage[]>) | null =>
	store && roomId
		? () => store.listRecentMessages(roomId, { limit: CHAT_MESSAGE_PAGE_SIZE })
		: null;

/** A stable empty array: a new array per render would make consumers redraw every time. */
const EMPTY: ChatMessage[] = [];
