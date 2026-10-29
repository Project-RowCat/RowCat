import type { Rev } from "@rowcat/contracts/sync";
import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";

/**
 * Product model for player saves: the point where runtime snapshots become sync records.
 *
 * - Two records, not one. A single row holding both lifetimes would put both in one conflict
 *   domain. Snapshots merge as whole-record LWW, so one device's change would always discard the
 *   other's. Separate rows each win on their own HLC.
 * - Reset advances the playthrough row to an empty snapshot instead of deleting it. A local
 *   delete would not propagate, and another device still holding old progress would restore it on
 *   sync.
 * - Ids are derived from the story id, not random. Random ids on two devices would leave two
 *   records that nothing can merge. The lifetime prefix keeps the two records off the same server
 *   key.
 * - The owner id is not in the payload. Ownership comes from the local DB scope and the server
 *   session, and a copied value would look like authorization. Device id, wall-clock save time, and
 *   sync state are also excluded.
 */

/**
 * Single-value slot vocabulary. It is kept so that record identity keeps its shape if slots are
 * added later. Removing the slot now would change the id rule, and already-synced saves would
 * become different records. This is separate from whether the screen has a slot UI.
 */
export const RUNTIME_SAVE_SLOTS = ["default"] as const;
export type RuntimeSaveSlot = (typeof RUNTIME_SAVE_SLOTS)[number];
export const DEFAULT_RUNTIME_SAVE_SLOT: RuntimeSaveSlot = "default";

export const isRuntimeSaveSlot = (value: unknown): value is RuntimeSaveSlot =>
	typeof value === "string" &&
	(RUNTIME_SAVE_SLOTS as readonly string[]).includes(value);

/**
 * Sync metadata carried by every synced local record. It has the same shape as in other domains.
 */
export interface RuntimeSaveSyncMeta {
	/**
	 * Whether local changes have not yet been applied on the server. Typed 0|1 because it serves as an
	 * IndexedDB index key.
	 */
	dirty: 0 | 1;
	serverVersion: number;
	rev: Rev;
	/** ISO 8601 deletion timestamp (tombstone). null means the record is alive. */
	deletedAt: string | null;
}

/**
 * The current playthrough save: one per story per slot. Reset does not delete this row. It advances
 * the row to an empty snapshot, because a local delete would not propagate, and another device
 * still holding old progress would restore it on next sync.
 */
export interface RuntimePlaythroughRecord extends RuntimeSaveSyncMeta {
	/** `runtimePlaythroughIdFor(storyId, slot)`. */
	id: string;
	storyId: string;
	slot: RuntimeSaveSlot;
	snapshot: RuntimeStoryStateSnapshot;
	updatedAt: string;
}

/**
 * Long-lived progress for a member and a story: one per story, with no slot axis. The absence of a
 * slot is part of this record's definition. Per-episode ending lists do not belong to this
 * lifetime.
 */
export interface RuntimePersistentRecord extends RuntimeSaveSyncMeta {
	/** `runtimePersistentIdFor(storyId)`. */
	id: string;
	storyId: string;
	snapshot: RuntimePersistentStateSnapshot;
	updatedAt: string;
}

export const RUNTIME_PLAYTHROUGH_ID_PREFIX = "runtime-playthrough";
export const RUNTIME_PERSISTENT_ID_PREFIX = "runtime-persistent";

/**
 * Identity of the playthrough record: `runtime-playthrough:<story>:<slot>`. The slot stays in the
 * id even though only one slot exists, for the reason given at RUNTIME_SAVE_SLOTS above.
 */
export const runtimePlaythroughIdFor = (
	storyId: string,
	slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
): string => `${RUNTIME_PLAYTHROUGH_ID_PREFIX}:${storyId}:${slot}`;

export const runtimePersistentIdFor = (storyId: string): string =>
	`${RUNTIME_PERSISTENT_ID_PREFIX}:${storyId}`;

/**
 * Product save limit, deliberately tighter than the runtime host's theoretical limit.
 * - The host accepts 1 MiB per snapshot (DEFAULT_DURABLE_STATE_LIMITS), but one sync record's
 *   ciphertext caps at 512,000 bytes (SYNC_LIMITS.ciphertextMaxBytes). A maximal snapshot that
 *   compression does not shrink would not fit. The failure would surface at push time, long after
 *   save.
 * - Rejecting here, before the durable write, means a rejected snapshot is never written locally
 *   either.
 * - 256 KiB is sized by arithmetic: even with no compression, base64 expansion (4/3, about 349
 *   KB) plus AEAD overhead stays under 512,000 bytes. Raising this value requires re-deriving that
 *   inequality.
 * - Do not lower the runtime's own limit to match. The VM limit answers how much a creator may
 *   hold at once; this one answers how much can be safely synced. The two answers need not match.
 */
export const RUNTIME_SAVE_LIMITS = Object.freeze({
	maxSnapshotSerializedLength: 256 * 1024,
});
