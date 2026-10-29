import type {
	ChatCharacter,
	CreateCharacterInput,
	UpdateCharacterPatch,
} from "./character.ts";
import type { AssistantContinuation } from "./continuation.ts";
import type { ChatIntensity } from "./intensity.ts";
import type {
	ChatMemory,
	CreateMemoryInput,
	UpdateMemoryPatch,
} from "./memory.ts";
import type { ChatMaintenancePlan } from "./memory-maintenance.ts";
import type {
	AppendMessageInput,
	ChatMessage,
	ChatRoom,
	CreateRoomInput,
	UpdateMessagePatch,
} from "./model.ts";
import type { ChatNarrationSettings } from "./narration.ts";
import type {
	ChatPersona,
	ChatPersonaSnapshot,
	CreatePersonaInput,
	UpdatePersonaPatch,
} from "./persona.ts";
import type { ChatSummary } from "./summary.ts";
import type { ChatTailRewrite } from "./tail-rewrite.ts";

/**
 * The local storage port: the boundary between pure conversation rules and actual persistence.
 *
 * - The interface is justified because its two implementations are already known: web uses Dexie
 *   (IndexedDB) and mobile will use SQLite. Only operations that really happen are listed. There is
 *   no Repository factory, UnitOfWork or entity manager, since those layers would absorb no real
 *   difference and would blur the transaction boundaries each implementation must keep.
 * - Transactions are not exposed. That `appendMessage` bumps the room's `updatedAt` in the same
 *   step is part of this contract; how each implementation makes it atomic is up to it.
 * - Two contracts apply to every implementation:
 * 1. Soft deletes are invisible. No query returns records with `deletedAt` set, including
 *    messages of deleted rooms. Rows stay, because future sync must learn about deletions, but that
 *    is a storage concern, not a screen concern. 2. No operation revives a deleted record. A late
 *    stream completion or a write from another tab must not overwrite a tombstone, or the user sees
 *    a deleted conversation come back.
 */
export interface ChatStore extends ChatMemoryStore, ChatPersonaStore {
	/**
	 * Creates a room. The implementation generates the id, since a device-owned identity needs no
	 * server round-trip. Returns the created record so the caller can navigate straight to
	 * `/chat/:id`.
	 */
	createRoom(input: CreateRoomInput): Promise<ChatRoom>;

	/** One room, or null. A room outside this scope is 'not found', not an error. */
	getRoom(id: string): Promise<ChatRoom | null>;

	/** Rooms in most-recent-activity order. */
	listRooms(): Promise<ChatRoom[]>;

	/**
	 * Returns a page of recent messages in ascending order (oldest first), matching the order the
	 * screen draws. Storage reads are cheaper newest-first (reverse index plus limit), but exposing
	 * that order would make every caller reverse it, and missing one would show a conversation
	 * backwards. `before` means strictly older than that message (exclusive). Using the message id as
	 * the cursor means loading older pages neither repeats nor skips messages when new ones arrive,
	 * which an offset cannot guarantee.
	 */
	listRecentMessages(
		roomId: string,
		input?: { limit?: number; before?: string },
	): Promise<ChatMessage[]>;

	/**
	 * Every live message in the room, ascending. It sits beside the paged query for one caller: room
	 * search, which must read the whole conversation because the wanted text is often far up. Widening
	 * a window and querying repeatedly would turn one keystroke into several queries. The signature
	 * has no search-term argument on purpose: storage does not know what is sought, and matching
	 * happens in memory (`search.ts`). If the query crossed this boundary, the next step would always
	 * be an index, which would store a second plaintext copy of the user's messages. Missing or
	 * deleted rooms return an empty list, not an error.
	 */
	listAllMessages(roomId: string): Promise<ChatMessage[]>;

	/**
	 * Appends a message and bumps the room's activity time in the same transaction. Splitting them
	 * would leave a message that exists while the room still sorts by a months-old time if the browser
	 * dies in between. To the user these are one action, so the save must be one action too.
	 */
	appendMessage(input: AppendMessageInput): Promise<ChatMessage>;

	/**
	 * Updates a stored message and bumps the room's activity time in the same transaction. A missing
	 * message is silently ignored: callers are on the stream-completion path, and the user may have
	 * left the room meanwhile, so an error would be spurious.
	 */
	updateMessage(id: string, patch: UpdateMessagePatch): Promise<void>;

