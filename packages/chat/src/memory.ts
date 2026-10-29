import type { ChatSoftDelete, ChatStamp, ChatSyncMeta } from "./model.ts";
import { freshChatSyncMeta } from "./model.ts";

/**
 * Memory is room-scoped state that the user writes directly. It is not conversation history:
 * messages leave the context as the history window advances, but memories must persist for hundreds
 * of turns.
 *
 * It is a separate record, not a field on the room blob, because a blob has no per-item identity.
 * Edits, deletes and sync merges would overwrite the whole room, and two devices each adding a
 * memory would lose one of them.
 *
 * `source` was added in V2, when auto-maintenance (`memory-maintenance.ts`) began producing
 * entries. The vocabulary is `user` and `auto` only; predeclaring values such as `ai`, `summary` or
 * `extracted` would have fixed producers that do not exist.
 *
 * Both kinds share the record, storage, sync, budget and delete lifecycle. They differ only in who
 * may edit them (see `ChatMemorySource`).
 *
 * Not here: embeddings, similarity search, confidence scores or a knowledge graph. Deduplication is
 * a deterministic normalized comparison (`memoryDedupeKey`). Merging sentences that mean the same
 * thing is done by the extraction request, which is given the existing memories.
 */

/**
 * Who wrote the memory. This decides who may edit it:
 * - `user`: a person wrote it. Auto-maintenance reads it but never edits or deletes it.
 * - `auto`: extracted from the conversation. Auto-maintenance may replace or remove it.
 *
 * This is the most important product rule in this slice. A sentence the user wrote is their data.
 * If the model rewrote it as a 'more accurate' phrasing, the user would find text in their list
 * that they never wrote, with no way to undo it.
 *
 * The direction is one-way: `auto` can become `user`, never the reverse. Once a user edits an auto
 * memory, it is their sentence and auto-maintenance must no longer touch it (see
 * `promoteMemoryPatch`).
 */
export const CHAT_MEMORY_SOURCES = ["user", "auto"] as const;
export type ChatMemorySource = (typeof CHAT_MEMORY_SOURCES)[number];

const MEMORY_SOURCE_SET: ReadonlySet<string> = new Set(CHAT_MEMORY_SOURCES);

/**
 * Reads the source of a stored or sent value. Unknown values fold to `user`.
 *
 * The direction is deliberate. An unknown value read as `auto` would make the record removable by
 * automatic maintenance, and the mistake would delete the user's text. The opposite mistake only
 * leaves one auto memory that never gets cleaned up.
 */
export const readMemorySource = (value: unknown): ChatMemorySource =>
	typeof value === "string" && MEMORY_SOURCE_SET.has(value)
		? (value as ChatMemorySource)
		: "user";

/**
 * Whether automatic maintenance may touch this memory. The predicate is defined here so that it is
 * not written again elsewhere.
 */
export const isAutoMemory = (memory: Pick<ChatMemory, "source">): boolean =>
	memory.source === "auto";

/**
 * A single memory. It is a child of the room and carries the same sync axis as messages.
 *
 * `id` is a globally stable string, for the same reason as rooms and messages: the local primary
 * key is the sync identity. Pointing at a memory by array index or content hash would change its
 * identity on every edit, and another device's copy would become a different record (both would
 * survive).
 */
