import {
	CHAT_SEARCH_RESULT_PAGE_SIZE,
	type ChatMessage,
	type ChatSearchView,
	type ChatStore,
	searchMessages,
} from "@rowcat/chat";
import { useDeferredValue, useMemo, useState } from "react";
import { useLocalLive } from "../../lib/local-data/live.ts";

/**
 * In-room search. Results are derived, never stored: they are recomputed from the room's messages
 * and the current input, so no message change (arrival, edit, delete, sync) can leave them stale.
 *
 * The query never leaves the device; there is no search endpoint. Recent queries are not saved
 * either, since that would be an index extracted from conversation content.
 *
 * `searchMessages` in `@rowcat/chat` decides matching, result counts and preview cuts, so the two
 * apps' "found" cannot diverge.
 *
 * `useDeferredValue` replaces a debounce: a timer needs a delay that is too long on fast devices
 * and too short on slow ones. It lowers the priority of the computation instead, and skips values
 * superseded before it finishes.
 *
 * The whole message list is read once through `listAllMessages`, not through the screen's window,
 * because matches are often far up and widening per query would multiply reads.
 */

export interface RoomSearchState {
	view: ChatSearchView;
	/** Live message count in this room. */
	total: number;
	/** Still reading the record; distinct from zero results. */
	loading: boolean;
	/** Results do not yet match the text just typed. */
	stale: boolean;
	/** Widens the preview window by one step. */
	showMore: () => void;
}

const EMPTY: ChatMessage[] = [];

export function useRoomSearch(
	store: ChatStore | null,
	roomId: string,
	query: string,
): RoomSearchState {
	const load = useMemo(
		() => (store ? () => store.listAllMessages(roomId) : null),
		[store, roomId],
	);
	const messages = useLocalLive<ChatMessage[]>(load, EMPTY);
	const deferred = useDeferredValue(query);

	/**
	 * The window resets when the query changes. It is keyed by the query instead of using an effect,
	 * because an effect would show one frame of the previous query's expanded window.
	 */
	const [shown, setShown] = useState({
		key: deferred,
		limit: CHAT_SEARCH_RESULT_PAGE_SIZE,
	});
	const effectiveLimit =
		shown.key === deferred ? shown.limit : CHAT_SEARCH_RESULT_PAGE_SIZE;

	const view = useMemo(
		() => searchMessages(messages.value, deferred, { limit: effectiveLimit }),
		[messages.value, deferred, effectiveLimit],
	);

	return {
		view,
		total: messages.value.length,
		loading: messages.status === "loading",
		stale: deferred !== query,
		showMore: () =>
			setShown({
				key: deferred,
				limit: effectiveLimit + CHAT_SEARCH_RESULT_PAGE_SIZE,
			}),
	};
}
