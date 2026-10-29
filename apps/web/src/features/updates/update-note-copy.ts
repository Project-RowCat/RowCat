import type { UpdateNote } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The note's title in the render's language. The domain derives a title from the release date for
 * Discord and the projection; the screen derives its own from the same date (the note's public
 * identity, `YYYY-MM-DD`), so the date is the one fact both share and only the words differ.
 */
export const updateNoteTitle = (note: Pick<UpdateNote, "id">): string =>
	translator("shell")("updates.title", { date: note.id.replaceAll("-", ".") });