export interface ChatMemory extends ChatSyncMeta, ChatSoftDelete {
	id: string;
	/** Parent room. Memories are not shared across rooms; global memories are out of scope for V1. */
	roomId: string;
	/** The text the user wrote. Limited by `CHAT_MEMORY_CONTENT_MAX_LENGTH`. */
	content: string;
	/**
	 * Who wrote this memory. The answer also decides who may edit it.
	 *
	 * It is not inferred from the content: no predicate can tell a human sentence from a
	 * model-extracted one by its shape. This is a recorded fact, so it needed migrating, and the rule
	 * is simple: every memory created before this field existed is `user`. The only path that created
	 * memories then was the human-facing form, so this is a true fact, not a guess.
	 */
	source: ChatMemorySource;
	/**
	 * End time of the conversation range the auto memory was derived from (the `createdAt` of the
	 * batch's last message). Human-written memories have `null`, because their basis is not a
	 * conversation.
	 *
	 * This exists for history rewrite. If the user deletes past messages, facts extracted from that
	 * span are no longer things that happened in this conversation, and keeping them makes the model
	 * keep referring to events the user removed. To choose what to remove, the origin of each memory
	 * must be known, and one timestamp is the cheapest answer (`planMaintenanceRewind`).
	 *
	 * Message ids are not stored, because they are the values that get deleted. A rewind is a range
	 * check ('after this time'), and the anchoring message would disappear at that very moment.
	 */
	originAt: string | null;
	/**
	 * Whether this memory is included first when the context budget is short.
	 *
	 * It does not mean 'never truncated'. Final safety still belongs to the assembler's budget: if
	 * pinned memories alone exceed the budget, they are truncated too (`selectMemoriesForContext`).
	 * Without this, a user who pinned everything would see the whole chat history pushed out.
	 */
	pinned: boolean;
	/** ISO 8601. */
	createdAt: string;
	updatedAt: string;
}

/**
 * Length limit for one memory, in characters (code points).
 *
 * 1,000 characters is a couple of paragraphs. The reason is the context budget, not storage:
 * `CHAT_MEMORY_CONTEXT_CHAR_BUDGET` is 4,000 characters, so a single memory cannot take more than a
 * quarter of it. Without a limit, one entry could consume the whole budget and the other memories
 * in that room would never be included. From the user's side it looks like 'I wrote it and it is
 * not applied'.
 *
 * The rule lives in this package for the same reason as the room title
 * (`CHAT_ROOM_TITLE_MAX_LENGTH`). If validation existed only in the web form, the limits of two
 * platforms would diverge once a second client exists, and the difference would persist in records
 * already on devices. Storage and the sync decoder read this same constant.
 */
export const CHAT_MEMORY_CONTENT_MAX_LENGTH = 1_000;

/**
 * Maximum number of live memories a room may hold. Enforced by storage.
 *
 * The budget already truncates what is sent, so why cap as well? Truncating and accumulating are
 * different problems. Without a cap, some rooms would hold thousands of memories, and the list
 * screen and the assembler (which sorts on every generation) would pay for that, while only the
 * budget-sized subset ever reaches the prompt.
 *
 * 200 is well above what is written by hand. A user who reaches it is using memories for something
 * else, which is worth revisiting when automatic extraction arrives.
 */
export const CHAT_MEMORY_MAX_PER_ROOM = 200;

/**
 * Length limit for one auto memory: one fifth of the human limit.
 *
 * The two limits differ because the values differ in kind. A person can write multi-line
 * relationship or settings notes, but automatic extraction should produce one fact sentence (for
 * example, 'Kai has the key to the basement storage room'). A looser limit would lead the model to
 * write scene summaries as memories, which duplicates what the summary block already does.
 *
 * The worst case is 200 characters x 60 entries (`CHAT_AUTO_MEMORY_MAX_PER_ROOM`), or 12,000
 * characters, against a 4,000-character budget. Human memories are not starved because of selection
 * order: `sortMemories` places human-written memories first within the same pin tier.
 */
export const CHAT_AUTO_MEMORY_CONTENT_MAX_LENGTH = 200;

/**
 * Maximum number of live auto memories in a room. A sub-budget within the overall cap of 200.
 *
 * It is split out because auto memories grow without human involvement. With one shared cap, a long
 * conversation could fill all 200 slots with auto memories, and the user could no longer add new
 * ones (`ChatMemoryLimitError`). Automation would then break manual use.
 *
 * 60 is about three times the budget at the 200-character limit, so the budget starts truncating
 * well before this cap is reached. What this value does is keep storage from growing without bound.
 * When it is reached, maintenance either drops the new candidate or replaces a stale auto memory.
 * Human-written memories never give up their slot (`planMemoryMaintenance`).
 */
