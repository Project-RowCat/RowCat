import type { UpdateNote, UpdateNoteSectionId } from "@rowcat/domain";
import { translator } from "../../lib/i18n/instance.ts";

/**
 * The update tab's words in the drawn language. The domain derives an English title from the release
 * date for Discord and the projection; the screen derives its own from the same date (the note's
 * public identity, `YYYY-MM-DD`), so the date is the one fact both share and only the words differ —
 * the web's `update-note-copy.ts` makes the same choice. Section labels are named by the domain's
 * section id; the domain keeps the order and drops empty sections.
 */
const t = () => translator("updates");

export const updateNoteTitle = (note: Pick<UpdateNote, "id">): string =>
	t()("title", { date: note.id.replaceAll("-", ".") });

export const updateNoteSectionLabel = (id: UpdateNoteSectionId): string =>
	t()(`section.${id}`);

/**
 * The fact that a new update exists, as part of a history row's name (the inbox tab and the bell say
 * the same fact with the inbox's own entry).
 * The web adds an invisible text node; native has no such mechanism, and a dot alone conveys the
 * state only through color and shape. The English is the domain's `UPDATE_UNSEEN_LABEL_SUFFIX`, held
 * equal by a test.
 */
export const updateUnseenSuffix = (): string => t()("unseen");

export const updateNoteOpenHint = (): string => t()("hint");
export const updateNoteDismissLabel = (): string => t()("ok");
export const updateNotesEmpty = (): string => t()("empty");
