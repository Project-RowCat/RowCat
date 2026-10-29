import { CHAT_USER_NOTE_MAX_LENGTH, chatTextLength } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";
import { formatNumber } from "#/lib/i18n/format.ts";

/**
 * Copy for the user-note screen. The rules live in user-note.ts in @rowcat/chat. Must match the
 * mobile copy of this same file. The pure package cannot contain Korean text, which is why the copy
 * is split; with only two consumers, side-by-side comparison reveals drift (character-copy.ts and
 * narration-copy.ts follow the same pattern).
 */

/**
 * Summary for the settings home row: it says whether a note exists and how long it is. It does not
 * show the start of the text, because the note is an instruction. A cut-off instruction can read as
 * its opposite (`Don't use formal speech…`), and at roughly 240px that mistake is common. Showing only the
 * length confirms that what the user wrote is still there.
 */
export function userNoteRowSummary(note: string | null): string {
	const t = translator("chat");
	if (!note) return t("userNote.summary.none");
	return t("userNote.summary.written", {
		count: formatNumber(userNoteLength(note)),
	});
}

/** Length shown in the UI. It must use the same unit as storage (code points). */
export const userNoteLength = chatTextLength;

/**
 * The character count is shown only when it matters. Shown constantly, the number follows the user
 * through writing and usually says nothing. It appears only as the limit approaches (same rule and
 * margin as memory and rename).
 */
export const USER_NOTE_COUNTER_THRESHOLD = CHAT_USER_NOTE_MAX_LENGTH - 100;

/**
 * Save failure message, one sentence. Raw Dexie or SQLite text is not shown: it does not tell the
 * user what to do, and internal structure would leak. An over-limit value never reaches this point;
 * the form blocks it before saving.
 */
export const userNoteSaveFailureMessage = (): string =>
	translator("chat")("userNote.saveFailed");

/**
 * Over the limit, the text is not truncated; the user is told instead. A truncated instruction is
 * no longer the instruction the user wrote.
 */
export const userNoteTooLongMessage = (): string =>
	translator("chat")("userNote.tooLong", {
		max: formatNumber(CHAT_USER_NOTE_MAX_LENGTH),
	});

/**
 * One sentence describing this field, including what it does not promise. The note is one block of
 * the prompt, not a rule. Writing that it will always be followed would make the product wrong when
 * the model does not comply. The safety guard comes after this text in the prompt, so that promise
 * could not be kept anyway.
 */
export const userNoteDescription = (): string =>
	translator("chat")("userNote.description");

export const userNotePlaceholder = (): string =>
	translator("chat")("userNote.placeholder");