export const CHAT_AUTO_MEMORY_MAX_PER_ROOM = 60;

/** The two reasons content can be rejected. The screen picks its message from this value. */
export type ChatMemoryContentRejection = "empty" | "too_long";

export type ChatMemoryContentCheck =
	| { ok: true; content: string }
	| { ok: false; reason: ChatMemoryContentRejection };

/**
 * Trims leading and trailing whitespace. That is the entire normalization.
 *
 * Internal line breaks are not collapsed, because a memory may span lines (relationships and
 * settings are naturally written one per line). Line formatting for the prompt is done by the
 * assembler at presentation time; the stored value is exactly what the user wrote.
 */
export const normalizeMemoryContent = (input: string): string => input.trim();

/**
 * Whether the input can be stored.
 *
 * Empty input is not replaced with a default, for the same reason as room renames. Memories are
 * created only on a screen opened to write content, so an empty value means unfinished, not 'wants
 * a default'.
 *
 * Length is counted in code points. `String.length` counts UTF-16 code units, so an emoji counts as
 * 2, and only users who include emoji would reach the limit at half the length.
 */
export function checkMemoryContent(input: string): ChatMemoryContentCheck {
	const content = normalizeMemoryContent(input);
	if (content.length === 0) return { ok: false, reason: "empty" };
	if ([...content].length > CHAT_MEMORY_CONTENT_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, content };
}

/**
 * Whether content proposed by automatic extraction can be stored, using the narrow limit.
 *
 * It is rejected, not truncated. A truncated fact is the front half of a sentence (for example,
 * 'Kai has the key to the basement'), and storing it would make the model reference that incomplete
 * sentence from later turns. The only cost of discarding one candidate is that the next maintenance
 * pass may extract the same fact again.
 */
export function checkAutoMemoryContent(input: string): ChatMemoryContentCheck {
	const content = normalizeMemoryContent(input);
	if (content.length === 0) return { ok: false, reason: "empty" };
	if ([...content].length > CHAT_AUTO_MEMORY_CONTENT_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, content };
}

/**
 * The key for duplicate detection: a deterministic normalized comparison, and nothing more.
 *
 * It does exactly three things: collapses whitespace runs into one space, lowercases, and strips
 * trailing sentence punctuation. That is precisely enough to stop 'Kai is left-handed.' and
 * 'Kai  is left-handed' from becoming two memories. It deliberately does not catch other sentences
 * with the same meaning (for example, 'Kai mainly uses the left hand'). That judgment belongs to
 * embeddings, and this slice has none. Instead, the extraction request receives the existing list
 * and is told not to return facts already expressed (`maintenance-prompt.ts`). Because the model's
 * answer is still not trusted, this deterministic comparison runs once more after it.
 *
 * No stemming and no particle removal. Those rules are locale-specific, and this package
 * deliberately does not know Korean. A wrong merge ('received the key' vs. 'gave the key') costs
 * far more than a duplicate.
 */
export function memoryDedupeKey(content: string): string {
	return content
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.replace(/[.!?。！？…]+$/u, "");
}

/**
 * A write that violated the content rules. The error type records that storage does not trust the
 * UI.
 */
export class ChatMemoryContentError extends Error {
	readonly reason: ChatMemoryContentRejection;
	constructor(reason: ChatMemoryContentRejection) {
		super(
			reason === "empty"
				? "a memory cannot be empty"
				: `a memory cannot exceed ${CHAT_MEMORY_CONTENT_MAX_LENGTH} characters`,
		);
		this.name = "ChatMemoryContentError";
		this.reason = reason;
	}
}

/**
 * The room's memory count has reached its cap. This gives the screen a basis for telling the user
 * what must be deleted.
 */
