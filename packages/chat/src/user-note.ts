/**
 * The user note: a directive the user writes for this conversation. The room already has four
 * prompt axes, and none of them can say 'steer this conversation this way':
 *
 * - Persona: who the character is in this conversation.
 * - Narration: how the character is written (a closed set of three: scope, density, and `Character card`).
 * - Cast: which other characters are present.
 * - Memory: facts the conversation knows.
 *
 * Memory is the nearest neighbor and the reason this axis exists. Memory entries are facts, many of
 * them, trimmed by a budget, and auto-maintenance writes to the same table (`source: 'auto'`).
 * Instructions stored there would be cut silently, mixed in with facts, and joined by
 * auto-generated lines. The note is a single value, never trimmed, and written only by people.
 *
 * One value, with no separate enabled flag. A flag would make 'text present, but not applied' a
 * valid state, which the screen cannot explain to the user. As with the other room override axes
 * (`applyRoomPersona`, `applyRoomNarration`), the absence of the key is the only representation of
 * 'no override'. Clearing the value turns the note off. The trade-off: to switch a note off
 * briefly, its text must be kept elsewhere. If that becomes a real problem, the answer is several
 * notes with one attached, which is a separate slice.
 *
 * Not included:
 * - Depth (`at_depth`). Mid-history insertion belongs to the context engine. The note is one
 *   block in the system prompt, at a position the assembler chooses (`context.ts`). Opening depth
 *   would store a position per room and force history rewrites, summary rewinds, and continuations
 *   to recompute it.
 * - Global defaults. The note belongs to this conversation with no layer above it, so clearing
 *   and never setting mean the same thing. (Generation settings differ: they are per device, and
 *   the room overrides them.)
 * - `{{user}}` and `{{char}}` substitution. The stored value is kept verbatim. Substituting would
 *   make the edit form show different text from what the model read, with no visible sign of the
 *   difference.
 * - A separate instruction telling the model the note exists. The block's header does that.
 */

/**
 * Length cap for one note, in characters (code points). The reason is the prompt position, not
 * storage. The note is one block, outside the budget, and sent whole every turn. Without a cap, a
 * long note would push out the conversation history, and the symptom ('the model forgets earlier
 * turns after a long note') would not point at the note. 2000 matches the summary cap
 * (`CHAT_SUMMARY_MAX_LENGTH`): both are single blocks sent every turn in the same spot. The rule
 * lives in this package, like memory and room titles. If validation exists only in one app's form,
 * the two platforms' limits diverge, and the difference persists in records already stored on
 * devices.
 */
export const CHAT_USER_NOTE_MAX_LENGTH = 2_000;

/**
 * The only reason a note is rejected. An empty value is not a rejection; it clears the note (see
 * below).
 */
export type ChatUserNoteRejection = "too_long";

/**
 * Result of the check. On success the value is either the string to store or `null`. Success with
 * `null` is what separates this from the memory `check`. A memory is built only in the screen where
 * its content is written, so an empty memory is incomplete. A note is one field on the room record,
 * so clearing it is a complete decision: no note is attached to this conversation.
 */
export type ChatUserNoteCheck =
	| { ok: true; note: string | null }
	| { ok: false; reason: ChatUserNoteRejection };

/**
 * Trims surrounding whitespace, and nothing more, the same rule as memory and summaries. Internal
 * newlines are kept, since notes are naturally multi-line. Line handling for the prompt is the
 * assembler's job, at the presentation layer; the stored value is exactly what the user typed.
 */
export const normalizeChatUserNote = (input: string): string => input.trim();

/**
 * Checks whether the value can be stored. Length counts code points, not UTF-16 units:
 * `String.length` counts an emoji as 2, so emoji users would hit half the limit.
 *
 * Rejects instead of truncating. A truncated instruction is a fragment of a sentence (for example,
 * 'don't use formal speech' cut down to 'don't use'), and storing it would send a different
 * instruction every turn. `clampChatUserNote` is the last defense for values that bypass this gate,
 * such as old client builds. It is not the normal rule.
 */
export function checkChatUserNote(input: string): ChatUserNoteCheck {
	const note = normalizeChatUserNote(input);
	if (note.length === 0) return { ok: true, note: null };
	if ([...note].length > CHAT_USER_NOTE_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, note };
}

/** The storage layer does not trust the screen; this error records a rejected write. */
export class ChatUserNoteError extends Error {
	readonly reason: ChatUserNoteRejection;
	constructor(reason: ChatUserNoteRejection) {
		super(`a user note cannot exceed ${CHAT_USER_NOTE_MAX_LENGTH} characters`);
		this.name = "ChatUserNoteError";
		this.reason = reason;
	}
}

/**
 * Last gate before storage. Returns the value to store (or `null`), or throws. Both storage
 * implementations pass through this. It is not skipped because the screen validates too, since
 * there are several callers (web, mobile, tests). A stored invalid value would push a room's prompt
 * past the cap on every turn, with no visible sign.
 */
export function requireChatUserNote(input: string | null): string | null {
	if (input === null) return null;
	const checked = checkChatUserNote(input);
	if (!checked.ok) throw new ChatUserNoteError(checked.reason);
	return checked.note;
}

/**
 * Clamps to the limit. The assembler calls this last, with the same shape as `clampSummary`.
 *
 * It is needed even though storage rejects long values, because the value also arrives through
 * sync. The room record decoder does not check note length (rejecting there would delete the whole
 * room, as it does for titles), so a long note from an old build or buggy client would reach the
 * prompt. Clamping here makes that worst case deterministic, since two devices produce the same
 * value, and leaves the stored original untouched.
 *
 * It slices by code point, not with `String.prototype.slice`, for the same reason as summaries: a
 * split surrogate pair puts a broken character in the prompt, and some providers reject the
 * request.
 */
export function clampChatUserNote(input: string): string {
	const normalized = normalizeChatUserNote(input);
	const points = [...normalized];
	if (points.length <= CHAT_USER_NOTE_MAX_LENGTH) return normalized;
	return points.slice(0, CHAT_USER_NOTE_MAX_LENGTH).join("").trim();
}

/**
 * Attaches the note to the room record, or removes the key entirely. This is the only place that
 * does it, and it is the same function as `applyRoomPersona` and `applyRoomNarration`, for the same
 * reason. If a caller writes `{ ...room, userNote: value ?? undefined }` directly, 'no note' has
 * two shapes: the key absent, or the key present with `undefined`. The encoder then differs on
 * whether it includes the key, so applying the same page twice gives different results, which is
 * hard to reproduce.
 *
 * An empty string also counts as absent. Values reaching here already passed `requireChatUserNote`,
 * but the merge path takes stored values as they are, so an empty string from an older build can
 * arrive here.
 */
export function applyRoomUserNote<T extends { userNote?: string }>(
	room: T,
	userNote: string | null,
): T {
	const note = userNote === null ? "" : normalizeChatUserNote(userNote);
	if (note) return { ...room, userNote: note };
	const { userNote: _cleared, ...rest } = room;
	return rest as T;
}

/**
 * Single-line accessor for the room's note, or `null`. Code should not read `room.userNote`
 * directly. Each direct read adds slightly different handling (`?? null`, `?.trim()`, `||
 * undefined`), and those differences make the screen and the prompt disagree. The symptom: the
 * settings list shows a note as attached while responses do not change.
 */
export function roomUserNote(room: { userNote?: string }): string | null {
	const note = normalizeChatUserNote(room.userNote ?? "");
	return note.length > 0 ? note : null;
}
