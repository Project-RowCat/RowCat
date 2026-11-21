import type {
	ChatMemory,
	ChatSummary,
	ChatSummaryFrontier,
} from "@rowcat/chat";
import {
	createMemoryRecord,
	freshChatSyncMeta,
	markLocalUpdate,
	summaryIdFor,
} from "@rowcat/chat";
import { newLocalId, nowIso } from "#/lib/local-data/clock.ts";
import type { LocalDb } from "#/lib/local-data/db.ts";
import { nextRev } from "#/lib/local-data/hlc.ts";

/**
 * Memory V2's historical records, written straight into the tables.
 *
 * Nothing in the product writes a summary or an automatic memory any more, but devices still hold
 * them: an install that ran V2 left them behind, and an older client may still push them. These
 * helpers put such rows in place the way that client did, so tests can check what still applies to
 * them (reads, rewinds, cascades, sync).
 *
 * Each write takes a fresh revision from the device's own clock in the same transaction (the store
 * rule, `hlc.ts`) and leaves the row dirty, as an unsynced local write would: on a sync device it is
 * pushed on the next run like any other change.
 */

export interface SeedV2SummaryInput {
	roomId: string;
	summary: string;
	frontier: ChatSummaryFrontier | null;
	/** Defaults to the stored row's epoch, or 0 for a new row. */
	epoch?: number;
}

/**
 * Writes the room's V2 summary. When a row already exists (for example one pulled from another
 * device), it is updated in place, keeping its `serverVersion`, as an older V2 client advancing it
 * would; otherwise a new row is created.
 */
export async function seedV2Summary(
	db: LocalDb,
	input: SeedV2SummaryInput,
): Promise<ChatSummary> {
	return db.transaction("rw", [db.chatSummaries, db.syncState], async () => {
		const id = summaryIdFor(input.roomId);
		const now = nowIso();
		const rev = await nextRev(db);
		const existing = await db.chatSummaries.get(id);
		const record: ChatSummary = existing
			? markLocalUpdate(
					{
						...existing,
						summary: input.summary,
						frontier: input.frontier,
						epoch: input.epoch ?? existing.epoch,
					},
					now,
					rev,
				)
			: {
					id,
					roomId: input.roomId,
					summary: input.summary,
					frontier: input.frontier,
					epoch: input.epoch ?? 0,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
					...freshChatSyncMeta(rev),
				};
		await db.chatSummaries.put(record);
		return record;
	});
}

export interface SeedV2AutoMemoryInput {
	roomId: string;
	content: string;
	/** End of the conversation stretch V2 extracted it from; `null` is "origin unknown". */
	originAt: string | null;
	/**
	 * Lands the row as a sync pull would: clean (`dirty: 0`) with a server version, instead of as an
	 * unsynced local write.
	 */
	pulled?: boolean;
}

/** Writes one automatic (`source: "auto"`) memory, as V2's maintenance once created it. */
export async function seedV2AutoMemory(
	db: LocalDb,
	input: SeedV2AutoMemoryInput,
): Promise<ChatMemory> {
	return db.transaction("rw", [db.chatMemories, db.syncState], async () => {
		const record = createMemoryRecord(
			{
				roomId: input.roomId,
				content: input.content,
				source: "auto",
				originAt: input.originAt,
			},
			{ id: newLocalId(), now: nowIso(), rev: await nextRev(db) },
		);
		const stored: ChatMemory = input.pulled
			? { ...record, dirty: 0, serverVersion: 1 }
			: record;
		await db.chatMemories.add(stored);
		return stored;
	});
}