export class ChatMemoryLimitError extends Error {
	readonly limit = CHAT_MEMORY_MAX_PER_ROOM;
	constructor() {
		super(
			`a conversation cannot hold more than ${CHAT_MEMORY_MAX_PER_ROOM} memories`,
		);
		this.name = "ChatMemoryLimitError";
	}
}

/**
 * The gate right before saving: returns the string to store, or throws.
 *
 * Both the storage implementation and the sync decoder pass through this gate. It is not skipped
 * just because the screen validates, because there is more than one call site: a future mobile
 * client, tests, and above all payloads uploaded by other devices. Successfully decrypting a
 * payload does not mean it follows our rules; a buggy or older client may share the same account.
 */
export function requireMemoryContent(input: string): string {
	const checked = checkMemoryContent(input);
	if (!checked.ok) throw new ChatMemoryContentError(checked.reason);
	return checked.content;
}

/** Gate for auto memories. Same as above, but it uses the narrower auto limit. */
export function requireAutoMemoryContent(input: string): string {
	const checked = checkAutoMemoryContent(input);
	if (!checked.ok) throw new ChatMemoryContentError(checked.reason);
	return checked.content;
}

export interface CreateMemoryInput {
	roomId: string;
	content: string;
	/** Omitted means the memory is not pinned. */
	pinned?: boolean;
	/**
	 * Omitted means **a human-written memory**.
	 *
	 * The default is the safe direction. The add form does not pass this value; only automatic
	 * maintenance sets `auto` explicitly. If a new caller forgets it, the memory simply is not
	 * eligible for automatic cleanup. If the default were `auto`, a memory a person wrote could be
	 * silently removed.
	 */
	source?: ChatMemorySource;
	/** End time of the range the auto memory was derived from. Omit it for human-written memories. */
	originAt?: string | null;
}

/**
 * The parts of a stored memory that may be overwritten. Identity (`id`, `roomId`) and creation time
 * do not change.
 *
 * `source` is here for one operation: promotion (`promoteMemoryPatch`). Storage applies this patch
 * as written, so the field itself can express auto-to-user. The reverse direction (user-to-auto) is
 * blocked not by the type but by callers: automatic maintenance never calls this operation and goes
 * through `applyMemoryMaintenance` instead. Inside that, the pure plan already filters out
 * operations that target human-written memories (`planMemoryMaintenance`).
 */
export type UpdateMemoryPatch = Partial<
	Pick<ChatMemory, "content" | "pinned" | "source">
>;

/**
 * The patch to pass to storage when the user directly edits an auto memory.
 *
 * Promotion is not written at each call site because forgetting it fails silently. An unpromoted
 * memory stays `auto`, so the next maintenance pass treats it as a stale auto fact and replaces or
 * removes it. The user would see a memory they just edited return or disappear days later, with
 * nothing in between to explain it.
 *
 * Pinning does not go through this function. Pinning is about priority, not content, so raising an
 * auto memory does not change who wrote it.
 */
export const promoteMemoryPatch = (content: string): UpdateMemoryPatch => ({
	content,
	source: "user",
});

/**
 * The source after a patch is applied. It only ever moves to `user`.
 *
 * Storage does not assign `patch.source` directly; it passes through this function because of
 * direction. Promotion (`auto` to `user`) is the user making the sentence theirs. The reverse is
 * not a product action at all: nothing in the product turns a human-written memory back into one
 * open to automatic cleanup.
 *
 * The type alone cannot express that direction, since `UpdateMemoryPatch` accepts both values.
 * Folding here enforces the invariant structurally in both storage implementations. If someone
 * later passes an `auto` source in a patch, that line does nothing.
 */
export const mergeMemorySource = (
	current: ChatMemorySource,
	patched: ChatMemorySource | undefined,
): ChatMemorySource =>
	current === "user" || patched === "user" ? "user" : "auto";

/**
 * Builds a memory record (does not save it).
 *
 * Content validation happens here because this function is the common point for every creation
 * path. If storage validated separately and this function only accepted input, a future storage
 * implementation (Expo) would have to repeat the check, and one copy would eventually be missed.
 */
