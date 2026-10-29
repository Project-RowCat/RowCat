import type { SqlRunner } from "./sqlite.ts";
import { readSyncState, SYNC_STATE_KEY } from "./sync-state.ts";

/**
 * The device preference for auto-sync: a narrow port holding one value (the counterpart of the
 * web's `local-sync/preference.ts`).
 *
 * No settings system is built for this one value. A place to hold it already exists (the
 * `sync_state` row in the per-member SQLite), and that place matches exactly the scope required
 * (member + device). It is not stored in AsyncStorage, because that holds one value per device and
 * another member on the same device would then share the toggle.
 *
 * **Not synced.** This value has no `dirty`, `rev`, or tombstone, and it is absent from the codec
 * registry and `TABLE_ORDER` — the protocol does not know this preference exists. Devices should
 * differ here: on a shared tablet you turn it off, and on your own phone you leave it on.
 *
 * **Not held in TanStack Query either.** The screen reads a snapshot from the auto-sync adapter
 * (`local-sync/auto-sync.ts`), and the source of that snapshot is this store. Two copies would
 * leave a window where the toggle is drawn out of step.
 */
export interface AutoSyncPreferenceStore {
	/** A missing record (NULL) means **on** — setting up sync is itself a request to keep it running. */
	isEnabled(): Promise<boolean>;
	setEnabled(enabled: boolean): Promise<void>;
}

interface AutoSyncColumn {
	auto_sync_on: number | null;
}

export function createAutoSyncPreferenceStore(
	db: SqlRunner & {
		transaction<T>(task: (tx: SqlRunner) => Promise<T>): Promise<T>;
	},
): AutoSyncPreferenceStore {
	return {
		async isEnabled() {
			const row = await db.first<AutoSyncColumn>(
				"SELECT auto_sync_on FROM sync_state WHERE key = ?",
				[SYNC_STATE_KEY],
			);
			return row?.auto_sync_on !== 0;
		},

		/**
		 * Ensuring the row and the write happen in **one transaction**. The state row normally exists (it
		 * is created when the database opens), but if it were silently dropped when missing, the toggle
		 * would become a switch that does nothing — `readSyncState` creates the missing row on the spot.
		 */
		async setEnabled(enabled) {
			await db.transaction(async (tx) => {
				await readSyncState(tx);
				await tx.run("UPDATE sync_state SET auto_sync_on = ? WHERE key = ?", [
					enabled ? 1 : 0,
					SYNC_STATE_KEY,
				]);
			});
		},
	};
}