	/**
	 * Attaches a continuation to an assistant message that was cut off by the output limit, as one
	 * logical edit and one revision. It is not `updateMessage` with a patch, because a merge is not a
	 * patch: the next body derives from the currently stored body (appending text, summing usage,
	 * attaching scene images, cleaning display text). If the read and write were separate
	 * transactions, a write in between would be silently overwritten. The rule is the single function
	 * `extendAssistantRecord` (continuation.ts), which the store calls inside its own transaction, so
	 * Dexie on web and SQLite on mobile produce the same body on every device. The room's activity
	 * time moves too, since continuing is conversation activity. Missing, deleted or user messages,
	 * and empty continuations are skipped silently, as in `updateMessage`.
	 */
	extendMessage(id: string, continuation: AssistantContinuation): Promise<void>;

	/** Bumps only the room's activity time. Used by changes that do not add a message. */
	touchRoom(roomId: string): Promise<void>;

	/**
	 * Renames a room: one logical edit, one revision. The operation is narrow on purpose. A generic
	 * `updateRoom(id, Partial<ChatRoom>)` would let callers touch `seed`, `adult`, `originStoryId`,
	 * `createdAt` and sync metadata, none of which the user edits (the acquisition snapshot is
	 * immutable, so its merge rules differ). Calling put and then touchRoom would issue two revisions
	 * and expose the intermediate state (new title, old activity time). The title rule is re-checked
	 * here (`requireRoomTitle`), so a second screen cannot make it diverge. A rejected title throws
	 * `ChatRoomTitleError`; it is never silently trimmed. A missing or deleted room is a no-op,
	 * because a late rename from another tab must not overwrite a tombstone and bring a deleted
	 * conversation back.
	 */
	renameRoom(id: string, title: string): Promise<void>;

	/**
	 * Sets which persona the user plays in this conversation, as one logical edit and one revision. It
	 * takes a value, never a library id: with an id, storage would have to look the library up, and
	 * deleting a library entry would lose the speaker of old messages (see the header of
	 * `persona.ts`). `null` clears the room's override rather than meaning 'no role': the work's
	 * suggested partner shows again, and if there is none, the assembler's default name is used
	 * (`effectiveChatPersona`). The value is not copied down from the upstream layer, because a copy
	 * would make it impossible to tell the work's default from a choice the user actually made. The
	 * name and description are re-checked here (`requirePersonaName`), since a rule diverging across
	 * screens would surface after sync as a rejection by the receiving device. Stored message speakers
	 * never change; past speech stays with the role it was spoken under. A missing or deleted room is
	 * a no-op, because a late selection must not overwrite a tombstone.
	 */
	setRoomPersona(
		roomId: string,
		persona: ChatPersonaSnapshot | null,
	): Promise<void>;

	/**
	 * Sets or clears the room's narration style, as a narrow operation like the ones above. It stores
	 * only the three product values (range, density, character cards). Which narration body runs for a
	 * turn is decided at execution time by `resolveNarrationExecution`, not stored, because storing a
	 * model key would leave a room pointing at a body it can no longer open after a model change.
	 * `null` means no narration pack; there is no inherited layer, so clearing and turning off are the
	 * same and are stored as the absence of the key (`applyRoomNarration`). A missing or deleted room
	 * is a no-op.
	 */
	setRoomNarration(
		roomId: string,
		narration: ChatNarrationSettings | null,
	): Promise<void>;

	/**
	 * Sets or resets the room's expression intensity. It is a narrow operation, and it sits next to
	 * `adult`, so a broad operation would let callers write the rating too; the rating is immutable
	 * (`ROOM_IMMUTABLE`). The rating is deliberately not checked here. Storing `intense` in a room
	 * rated for all ages is allowed: that value does not apply during a turn (`resolveChatIntensity`),
	 * and the screen never offers it (`chatIntensityChoices`). Re-checking the rating here would
	 * duplicate the rule a third place, and the user's choice would be erased whenever adult
	 * verification briefly lapsed. `null` resets to the default, represented as the absence of the key
	 * (`applyRoomIntensity`). A missing or deleted room is a no-op.
	 */
	setRoomIntensity(
		roomId: string,
		intensity: ChatIntensity | null,
	): Promise<void>;

	/**
	 * Writes or clears the room's user note, as a narrow operation. The length limit is re-checked
	 * here (`requireChatUserNote`), because a limit that differs between screens would let an
	 * oversized note into every turn's prompt, where the user would see the model forget earlier
	 * conversation. `null` and an empty value mean the same thing: no note is applied
	 * (`applyRoomUserNote`). A missing or deleted room is a no-op.
	 */
	setRoomUserNote(roomId: string, userNote: string | null): Promise<void>;

