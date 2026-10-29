import {
	type UpdateNote,
	unseenUpdateNoteId,
	updateNotesFor,
} from "@rowcat/domain";
import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import { expoUpdateNoteSeenStorage } from "./device-seen-storage.ts";
import {
	createUpdateNoteSeenStore,
	mergeSeenUpdateNoteId,
	type UpdateNoteSeenStorage,
} from "./seen-store.ts";

/**
 * One "seen" fact for update notes, shared by the app's three display points.
 *
 * ## Why a context: the indicator appears in three places
 *
 * ```text
 * header bell     a dot shows when there are no unread notifications    present on nearly every screen
 * tab dot         the updates tab has something new                     drawn by the notification screen's tab bar
 * history dot     which row is the new one                              drawn by the updates tab
 * ```
 *
 * If each read storage separately, **only some would go stale**: opening the newest row in the
 * history would clear that row's dot while the bell stays on, and the mismatch would clear only
 * after relaunching the app.
 *
 * ## So the container sits at the **app root**
 *
 * Not in one screen: `app/_layout.tsx` mounts it, because the shortcut appears on almost every
 * screen and the notification screen's tab must read the same value, and the root is the only place
 * covering both. Placing it just inside the appearance preference is also deliberate: the seen fact
 * is a **device** value (it survives sign-out and account switches). Moving it below identity would
 * make the same announcement look new again on every account switch.
 *
 * ## The window is not here — **the one place this differs from the web**
 *
 * The web's header popover closes the instant a row is pressed, so the window had to be raised to
 * this layer. This app's shortcut is a single **navigation**, not a popover, so there is no surface
 * that opens the announcement in place. The window still lives beside the list
 * (`update-notes-list.tsx`). The rule is the same in both apps: opening is the moment of reading,
 * and the only way to open is a row the person pressed.
 *
 * ## Judged once
 *
 * Read inside the `useState` initializer. This app's device storage reads synchronously (the same
 * axis as the web's `localStorage`), so the answer exists on the first frame; reading in an effect
 * would turn the dot on one frame late.
 *
 * ## Writes are asynchronous, so storage is not re-read
 *
 * If `markSeen` were awaited (the window is already open) and `read()` called right away, **the old
 * value could come back** and the dot would not clear on screen. So the screen moves its value
 * forward with the same rule as storage (`mergeSeenUpdateNoteId`): opening an older history row
 * keeps any newer announcement already recorded, so pressing a lower row does not clear the marker
 * on an upper row.
 *
 * ## Opening is reading
 *
 * There is no separate button to clear the dot. **Selecting a row alone reads nothing** — clearing
 * the marker of someone who only browsed the history could not be undone.
 */

interface UpdateNotes {
	/** This surface's announcement history, newest first. Sorting and surface filtering are both done by the shared pure function. */
	readonly notes: readonly UpdateNote[];
	/** Identity of the newest announcement not yet opened, or `null`. The tab dot and the row dot both read this one value. */
	readonly unseenId: string | null;
	/**
	 * Called on open — **opening is reading.** The screen updates first and the record is written for
	 * the next launch, so this does not wait for the write.
	 */
	readonly markSeen: (note: UpdateNote) => void;
}

const Context = createContext<UpdateNotes | null>(null);

export function UpdateNotesProvider({
	storage = expoUpdateNoteSeenStorage,
	children,
}: {
	/** Where tests and the development harness plug in a different medium. The product path uses the default. */
	storage?: UpdateNoteSeenStorage;
	children: ReactNode;
}) {
	const store = useMemo(() => createUpdateNoteSeenStore(storage), [storage]);

	/** **An initializer function** — read once, not on every render, and not later than the first frame. */
	const [lastSeenId, setLastSeenId] = useState(() => store.lastSeenId());

	const value = useMemo<UpdateNotes>(
		() => ({
			notes: updateNotesFor("mobile"),
			unseenId: unseenUpdateNoteId("mobile", lastSeenId),
			markSeen: (note) => {
				void store.markSeen(note.id);
				setLastSeenId((current) => mergeSeenUpdateNoteId(current, note.id));
			},
		}),
		[lastSeenId, store],
	);

	return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * This app's update state.
 *
 * Throws when called outside the provider. Silently returning an empty history would let a screen
 * that forgot the provider draw "no announcements" with no error, and it would look plausible.
 */
export function useUpdateNotes(): UpdateNotes {
	const value = useContext(Context);
	if (!value) throw new Error("can only be used inside UpdateNotesProvider");
	return value;
}
