import { useTranslation } from "react-i18next";
import { useUpdateNotes } from "./update-notes-provider.tsx";

/**
 * Whether an unopened note exists, as one boolean. The bell needs this before drawing: its badge
 * slot holds only one of the unread notification count or this dot. The priority and label logic is
 * in the shared pure function `notificationAttention` in `@rowcat/domain`. Exporting only the
 * component would leave nowhere to make that call.
 *
 * Neither read state nor history leaves through this hook. The only output is 'something new
 * exists', so the consumer never picks up the storage vocabulary.
 */
export function useUpdateNotesUnseen(): boolean {
	return useUpdateNotes().unseenId !== null;
}

/**
 * The dot on the `Updates` tab. It says only that something new exists.
 *
 * Not a count. `Updates (3)`, `NEW`, and `New update` are all out. A count is inbox vocabulary, and 'new
 * things here' is not the same claim as 'N unread releases'. Three backlogged notes still show one
 * dot and one marked row (`unseenUpdateNoteId`).
 *
 * The status is spelled into the tab button's accessible name through an `sr-only` label. Color and
 * shape alone tell assistive tech nothing. The suffix string is a shared constant
 * (`bell.unseenUpdate`) because the bell's name states the same fact. Two names for one
 * fact would read as two facts.
 *
 * Not focusable. The tab is the only target; a focusable dot would create a second path to the same
 * place.
 */
export function UpdateNotesUnseenDot() {
	const { t } = useTranslation("shell");
	const { unseenId } = useUpdateNotes();
	if (unseenId === null) return null;
	return (
		<>
			<span
				aria-hidden="true"
				className="size-1.5 shrink-0 rounded-full bg-primary"
			/>
			<span className="sr-only">{t("bell.unseenUpdate")}</span>
		</>
	);
}