	/*
	 * Characters are the room's fourth child. They share the four-operation shape of memory and are
	 * cascade-deleted with the room for the same reason (`deleteRoom`, `applyTombstone`).
	 */

	/**
	 * The room's live characters in display order (`sortCharacters`). Empty array if there are none.
	 */
	listCharacters(roomId: string): Promise<ChatCharacter[]>;

	/**
	 * Creates a character. Name and body rules are re-checked by storage (`requireCharacterName`),
	 * because a rule diverging across screens would be rejected by the receiving device's decoder on
	 * the next sync. Throws when the per-room cap (`CHAT_CHARACTER_MAX_PER_ROOM`) is reached: silently
	 * dropping the excess would show the user a character they created missing from the list.
	 */
	createCharacter(input: CreateCharacterInput): Promise<ChatCharacter>;

	/**
	 * Updates a character. Keys absent from the patch are left alone. The room's activity time is not
	 * bumped, as with memory edits: refining an old room's character description must not move that
	 * conversation to the top of the list as if the user had done something new. A missing or deleted
	 * character is a no-op.
	 */
	updateCharacter(id: string, patch: UpdateCharacterPatch): Promise<void>;

	/** Soft-deletes a character. Idempotent, for the same reason as above. */
	deleteCharacter(id: string): Promise<void>;

	/**
	 * Returns the room's routing-friendly key, issuing and persisting one if it does not exist yet.
	 * The method is named `ensure` rather than `set` on purpose: callers do not choose the value (the
	 * only argument is the room id), and the issuer lives in storage. If callers could supply it, a
	 * room or account id could end up in that slot and break the opacity of this key. When a key
	 * already exists nothing is written: no revision and no dirty flag, because this runs every turn
	 * and a write would re-upload the room record each time. `updatedAt` is not bumped either, since
	 * this is an internal fill-in for old records, not conversation activity. A missing or deleted
	 * room returns null and is not revived; the turn then goes out without a routing key, the same
	 * request as before the key existed.
	 */
	ensureRoomRoutingSession(roomId: string): Promise<string | null>;

	/**
	 * Soft-deletes a room together with its messages, memories, summary and characters, all in one
	 * transaction. Forgetting any child leaves an orphaned character on this device that the next
	 * outbound sync would upload again, bringing back data from a deleted room. The receiving side's
	 * cascade (`applyTombstone`) must cover the same four children; fixing only one side would show up
	 * only after a round trip between two devices. Cascaded children get no tombstones of their own,
	 * because the room's tombstone stands in for the whole subtree (see `markCascadeDeleted`). A
	 * missing or deleted room is a no-op, since the same room can be deleted from two tabs and the
	 * second call must not fail.
	 */
	deleteRoom(id: string): Promise<void>;

	/**
	 * Soft-deletes one message and bumps the room's activity time in the same transaction. A missing
	 * or already-deleted message is a no-op.
	 */
	deleteMessage(id: string): Promise<void>;

	/*
	 * The two methods below are one operation seen from two sides. The rule for choosing what to
	 * delete lives in one place, `tail-rewrite.ts` (`selectChatTail`), and the screen's three actions
	 * (edit, regenerate, delete from here) are built on it.
	 *
	 * They are not split into separate storage operations. For storage, regenerate is identical to
	 * `deleteFromMessage`; the only difference is whether a new generation starts afterward, which is
	 * a screen decision. A `regenerate` method would make the port aware of the generation lifecycle.
	 *
	 * Each operation completes four steps in one transaction: check the anchor (alive, and for edits,
	 * the role matches), select and tombstone the tail, update the anchor's content (edits only), and
	 * bump the room's activity time. Splitting them would allow an edited user message next to
	 * responses generated from the old text, which the screen would show as a confirmed conversation.
	 *
	 * Messages removed as part of a tail each get their own tombstone, unlike a room cascade, because
	 * there is no parent tombstone to stand in for them. Without per-message tombstones, other devices
	 * would still think the messages exist and re-upload them.
	 */

	/**
	 * Edits a user message and deletes everything after it. There is no option to keep the tail: the
	 * remaining responses were generated from the message as it was, so after an edit they would carry
	 * a false causal link with no visible marker, and the next turn's context would include it.
	 * Content is re-checked (`requireMessageContent`): empty content throws `ChatMessageContentError`,
	 * and an assistant message throws `ChatMessageRoleError`. The method never silently turns the edit
	 * into a delete or ignores the role. A missing or already-deleted message returns `applied: false`
	 * and changes nothing; callers rely on that to avoid starting a new generation.
	 */
	editUserMessage(id: string, content: string): Promise<ChatTailRewrite>;

