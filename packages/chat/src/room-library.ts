/**
 * Chooses the rows the library list actually draws: search, sort and reveal. Lives in the pure
 * package because two consumers show the same product screen (web `/chats` and mobile). They differ
 * only in container (`<ul>` vs `FlatList`, hover vs press). Per-app rules let search become
 * case-sensitive on one side, trimming happen before search on one side, or equal-timestamp rooms
 * swap on refresh. That drift only shows when both screens are compared side by side.
 *
 * No copy lives here. Words such as `Recent activity` belong to each app, since locale text in this package
 * would tie the rules to one locale. Type checks catch omissions: each app's copy table is
 * `Record<RoomSort, string>`, so adding a value breaks both apps' compilation.
 *
 * No server is involved. The input is an array already in local device storage, and no query is
 * made. There is no room-list endpoint, and none should be added.
 */

/** The fields a row actually reads. Does not require the full room record. */
export interface LibraryRoom {
	id: string;
	title: string;
	/** Last activity timestamp, ISO 8601. */
	updatedAt: string;
}

export type RoomSort = "recent" | "oldest" | "title";

/**
 * Only three orders. 'Most messages' and 'created' are excluded: the first needs a message query
 * per row, and the second repeats `updatedAt` order under another name.
 */
export const ROOM_SORTS: readonly RoomSort[] = ["recent", "oldest", "title"];

export const DEFAULT_ROOM_SORT: RoomSort = "recent";

/**
 * Number of rows drawn at once. This is a display window, not a storage cursor. The list always
 * covers every live room, so search sees everything; only the head of the result is cut here.
 * `ChatStore.listRooms()` is not converted to cursor pagination, because search would then only
 * match the page already fetched.
 *
 * Fifty is a few scrolls on any screen. `Show more` opens the rest in same-size steps. It
 * does not load automatically: this screen is for finding, not browsing, and endless growth would
 * hide whether anything remains below.
 */
export const ROOM_LIBRARY_PAGE_SIZE = 50;

/** Trims and lowercases the search query. Lowercasing has no effect on Hangul. */
export const normalizeRoomQuery = (query: string): string =>
	query.trim().toLocaleLowerCase("ko-KR");

/**
 * Searches titles only, not message bodies. This is privacy before performance: once the list reads
 * conversation content, what is visible over someone's shoulder becomes the content, not the title.
 * Message search is a separate action with its own place (`search.ts`) and is not merged here.
 *
 * No fuzzy or morphological matching. Substring matches are predictable to the user, and a match
 * that cannot be explained cannot be trusted.
 */
const matches = (room: LibraryRoom, normalized: string): boolean =>
	room.title.toLocaleLowerCase("ko-KR").includes(normalized);

/**
 * Ties are broken by id. This does not rely on the engine's sort stability. If two rooms created in
 * the same millisecond swapped on each refresh, the user would read the list as jumping, and that
 * symptom is hard to reproduce.
 */
const byId = (a: LibraryRoom, b: LibraryRoom): number =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const oldestFirst = (a: LibraryRoom, b: LibraryRoom): number =>
	a.updatedAt === b.updatedAt ? byId(a, b) : a.updatedAt < b.updatedAt ? -1 : 1;

/**
 * Name order uses Korean collation. `<` compares Unicode code points, which mis-orders mixed
 * Hangul, Latin and digits relative to what people expect.
 */
const byTitle = (a: LibraryRoom, b: LibraryRoom): number => {
	const compared = a.title.localeCompare(b.title, "ko-KR");
	// Equal titles fall back to recent activity first. Two rooms can genuinely share a name.
	return compared !== 0 ? compared : -oldestFirst(a, b);
};

/**
 * Sorting. The default (`recent`) is never re-sorted. Order is the repository's contract
 * (`listRooms` uses `updatedAt DESC, id DESC`). If the screen reordered by its own rule, a room
 * could be first here and fifth in the sidebar's `Recent chats`, since both read the same repository.
 */
function sortRooms<T extends LibraryRoom>(
	rooms: readonly T[],
	sort: RoomSort,
): readonly T[] {
	if (sort === "recent") return rooms;
	return [...rooms].sort(sort === "oldest" ? oldestFirst : byTitle);
}

export interface RoomLibraryInput<T extends LibraryRoom> {
	/** All live rooms the repository returned, most recent activity first. */
	rooms: readonly T[];
	query: string;
	sort: RoomSort;
	visibleCount: number;
}

export interface RoomLibraryView<T extends LibraryRoom> {
	/**
	 * Count of this account's live conversations before search. Distinguishes the two empty states.
	 */
	total: number;
	/** Count that passed search. The screen's `N conversations` uses this value. */
	matched: number;
	visible: T[];
	hasMore: boolean;
	/**
	 * A search term is active but nothing matches. This is a different screen from the first-visit
	 * empty state.
	 */
	emptyBySearch: boolean;
}

/**
 * Search, then sort, then trim. This order is the rule, and trimming last is the point: trimming
 * first would search only the first 50 rows, and a conversation the user knows of would appear not
 * to exist.
 */
export function roomLibraryView<T extends LibraryRoom>({
	rooms,
	query,
	sort,
	visibleCount,
}: RoomLibraryInput<T>): RoomLibraryView<T> {
	const normalized = normalizeRoomQuery(query);
	const filtered = normalized
		? rooms.filter((room) => matches(room, normalized))
		: rooms;
	const ordered = sortRooms(filtered, sort);
	const limit = Math.max(0, visibleCount);
	return {
		total: rooms.length,
		matched: ordered.length,
		visible: ordered.slice(0, limit),
		hasMore: ordered.length > limit,
		emptyBySearch: normalized.length > 0 && ordered.length === 0,
	};
}
