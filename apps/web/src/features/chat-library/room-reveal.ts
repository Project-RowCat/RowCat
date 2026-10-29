import {
	type ChatStore,
	normalizeRoomQuery,
	ROOM_LIBRARY_PAGE_SIZE,
	type RoomSort,
} from "@rowcat/chat";

/**
 * How many rows have been revealed so far. **There is only ever one live window.**
 *
 * It is not reset with an effect, for a frame-timing reason. `useEffect(() => setCount(50))` runs
 * after the frame is already painted, so right after the search is cleared, 500 rows would sit in
 * the DOM for one frame. Keeping the query together with the window means a stale window never
 * exists: if the query differs, the render writes a new window immediately.
 *
 * ## The owner is the **store instance**
 *
 * For a while the axis of this decision was the scope's `status`, which protected nothing when the
 * account changed, because status **returns** through `ready → activating → ready`:
 *
 * ```text
 * Alice pressed `Show more` three times   key = "|recent|ready", count = 200
 * Sign out                              the key briefly changes; the screen is a placeholder meanwhile
 * Bob signs in                          the key is "|recent|ready" again, so **200 comes back**
 * ```
 *
 * Bob's first list would then start expanded by whatever the previous person revealed. Comparing
 * member id is not enough either: `Alice → sign out → Alice` keeps the same id while the connection
 * was closed and reopened. The instance separates both cases (the same axis as room management's
 * ownership check, `features/chat/room/management.tsx`). The mobile version of this screen already
 * used this axis (`apps/mobile/.../use-room-library.ts`).
 *
 * ## When the condition changes, the **window ends** — it does not pick a value
 *
 * This is where the file was wrong once. The old check left the saved window in place and only
 * answered "if it is not this list's, give the initial value". So returning to an old condition
 * **revived** that window:
 *
 * ```text
 * No query, `Show more` three times    saved window = ("", recent, 200)
 * Type "library"                     renders 50; the saved window is still 200
 * Clear the query                    the condition matches again → **200 comes back**
 * ```
 *
 * The person only searched, yet the list expanded itself by 150 rows. So this module exports not
 * "what to render now" but a **transition** of the window: when the condition changes, the old
 * window is discarded and a new one takes its place (`reconcileRoomRevealWindow`). Going back means
 * **visiting that condition again**, not returning to the old window. There is deliberately no
 * per-condition memory (no `condition → revealed count` table), and the type shows it: one window,
 * holding its own owner.
 *
 * ## No rules here
 *
 * What to render, and how many rows, is decided by `roomLibraryView` in `@rowcat/chat`, which
 * mobile calls too. This file only owns the question of **whose** window it is. Search, sort and
 * slicing are not here.
 */

export interface RoomRevealWindow {
	/**
	 * Whose list this window is for: the store **instance**, not the member id. `null` while the scope
	 * is not open yet, and `null` is distinct from every instance.
	 *
	 * **`null` is not the owner of the store that opens next.** A window that exists while the scope
	 * is closed ends right there, and a newly opened database starts its own window from scratch.
	 */
	store: ChatStore | null;
	/** Query condition. The search text is normalized first, so an edit that changes only whitespace does not reset the window. */
	key: string;
	count: number;
}

/** The query condition the window is keyed on. Normalization uses the **same function** as search. */
export const roomRevealKey = (query: string, sort: RoomSort): string =>
	`${normalizeRoomQuery(query)}|${sort}`;

/** The window for opening this list. It starts again here whenever the condition changes. */
export const initialRoomRevealWindow = (
	store: ChatStore | null,
	key: string,
): RoomRevealWindow => ({ store, key, count: ROOM_LIBRARY_PAGE_SIZE });

/**
 * The window for the current list.
 *
 * If it still belongs to this list, **the received object is returned as is**. Its identity is the
 * signal that nothing changed, and callers use that to decide whether to write state (writing would
 * loop the render). Otherwise the old window is discarded and a new one is created.
 */
export const reconcileRoomRevealWindow = (
	reveal: RoomRevealWindow,
	store: ChatStore | null,
	key: string,
): RoomRevealWindow =>
	reveal.store === store && reveal.key === key
		? reveal
		: initialRoomRevealWindow(store, key);

/**
 * One `Show more`: expands by the same size.
 *
 * The owner is not changed. What to expand must be settled **before** calling (the caller runs
 * `reconcileRoomRevealWindow` first). That way a `Show more` right after changing the condition expands
 * the list being shown, and does not quietly grow the window of the list you just left.
 */
export const expandRoomRevealWindow = (
	reveal: RoomRevealWindow,
): RoomRevealWindow => ({
	...reveal,
	count: reveal.count + ROOM_LIBRARY_PAGE_SIZE,
});