	/**
	 * Edits an assistant response and deletes everything after it, with the same tail rule as user
	 * edits.
	 *
	 * The role is not passed as an argument, as it could be in `editUserMessage(id, content, role)`. A
	 * role argument would make the role a request value, so a call could write `user` onto an
	 * assistant record, and storage would need one more check to reject it. With one method per role,
	 * each pins its role as a value (`requireEditableRole(target.role, 'assistant')`), so a mismatched
	 * call cannot pass.
	 *
	 * What stays unchanged: the role (still assistant), the speaker (assistant records carry none),
	 * model and usage (they describe the request that produced the text, not the current text), and
	 * `truncated` and `incomplete`. Keeping `truncated` is intentional: an edited but still cut-off
	 * response remains cut off, and the user must still be able to continue it. Clearing the flag
	 * would leave only Regenerate. Content is re-checked (`requireMessageContent`); empty content
	 * throws `ChatMessageContentError`, and a user message throws `ChatMessageRoleError`. A missing or
	 * already-deleted message returns `applied: false` and changes nothing.
	 */
	editAssistantMessage(id: string, content: string): Promise<ChatTailRewrite>;

	/**
	 * Soft-deletes this message and everything after it. Used by both `Delete from here` and `Regenerate`. There is
	 * deliberately no operation for removing one message in the middle: in a linear conversation where
	 * user and assistant alternate, removing one leaves responses answering a message that no longer
	 * exists, and every later turn drifts further. `deleteMessage` remains because it is a different
	 * operation, a single-message cleanup that leaves the tail alone. A missing or already-deleted
	 * message returns `applied: false` (idempotent).
	 */
	deleteFromMessage(id: string): Promise<ChatTailRewrite>;
}

/**
 * The narrow memory API: six operations for one room.
 *
 * It has its own interface, but `ChatStore` extends it, because deleting a room must remove its
 * messages and memories in one transaction. Splitting the stores would make that atomicity
 * impossible to express: an IndexedDB transaction is atomic only within one connection, and with
 * two ports a caller makes two calls with a window between them, leaving orphaned memories. The
 * interface is a vocabulary boundary: it shows what screens may touch, while implementation and
 * lifetime stay with the single conversation store.
 *
 * Contracts that apply across the implementation:
 * 1. Deleted things are invisible. No query returns a deleted memory or a memory of a deleted
 *    room.
 * 2. No operation revives a deleted room. A late UI callback, such as a memory window open in
 *    another tab, must not recreate the room record.
 * 3. Edits preserve identity. A content edit does not delete and recreate. Otherwise another
 *    device sees one memory removed and one added, and merging loses the basis to compare the two
 *    versions.
 * 4. Automatic maintenance cannot change human-written memories. The implementation checks each
 *    target's `source`, and operations aimed at manual memories are skipped without throwing, since
 *    a throw would discard the progress of the entire batch.
 */
export interface ChatMemoryStore {
	/**
	 * The room's live memories: pinned first, then most recently edited (`sortMemories`). Storage sets
	 * the order because it has two callers, the screen and context assembly. If each sorted on its
	 * own, the memory at the top of the screen and the one placed first in the prompt could diverge,
	 * and users could not predict which entry the budget drops. A missing or deleted room gives an
	 * empty list.
	 */
	listMemories(roomId: string): Promise<ChatMemory[]>;

	/**
	 * Creates a memory. The id is generated by storage, as for rooms and messages. Creating into a
	 * missing or deleted room throws, while updates and deletes silently do nothing. The asymmetry is
	 * deliberate: updates and deletes can treat 'already in that state' as success, but a create must
	 * return a record and has no quiet answer to give. Succeeding silently would mean inventing a
	 * memory that vanishes on the next read. Content rules (`requireMemoryContent`) and the per-room
	 * cap (`CHAT_MEMORY_MAX_PER_ROOM`) are re-checked by storage, as with characters.
	 */
	createMemory(input: CreateMemoryInput): Promise<ChatMemory>;

	/**
	 * Edits a stored memory, as one logical edit and one revision. A missing or deleted memory is a
	 * no-op. A deleted room's memories are already tombstoned by the cascade, so the same rule
	 * applies: no structural path edits a deleted room's memory back into life.
	 */
	updateMemory(id: string, patch: UpdateMemoryPatch): Promise<void>;

