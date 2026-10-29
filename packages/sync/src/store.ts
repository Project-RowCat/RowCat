import type { Rev, SyncPayloadEnvelope } from "@rowcat/contracts/sync";
import type { MergeContext, MergeResult, SyncRecordShape } from "./registry.ts";

/**
 * Local storage port. Methods are commit units, not individual operations. This is the most
 * important decision in this interface. For the abstraction not to blur atomicity, transaction
 * boundaries must match method boundaries. If applyRecords() and setCursor() were separate, callers
 * could invoke them separately. Once split, the state 'cursor advanced, application failed' becomes
 * representable, and that page's records would never be sent again. The legacy system's biggest
 * flaw had exactly that shape. Not exposed: Dexie Table, Collection and liveQuery, IndexedDB
 * transactions, SQLite statements. Exposed: the contract that applyPull and commitPush are each
 * atomic.
 */

/** The syncState row. There is exactly one per database, which means one per member per device. */
export interface SyncLocalState {
	deviceId: string;
	cursor: number;
	protocolEpoch: number;
	initialSyncDone: boolean;
	lastSyncedAt: string | null;
	lastError: string | null;
}

/**
 * Outbound collection cursor: a position within the (type, id) order. It is a key cursor, not an
 * offset, because the user keeps writing during the scan. With an offset, one record added or one
 * dirty flag cleared mid-scan would shift the window and skip a record. A key cursor does not
 * shift.
 */
export interface OutboundCursor {
	type: string;
	id: string;
}

export interface OutboundRecord {
	id: string;
	type: string;
	/** The last server version this device confirmed. 0 if the server does not have the record. */
	baseVersion: number;
	deleted: boolean;
	/**
	 * Null for a tombstone, because there is nothing to encrypt. Do not fabricate an empty object and
	 * encrypt that.
	 */
	payload: SyncPayloadEnvelope | null;
	/**
	 * The revision at collection time. commitPush compares this with the current value. If the record
	 * was edited again while the push was in flight, that later edit would be marked clean and never
	 * uploaded.
	 */
	rev: Rev;
}

export interface CollectOutboundOptions {
	/** Maximum records per fetch. It is a window, so the whole account is not loaded into memory. */
	limit: number;
	/**
	 * Ignores dirty and scans all records. Used for bootstrap and full resync. A dirty-only first sync
	 * is not enough. Databases migrated from v1 or v2 may contain rows with dirty = 0 that were never
	 * on the server. The dirty index is an optimization for routine sync; bootstrap correctness comes
	 * from the full scan.
	 */
	all?: boolean;
	/** Where to resume scanning. Leave empty on the first call. */
	after?: OutboundCursor | null;
}

export interface OutboundBatch {
	records: OutboundRecord[];
	/** The next cursor if more records remain; null when the scan is finished. */
	next: OutboundCursor | null;
}

export interface PushAck {
	id: string;
	type: string;
	version: number;
	/** The revision observed when this record was collected for push. */
	rev: Rev;
}

/**
 * A single pull entry, as storage receives it after decryption and decoding are complete. Network
 * and crypto must finish outside the storage transaction. In Dexie, an await on something outside
 * the transaction, inside a transaction callback, auto-commits the transaction. Decrypting inside
 * would silently close it. Later writes would then run outside the transaction, and tests would
 * pass with atomicity lost.
 */
