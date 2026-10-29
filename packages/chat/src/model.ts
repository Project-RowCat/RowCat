import type { StoryChatSeedDto } from "@rowcat/contracts/chat";
import type { Rev } from "@rowcat/contracts/sync";
import type { ChatIntensity } from "./intensity.ts";
import type { ChatNarrationSettings } from "./narration.ts";
import type { ChatPersonaSnapshot } from "./persona.ts";

/**
 * Product model for local chat: rooms and messages.
 *
 * The owner of these records is the device. The server does not issue them and is not the final
 * authority. That is why they are kept apart from `Story`, the server-owned public catalog: a room
 * is a copy taken from a work, not the work itself, and after acquisition it does not change when
 * the work changes.
 *
 * This package imports no React, Dexie, SQLite or fetch. The web (IndexedDB) and a future Expo
 * client (SQLite) share the same model. If storage differences changed the meaning of rooms and
 * messages, the two platforms' conversations would diverge.
 */

/**
 * The replay snapshot a room carries. It reuses the contract type directly, because two copies
 * would inevitably drift apart.
 */
export type ChatSeed = StoryChatSeedDto;

/**
 * Sync metadata. Nothing syncs yet, but records carry these fields from now on.
 *
 * Why not add them later: records stored without these fields cannot distinguish 'never uploaded'
 * from 'uploaded, with no record kept'. A first sync run in that state has no basis for deciding
 * which side is newer. Leaving room in the schema costs two fields; starting without them costs a
 * migration script.
 */
export interface ChatSyncMeta {
	/**
	 * Whether local changes have not yet reached the server. 1 on creation, 0 after server
	 * confirmation.
	 *
	 * This is 0 | 1 rather than a boolean because of IndexedDB. A boolean is not a valid index key, so
	 * it cannot be indexed (an index such as `rooms` over `dirty` cannot be built), and without an
	 * index each future push would scan the whole table to find its work. At 100,000 messages that
	 * scan is unusable. Using a number costs one migration now; changing it after sync is enabled
	 * would mean migrating data already exchanged with other devices.
	 *
	 * A future push must clear this flag together with the `rev` observed at collection time. If a
	 * record is edited again while a push is in flight, that edit would be marked clean along with it
	 * and never uploaded.
	 */
	dirty: 0 | 1;
	/**
	 * Last version confirmed by the server (optimistic concurrency). Records created only locally have
	 * 0.
	 *
	 * The server does not issue ids, which matters: a device must be able to create a room without a
	 * server round trip. So only the version comes from the server; the identity is local from the
	 * start.
	 */
	serverVersion: number;
	/**
	 * Merge revision (hybrid logical clock). **This is a different axis from `updatedAt`.**
	 *
	 * `updatedAt` is a wall-clock time for display and recency sorting. This value is a logical clock
	 * that decides which of two copies is later. Deciding by wall clock would let a device whose clock
	 * went backward lose its newest edit to its own older one, and the user would see text they just
	 * wrote disappear.
	 *
	 * Storage issues it, and must persist the clock state in the same transaction. This package only
	 * receives and carries it. If a pure model held the clock, each platform's clock would diverge.
	 */
	rev: Rev;
}

/**
 * Soft delete: a deletion that future sync can **propagate**.
 *
 * If a row were deleted outright, there would be no way to tell other devices it was deleted. They
 * would keep the record they still know about, and the next sync would bring it back, so a deleted
 * conversation would resurrect.
 *
 * The representation was added before the UI because the conversation list's delete (`/chats`)
 * writes this axis right away, and other devices see the same deletion as a tombstone. Adding a
 * delete axis later to records that are already syncing would have been a migration that also had
 * to preserve consistency with other devices. The authoring domain already uses the same shape
 * (`AuthoringSoftDelete`); both domains widen by the same rule so their delete semantics do not
 * diverge.
 *
 * Ordinary queries do not show records with this field set; storage enforces that (see the contract
 * in `store.ts`).
 */