	/**
	 * Soft-deletes a memory; this is not a hard delete. A removed row cannot tell another device that
	 * it was deleted, and that device would resurrect its copy at the next sync. A missing or
	 * already-deleted memory is a no-op (idempotent).
	 */
	deleteMemory(id: string): Promise<void>;

	/*
	 * The next two methods belong on the memory port for the same reason as the four above:
	 * transactions. A maintenance commit writes a summary record and several memories together, and
	 * room deletion must take all three with it. Splitting the port would leave no way to express that
	 * atomicity at the interface level.
	 */

	/**
	 * The room's summary state, or null if maintenance has never run. A missing or deleted room also
	 * gives null, following the rule of the other reads. The summary is not folded into `getRoom`,
	 * because `getRoom` is the hottest read (lists, headers, navigation) and the summary is needed
	 * only when generation starts.
	 */
	getSummary(roomId: string): Promise<ChatSummary | null>;

	/**
	 * Commits a validated maintenance plan in one transaction. Returns `true` if it was applied. The
	 * single transaction is the atomicity of this slice: split up, a crash between saving the summary
	 * and advancing the frontier would either process a range without recording it or record it
	 * without processing it, and the same facts would be extracted again. Optimistic concurrency is
	 * checked inside the transaction (`maintenanceStillApplies`): if history was rewritten or another
	 * maintenance committed first, the generation or frontier differs, and the method writes nothing
	 * and returns `false`. Checking outside and writing inside would leave a window where that
	 * guarantee fails. If one operation's target has disappeared meanwhile, only that operation is
	 * skipped. If the room was deleted, nothing is written and the result is `false`, so a deleted
	 * room is not revived. Human-written memories are never changed: the plan already filters them
	 * (`planMemoryMaintenance`), and the implementation checks `source` once more, so storage does not
	 * trust the plan.
	 */
	applyMemoryMaintenance(
		plan: ChatMaintenancePlan & { roomId: string },
	): Promise<boolean>;
}

/**
 * The persona library's narrow API: five operations and nothing else.
 *
 * It is a separate interface, but not for the reason memory is: personas are not children of rooms
 * and have no cascade. The justification is lifetime. Records live in the per-member local
 * database, whose connection lives exactly as long as the conversation store. Splitting the port
 * would give the screen and the activation layer two handles on one connection, and two copies of
 * the ownership check.
 *
 * Contracts that apply:
 * 1. Deleted personas are invisible.
 * 2. No operation revives a deleted persona.
 * 3. Deleting a library entry never touches rooms. A room holds a copy of the values and has
 *    nothing to point at, so the non-cascade is structural: it cannot happen, rather than being
 *    skipped on purpose (see the header of `persona.ts`).
 */
export interface ChatPersonaStore {
	/**
	 * The account's live personas, most recently edited first (`sortPersonas`). Storage sets the order
	 * because two screens use it, the library and the room settings picker. Sorting separately would
	 * show the same library in two orders, a difference visible only side by side.
	 */
	listPersonas(): Promise<ChatPersona[]>;

	/** One persona, or null. Something outside this scope is 'not found', not an error. */
	getPersona(id: string): Promise<ChatPersona | null>;

	/**
	 * Creates a persona; the id is generated by storage. Returns the created record so the caller can
	 * apply it to a room right away, which is the create-then-choose flow the return value exists for.
	 * Name and description rules are re-checked by storage (`createPersonaRecord`).
	 */
	createPersona(input: CreatePersonaInput): Promise<ChatPersona>;

	/**
	 * Updates a stored persona, as one logical edit and one revision. Values already copied into a
	 * room do not follow. Renaming here leaves the speaker and prompt of old conversations started
	 * with that persona unchanged. Making them follow would change conversations the user never
	 * touched, and that change cannot be undone; to change a room, pick the persona again in that
	 * room. A missing or deleted persona is a no-op.
	 */
	updatePersona(id: string, patch: UpdatePersonaPatch): Promise<void>;

	/**
	 * Soft-deletes a persona, not a hard delete, for the same reason as memory: a removed row cannot
	 * tell another device about the deletion, and that device would bring it back at the next sync. No
	 * room is touched. Conversations already using the persona keep their own copy and continue
	 * unchanged, because deleting removes a row from the picker, not the identity of conversations
	 * already started. A missing or deleted persona is a no-op.
	 */
	deletePersona(id: string): Promise<void>;
}

/**
 * The default number of messages read at once. Not everything is read, because a conversation can
 * span years. Fifty is a few screens' worth, so the first open leaves room to scroll up, and it
 * still fits one read.
 */
export const CHAT_MESSAGE_PAGE_SIZE = 50;
