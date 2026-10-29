import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	type RuntimePersistentRecord,
	type RuntimePersistentWrite,
	type RuntimePlaythroughRecord,
	type RuntimePlaythroughWrite,
	type RuntimeSaveSlot,
	type RuntimeSaveStore,
	runtimePersistentIdFor,
	runtimePlaythroughIdFor,
} from "@rowcat/runtime-persistence";
import type { LocalDb } from "#/lib/local-data/db.ts";
import { nextRev } from "#/lib/local-data/hlc.ts";
import { SYNC_STATE_KEY } from "#/lib/local-data/sync-state.ts";

/**
 * Dexie adapter for RuntimeSaveStore. It fills the same contract as the mobile SQLite adapter
 * (@rowcat/runtime-persistence/store-contract). Both adapters passing the same behavior suite is
 * the point: without it, "progress disappears only on phones" would go unnoticed in review.
 * - The revision is issued in the same transaction, and db.syncState is in the transaction list
 *   (hlc.ts). Issuing it outside would split the issue from the save. If the browser dies in
 *   between, the record is saved but the clock has not advanced, and the next write would reissue
 *   the same revision.
 * - No delete. Reset writes an empty snapshot (§48). A delete would not propagate: a device still
 *   holding old progress would restore it at the next sync.
 * - serverVersion is inherited. Resetting it to 0 when editing a record the server already knows
 *   would make the next push look like a new record and conflict. Only a new row starts at 0.
 */
export function createDexieRuntimeSaveStore(db: LocalDb): RuntimeSaveStore {
	return {
		async getPlaythrough(
			storyId: string,
			slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
		): Promise<RuntimePlaythroughRecord | null> {
			return (
				(await db.runtimePlaythroughs.get(
					runtimePlaythroughIdFor(storyId, slot),
				)) ?? null
			);
		},

		async putPlaythrough(
			write: RuntimePlaythroughWrite,
		): Promise<RuntimePlaythroughRecord> {
			const slot = write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT;
			const id = runtimePlaythroughIdFor(write.storyId, slot);
			return db.transaction(
				"rw",
				[db.runtimePlaythroughs, db.syncState],
				async () => {
					const previous = await db.runtimePlaythroughs.get(id);
					const record: RuntimePlaythroughRecord = {
						id,
						storyId: write.storyId,
						slot,
						snapshot: write.snapshot,
						updatedAt: write.updatedAt,
						/**
						 * Revives a tombstoned row. Writing new progress onto a row that was a tombstone is the
						 * normal path, for example when another device deleted it and this device plays again.
						 */
						deletedAt: null,
						dirty: 1,
						serverVersion: previous?.serverVersion ?? 0,
						rev: await nextRev(db),
					};
					await db.runtimePlaythroughs.put(record);
					return record;
				},
			);
		},

		async getPersistent(
			storyId: string,
		): Promise<RuntimePersistentRecord | null> {
			return (
				(await db.runtimePersistentStates.get(
					runtimePersistentIdFor(storyId),
				)) ?? null
			);
		},

		async putPersistent(
			write: RuntimePersistentWrite,
		): Promise<RuntimePersistentRecord> {
			const id = runtimePersistentIdFor(write.storyId);
			return db.transaction(
				"rw",
				[db.runtimePersistentStates, db.syncState],
				async () => {
					const previous = await db.runtimePersistentStates.get(id);
					const record: RuntimePersistentRecord = {
						id,
						storyId: write.storyId,
						snapshot: write.snapshot,
						updatedAt: write.updatedAt,
						deletedAt: null,
						dirty: 1,
						serverVersion: previous?.serverVersion ?? 0,
						rev: await nextRev(db),
					};
					await db.runtimePersistentStates.put(record);
					return record;
				},
			);
		},

		/**
		 * Whether anything is pending is answered by the sync state row, not by counting records.
		 * Counting would fold a new account with no saves and a new device that has received nothing into
		 * the same value, and that would start a new game over months of progress. No key, no wait. A
		 * device that does not remember the DEK cannot receive anything, so waiting would never end. With
		 * only the bootstrap flag, an account that never set up sync kept it false forever, and the play
		 * screen stayed on `Syncing`. The port's header notes the window this leaves open.
		 */
		async initialSyncDone(): Promise<boolean> {
			const state = await db.syncState.get(SYNC_STATE_KEY);
			if (state === undefined) return true;
			return state.initialSyncDone || state.deviceKey === null;
		},
	};
}
