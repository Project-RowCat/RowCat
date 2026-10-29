import type { ChatSoftDelete, ChatStamp, ChatSyncMeta } from "./model.ts";
import { freshChatSyncMeta } from "./model.ts";

/**
 * Summary state: what a conversation leaves behind once its messages are pushed out of the history
 * window.
 * - Kept as a fourth record type: messages leave the prompt when CHAT_HISTORY_LIMIT advances, and
 *   memories are for facts meant to persist. As memories, each event would add an entry. As room
 *   fields, every summary update would overwrite the whole room and conflict with device activity.
 * - Identity is derived from the room id (`summaryIdFor`), so each room has exactly one summary.
 *   A random id would let two devices create two summaries that sync cannot merge.
 * - The id is prefixed rather than equal to the room id. The server key is (owner, id) without
 *   the type (apps/api/src/db/tables/sync.ts), so an equal id would collide. Other ids are UUIDs or
 *   base32 and cannot contain ':'.
 * - Not stored: rendered markdown or HTML, summary history, token counts, model name, or cost. A
 *   model change would otherwise make every stored summary stale.
 */

/**
 * The frontier uses the same coordinate as the repository's ordering, `[roomId+createdAt+id]`. An
 * array index or a count is not used, because it is not stable. A history rewrite that removes a
 * middle message, or sync that inserts earlier messages, changes which message sits at position 20.
 * A recorded position would then point at nothing while claiming to be processed.
 */
export interface ChatSummaryFrontier {
	/** Processed up to and including this timestamp. */
	createdAt: string;
	/** Second axis for messages that share a timestamp, in the same order as the repository sort. */
	messageId: string;
}

/**
 * Maps a room id to that room's summary identity. Both devices must compute the same value. The
 * prefix keeps this id out of the room record's space in the server's `(owner, id)` key, since
 * other record ids (UUIDs or base32) cannot contain ':'.
 *
 * Do not change the prefix. Summaries are already stored under it on devices and the server, and a
 * different prefix would orphan every existing summary.
 */
export const summaryIdFor = (roomId: string): string =>
	`chat-summary:${roomId}`;

export interface ChatSummary extends ChatSyncMeta, ChatSoftDelete {
	/** Always `summaryIdFor(roomId)`, never a random id. See the module header for why. */
	id: string;
	roomId: string;
	/**
	 * Plain text produced by the model. Empty means there is not yet enough progress to summarize.
	 */
	summary: string;
	/**
	 * `null` means nothing has been processed yet (a new or rewound room).
	 *
	 * The summary and frontier share one record so the update is atomic. If split, the summary could
	 * advance while the frontier stayed behind, reprocessing the same range forever or skipping an
	 * unsummarized range as if it were processed.
	 */
	frontier: ChatSummaryFrontier | null;
	/**
	 * Invalidation generation: an integer that makes a rewind win in merge. Without it, HLC alone
	 * would let a stale summary advance resurrect a summary of history the user deleted, and that
	 * state would never heal. Rewinds always raise this value (`planMaintenanceRewind`), so they beat
	 * any concurrent advance; the reverse case costs one recomputation. Empty-summary- wins is not
	 * used, because a stale rewind record would then reverse every later advance forever.
	 */
	epoch: number;
	/** ISO 8601. */
	createdAt: string;
	updatedAt: string;
}

/**
 * Length cap, counted in code points (characters), not UTF-16 units. The value goes into every
 * request in full, so the cap is the prompt cost. 2,000 characters is half the memory budget.
 *
 * Over-long summaries are clamped rather than rejected. Dropping a summary would erase the batch's
 * progress and reprocess the same range forever, while a truncated summary is still true about the
 * conversation.
 */
export const CHAT_SUMMARY_MAX_LENGTH = 2_000;

/** Trims surrounding whitespace. That is all normalization does, the same rule as memories. */
export const normalizeSummary = (input: string): string => input.trim();

/**
 * Folds the input to the cap, counting code points. `slice` would cut UTF-16 code units and could
 * split a surrogate pair, leaving a broken character that feeds the next summary request, which
 * some providers reject outright.
 */
export function clampSummary(input: string): string {
	const normalized = normalizeSummary(input);
	const points = [...normalized];
	if (points.length <= CHAT_SUMMARY_MAX_LENGTH) return normalized;
	return points.slice(0, CHAT_SUMMARY_MAX_LENGTH).join("").trim();
}

/**
 * The message total order must match the repository's sort. If the two diverge, the frontier points
 * at a different position than storage believes. Already-processed messages are then summarized
 * again (duplicate memories), or unprocessed messages are skipped and never summarized. The second
 * failure is silent.
 */
export function compareMessagePosition(
	a: { createdAt: string; id: string },
	b: { createdAt: string; id: string },
): number {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

export const isAfterFrontier = (
	message: { createdAt: string; id: string },
	frontier: ChatSummaryFrontier | null,
): boolean =>
	frontier === null ||
	compareMessagePosition(message, {
		createdAt: frontier.createdAt,
		id: frontier.messageId,
	}) > 0;

export interface CreateSummaryInput {
	roomId: string;
	summary: string;
	frontier: ChatSummaryFrontier | null;
	/** Omitted means 0, that is, the room has never been rewound. */
	epoch?: number;
}

/**
 * Builds the record without saving it. `stamp.id` is ignored on purpose: identity comes from the
 * room id, and this factory enforces that. If callers could pass a fresh UUID, some would, and the
 * room would end up with two summaries.
 */
export function createSummaryRecord(
	input: CreateSummaryInput,
	stamp: Omit<ChatStamp, "id">,
): ChatSummary {
	return {
		id: summaryIdFor(input.roomId),
		roomId: input.roomId,
		summary: clampSummary(input.summary),
		frontier: input.frontier,
		epoch: input.epoch ?? 0,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}
