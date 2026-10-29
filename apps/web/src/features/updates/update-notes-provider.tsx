import {
	type UpdateNote,
	unseenUpdateNoteId,
	updateNotesFor,
} from "@rowcat/domain";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	browserSeenStorage,
	createUpdateNoteSeenStore,
	mergeSeenUpdateNoteId,
	type UpdateNoteSeenStorage,
} from "./seen-store.ts";
import { UpdateNoteDialog } from "./update-note-dialog.tsx";

/**
 * Shares one read-state value across the app. Four places show it: the header bell dot, the popover
 * `Updates` tab dot, the page tab dot, and the per-row dots.
 *
 * Mounted once in the app-shell route (`routes/(app)/route.tsx`). Separate reads would go stale on
 * one side: a note opened in the popover would clear its row dot while the bell and the page tab
 * kept showing it until reload.
 *
 * It also owns the dialog. The popover closes on press, which would unmount a dialog placed beside
 * the list, so this provider holds the selected note and the open state.
 *
 * `openNote` is the only place that records a note as read. Opening is reading. Recording it in
 * each list would leave a note unseen forever whenever one list forgot to.
 *
 * Nothing opens on its own. No effect opens a note on mount; a person pressing a row is the only
 * way in. An earlier version showed a dialog on the way into the app and was removed, because
 * release news is neither consent nor confirmation. A gate of that kind would turn information into
 * a blocker.
 *
 * The server cannot know read state; it lives in this browser's `localStorage`. The history is
 * server-rendered so the list does not pop in after hydration. Only the dots wait for the browser.
 * `undefined` means not read yet and claims nothing as new. `null` would make the server draw dots
 * that vanish after hydration for returning readers.
 */

interface UpdateNotes {
	/**
	 * This surface's history, newest first. Sorting and surface filtering are already done by a shared
	 * pure function.
	 */
	readonly notes: readonly UpdateNote[];
	/**
	 * Identity of the most recent unopened note, or `null` if none. Every dot reads this one value.
	 */
	readonly unseenId: string | null;
	/**
	 * Opening a note also marks it read. The display comes first; the record is for the next visit, so
	 * opening does not wait on storage.
	 */
	readonly openNote: (note: UpdateNote) => void;
}

const Context = createContext<UpdateNotes | null>(null);

export function UpdateNotesProvider({
	storage,
	children,
}: {
	/**
	 * Slot for tests to plug in a different medium. The product path uses the browser's
	 * `localStorage`.
	 */
	storage?: UpdateNoteSeenStorage | null;
	children: ReactNode;
}) {
	const store = useMemo(
		() => createUpdateNoteSeenStore(storage ?? browserSeenStorage()),
		[storage],
	);

	/**
	 * `undefined` means not read yet, not never seen. It is the value during server render and before
	 * hydration; dots stay off in that window.
	 */
	const [lastSeenId, setLastSeenId] = useState<string | null | undefined>(
		undefined,
	);
	useEffect(() => {
		setLastSeenId(store.lastSeenId());
	}, [store]);

	/**
	 * The open note and the dialog's open flag are separate values on purpose. The note outlives
	 * closing so the exit animation can finish (see `open` on `UpdateNoteDialog`).
	 */
	const [selected, setSelected] = useState<UpdateNote | null>(null);
	const [open, setOpen] = useState(false);

	const value = useMemo<UpdateNotes>(
		() => ({
			notes: updateNotesFor("web"),
			unseenId:
				lastSeenId === undefined ? null : unseenUpdateNoteId("web", lastSeenId),
			openNote: (note) => {
				setSelected(note);
				setOpen(true);
				store.markSeen(note.id);
				/**
				 * Never goes backward. Opening an older note leaves the newer recorded note in place, so
				 * pressing a lower row does not clear the dot on a higher one. The storage layer's
				 * `mergeSeenUpdateNoteId` enforces the same rule.
				 */
				setLastSeenId((current) =>
					mergeSeenUpdateNoteId(current ?? null, note.id),
				);
			},
		}),
		[lastSeenId, store],
	);

	return (
		<Context.Provider value={value}>
			{children}
			{/*
			 * The dialog sits outside `children` on purpose. Inside the popover, pressing a row closes
			 * the popover, which would unmount the dialog with it.
			 */}
			{selected ? (
				<UpdateNoteDialog
					note={selected}
					open={open}
					onDismiss={() => setOpen(false)}
				/>
			) : null}
		</Context.Provider>
	);
}

/**
 * Reads the app's update state. Throws outside the provider. Returning empty history there would
 * let a screen that forgot the provider show 'no updates' with no error.
 */
export function useUpdateNotes(): UpdateNotes {
	const value = useContext(Context);
	if (!value)
		throw new Error("useUpdateNotes must be used inside UpdateNotesProvider");
	return value;
}
