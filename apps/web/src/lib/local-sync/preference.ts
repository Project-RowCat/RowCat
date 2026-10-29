import type { LocalDb } from "#/lib/local-data/db.ts";
import { SYNC_STATE_KEY } from "#/lib/local-data/sync-state.ts";

/**
 * Device preference for auto-sync: a narrow port that holds one value.
 *
 * No settings system is built for this single value. A place already exists (the state row of the
 * per-member local DB), and its scope (member plus device) matches exactly what is needed.
 * localStorage['rowcat.autoSync'] is not used, because it holds one value per origin. On a shared
 * browser, what Alice turned off would become Bob's default.
 *
 * Not synced. This value has no dirty flag, rev, or tombstone, and it is absent from the codec
 * registry and TABLE_ORDER. The protocol does not know it exists. Devices should differ on purpose:
 * turning it off on a shared laptop and on a personal phone is what the toggle is for.
 *
 * It is also kept out of the SyncStore port, for the same reason. That port is the protocol
 * contract both platforms share. This value is a preference about when this app runs on this
 * device.
 */
export interface AutoSyncPreferenceStore {
	/** No record means enabled. Setting up sync already counts as a request to keep it running. */
	isEnabled(): Promise<boolean>;
	setEnabled(enabled: boolean): Promise<void>;
}

export function createAutoSyncPreferenceStore(
	db: LocalDb,
): AutoSyncPreferenceStore {
	return {
		async isEnabled() {
			const state = await db.syncState.get(SYNC_STATE_KEY);
			return state?.autoSyncEnabled !== false;
		},

		/**
		 * Read and write happen in one transaction. If split, another write to the same row (revision
		 * issuance or cursor advance) could slip in between and roll the clock state back. That would
		 * hand two copies the same revision. device-key.ts has the same shape for the same reason.
		 */
		async setEnabled(enabled) {
			await db.transaction("rw", [db.syncState], async () => {
				const state = await db.syncState.get(SYNC_STATE_KEY);
				if (!state) return;
				await db.syncState.put({ ...state, autoSyncEnabled: enabled });
			});
		},
	};
}
