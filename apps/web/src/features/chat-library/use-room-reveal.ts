import type { ChatStore } from "@rowcat/chat";
import { useCallback, useState } from "react";
import {
	expandRoomRevealWindow,
	initialRoomRevealWindow,
	type RoomRevealWindow,
	reconcileRoomRevealWindow,
} from "./room-reveal.ts";

/**
 * Hook that owns only the **lifetime** of the revealed window.
 *
 * The rules live in `room-reveal.ts` (pure). What stays here is holding that window across renders
 * and the `Show more` action. Search, sorting and slicing still belong to `@rowcat/chat`.
 *
 * ## Why state is written during render
 *
 * When the condition changes, **that render already draws the new window** (`owned`). Correcting it
 * in an effect would be too late: the frame would already have put 500 rows into the DOM, which is
 * visible in accounts that hold hundreds of rooms. So the render itself picks the value, and the
 * state write exists only to **persist** that choice. Without the write, the old window would
 * survive, and clearing the search would bring back a window left behind. That is why this file
 * exists.
 *
 * The loop is prevented by identity. `reconcileRoomRevealWindow` returns the **same object** it was
 * given when the window still belongs to this list, so in a render where the condition is
 * unchanged, `owned === reveal` and nothing is written. Only a render where the condition changed
 * writes once; the next render sees the same object again. React re-runs the component before
 * committing, so the two steps are never painted.
 */
export interface RoomReveal {
	/** Rows to draw now. Passed straight through as `roomLibraryView`'s `visibleCount`. */
	visibleCount: number;
	showMore: () => void;
}

export function useRoomReveal(
	store: ChatStore | null,
	key: string,
): RoomReveal {
	const [reveal, setReveal] = useState<RoomRevealWindow>(() =>
		initialRoomRevealWindow(store, key),
	);

	const owned = reconcileRoomRevealWindow(reveal, store, key);
	if (owned !== reveal) setReveal(owned);

	/**
	 * Expands **the window of the list that is current now**.
	 *
	 * The window is reconciled again inside the updater because this callback may hold a stale window.
	 * A press right after the condition changed would otherwise widen the window of the list the user
	 * just left, and that list would appear pre-expanded when they came back.
	 */
	const showMore = useCallback(
		() =>
			setReveal((current) =>
				expandRoomRevealWindow(reconcileRoomRevealWindow(current, store, key)),
			),
		[store, key],
	);

	return { visibleCount: owned.count, showMore };
}
