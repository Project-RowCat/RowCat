import {
	CHAT_SEARCH_RESULT_PAGE_SIZE,
	type ChatSearchView,
	searchMessages,
} from "@rowcat/chat";
import { useDeferredValue, useMemo, useState } from "react";
import { useAllLocalMessages } from "#/lib/local-chat/hooks.ts";

/**
 * Search panel state. Everything is derived; nothing is stored.
 *
 * Results are not persisted in the database, the query cache, or `localStorage`. They are
 * recomputed from the room's messages and the current input on every change, so there is no path
 * that can leave results stale after a message arrives, is edited, deleted, or synced.
 *
 * No timer is used. `useDeferredValue` lowers the priority of the result computation instead of
 * waiting a fixed number of milliseconds: the input redraws immediately and an in-flight
 * computation is skipped when a newer keystroke arrives. This is not the same kind of delay as
 * auto-sync's debounce, which saves network round trips; here the work is a scan over an array
 * already in memory. Measured at tens of milliseconds for one search over 5,000 messages
 * (`packages/chat/src/search.perf.test.ts`), which is why no index library is used.
 */

export interface RoomSearchState {
	view: ChatSearchView;
	/** Live message count in this room; the denominator for the position used when jumping from a result to the transcript. */
	total: number;
	/** The transcript is still loading; drawn differently from zero results. */
	loading: boolean;
	/** Results do not yet reflect the latest keystroke; the reason to draw them dimmed. */
	stale: boolean;
	/** Widens the preview window by one page (`Show more`). */
	showMore: () => void;
}

export function useRoomSearch(roomId: string, query: string): RoomSearchState {
	const { messages, loading } = useAllLocalMessages(roomId);
	const deferred = useDeferredValue(query);

	// The window resets to the first page when the query changes, keyed on the query rather than reset
	// in an effect. An effect runs after the first paint, so the new query's first frame would briefly
	// show the expanded results of the previous query.
	const [shown, setShown] = useState({
		key: deferred,
		limit: CHAT_SEARCH_RESULT_PAGE_SIZE,
	});
	const effectiveLimit =
		shown.key === deferred ? shown.limit : CHAT_SEARCH_RESULT_PAGE_SIZE;

	const view = useMemo(
		() => searchMessages(messages, deferred, { limit: effectiveLimit }),
		[messages, deferred, effectiveLimit],
	);

	return {
		view,
		total: messages.length,
		loading,
		stale: deferred !== query,
		showMore: () =>
			setShown({
				key: deferred,
				limit: effectiveLimit + CHAT_SEARCH_RESULT_PAGE_SIZE,
			}),
	};
}
