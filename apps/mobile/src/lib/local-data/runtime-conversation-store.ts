import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	nextRuntimeConversation,
	type RuntimeConversationRecord,
	type RuntimeConversationRemoval,
	type RuntimeConversationStore,
	type RuntimeConversationTouch,
	type RuntimeSaveSlot,
	runtimeConversationIdFor,
} from "@rowcat/runtime-persistence";
import { nextRev } from "./hlc.ts";
import type { MobileDatabase } from "./sqlite.ts";
import { runtimeConversationTable, type SqlRow } from "./tables.ts";

/**
 * SQLite adapter for `RuntimeConversationStore`, with the **same contract** as the web Dexie
 * implementation (`runtimeConversationStoreContract` in
 * `@rowcat/runtime-persistence/store-contract`).
 *
 * This is a separate file from the save adapter (`runtime-save-store.ts`). Writing library rows
 * must happen outside the playback lifecycle's ownership procedure. If both ports sat on one
 * object, someday that procedure would call this write.
 *
 * The row ↔ record mapping is the table in `tables.ts`, shared with the sync store. The value rules
 * (first-open `createdAt`, preserving a known title, clearing the removed mark) live in a shared
 * function (`nextRuntimeConversation`). What is decided here is only the revision, `dirty` and
 * `serverVersion`, and revisions are issued **inside this transaction**.
 *
 * There is no `DELETE`. Removing a row from the list is the newer state that sets `removed_at`.
 */

const SELECT_ONE = `SELECT * FROM runtime_conversation WHERE id = ?`;
/** Rows shown in the library: no protocol tombstone and no removed mark. Order matches the domain's merge rule. */
const SELECT_VISIBLE = `SELECT * FROM runtime_conversation
	WHERE deleted_at IS NULL AND removed_at IS NULL
	ORDER BY updated_at DESC, id DESC`;

export function createSqliteRuntimeConversationStore(
	db: MobileDatabase,
): RuntimeConversationStore {
	return {
		async get(
			storyId: string,
			slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
		): Promise<RuntimeConversationRecord | null> {
			const row = await db.first<SqlRow>(SELECT_ONE, [
				runtimeConversationIdFor(storyId, slot),
			]);
			return row ? runtimeConversationTable.fromRow(row) : null;
		},

		async list(): Promise<RuntimeConversationRecord[]> {
			const rows = await db.all<SqlRow>(SELECT_VISIBLE, []);
			return rows.map((row) => runtimeConversationTable.fromRow(row));
		},

		async touch(
			write: RuntimeConversationTouch,
		): Promise<RuntimeConversationRecord> {
			const id = runtimeConversationIdFor(
				write.storyId,
				write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT,
			);
			return db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(SELECT_ONE, [id]);
				const previous = row ? runtimeConversationTable.fromRow(row) : null;
				const record: RuntimeConversationRecord = {
					...nextRuntimeConversation(previous, write),
					dirty: 1,
					serverVersion: previous?.serverVersion ?? 0,
					rev: await nextRev(tx),
				};
				await runtimeConversationTable.upsert(tx, record);
				return record;
			});
		},

		async remove(
			write: RuntimeConversationRemoval,
		): Promise<RuntimeConversationRecord | null> {
			const id = runtimeConversationIdFor(
				write.storyId,
				write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT,
			);
			return db.transaction(async (tx) => {
				const row = await tx.first<SqlRow>(SELECT_ONE, [id]);
				/** Removing a row that does not exist does nothing. Nothing is invented. */
				if (!row) return null;
				const previous = runtimeConversationTable.fromRow(row);
				const record: RuntimeConversationRecord = {
					...previous,
					removedAt: previous.removedAt ?? write.now,
					updatedAt: write.now,
					dirty: 1,
					rev: await nextRev(tx),
				};
				await runtimeConversationTable.upsert(tx, record);
				return record;
			});
		},
	};
}
