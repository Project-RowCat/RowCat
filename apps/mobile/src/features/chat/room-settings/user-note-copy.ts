import { CHAT_USER_NOTE_MAX_LENGTH, chatTextLength } from "@rowcat/chat";

/**
 * Copy for the user-note pane; the rules live in `user-note.ts` of `@rowcat/chat`.
 *
 * The wording must match the other app's same file. Copy is split per app because the pure package
 * holds no Korean; with only two consumers, drift shows when they are read side by side
 * (`character-copy.ts` and `narration-copy.ts` sit in the same place).
 */

/**
 * Settings-home row summary: whether a note exists and how long it is. The body is not truncated
 * because it is an instruction: "Don't use formal speech…" cut short reads the opposite, and a ~240px row makes
 * that common. The length only confirms the user's note is still there.
 */
export function userNoteRowSummary(note: string | null): string {
	if (!note) return "Set how this conversation goes";
	return `${userNoteLength(note).toLocaleString("en-US")} characters written`;
}

/** Must use the store's unit (code points). */
export const userNoteLength = chatTextLength;

/** The counter shows only near the limit (same rule and margin as memory and rename); always visible it would follow typing and rarely say anything. */
export const USER_NOTE_COUNTER_THRESHOLD = CHAT_USER_NOTE_MAX_LENGTH - 100;

/** Raw Dexie/SQLite text is not shown (it names no user action and leaks internals). Over-limit never lands here; the form blocks it before saving. */
export const USER_NOTE_SAVE_FAILURE_MESSAGE =
	"Couldn't save the user note. Please try again.";

/** Over the limit: say so instead of truncating (a truncated instruction is not the instruction). */
export const USER_NOTE_TOO_LONG_MESSAGE = `User notes can be up to ${CHAT_USER_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters.`;

/**
 * One sentence on what this field is, including what it does not promise. The note is one prompt
 * block, not a rule: "always follows this" would be a lie when the model ignores it, and safety
 * guards stand after it, so we cannot keep that promise.
 */
export const USER_NOTE_DESCRIPTION =
	"Write a request to the model about how this conversation should go. It's sent with every reply and doesn't affect other conversations.";

export const USER_NOTE_PLACEHOLDER =
	"e.g. Keep descriptions short and focus on dialogue. Leave a blank line when the scene changes.";
