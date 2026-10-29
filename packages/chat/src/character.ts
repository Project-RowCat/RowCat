import type { ChatSoftDelete, ChatStamp, ChatSyncMeta } from "./model.ts";
import { freshChatSyncMeta } from "./model.ts";

/**
 * Characters the user added to this conversation.
 * - Not in seed.characters: the replay snapshot is immutable (ROOM_IMMUTABLE in sync-codec.ts).
 *   The first writer wins and divergence is logged. Opening it would rewrite the whole seed on
 *   every edit, and two devices adding characters at once would lose one of them.
 * - Child records, not an array on the room record, so each character has its own identity and
 *   revision for sync merges. Otherwise every edit and delete collapses into a room-level
 *   overwrite.
 * - Not memory. Memory is a fact; a character is a participant. The prompt places characters in
 *   the cast block so the model reads them as 'who is in this story'. Memory is trimmed to a
 *   budget, but characters are not: a silently dropped character leaves the model answering without
 *   it.
 * - Two fields only: name and a free-form prompt. The legacy five-field layout was not restored.
 *   Fields that do not map to clear questions become obstacles, and users write anywhere anyway.
 * - Characters supplied by the work cannot be edited or hidden here. This record only adds. Seed
 *   characters have no id, so renaming one would silently break its override.
 * - Out of scope: avatars, relationships, state, tags, and a global character library. A global
 *   library would make a library edit change past conversations, a question to answer separately
 *   (see persona.ts).
 */

/**
 * The id is a globally stable string for the same reason: the local primary key is the sync
 * identity. Looking up by name would change identity on every rename, and the same character on
 * another device would become a separate record, with both kept.
 */
export interface ChatCharacter extends ChatSyncMeta, ChatSoftDelete {
	id: string;
	/** Parent room. Characters are not shared across rooms; a global library is outside this slice. */
	roomId: string;
	/** Name shown in the UI and used in the prompt. Limited by CHAT_CHARACTER_NAME_MAX_LENGTH. */
	name: string;
	/**
	 * Free-form text describing the character, as one block. It may be empty: a name-only character is
	 * valid, because even the name alone informs the model.
	 */
	prompt: string;
	/** ISO 8601 timestamp. It is the sort axis for lists. */
	createdAt: string;
	updatedAt: string;
}

/**
 * Name length limit. It need not match the persona limit, but it serves the same role in the same
 * place. Keeping the two equal avoids re-justifying a difference each time.
 */
export const CHAT_CHARACTER_NAME_MAX_LENGTH = 60;

/**
 * Prompt length limit, set well above one memory (1,000 characters) on purpose. A memory is one
 * fact, while a character card holds background, personality and speech style in one block. With a
 * memory-sized limit, users would split a character across entries because of the cap, not because
 * of a lack of fields.
 */
export const CHAT_CHARACTER_PROMPT_MAX_LENGTH = 4_000;

/**
 * Upper bound on living characters per room. It limits accumulation, not budget, for the same
 * reason as the memory cap. Characters are never cut by budget, so without a cap a room would send
 * hundreds on every turn and the model could not keep track of them all. 40 is far above what is
 * typed by hand, so reaching it means the list is being used for something else.
 */
export const CHAT_CHARACTER_MAX_PER_ROOM = 40;

export type ChatCharacterIssue = "empty" | "too_long";

/**
 * Checks whether a name can be stored. It is not skipped because the screen validates: this is
 * called from more than one place (web form, mobile form, tests). An invalid value would ride the
 * next sync and be rejected by the receiving device's decoder, so the character would never arrive
 * there. Length is counted in code points, for the same reason as the memory length check.
 */
export function checkCharacterName(
	input: string,
): { ok: true; name: string } | { ok: false; reason: ChatCharacterIssue } {
	const name = input.trim();
	if (name.length === 0) return { ok: false, reason: "empty" };
	if ([...name].length > CHAT_CHARACTER_NAME_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, name };
}

/**
 * Checks whether a prompt can be stored. Empty values pass. This differs from the name: a character
 * without a name cannot be referenced, but one without a description is a complete value.
 */
export function checkCharacterPrompt(
	input: string,
):
	| { ok: true; prompt: string }
	| { ok: false; reason: Extract<ChatCharacterIssue, "too_long"> } {
	const prompt = input.trim();
	if ([...prompt].length > CHAT_CHARACTER_PROMPT_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, prompt };
}

/**
 * Error for a rule violation. The error type is preserved so the screen knows what to say. The
 * storage layer throws this outside the transaction for that reason (setRoomPersona does the same).
 * Thrown inside a transaction callback, the failure would be wrapped in an abort, and the screen
 * could not tell which field was rejected or why.
 */
export class ChatCharacterFieldError extends Error {
	/**
	 * Does not use parameter properties (constructor(readonly field: ...)). apps/api runs with
	 * erasableSyntaxOnly, which requires syntax that is only erased and never executed. The server
	 * imports this package, so the constraint applies here too.
	 */
	readonly field: "name" | "prompt";
	readonly reason: ChatCharacterIssue;
	constructor(field: "name" | "prompt", reason: ChatCharacterIssue) {
		super(`character ${field}: ${reason}`);
		this.name = "ChatCharacterFieldError";
		this.field = field;
		this.reason = reason;
	}
}

/** Last check before storage. Only values that pass reach the record. */
export function requireCharacterName(input: string): string {
	const checked = checkCharacterName(input);
	if (!checked.ok) throw new ChatCharacterFieldError("name", checked.reason);
	return checked.name;
}

export function requireCharacterPrompt(input: string): string {
	const checked = checkCharacterPrompt(input);
	if (!checked.ok) throw new ChatCharacterFieldError("prompt", checked.reason);
	return checked.prompt;
}

/**
 * The room has reached the character cap. Gives the screen grounds to say which character must be
 * removed first.
 */
export class ChatCharacterLimitError extends Error {
	readonly limit = CHAT_CHARACTER_MAX_PER_ROOM;
	constructor() {
		super(
			`a conversation cannot hold more than ${CHAT_CHARACTER_MAX_PER_ROOM} characters`,
		);
		this.name = "ChatCharacterLimitError";
	}
}

export interface CreateCharacterInput {
	roomId: string;
	name: string;
	/** If omitted, the character is name-only. */
	prompt?: string;
}

/**
 * Partial update: keys that are absent are left untouched. Not typed as Partial<ChatCharacter>,
 * because that would let callers modify id, roomId, the revision, and the tombstone. In practice
 * users edit only these two fields.
 */
export interface UpdateCharacterPatch {
	name?: string;
	prompt?: string;
}

export function createCharacterRecord(
	input: CreateCharacterInput,
	stamp: ChatStamp,
): ChatCharacter {
	return {
		id: stamp.id,
		roomId: input.roomId,
		name: requireCharacterName(input.name),
		prompt: requireCharacterPrompt(input.prompt ?? ""),
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

/**
 * The list and the prompt use the same order: creation order. Not name order, because localeCompare
 * can differ between devices. The same room's prompt would then be assembled differently on each
 * device, which breaks the cache prefix and makes one conversation drift between devices.
 *
 * Same-timestamp ties are broken by id. Without a tiebreaker, two characters could swap places
 * between runs, since sort stability is not relied on.
 */
export const sortCharacters = (
	characters: readonly ChatCharacter[],
): ChatCharacter[] =>
	[...characters].sort((a, b) => {
		if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
