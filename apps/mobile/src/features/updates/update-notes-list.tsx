import { space } from "@rowcat/design";
import type { UpdateNote } from "@rowcat/domain";
import { screenPadding, Text } from "@rowcat/ui-native";
import { useCallback, useState } from "react";
import { FlatList, StyleSheet } from "react-native";
import { UpdateNoteDialog } from "./update-note-dialog.tsx";
import { UpdateNoteRow } from "./update-note-row.tsx";
import { useUpdateNotes } from "./update-notes-provider.tsx";

/**
 * The `Updates` tab — **this surface's release history.**
 *
 * ## A history, not just the newest one
 *
 * This slice used to draw a single row at the head of the notification list. That shape held only
 * while there was one announcement. As releases pile up, that row means "older ones cannot be
 * seen", and the user loses any way to ask which releases they missed.
 *
 * **Ordering and filtering are not repeated here.** Newest-first sorting and surface selection are
 * both done by the shared pure function (`updateNotesFor`). If the app restated them, the web and
 * this app would draw the same releases in different orders.
 *
 * ## One list is the whole tab
 *
 * It is not placed inside a `ScrollView`: an unbounded height would switch off virtualization
 * entirely. There is no pull-to-refresh either. Nothing goes to the server, so there is nothing to
 * pull, and that gesture promises "fetch again" when there is nothing to fetch.
 *
 * ## The row pressed is the one opened
 *
 * Not always the newest. If every row opened the same window, a history would not be a history.
 * **Opening is the moment of reading**, and opening an older row does not roll the record back
 * (`seen-store.ts`), so the marker on newer rows stays as it is.
 *
 * ## No paging
 *
 * The history is content the server ships, so its size is known to us. There is no "load more",
 * `onEndReached`, search, filter or archive in this slice.
 */
export function UpdateNotesList() {
	const { notes, unseenId, markSeen } = useUpdateNotes();

	/**
	 * The announcement currently open and the window's open state are **different values**. The
	 * announcement must stay held after closing so the primitive finishes its exit animation;
	 * discarding it at once would make the window vanish abruptly instead of animating out.
	 */
	const [selected, setSelected] = useState<UpdateNote | null>(null);
	const [open, setOpen] = useState(false);

	const openNote = useCallback(
		(note: UpdateNote) => {
			setSelected(note);
			setOpen(true);
			markSeen(note);
		},
		[markSeen],
	);

	const renderRow = useCallback(
		({ item }: { item: UpdateNote }) => (
			<UpdateNoteRow
				note={item}
				unseen={item.id === unseenId}
				onOpen={() => openNote(item)}
			/>
		),
		[openNote, unseenId],
	);

	return (
		<>
			<FlatList
				data={notes}
				keyExtractor={keyOf}
				renderItem={renderRow}
				contentContainerStyle={list.content}
				/**
				 * **The tab is never hidden.** Even with an empty history the tab stays and one line of fact
				 * appears. If the number of tabs changed per screen, that line would become a status indicator
				 * rather than part of the IA. A large illustration is also not used by rule: one line is
				 * enough.
				 */
				ListEmptyComponent={
					<Text variant="label" tone="muted-foreground" style={list.empty}>
						No update notes yet.
					</Text>
				}
			/>

			{selected ? (
				<UpdateNoteDialog
					note={selected}
					open={open}
					onDismiss={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}

/** The public identity is the key. Using position as the key would make rows take each other's places as the history grows. */
const keyOf = (note: UpdateNote) => note.id;

const list = StyleSheet.create({
	content: { paddingBottom: space.xl, paddingHorizontal: screenPadding },
	empty: { paddingVertical: space.xl, textAlign: "center" },
});