export type InboundEntry =
	| {
			kind: "record";
			id: string;
			type: string;
			version: number;
			serverUpdatedAt: string;
			rev: Rev;
			/** Remote record decoded by the codec. `dirty` and `serverVersion` have no meaning here. */
			remote: SyncRecordShape;
			/**
			 * This type's merge rule, carried in from the codec. Storage does not hold the registry. Storage
			 * knows which table to write; who wins is the domain's decision. The local record is read inside
			 * the transaction and passed to this callback.
			 */
			merge(
				local: SyncRecordShape,
				context: MergeContext,
			): MergeResult<SyncRecordShape>;
	  }
	| {
			kind: "tombstone";
			id: string;
			type: string;
			version: number;
			/**
			 * The server's last write time for this row. The local `deletedAt` comes from here. A tombstone
			 * has no ciphertext, so the deletion time the original device wrote cannot be recovered. If each
			 * receiving device wrote its own time, devices would store different values. Messages deleted by
			 * cascade along with a room would inherit that value too.
			 */
			serverUpdatedAt: string;
	  }
	/**
	 * Entries that are not applied but still advance the cursor. Unknown types, unknown schema
	 * versions, unknown envelopes and corrupted ciphertext arrive here. None of these can be fixed by
	 * retrying. Blocking the cursor would halt sync on this device forever because of one record. This
	 * is by design, not data loss.
	 */
	| { kind: "ignored"; reason: IgnoredReason };

/** Reasons for ignoring an entry. Diagnostics count them; record ids are not kept. */
export type IgnoredReason =
	| "unknown_type"
	| "unknown_envelope"
	| "unknown_schema"
	| "decrypt_failed"
	| "invalid_payload";

export interface PullPage {
	entries: InboundEntry[];
	/** The cursor after applying this page. It is recorded in the same transaction. */
	cursor: number;
	/**
	 * Whether this is the last bootstrap page. The cursor and initialSyncDone must commit in the same
	 * transaction (§24). If they split, a crash between them would leave bootstrap marked done while
	 * the last page was never applied.
	 */
	markInitialSyncDone?: boolean;
}

export interface ApplyPullResult {
	applied: number;
	ignored: number;
	/**
	 * Records where the local side contributed and must be sent back, i.e. those whose dirty flag
	 * stayed set.
	 */
	conflicts: number;
	notes: Record<string, number>;
	/**
	 * Newly created recovery copies, counted only. Re-observing a copy that already exists is not
	 * counted. That is the same event seen again, not a new one. The number carries no record identity
	 * or piece name. Including those would let this result flow into diagnostics and correlate with
	 * user activity.
	 */
	recovered: number;
}

export interface SyncStore {
	/** Reads the cursor, epoch, device identifier and bootstrap status in one read. */
	readState(): Promise<SyncLocalState>;

	/** Records the last sync time and error. Does not touch records. */
	recordOutcome(outcome: {
		syncedAt?: string | null;
		error?: string | null;
	}): Promise<void>;

	/** Collects push candidates in windows. The full set is never loaded into memory. */
	collectOutbound(options: CollectOutboundOptions): Promise<OutboundBatch>;

	/**
	 * Applies a successful push in one transaction. serverVersion is always updated. dirty is cleared
	 * only if the revision at collection time is unchanged. Without that condition: edit A starts a
	 * push, edit B happens, the push response arrives, and dirty is set to 0 unconditionally. Edit B
	 * then never uploads.
	 */
	commitPush(acks: PushAck[]): Promise<void>;

	/**
	 * Applies one pulled page inside one transaction: record application, cascades, order
	 * normalization, HLC absorption and cursor recording. This is the reason this port exists. If the
	 * transaction aborts, nothing is applied and the cursor does not advance. The same page can be
	 * received and applied again safely (idempotent).
	 */
	applyPull(page: PullPage): Promise<ApplyPullResult>;

	/**
	 * Prepares a full resync: cursor set to 0, epoch incremented by 1, initialSyncDone cleared. Local
	 * data is not touched. Emptying local storage and re-downloading from the server would be
	 * discarding local data, not a full resync. It would lose every local change the server does not
	 * have.
	 */
	resetCursor(): Promise<void>;

	/**
	 * Records that the server does not know these records. Sets every record's serverVersion to 0 and
	 * turns dirty on. Local values do not change. Called only after a namespace reset
	 * (controller.reset). If the server has no ciphertext but local storage still holds old
	 * serverVersion values, pushes are rejected because a missing record must have baseVersion 0. Pull
	 * cannot resolve that, since there is nothing to receive, so every convergence attempt fails.
	 * Without this method, a reset account can never re-upload its data.
	 */
	forgetServerVersions(): Promise<void>;
}
