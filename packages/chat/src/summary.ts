import { type ChatMemory, isAutoMemory } from "./memory.ts";
import type { ChatSoftDelete, ChatSyncMeta } from "./model.ts";

/**
 * Memory V2's rolling summary — a **historical record**, not a feature.
 *
 * V2 kept one model-written summary per room (`chat.summary`, E2EE-synced). V2 is gone: nothing in
 * this codebase writes, advances or sends a summary to a model any more, and the generation request
 * never carries one (`docs/chat/MEMORY.md` §2). What remains is what existing data needs:
 *
 * - the **record type and its decoder** (`sync-codec.ts`), because devices still hold these records
 *   and older clients may still sync them; a record this device cannot decode would be skipped with
 *   the cursor advanced, and its tombstone would never apply;
 * - the **identity** (`summaryIdFor`), so a summary still maps to its room (room deletion cascades,
 *   duplication leaves it behind);
 * - the **history-rewind rule** (`planHistoryRewind`), so editing or deleting past messages still
 *   retires a summary that described them — otherwise the migration below could import a summary of
 *   conversation the user removed;
 * - the **migration input**: the afterstate index may import a stored summary as attributed,
 *   model-written evidence, only for rooms with no scenes (`conversation-memory.ts` `summaryItem`).
 *
 * Not here any more: frontier progress, the summary block, the maintenance cadence.
 */

/** Where the summary stopped: the last message it covered (stored coordinate, not a count). */
export interface ChatSummaryFrontier {
	createdAt: string;
	messageId: string;
}

/**
 * The summary's id, derived from the room id. The server's key is `(owner, id)` without the type,
 * so the room id itself cannot be reused (both records would fight over one row).
 */
export const summaryIdFor = (roomId: string): string =>
	`chat-summary:${roomId}`;

export interface ChatSummary extends ChatSyncMeta, ChatSoftDelete {
	/** Always `summaryIdFor(roomId)`. */
	id: string;
	roomId: string;
	summary: string;
	frontier: ChatSummaryFrontier | null;
	/**
	 * Raised by every history rewind. The sync merge compares it before the clock, so a rewind on one
	 * device beats an older summary advanced on another (`chatSummarySyncCodec`).
	 */
	epoch: number;
	createdAt: string;
	updatedAt: string;
}

/** The longest summary V2 ever wrote; the decoder folds anything longer to this. */
export const CHAT_SUMMARY_MAX_LENGTH = 2_000;

export const normalizeSummary = (input: string): string => input.trim();

/** Trims and clamps to `CHAT_SUMMARY_MAX_LENGTH` code points (the decoder's rule). */
export function clampSummary(input: string): string {
	const normalized = normalizeSummary(input);
	const points = [...normalized];
	if (points.length <= CHAT_SUMMARY_MAX_LENGTH) return normalized;
	return points.slice(0, CHAT_SUMMARY_MAX_LENGTH).join("").trim();
}

/** Total order on stored message positions: time, then id. */
export function compareMessagePosition(
	a: { createdAt: string; id: string },
	b: { createdAt: string; id: string },
): number {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

// ── History rewind (historical records only) ─────────────────────────────────────────────────────

export interface PlanHistoryRewindInput {
	summary: ChatSummary | null;
	memories: readonly ChatMemory[];
	/** `createdAt` of the first message the rewrite erases or changes. */
	cutoffCreatedAt: string;
}

export interface ChatHistoryRewind {
	/** The stored summary covered erased history: retire it (tombstone, epoch raised). */
	resetSummary: boolean;
	/** Automatic memories extracted from the erased stretch (or of unknown origin): delete them. */
	staleMemoryIds: string[];
}

/**
 * What a history rewrite (edit, delete, delete-from-here) retires among V2's historical records.
 *
 * - The summary is a paragraph and cannot be partly undone, so a summary whose frontier reaches the
 *   erased stretch is retired whole. On equal times it errs toward retiring (an erased event must not
 *   stay described). A summary with text but no frontier (a damaged row) covers unknown history and
 *   is retired by any rewrite; an empty one has nothing to retire.
 * - Automatic memories carry the end time of the stretch they came from (`originAt`); those at or
 *   after the cutoff, or with no origin, are deleted.
 * - **Human-written memories are never touched.** They are the person's data, not a derivative of the
 *   conversation.
 *
 * Storage runs this inside the rewrite's own transaction, so no reader sees the messages gone and
 * their description still present. The afterstate index needs no such rule: its derived passages
 * and consolidated episodes are erased with their source records.
 */
export function planHistoryRewind(
	input: PlanHistoryRewindInput,
): ChatHistoryRewind {
	const { summary, memories, cutoffCreatedAt } = input;
	const resetSummary =
		summary !== null &&
		summary.deletedAt === null &&
		(summary.frontier === null
			? summary.summary.trim() !== ""
			: summary.frontier.createdAt >= cutoffCreatedAt);
	const staleMemoryIds = memories
		.filter(
			(memory) =>
				isAutoMemory(memory) &&
				(memory.originAt === null || memory.originAt >= cutoffCreatedAt),
		)
		.map((memory) => memory.id);
	return { resetSummary, staleMemoryIds };
}

/** Whether the rewind changes anything (storage issues no empty revision). */
export const rewindChangesAnything = (rewind: ChatHistoryRewind): boolean =>
	rewind.resetSummary || rewind.staleMemoryIds.length > 0;

/**
 * The epoch a retired summary is written with. Always raised: it is what lets the retirement win the
 * merge against a device that advanced the old summary concurrently.
 */
export const nextSummaryEpoch = (summary: ChatSummary | null): number =>
	(summary?.epoch ?? 0) + 1;