export interface ChatSoftDelete {
	/** ISO 8601. `null` means alive. */
	deletedAt: string | null;
}

/** Whether a record is live. This is the predicate queries use. */
export const isLiveChatRecord = <T extends ChatSoftDelete>(
	record: T,
): boolean => record.deletedAt === null;

/**
 * Chat room: a local copy taken from a work.
 *
 * The core of this design is that `id` is a globally stable string (a UUID) from the start. The
 * legacy design kept a local integer id and a separate UUID for sync, and mapped between them
 * everywhere. That mapping spread through every path with a foreign key (messages, memories,
 * relations). Being new, there is no reason to inherit that debt: the local primary key is the
 * future sync identity.
 */
export interface ChatRoom extends ChatSyncMeta, ChatSoftDelete {
	/**
	 * Globally stable id, created by the device with no server round trip. The URL `/chat/:roomId`
	 * uses this value.
	 */
	id: string;
	/**
	 * Source work id. **Not the source of truth for content.** After acquisition, the room's content
	 * belongs to `seed`. The room still opens if the work is later made private or deleted.
	 */
	originStoryId: string | null;
	title: string;
	/**
	 * The work's rating, inherited by the room. The safety guard checks this value before the member
	 * setting.
	 */
	adult: boolean;
	/** A room started from a protected prompt copy. Creative prompts are never shown on screen. */
	promptProtected: boolean;
	/**
	 * Replay snapshot: a self-contained copy, so the work does not have to be fetched again on every
	 * turn.
	 */
	seed: ChatSeed;
	/**
	 * The role the user plays in this conversation. **Unlike `seed`, this value is mutable.**
	 *
	 * It is the only mutable axis among the immutable fields, which is why this comment is long.
	 * `seed.persona` is the counterpart the work proposed; it is fixed at acquisition. This value is
	 * the user's own choice and can change mid-conversation. It is kept outside `seed` because putting
	 * it there would make the replay snapshot mutable, and the promise that this room stays the same
	 * after the work changes would be lost.
	 *
	 * It is a value, not a reference: `ChatPersonaSnapshot` has no id. A reference to a library row
	 * would mean that editing or deleting the row changes the speaker of old conversations. The full
	 * rationale is in the header of `persona.ts`.
	 *
	 * Optional on purpose. Rooms created before this axis existed have no such key, and absent and
	 * `null` both mean 'no override', so the work's proposal applies. Making it required would force a
	 * rewrite of every room already on devices, and that migration buys only the shape of the type
	 * (the message usage axis made the same call).
	 *
	 * All reads go through `effectiveChatPersona`. Code that reads this field directly restates the
	 * priority order, and that restatement belongs in `effectiveChatPersona` only.
	 */
	persona?: ChatPersonaSnapshot | null;
	/**
	 * How the conversation is written: the narration style. It is the mutable counterpart to the role
	 * above.
	 *
	 * The role says who the user is in this conversation; the narration style says who writes that
	 * character. They answer one question together. The value lives on the room record rather than in
	 * device preferences (`GenerationPreference`), because a story started with autoplay that returns
	 * on another device as ordinary chat is not a missed setting: it is a different story.
	 *
	 * The cost is that the value is a wish. Density and texture are decided by the model, which
	 * differs per device. What is actually sent on a given turn is answered by
	 * `resolveNarrationExecution`. Code that reads this value directly to build a prompt would, on a
	 * model that cannot accept the pack, produce a state where only the protective sentence is kept
	 * and the narration pack is not assembled.
	 *
	 * Optional on purpose. Rooms created before this axis have no key, and absent means the same as
	 * `null`: no pack is used. Making it required would force a rewrite of every stored room, for only
	 * the shape of the type (persona and routing key made the same call).
	 */
	narration?: ChatNarrationSettings | null;
	/**
	 * How strongly descriptions are written in this conversation. A mutable axis, paired with the
	 * narration style.
	 *
	 * This contrasts with the rating (`adult`) in the immutable field above. The rating decides what
	 * may be written and is fixed at acquisition. Intensity is the user's own choice of how much to
	 * show within that range, and it can change mid-conversation. Merging the two would make
	 * 'age-verified, but I want it toned down' impossible to represent.
	 *
	 * It cannot exceed the rating. `Intense` can be chosen only in adult-rated rooms, and its block
	 * is added only when running in adult mode (`resolveChatIntensity`). On top of that, the server's
	 * rating guard wraps the prompt without knowing about this axis. The full rationale is in the
	 * header of `intensity.ts`.
	 *
	 * Optional, and the absence is intended: absent means `Default`, and that is the only
	 * representation (`applyRoomIntensity` deletes the key). Rooms created before this axis lack the
	 * key, which is exactly the right representation. Making it required would force a rewrite of
	 * every stored room, for only the shape of the type (persona, narration style and user note made
	 * the same call).
	 */
	intensity?: ChatIntensity;
	/**
	 * A direct instruction the user writes for this conversation. Like the values above, this is a
	 * mutable axis.
	 *
	 * Role and narration style decide *who writes* from a closed vocabulary. This is the free-text
	 * place for whatever that vocabulary cannot express. It becomes one block in the prompt; the
	 * assembler (`context.ts`) decides where that block goes. Depth is not an axis of this record.
	 *
	 * It is a field of the room, not a memory (`chat.memory`), and that is the point. Memories are
	 * facts: many accumulate, the budget includes only some, and automatic maintenance writes to the
	 * same table. A note is a single value, is never truncated, and is written only by the person. As
	 * child records, a room could end up with two notes, and then no one could say which one applies.
	 *
	 * Optional, and absence is intended. Rooms created before this axis have no key, and absent and an
	 * empty string mean the same thing: no note applies. There is one representation:
	 * `applyRoomUserNote` sets or clears it, and `roomUserNote` reads it.
	 */
	userNote?: string;
	/**
	 * The routing-friendly key for this conversation. Nothing in it enters the prompt.
	 *
	 * Its meaning is one thing: requests leaving this room are continuations of one conversation. When
	 * managed generation tells the gateway that, the next turn goes to the same provider endpoint as
	 * the previous one, where the prompt prefix cache is already warm. Roleplay resends a large stable
	 * prefix every turn (safety guard, scenario, persona, lore, summary), so the hit rate is the cost.
	 * The full rationale is in the `RoutingSessionId` header in `@rowcat/contracts`.
	 *
	 * It is not derived from `id`. If it were, this value would be just another representation of the
	 * room id, and the server having no such room would collapse on the routing axis. Upstream systems
	 * could then correlate the same user's conversation. It is an independent random value, issued at
	 * creation (`ChatRoomStamp`).
	 *
	 * It does not change once set. Changing the title, role, model, reasoning effort or response
	 * length, or editing or regenerating messages, leaves it as is. Changing it resets the room's
	 * cache locality, which defeats the purpose of having the field.
	 *
	 * Optional, and absence is intended. Rooms created before this axis lack the key, and absence
	 * means 'not yet issued'. Such a room receives one just before its next generation, and that value
	 * is persisted (`ChatStore.ensureRoomRoutingSession`). Making it required would force a rewrite of
	 * every stored room, for only the shape of the type (persona made the same call).
	 */
	routingSessionId?: string;
	/** ISO 8601. */
	createdAt: string;
	/**
	 * Last activity time. It orders the list and serves as the future sync revision token. The
	 * transaction that appends a message must update this value in the same write.
	 */
	updatedAt: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage extends ChatSyncMeta, ChatSoftDelete {
	id: string;
	roomId: string;
	role: ChatRole;
	/**
	 * The speaker's name. For user messages this is the persona name; if empty, the assembler uses a
	 * default. Assistant messages leave it empty because several characters may appear in one
	 * response.
	 */
	speaker: string;
	content: string;
	createdAt: string;
	updatedAt: string;

	/*
	 * Generation meta: on assistant messages only, and only when the provider reported it.
	 *
	 * No path carries billing. Managed generation runs unmetered (the server once metered tokens for
	 * billing, but that went away with payments; see `docs/oss/PLAN.md` step 3). BYO never reaches our
	 * ledger. The values stored here are this device's observations. Both paths still keep the same
	 * axis: whatever is computed later needs the raw tokens recorded at the time, and without them
	 * that span would remain an estimate forever.
	 */
	/** The model that actually responded. It may differ from the requested model. */
	model?: string;
	/**
	 * Total input tokens for this response, including the portion read from cache.
	 *
	 * The three values below are stored together so a conversation can be reconstructed later. The
	 * total alone cannot recover the cache ratio, and the cache portion alone does not give the total.
	 * All three are present only when the provider reports them.
	 */
	inputTokens?: number;
	/** The part of `inputTokens` read from the provider's prompt cache. */
	cachedInputTokens?: number;
	/**
	 * Tokens this request wrote to the provider's cache. Not subtracted from `inputTokens`; it is a
	 * separate axis.
	 */
	cacheWriteInputTokens?: number;
	outputTokens?: number;
	/**
	 * A response stored without a clean finish (stopped, or the connection dropped).
	 *
	 * The point is not to discard the content. The user has already read that text, and deleting it
	 * would make the characters vanish from the screen. Instead a marker is kept so the screen can say
	 * the response was cut off here.
	 */
	incomplete?: boolean;
	/**
	 * The provider stopped the response because it hit its **output limit**. This is a different fact
	 * from `incomplete`.
	 *
	 * `incomplete` means the provider's clean finish (`done`) was never seen. `truncated` means a
	 * clean finish was received, but its reason was the limit. Collapsing the two would make limit
	 * truncation indistinguishable from normal completion, which is exactly the state the code was in
	 * before this field existed.
	 *
	 * Both fields together answer whether a continuation should be offered (`assistantTailOpen`).
	 * Previously only `incomplete` answered that, on the reasoning that stopped or disconnected
	 * responses already have `Regenerate` in that turn. But a partially saved response's turn
	 * does not show that button, because the turn did get an answer, so such a response had nothing to
	 * press.
	 *
	 * The flag is cleared when a continuation finishes successfully. The decision always goes through
	 * `isTruncationFinishReason` in `continuation.ts`; the screen never reads raw provider values
	 * (`length`, `max_tokens`, `MAX_TOKENS`).
	 */
	truncated?: boolean;
}

/**
 * The maximum length of a room title that the user can enter, in characters.
 *
 * 80 is about twice the length that fits on one list line without cutting off: long enough to
 * recognize one's conversation, short enough that the list is not broken by one title. Storage does
 * not need this limit (IndexedDB accepts kilobytes), so the rationale is entirely on the screen
 * side.
 *
 * The rule lives in this package for the sake of the future Expo app. If validation existed only in
 * the web form, the 'title too long' rule would diverge once a second screen existed, and that
 * difference would persist in titles already stored on two devices.
 */
export const CHAT_ROOM_TITLE_MAX_LENGTH = 80;

/** The two reasons a title can be rejected. The screen picks its message from this value. */
export type ChatRoomTitleRejection = "empty" | "too_long";

export type ChatRoomTitleCheck =
	| { ok: true; title: string }
	| { ok: false; reason: ChatRoomTitleRejection };

/**
 * Trims leading and trailing whitespace. That is the entire normalization.
 *
 * Internal whitespace is not collapsed and line breaks are not removed. Keeping what the user typed
 * is more predictable, and the one-line list display is already truncated by CSS.
 */
export const normalizeRoomTitle = (input: string): string => input.trim();

/**
 * Whether an explicit rename can accept this value.
 *
 * **Unlike creation, an empty title is not folded to a default.** Creation can fold silently
 * because the title is secondary there (the snapshot title exists). A rename happens on a screen
 * the user opened to set that exact value. If they clear it and save, and it becomes `Untitled conversation`
 * (untitled conversation), something else has happened, and the user cannot tell what they did
 * wrong.
 *
 * Length is counted in code points. `String.length` counts UTF-16 code units, so an emoji counts as
 * 2, and only users who include emoji would get half the limit.
 */
export function checkRoomTitle(input: string): ChatRoomTitleCheck {
	const title = normalizeRoomTitle(input);
	if (title.length === 0) return { ok: false, reason: "empty" };
	if ([...title].length > CHAT_ROOM_TITLE_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, title };
}

/**
 * A rename that violated the title rules. The fact that storage does not trust the UI is recorded
 * in this error shape.
 */
export class ChatRoomTitleError extends Error {
	readonly reason: ChatRoomTitleRejection;
	constructor(reason: ChatRoomTitleRejection) {
		super(
			reason === "empty"
				? "a room title cannot be empty"
				: `a room title cannot exceed ${CHAT_ROOM_TITLE_MAX_LENGTH} characters`,
		);
		this.name = "ChatRoomTitleError";
		this.reason = reason;
	}
}

/**
 * A write that targets a room which does not exist or was already deleted.
 *
 * Most operations silently pass over this case, since idempotence is correct: the state is already
 * as requested. Only operations that must return a record have nowhere to pass over, and right now
 * that is `createMemory` alone. Failing silently there would mean fabricating a record that was
 * never stored. That fabricated record would render and then vanish on the next query, so the user
 * would see 'I wrote it and it disappeared'.
 */
export class ChatRoomMissingError extends Error {
	readonly roomId: string;
	constructor(roomId: string) {
		super("conversation not found");
		this.name = "ChatRoomMissingError";
		this.roomId = roomId;
	}
}

/**
 * The gate right before saving: returns the string to store, or throws.
 *
 * Storage implementations call this. It is not skipped just because the screen validates, since
 * there is more than one call site: a future mobile client, tests, and other screens not yet built.
 * A title that did not pass the rule, if stored locally, would be sent as-is in the next sync to
 * other devices.
 */
export function requireRoomTitle(input: string): string {
	const checked = checkRoomTitle(input);
	if (!checked.ok) throw new ChatRoomTitleError(checked.reason);
	return checked.title;
}

/**
 * The rename form's decision: a branch, not copy.
 *
 * The web's `rename-room.ts` held this decision. It moved here when there were two consumers (the
 * web dialog and the mobile sheet). `invalid` carries a reason instead of a sentence. Which values
 * are valid is decided in one place; each app has its own table that turns the reason into human
 * language.
 */
export type ChatRoomRenamePlan =
	| { kind: "invalid"; reason: ChatRoomTitleRejection }
	/**
	 * Nothing changed: close without writing.
	 *
	 * Writing is wrong because renaming is activity. A conversation opened and saved unchanged would
	 * move to the top of the list, and the user would read that as something they did.
	 */
	| { kind: "unchanged" }
	| { kind: "save"; title: string };

export function planRoomRename(
	input: string,
	currentTitle: string,
): ChatRoomRenamePlan {
	const checked = checkRoomTitle(input);
	if (!checked.ok) return { kind: "invalid", reason: checked.reason };
	if (checked.title === currentTitle) return { kind: "unchanged" };
	return { kind: "save", title: checked.title };
}

/**
 * The length the screen counts. It must use the same unit as storage: code points.
 *
 * Counting with `String.length` would double the displayed count only for users who include emoji,
 * and they would see 'nearly full' well before reaching the limit. Titles and memories use the same
 * function.
 */
export const chatTextLength = (input: string): number =>
	[...input.trim()].length;

/**
 * The values that must come from outside when a record is created: an id and a time.
 *
 * This package does not call `crypto.randomUUID()` or `Date.now()` directly, for two reasons. One
 * is the platform: Hermes on Expo needs a polyfill. The other is testing: as pure functions,
 * identical inputs produce identical records, so assembled results can be compared directly.
 */
export interface ChatStamp {
	id: string;
	/** ISO 8601. */
	now: string;
	/**
	 * The revision this record is born with. Storage takes it from the clock.
	 *
	 * It is not created here because the clock state is **persisted**. A pure function holding the
	 * clock would have to decide where to write that state, and the place differs per platform
	 * (IndexedDB on web, SQLite on mobile). Above all, issuing the revision and saving the record must
	 * be **one transaction**. If they split, the clock advances while the record never exists.
	 */
	rev: Rev;
}

/**
 * A second random value needed only when a room is created: the routing-friendly key.
 *
 * It is not added to `ChatStamp` because of the consumers. That type is shared by messages,
 * memories, summaries and personas, and none of them has this value. Adding it would force callers
 * of four factories to supply a value they do not use, and such a value eventually becomes a
 * constant.
 *
 * Required on purpose. If optional, a path would exist where a new room is created without this
 * key, and that room would live without cache locality until its first generation. The absence
 * would raise no error. Storage holds the issuer (`newLocalId`), so filling it costs one line.
 */
export interface ChatRoomStamp extends ChatStamp {
	/** A random value unrelated to the room id. The same value is never used twice. */
	routingSessionId: string;
}

export interface CreateRoomInput {
	originStoryId: string | null;
	seed: ChatSeed;
	/** If omitted, the snapshot's title is used. */
	title?: string;
	/**
	 * The role the user will play in this conversation. **It is set at the moment the room is
	 * created.**
	 *
	 * The point is that it is not attached afterward. The opening message replaces `{{user}}` on the
	 * room's first frame. If the role were applied later, the name the user chose would appear only
	 * after the work's default had been drawn once. If a first turn were sent in that gap, the name on
	 * screen would differ from the name the model received.
	 *
	 * If omitted, there is no override and the work's proposal applies.
	 */
	persona?: ChatPersonaSnapshot | null;
}

export interface AppendMessageInput {
	roomId: string;
	role: ChatRole;
	content: string;
	speaker?: string;
	model?: string;
	inputTokens?: number;
	cachedInputTokens?: number;
	cacheWriteInputTokens?: number;
	outputTokens?: number;
	incomplete?: boolean;
	truncated?: boolean;
}

/**
 * The parts of a stored message that may be overwritten. Identity (`id`, `roomId`, `role`) and
 * creation time do not change.
 */
export type UpdateMessagePatch = Partial<
	Pick<
		ChatMessage,
		| "content"
		| "speaker"
		| "model"
		| "inputTokens"
		| "cachedInputTokens"
		| "cacheWriteInputTokens"
		| "outputTokens"
		| "incomplete"
	>
>;

/**
 * Sync metadata for a new local record. The server has not seen it yet.
 *
 * Exported because record factories exist outside this module (`memory.ts`). If each one wrote `{
 * dirty: 1, serverVersion: 0, rev }` itself, the same fact would be spread across three places, and
 * when the default changed only one would be updated. The record would then misstate that it was
 * never uploaded.
 */
export const freshChatSyncMeta = (rev: Rev): ChatSyncMeta => ({
	dirty: 1,
	serverVersion: 0,
	rev,
});

/**
 * Builds a room record (does not save it).
 *
 * If the title is empty, it folds to the snapshot's title. Leaving it empty would make a blank row
 * in the list, and the user could not tell a room from a loading placeholder.
 */
export function createRoomRecord(
	input: CreateRoomInput,
	stamp: ChatRoomStamp,
): ChatRoom {
	const title =
		normalizeRoomTitle(input.title ?? input.seed.title) ||
		"Untitled conversation";
	return {
		id: stamp.id,
		originStoryId: input.originStoryId,
		title,
		adult: input.seed.adult,
		promptProtected: input.seed.promptProtected,
		seed: input.seed,
		/*
		 * Without an override, **no key is created.** `{ persona: undefined }` and `{}` look almost the
		 * same, but the codec's `encode` distinguishes them (`withOptional` drops `undefined`). More
		 * importantly, the result has the **same shape** as records created before this feature existed,
		 * so a ciphertext already on the server and one being created now mean the same thing.
		 */
		...(input.persona ? { persona: input.persona } : {}),
		/*
		 * The routing key is **always present**. Unlike persona, it is not conditional, because this
		 * value is the record's identity axis, not a user choice. There is no 'no override' state.
		 * Absence means exactly one thing: the room was made by an older build.
		 */
		routingSessionId: stamp.routingSessionId,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

export function createMessageRecord(
	input: AppendMessageInput,
	stamp: ChatStamp,
): ChatMessage {
	return {
		id: stamp.id,
		roomId: input.roomId,
		role: input.role,
		speaker: input.speaker ?? "",
		content: input.content,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		...(input.model !== undefined ? { model: input.model } : {}),
		...(input.inputTokens !== undefined
			? { inputTokens: input.inputTokens }
			: {}),
		...(input.cachedInputTokens !== undefined
			? { cachedInputTokens: input.cachedInputTokens }
			: {}),
		...(input.cacheWriteInputTokens !== undefined
			? { cacheWriteInputTokens: input.cacheWriteInputTokens }
			: {}),
		...(input.outputTokens !== undefined
			? { outputTokens: input.outputTokens }
			: {}),
		...(input.incomplete ? { incomplete: true } : {}),
		...(input.truncated ? { truncated: true } : {}),
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

/**
 * A local edit's mark: bumps the update time and revision, and sets dirty again.
 *
 * `serverVersion` is left alone. It records the last version the server confirmed, and local edits
 * do not change it. Raising it here would make a later push judge optimistic concurrency against a
 * version it never produced.
 *
 * The revision is **passed in**. When two records are edited in the same transaction they must
 * receive different revisions, since sharing one value would erase their order, and only storage
 * knows the issue order.
 */
export function markLocalUpdate<T extends ChatSyncMeta & { updatedAt: string }>(
	record: T,
	now: string,
	rev: Rev,
): T {
	return { ...record, updatedAt: now, dirty: 1, rev };
}

/**
 * Soft-delete mark, applied when the user deletes **this one record**.
 *
 * An already deleted record's `deletedAt` is not overwritten. The first deletion time is the basis
 * for the local trash and compaction (§20.5), and a second delete request (another tab, a retry)
 * would move that basis forward. A remote tombstone that comes back also cannot restore this time
 * exactly, since tombstones arrive without a body and the receiving device must record its own
 * time. That is why deletion is judged by the **tombstone state**, not by time.
 */
export function markLocalDelete<
	T extends ChatSyncMeta & ChatSoftDelete & { updatedAt: string },
>(record: T, now: string, rev: Rev): T {
	return {
		...record,
		deletedAt: record.deletedAt ?? now,
		updatedAt: now,
		dirty: 1,
		rev,
	};
}

/**
 * Mark for messages that go with a room deletion: **no dirty flag and no revision bump.**
 *
 * A room can hold thousands of messages. Tombstoning each one would turn one deletion into
 * thousands of record pushes. So only the room tombstone goes on the wire, and the receiving device
 * runs the same cascade again (§20.4). Setting dirty here would make the thousands of messages
 * eligible for upload, so it must not be set.
 *
 * The revision is also left as is. A new revision would mean 'a new version of this record exists',
 * and this version goes nowhere. Resurrection is prevented by the tombstone state itself, not by
 * revision comparison: a locally deleted record cannot be revived by any inbound change. A message
 * that was already dirty stays dirty and goes up with its own tombstone. That is accurate, so it is
 * deliberately not cleared.
 */
export function markCascadeDeleted<T extends ChatSoftDelete>(
	record: T,
	now: string,
): T {
	return { ...record, deletedAt: record.deletedAt ?? now };
}

/**
 * Sorts the room list by recent activity, newest first. Equal times are broken by id so the order
 * is deterministic.
 */
export function compareRoomsByRecency(a: ChatRoom, b: ChatRoom): number {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
	return a.id < b.id ? 1 : -1;
}
