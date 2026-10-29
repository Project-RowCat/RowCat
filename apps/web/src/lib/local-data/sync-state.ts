/**
 * Local sync state: the single row for this database, which is one member's one device. Sync does
 * not exist yet, but this row is needed now for the logical clock. The clock state that issues
 * revisions must survive tab switches and app restarts. In memory, a reloaded tab would reissue
 * revisions it already issued. Several tabs open the same database, so the source of truth must be
 * one stored row. The remaining fields (cursor, epoch) are not read by anyone yet. They are placed
 * now because adding fields later would mean migrating a row whose clock is already running.
 */

/**
 * Fixed key of the state row, since there is only one row. Each member has a separate database
 * (db.ts), so the member id is not written into this row. Writing it would give two places claiming
 * ownership. If they disagreed, for example during a write in the middle of an account switch,
 * nothing would say which one is right.
 */
export const SYNC_STATE_KEY = "state";

/**
 * Starting value of the protocol epoch. It starts at 1, not 0, because 0 cannot be told apart from
 * 'not set'. For a row with a new field or a corrupted row, reading 0 would not show whether it is
 * the first epoch or a missing value. The epoch rises only on a full resync (§24b), which does not
 * exist yet.
 */
export const SYNC_PROTOCOL_EPOCH = 1;

/**
 * Remembered DEK, stored only in wrapped form. wrapKey is a non-extractable CryptoKey, so its bytes
 * cannot be read out. IndexedDB keeps it through structured clone, so no plaintext DEK exists
 * anywhere on disk. It must live inside the state row. In a separate database, 'erase this device's
 * data' would not revoke trust with it, leaving a stale unlock. The boundary between logout and
 * trust revocation would also blur (the legacy code had this bug). Here, deleting one database
 * deletes everything. This is a web-only field and not an index, so the Dexie version is not
 * bumped. Existing rows read it as undefined, and readers fold that to null with ?? null.
 */
export interface RememberedDeviceKey {
	/** AES-GCM 256, `extractable: false`. */
	wrapKey: CryptoKey;
	iv: Uint8Array;
	/** AES-GCM(wrapKey, DEK). */
	ct: Uint8Array;
}

export interface LocalSyncState {
	key: typeof SYNC_STATE_KEY;

	/**
	 * This local database's device identifier. It is the tie-break axis of a revision (Rev.d). It does
	 * not use the member id. If one person writes on a laptop and on a phone, the two devices'
	 * revisions would be indistinguishable, and the winner of a concurrent edit would be random. It
	 * does not use the session id either. If that changed on every refresh, yesterday's edit and
	 * today's edit by the same person would look like strangers, and every revision would appear to
	 * come from a new device.
	 */
	deviceId: string;

	/**
	 * HLC (hybrid logical clock) state. This is the HlcState type from @rowcat/sync, flattened into
	 * the row.
	 */
	hlcT: number;
	hlcC: number;

	/** Last server cursor applied. It stays 0 because there is no sync yet. */
	cursor: number;
	protocolEpoch: number;
	initialSyncDone: boolean;

	/** ISO 8601 time of the last sync. Null if the database has never synced. */
	lastSyncedAt: string | null;
	/**
	 * Code of the last failure, not a message. Null if the last attempt succeeded or none was made. It
	 * is a code rather than a sentence because server messages could someday contain record ids or
	 * user values. A stored message would be persisted in the database, not just written to a log.
	 */
	lastError: string | null;

	/**
	 * Whether automatic sync is used on this device. This is a device preference, and it does not
	 * sync. It belongs in this row for two reasons. Scope: the choice is about this member's device
	 * (off on a shared laptop, on for my phone), and that is exactly this row's scope. Lifetime: the
	 * row is closed on logout and deleted with the account. In localStorage, Alice's choice would
	 * become Bob's default on his next login. undefined means on. Setting up sync already expresses a
	 * request to keep devices connected, so asking again would be asking twice. Existing rows without
	 * this field therefore read as on. The field is web-only and not an index, so the Dexie version is
	 * not bumped (same as deviceKey). It has no sync axis (dirty, rev, tombstone) and is not in the
	 * codec registry, so the protocol does not know it exists.
	 */
	autoSyncEnabled?: boolean;

	/**
	 * The remembered DEK wrapper for this device. null if the device is not trusted. Logout does not
	 * clear this value, because logout and revoking trust for a device are different actions. Making
	 * them the same would require re-entering the recovery code on every logout in the same browser.
	 * Users would then keep that code in a notes app, which is worse.
	 */
	deviceKey: RememberedDeviceKey | null;
}

/**
 * Creates a new state row from a device id and an optional starting clock. The starting clock is an
 * argument because of migration. After revisions are backfilled onto existing records, the clock
 * must not start below the largest of them. If the wall clock were set backward, the first local
 * edit would get a revision older than a stored record. Once sync is enabled, that edit would lose
 * to the older one.
 */
export const createLocalSyncState = (
	deviceId: string,
	hlc: { t?: number; c?: number } = {},
): LocalSyncState => ({
	key: SYNC_STATE_KEY,
	deviceId,
	hlcT: hlc.t ?? 0,
	hlcC: hlc.c ?? 0,
	cursor: 0,
	protocolEpoch: SYNC_PROTOCOL_EPOCH,
	initialSyncDone: false,
	lastSyncedAt: null,
	lastError: null,
	deviceKey: null,
});
