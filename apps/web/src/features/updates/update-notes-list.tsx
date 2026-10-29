import { useTranslation } from "react-i18next";
import { UpdateNoteRow } from "./update-note-row.tsx";
import { useUpdateNotes } from "./update-notes-provider.tsx";

/**
 * Row count for the popover. This is a preview, not the full history.
 *
 * In a 22rem box, a full history would need a lot of scrolling. Three rows is fewer than the
 * inbox's six, because each note takes two lines (title and lead) and releases rarely arrive
 * several per day. Six would make the list the whole history for most users, so the `See all updates`
 * link would promise nothing.
 *
 * The value lives here, not in the domain, because it is the geometry of this box.
 * `updateNotesFor()` always returns the full history for a surface.
 */
const UPDATE_POPOVER_LIMIT = 3;

/**
 * The `Updates` tab shows this surface's full release history, not only the latest entry. A
 * single-entry view only worked while there was one release; older ones would become unreachable.
 *
 * Ordering and surface filtering are not redone here. The shared pure function `updateNotesFor`
 * already does them, and rewriting them would let web and mobile order the same releases
 * differently.
 *
 * The notifications page and the header popover both render this one component. Only the row count
 * and layout (`surface`) differ. Rows, the open action, and the read fact are shared, so a dot
 * cleared in the popover also clears on the page's tab in the same frame.
 *
 * Opening a row is delegated to the provider (`update-notes-provider.tsx`), because the popover
 * closes on press.
 *
 * No pagination, infinite scroll, search, filters, or archive. The history is content the repo
 * ships, so its size is known. Any of these would need a route and its own cache.
 */
export function UpdateNotesList({
	surface = "page",
}: {
	/** `popover` is a preview. Both the row count and the layout belong to that box. */
	surface?: "page" | "popover";
}) {
	const { t } = useTranslation("shell");
	const { notes, unseenId, openNote } = useUpdateNotes();
	const preview = surface === "popover";
	const shown = preview ? notes.slice(0, UPDATE_POPOVER_LIMIT) : notes;

	/**
	 * The tab is never hidden. When the history is empty, the tab stays and a single status line
	 * shows. If the tab count changed between screens, the line would read as a status indicator
	 * instead of a navigation item.
	 */
	if (shown.length === 0)
		return (
			<p
				className={
					preview
						? "px-3 py-6 text-sm text-muted-foreground"
						: "py-10 text-sm text-muted-foreground"
				}
			>
				{t("updates.empty")}
			</p>
		);

	return (
		/*
		 * On the page, this surface matches the notifications list: one column separated only by
		 * dividers. In the popover the outer border is dropped. Inside a 22rem box, top and bottom rules
		 * turn the list into a box inside a box. The inbox tab made the same call in the same spot.
		 */
		<ul className={preview ? "" : "divide-y border-y"}>
			{shown.map((note) => (
				<li key={note.id}>
					<UpdateNoteRow
						note={note}
						surface={surface}
						unseen={note.id === unseenId}
						onOpen={() => openNote(note)}
					/>
				</li>
			))}
		</ul>
	);
}
