import type { Rev } from "@rowcat/contracts/sync";
import {
	type RuntimePersistentStateSnapshot,
	validatePersistentStateSnapshot,
} from "@rowcat/runtime-host/persistent-state";
import {
	type RuntimeStoryStateSnapshot,
	validateStoryStateSnapshot,
} from "@rowcat/runtime-host/story-state";
import { z } from "zod";
import { runtimeConversationSyncCodec } from "./conversation.ts";
import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	isRuntimeSaveSlot,
	RUNTIME_SAVE_SLOTS,
	type RuntimePersistentRecord,
	type RuntimePlaythroughRecord,
} from "./model.ts";
import { compareRev } from "./rev-order.ts";

/**
 * Sync codec for player saves: whole-record HLC LWW with no field-level merge.
 * - Does not import @rowcat/sync, the same as the chat and authoring codecs (option B). The app
 *   passes the codecs to the registry, where structural typing checks conformance.
 * - No deep merge. Snapshots are creator-defined values the sync layer cannot interpret. Per-key
 *   merging would produce states nobody wrote (inventory from one side, chapter from the other),
 *   and arrays could gain or lose items. The winner is the whole record. Splitting data into
 *   separate records (see model.ts) lets each winner lose less.
 * - Reset is a newer state, not a tombstone. An empty snapshot at a higher revision converges
 *   devices holding old progress. A local delete would not propagate.
 * - Decode re-validates the snapshot. Decryption does not prove the JSON is valid. A payload that
 *   fails the shape check decodes to null. The engine skips that record and advances only the
 *   cursor, so malformed state never reaches QuickJS.
 */

/** Codec version for this domain. Increment it when the save payload shape changes. */
export const RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION = 1;

export const RUNTIME_PERSISTENCE_SYNC_TYPE = {
	playthrough: "runtime.playthrough",
	persistent: "runtime.persistent",
} as const;

interface DecodeInput {
	id: string;
	schemaVersion: number;
	rev: Rev;
	deletedAt: string | null;
	data: unknown;
}

interface Merged<T> {
	record: T;
	remoteWins: boolean;
}

const INBOUND_META = { dirty: 0, serverVersion: 0 } as const;

/**
 * Whole-record LWW, the same rule as the authoring child merge (childMerge). When the remote wins,
 * local dirty and serverVersion carry over. Unpushed local changes must stay marked as unpushed
 * regardless of the merge.
 */
function wholeRecordMerge<
	T extends { rev: Rev; dirty: 0 | 1; serverVersion: number },
>(local: T, remote: T): Merged<T> {
	const remoteWins = compareRev(remote.rev, local.rev) >= 0;
	return {
		record: remoteWins
			? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
			: local,
		remoteWins,
	};
}

const PlaythroughData = z.object({
	storyId: z.string().min(1),
	slot: z.enum(RUNTIME_SAVE_SLOTS),
	snapshot: z.unknown(),
	updatedAt: z.string(),
});

const PersistentData = z.object({
	storyId: z.string().min(1),
	snapshot: z.unknown(),
	updatedAt: z.string(),
});

/**
 * `slot` is in the payload so more slots can be added later. It could be derived from the id, but
 * decode would then need a parser that splits the string. That parser would silently break if the
 * prefix ever changed.
 */
export const runtimePlaythroughSyncCodec = {
	type: RUNTIME_PERSISTENCE_SYNC_TYPE.playthrough,
	schemaVersion: RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION,
	encode: (record: RuntimePlaythroughRecord): unknown => ({
		storyId: record.storyId,
		slot: record.slot,
		snapshot: record.snapshot,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): RuntimePlaythroughRecord | null {
		const parsed = PlaythroughData.safeParse(input.data);
		if (!parsed.success) return null;
		if (!isRuntimeSaveSlot(parsed.data.slot)) return null;
		const snapshot = validateStoryStateSnapshot(parsed.data.snapshot);
		if (!snapshot.ok) return null;
		return {
			id: input.id,
			storyId: parsed.data.storyId,
			slot: parsed.data.slot,
			snapshot: snapshot.snapshot as RuntimeStoryStateSnapshot,
			updatedAt: parsed.data.updatedAt,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: RuntimePlaythroughRecord,
		remote: RuntimePlaythroughRecord,
	): Merged<RuntimePlaythroughRecord> => wholeRecordMerge(local, remote),
	revOf: (record: RuntimePlaythroughRecord): Rev => record.rev,
};

export const runtimePersistentSyncCodec = {
	type: RUNTIME_PERSISTENCE_SYNC_TYPE.persistent,
	schemaVersion: RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION,
	encode: (record: RuntimePersistentRecord): unknown => ({
		storyId: record.storyId,
		snapshot: record.snapshot,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): RuntimePersistentRecord | null {
		const parsed = PersistentData.safeParse(input.data);
		if (!parsed.success) return null;
		const snapshot = validatePersistentStateSnapshot(parsed.data.snapshot);
		if (!snapshot.ok) return null;
		return {
			id: input.id,
			storyId: parsed.data.storyId,
			snapshot: snapshot.snapshot as RuntimePersistentStateSnapshot,
			updatedAt: parsed.data.updatedAt,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: RuntimePersistentRecord,
		remote: RuntimePersistentRecord,
	): Merged<RuntimePersistentRecord> => wholeRecordMerge(local, remote),
	revOf: (record: RuntimePersistentRecord): Rev => record.rev,
};

/**
 * The list the app passes to the registry has no parent-child structure. The records are not
 * children of each other, so the order means only 'the end' (as with chat.persona). The third
 * entry, runtime.conversation, is library metadata rather than save state. It sits here because it
 * travels in the same member envelope. The app passes this one array at the assembly point (see
 * conversation.ts header).
 */
export const runtimePersistenceSyncCodecs = [
	runtimePlaythroughSyncCodec,
	runtimePersistentSyncCodec,
	runtimeConversationSyncCodec,
];

export { DEFAULT_RUNTIME_SAVE_SLOT };