export function createMemoryRecord(
	input: CreateMemoryInput,
	stamp: ChatStamp,
): ChatMemory {
	const source = input.source ?? "user";
	return {
		id: stamp.id,
		roomId: input.roomId,
		/**
		 * Validation also looks at the source. Auto candidates must pass the narrow limit. The check
		 * lives here for the same reason as above: this function is the common point for all creation
		 * paths, so storage checking separately would duplicate the rule in every new implementation.
		 */
		content:
			source === "auto"
				? requireAutoMemoryContent(input.content)
				: requireMemoryContent(input.content),
		pinned: input.pinned ?? false,
		source,
		originAt: source === "auto" ? (input.originAt ?? null) : null,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

/**
 * Display and selection order: pinned first, then human-written, then most recently updated.
 *
 * The source tier is what keeps auto memories from starving human ones. The budget is 4,000
 * characters, auto memories can reach 60 per room, and time alone would let fresh auto facts push
 * out older settings the user wrote. Human-written memories are therefore always considered first;
 * auto memories fill the remaining space and are omitted when there is none.
 *
 * The screen and the prompt use the same order, so a memory shown higher is never missing from the
 * prompt. The source tier is in the sort itself, not only in context selection, so the list also
 * reads as 'what I wrote, then what the AI remembered'.
 *
 * `pinned` is still the first key: a pinned auto memory precedes a human-written one, because
 * pinning is an explicit 'always include this' that outranks source.
 *
 * Ties are broken by `id`. Without that last key, two memories created in the same millisecond
 * would be ordered by the sort implementation, and two devices holding the same set would build
 * different prompts. A difference that does not reproduce cannot be diagnosed.
 *
 * There is no manual ordering (drag or rank column). A user-defined order would become a sync field
 * that needs reconciling across devices, and for this memory set that complexity buys nothing.
 */
export const sortMemories = <
	T extends Pick<ChatMemory, "id" | "pinned" | "source" | "updatedAt">,
>(
	memories: readonly T[],
): T[] =>
	[...memories].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		if (a.source !== b.source) return a.source === "user" ? -1 : 1;
		if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
		return a.id < b.id ? -1 : 1;
	});

/**
 * The memory form's decision: a branch, not copy.
 *
 * `unchanged` exists separately because an edit issues a revision. Saving an unedited memory would
 * mark the record dirty, so it would be pushed in the next sync, and on another device an unchanged
 * copy would become the latest version. The list order (most recently updated) would also flip for
 * no reason.
 */
export type ChatMemorySavePlan =
	| { kind: "invalid"; reason: ChatMemoryContentRejection }
	| { kind: "unchanged" }
	| { kind: "save"; content: string };

/**
 * Whether the current input is a value to save.
 *
 * Without `current` this is an add, so `unchanged` cannot occur: there is nothing to compare
 * against, and empty input is already `invalid`.
 */
export function planMemorySave(
	input: string,
	current?: string,
): ChatMemorySavePlan {
	const checked = checkMemoryContent(input);
	if (!checked.ok) return { kind: "invalid", reason: checked.reason };
	if (current !== undefined && checked.content === current)
		return { kind: "unchanged" };
	return { kind: "save", content: checked.content };
}

export interface ChatMemoryGroups {
	pinned: ChatMemory[];
	others: ChatMemory[];
}

/**
 * Splits the list into two groups. It does not sort.
 *
 * The order is already decided by storage (`sortMemories`: pinned first, then most recently
 * updated). Sorting again here could make the screen order and the prompt order diverge. This
 * function only cuts that one order into readable sections, so concatenating the groups restores
 * the original order.
 */
export const groupMemories = (
	memories: readonly ChatMemory[],
): ChatMemoryGroups => ({
	pinned: memories.filter((memory) => memory.pinned),
	others: memories.filter((memory) => !memory.pinned),
});
