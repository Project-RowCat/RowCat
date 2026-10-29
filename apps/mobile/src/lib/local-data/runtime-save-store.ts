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
import { nextRev } from "./hlc.ts";
import type { MobileDatabase } from "./sqlite.ts";
import { readSyncState } from "./sync-state.ts";
import {
	runtimePersistentTable,
	runtimePlaythroughTable,
	type SqlRow,
} from "./tables.ts";

/**
 * SQLite adapter for `RuntimeSaveStore`, with the same contract as the web Dexie adapter. Both pass
 * the shared behaviour suite (`@rowcat/runtime-persistence/store-contract`); without it, "progress
 * works on web but vanishes only on the phone" would go unnoticed in review.
 *
 * The row ↔ record mapping lives in `RecordTable` (`tables.ts`), which sync also uses. A local copy
 * would let this device's saves and sync read different values once a column changes.
 *
 * Revisions are issued inside the write transaction. Issuing them outside would let the record be
 * saved while the clock stays put if the app dies in between, so the next write would reissue the
 * same revision (the web's `hlc.ts` makes the same point).
 *
 * There is no delete. Resetting a playthrough writes an empty snapshot.
 */

const SELECT_PLAYTHROUGH = `SELECT id, story_id, slot, snapshot, updated_at, deleted_at, dirty, server_version, rev_t, rev_c, rev_d FROM runtime_playthrough WHERE id = ?`;
const SELECT_PERSISTENT = `SELECT id, story_id, snapshot, updated_at, deleted_at, dirty, server_version, rev_t, rev_c, rev_d FROM runtime_persistent WHERE id = ?`;

export function createSqliteRuntimeSaveStore(
	db: MobileDatabase,
	/**
	 * Whether this device holds the sync key. Injected: on web that fact sits in the sync-state row,
	 * but this app's DEK wrapper lives in SecureStore (`device-key.ts`), which a SQLite connection
	 * cannot answer. The assembly point supplies it so the adapter never touches `SecureKeyStorage`
	 * directly.
	 */
	hasDeviceKey: () => Promise<boolean>,
): RuntimeSaveStore {
	return {
		async getPlaythrough(
			storyId: string,
			slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
		): Promise<RuntimePlaythroughRecord | null> {
			const row = await db.first<SqlRow>(SELECT_PLAYTHROUGH, [
				runtimePlaythroughIdFor(storyId, slot),
			]);
			return row ? runtimePlaythroughTable.fromRow(row) : null;
		},

		async putPlaythrough(
			write: RuntimePlaythroughWrite,
		): Promise<RuntimePlaythroughRecord> {
			const slot = write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT;
			const id = runtimePlaythroughIdFor(write.storyId, slot);
			return db.transaction(async (tx) => {
				const existing = await tx.first<SqlRow>(SELECT_PLAYTHROUGH, [id]);
				const record: RuntimePlaythroughRecord = {
					id,
					storyId: write.storyId,
					slot,
					snapshot: write.snapshot,
					updatedAt: write.updatedAt,
					// Revived: another device may have deleted it, and replaying here must still work.
					deletedAt: null,
					dirty: 1,
					serverVersion: Number(existing?.server_version ?? 0),
					rev: await nextRev(tx),
				};
				await runtimePlaythroughTable.upsert(tx, record);
				return record;
			});
		},

		async getPersistent(
			storyId: string,
		): Promise<RuntimePersistentRecord | null> {
			const row = await db.first<SqlRow>(SELECT_PERSISTENT, [
				runtimePersistentIdFor(storyId),
			]);
			return row ? runtimePersistentTable.fromRow(row) : null;
		},

		async putPersistent(
			write: RuntimePersistentWrite,
		): Promise<RuntimePersistentRecord> {
			const id = runtimePersistentIdFor(write.storyId);
			return db.transaction(async (tx) => {
				const existing = await tx.first<SqlRow>(SELECT_PERSISTENT, [id]);
				const record: RuntimePersistentRecord = {
					id,
					storyId: write.storyId,
					snapshot: write.snapshot,
					updatedAt: write.updatedAt,
					deletedAt: null,
					dirty: 1,
					serverVersion: Number(existing?.server_version ?? 0),
					rev: await nextRev(tx),
				};
				await runtimePersistentTable.upsert(tx, record);
				return record;
			});
		},

		/**
		 * Whether there is anything to wait for, answered by the sync-state row together with the device
		 * key. Not inferred from the record count: that proxy would treat a brand-new account and a
		 * brand-new device that has received nothing yet as the same case, and starting a new game over
		 * months of progress is the cost of that conflation.
		 *
		 * Without a key there is nothing to wait for. Accounts that never set up sync had this flag false
		 * forever while the playback screen sat on `Syncing`, since no first sync would ever finish. The
		 * port's header records the remaining window.
		 */
		async initialSyncDone(): Promise<boolean> {
			if ((await readSyncState(db)).initialSyncDone) return true;
			return !(await hasDeviceKey());
		},
	};
}
