import type { SyncLocalState } from "@rowcat/sync";
import { newDeviceId } from "./clock.ts";
import { fromFlag, type SqlRunner, toFlag } from "./sqlite.ts";

/**
 * Local sync state: the one row in this database (one member on one device).
 *
 * One place differs from the web's row: **the remembered DEK is not here.** The web can keep a
 * non-extractable `CryptoKey` in IndexedDB and so put the wrapper in this row, but SQLite has no
 * such slot. Writing the key here would mean writing it into a plaintext file. On mobile the value
 * lives in the Keychain/Keystore (`../local-sync/device-key.ts`).
 *
 * Otherwise the axes match the web's. The cursor, epoch, bootstrap, and last result sit alongside
 * the **logical clock** (`hlcT`, `hlcC`). The clock lives in the row rather than in memory because
 * it must survive app restarts: a relaunched app that reissued a revision it had already issued
 * would make two records indistinguishable.
 */
export const SYNC_STATE_KEY = "state";

/**
 * The starting value of the protocol epoch.
 *
 * It is 1, not 0, because 0 cannot be told apart from "not set." Reading 0 from a damaged row would
 * leave no way to know whether it is the first epoch or a missing value.
 */
export const SYNC_PROTOCOL_EPOCH = 1;

export interface LocalSyncStateRow extends SyncLocalState {
	hlcT: number;
	hlcC: number;
}

interface SyncStateColumns {
	device_id: string;
	hlc_t: number;
	hlc_c: number;
	cursor: number;
	protocol_epoch: number;
	initial_sync_done: number;
	last_synced_at: string | null;
	last_error: string | null;
}

const fromRow = (row: SyncStateColumns): LocalSyncStateRow => ({
	deviceId: row.device_id,
	hlcT: row.hlc_t,
	hlcC: row.hlc_c,
	cursor: row.cursor,
	protocolEpoch: row.protocol_epoch,
	initialSyncDone: fromFlag(row.initial_sync_done),
	lastSyncedAt: row.last_synced_at,
	lastError: row.last_error,
});

export const createLocalSyncState = (deviceId: string): LocalSyncStateRow => ({
	deviceId,
	hlcT: 0,
	hlcC: 0,
	cursor: 0,
	protocolEpoch: SYNC_PROTOCOL_EPOCH,
	initialSyncDone: false,
	lastSyncedAt: null,
	lastError: null,
});

export const writeSyncState = (
	tx: SqlRunner,
	state: LocalSyncStateRow,
): Promise<void> =>
	tx.run(
		`INSERT INTO sync_state (
			key, device_id, hlc_t, hlc_c, cursor, protocol_epoch,
			initial_sync_done, last_synced_at, last_error
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			device_id = excluded.device_id,
			hlc_t = excluded.hlc_t,
			hlc_c = excluded.hlc_c,
			cursor = excluded.cursor,
			protocol_epoch = excluded.protocol_epoch,
			initial_sync_done = excluded.initial_sync_done,
			last_synced_at = excluded.last_synced_at,
			last_error = excluded.last_error`,
		[
			SYNC_STATE_KEY,
			state.deviceId,
			state.hlcT,
			state.hlcC,
			state.cursor,
			state.protocolEpoch,
			toFlag(state.initialSyncDone),
			state.lastSyncedAt,
			state.lastError,
		],
	);

/**
 * Reads the state row, creating it on the spot if it is missing.
 *
 * It always exists on the normal path (the database creates it on open). It does not throw when
 * missing anyway, because failing there would block the user's writes over a single state row.
 * Carrying on with a new device identifier only changes the revision tie-break axis; the records
 * stay as they are.
 */
export async function readSyncState(tx: SqlRunner): Promise<LocalSyncStateRow> {
	const row = await tx.first<SyncStateColumns>(
		"SELECT * FROM sync_state WHERE key = ?",
		[SYNC_STATE_KEY],
	);
	if (row) return fromRow(row);
	const fresh = createLocalSyncState(newDeviceId());
	await writeSyncState(tx, fresh);
	return fresh;
}
