import {
	type ChatStore,
	DEFAULT_ROOM_SORT,
	normalizeRoomQuery,
	ROOM_LIBRARY_PAGE_SIZE,
	type RoomLibraryView,
	type RoomSort,
	roomLibraryView,
} from "@rowcat/chat";
import { useCallback, useMemo, useState } from "react";
import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import {
	type ConversationEntry,
	useConversationLibrary,
} from "./use-conversation-library.ts";

/**
 * Applies the list screen's three axes (query, sort, revealed row count) to the conversation
 * library and picks rows with the shared rules.
 *
 * The subscription is not here: reading rooms and runtime rows together happens in one place
 * (`use-conversation-library.ts`). The drawer's recent conversations are the second consumer; if it
 * kept its own subscription, scope checks or a subscription could be missed on one side and go
 * stale silently.
 *
 * Both kinds are one list: search scans both titles, counts both, and `Show more` runs over the merged
 * list. Slicing rooms first and appending runtime rows would pin them to the end, which is not
 * activity order.
 *
 * Nothing asks the server (no room-list endpoint, no copy in the query cache) and nothing calls
 * sync: the same write signal wakes auto-sync, and a static scan blocks it
 * (`lib/boundaries.test.ts`). The rules (title-only search, store-decided default order, slicing
 * after search) belong to `@rowcat/chat`'s `roomLibraryView`, which web calls too.
 *
 * No message is read: the store call is `listRooms()` alone, since previews would add a message
 * lookup per row and put conversation text, not titles, in view over the shoulder.
 */

export interface RoomLibrary {
	query: string;
	setQuery: (query: string) => void;
	sort: RoomSort;
	setSort: (sort: RoomSort) => void;
	view: RoomLibraryView<ConversationEntry>;
	/** Whether a query is active after normalization; splits the two empty states. */
	searching: boolean;
	status: LocalLiveStatus;
	showMore: () => void;
	reload: () => void;
}

export function useRoomLibrary(): RoomLibrary {
	const library = useConversationLibrary();
	const store = library.store;
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<RoomSort>(DEFAULT_ROOM_SORT);

	// Revealed row count; it resets itself when the conditions change. It is not reset in an effect
	// because `useEffect(() => setCount(50))` runs after paint, so clearing the query would show 500
	// rows for one frame. Holding the conditions alongside means a mismatch uses the first window
	// immediately. The store instance must be in the conditions: comparing member ids would make
	// `Alice → sign out → Alice` equal and the new scope would start expanded.
	const normalized = normalizeRoomQuery(query);
	const [reveal, setReveal] = useState<Reveal>({
		store,
		key: `${normalized}|${sort}`,
		count: ROOM_LIBRARY_PAGE_SIZE,
	});
	const key = `${normalized}|${sort}`;
	const fresh = reveal.store === store && reveal.key === key;
	const visibleCount = fresh ? reveal.count : ROOM_LIBRARY_PAGE_SIZE;

	const showMore = useCallback(
		() =>
			setReveal({
				store,
				key,
				count: visibleCount + ROOM_LIBRARY_PAGE_SIZE,
			}),
		[store, key, visibleCount],
	);

	const view = useMemo(
		() =>
			roomLibraryView({ rooms: library.entries, query, sort, visibleCount }),
		[library.entries, query, sort, visibleCount],
	);

	return {
		query,
		setQuery,
		sort,
		setSort,
		view,
		searching: normalized.length > 0,
		status: library.status,
		showMore,
		reload: library.reload,
	};
}

interface Reveal {
	/** Whose list this window belongs to: the instance, not a member id. */
	store: ChatStore | null;
	key: string;
	count: number;
}
