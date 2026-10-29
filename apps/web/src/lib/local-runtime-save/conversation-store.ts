import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	isVisibleRuntimeConversation,
	nextRuntimeConversation,
	type RuntimeConversationRecord,
	type RuntimeConversationRemoval,
	type RuntimeConversationStore,
	type RuntimeConversationTouch,
	type RuntimeSaveSlot,
	runtimeConversationIdFor,
} from "@rowcat/runtime-persistence";
import type { LocalDb } from "#/lib/local-data/db.ts";
import { nextRev } from "#/lib/local-data/hlc.ts";

/**
 * Dexie adapter for RuntimeConversationStore. It fills the same contract as the mobile SQLite
 * adapter (runtimeConversationStoreContract in @rowcat/runtime-persistence/store-contract). Kept in
 * a file separate from store.ts on purpose. Writing a library row must happen outside the playback
 * ownership sequence (stop, drain, dispose, next session). With both ports on one object, a future
 * change inside that sequence could call this write. Revisions are issued inside this transaction,
 * which is why db.syncState is in the transaction list (hlc.ts). The value rules (createdAt on
 * first open, keeping a known title, clearing the removed mark) live in the shared function
 * nextRuntimeConversation. This file decides only identity, revision, dirty, and serverVersion. No
 * delete. Removing from the list sets removedAt, a newer state. A tombstone would mean a
 * conversation opened on another device never reaches this one (see the conversation.ts header).
 */
export function createDexieRuntimeConversationStore(
	db: LocalDb,
): RuntimeConversationStore {
	return {
		async get(
			storyId: string,
			slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
		): Promise<RuntimeConversationRecord | null> {
			return (
				(await db.runtimeConversations.get(
					runtimeConversationIdFor(storyId, slot),
				)) ?? null
			);
		},

		async list(): Promise<RuntimeConversationRecord[]> {
			/**
			 * Walks the index in reverse, as the room list does. Within the same updatedAt, reverse
			 * primary-key order matches the domain merge rule (updatedAt DESC, id DESC).
			 */
			const rows = await db.runtimeConversations
				.orderBy("updatedAt")
				.reverse()
				.toArray();
			return rows.filter(isVisibleRuntimeConversation);
		},

		async touch(
			write: RuntimeConversationTouch,
		): Promise<RuntimeConversationRecord> {
			const id = runtimeConversationIdFor(
				write.storyId,
				write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT,
			);
			return db.transaction(
				"rw",
				[db.runtimeConversations, db.syncState],
				async () => {
					const previous = (await db.runtimeConversations.get(id)) ?? null;
					const record: RuntimeConversationRecord = {
						...nextRuntimeConversation(previous, write),
						dirty: 1,
						serverVersion: previous?.serverVersion ?? 0,
						rev: await nextRev(db),
					};
					await db.runtimeConversations.put(record);
					return record;
				},
			);
		},

		async remove(
			write: RuntimeConversationRemoval,
		): Promise<RuntimeConversationRecord | null> {
			const id = runtimeConversationIdFor(
				write.storyId,
				write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT,
			);
			return db.transaction(
				"rw",
				[db.runtimeConversations, db.syncState],
				async () => {
					const previous = await db.runtimeConversations.get(id);
					/** Removing a row that does not exist does nothing. It does not invent one. */
					if (!previous) return null;
					const record: RuntimeConversationRecord = {
						...previous,
						removedAt: previous.removedAt ?? write.now,
						updatedAt: write.now,
						dirty: 1,
						rev: await nextRev(db),
					};
					await db.runtimeConversations.put(record);
					return record;
				},
			);
		},
	};
}
