import { type UpdateNote, updateNotePlainText } from "@rowcat/domain";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { updateNoteTitle } from "./update-note-copy.ts";
import { UpdateNoteText } from "./update-note-text.tsx";

/**
 * One history row, and it is a single open action.
 *
 * Does not reuse `NotificationRow`. That would need invented `id`, `createdAt`, `readAt`, and
 * `kind` values, which would bring inbox vocabulary (such as an unread count) into this row.
 *
 * Draws only values the release note actually has:
 * - title: date-derived; it is the note's public identity
 * - lead paragraph: authored, one or two sentences; omitted if absent
 * - unseen dot: on the most recent unopened row only; not a count or badge
 * - arrow: signals that pressing the row opens it
 *
 * The lead paragraph is not invented. Truncating the first bullet as a summary would show text the
 * author never wrote, at a length that does not fit. With no lead, only the title shows.
 *
 * One target. The dot is `aria-hidden`, and the button's accessible name includes the lead
 * paragraph, so assistive tech gets the same text sighted users see. A separate dot button would
 * give two paths to one place and an extra unnamed control.
 */
export function UpdateNoteRow({
	note,
	surface,
	unseen,
	onOpen,
}: {
	note: UpdateNote;
	/**
	 * Only the presentation varies by surface. The name, the open action, and the basis for the dot
	 * are the same for both values, as with `NotificationRow` on the same axis.
	 */
	surface: "page" | "popover";
	unseen: boolean;
	onOpen: () => void;
}) {
	const { t } = useTranslation("shell");
	const summary = note.intro ? `, ${updateNotePlainText(note.intro)}` : "";
	const state = unseen ? t("bell.unseenUpdate") : "";

	return (
		<button
			type="button"
			aria-label={`${updateNoteTitle(note)}${summary}${state}`}
			onClick={onOpen}
			/*
			 * The focus ring on the full list is drawn inset (`ring-inset`). Drawn outward, a row without
			 * corners would be clipped to three sides by its neighbors and the dividers. Popover rows keep
			 * the default because they have their own corners, the same rule as notification rows.
			 */
			className={
				surface === "page"
					? "flex w-full items-start gap-3 px-2 py-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
					: "flex w-full items-start gap-3 rounded-md px-3 py-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
			}
		>
			{/*
			 * The span stays in the layout when the dot is off. Rendering it conditionally would
			 * remove it from flow on press, shifting the title left in the same frame the dialog
			 * opens. Notification rows make the same decision in the same spot.
			 *
			 * Aligned to the first line's text height (`mt-2`). Top alignment would point at the top
			 * of the row rather than at the title.
			 */}
			<span
				aria-hidden="true"
				className={`mt-2 size-2 shrink-0 rounded-full bg-primary ${unseen ? "" : "opacity-0"}`}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium">
					{updateNoteTitle(note)}
				</span>
				{note.intro ? (
					<span className="text-sm leading-6 text-muted-foreground">
						<UpdateNoteText text={note.intro} />
					</span>
				) : null}
			</span>
			<ChevronRight
				className="mt-1 size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
		</button>
	);
}
