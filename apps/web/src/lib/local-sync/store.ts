import type {
	ApplyPullResult,
	CollectOutboundOptions,
	MergeRecoveryCandidate,
	OutboundBatch,
	OutboundRecord,
	PullPage,
	PushAck,
	SyncCodecRegistry,
	SyncLocalState,
	SyncRecordShape,
	SyncRecoveryRecord,
	SyncStore,
} from "@rowcat/sync";
import {
	absorbHlc,
	compareRev,
	decideInbound,
	SYNC_MERGE_NOTE,
	syncRecoveryId,
} from "@rowcat/sync";
import type { Table } from "dexie";
import { newDeviceId } from "#/lib/local-data/clock.ts";
import type { LocalDb } from "#/lib/local-data/db.ts";
import {
	createLocalSyncState,
	type LocalSyncState,
	SYNC_STATE_KEY,
} from "#/lib/local-data/sync-state.ts";

/**
 * SyncStore implemented with Dexie. The transaction boundaries are the whole point of this file.
 * `applyPull` is the reason this adapter exists. Inside it, record application, room cascade,
 * sibling order normalization, HLC absorption, and the cursor write all happen in one transaction.
 * If they were split, a state could arise where only the cursor is committed, and that page's
 * records would never arrive again. That is exactly the shape of the legacy code's worst defect.
 *
 * One rule applies to this file: inside a transaction callback, the only thing awaited is a Dexie
 * operation. A Dexie transaction auto-commits when its callback awaits something outside the
 * transaction (network, crypto), and later writes then happen outside it. Atomicity is lost while
 * the tests still pass. The engine finishes decryption and decoding before entering the
 * transaction.
 */

/**
 * Maps type strings to tables. The order here is the outbound order, parents first. It is exported
 * so that one check at the assembly point (`codec-wire.test.ts`) can compare it with the codec
 * registry. If this list and the registry's vocabulary diverge, one side is never collected and the
 * other fails at encode. Both failures are silent.
 */
export const SYNC_STORE_TABLE_ORDER = [
	"chat.room",
	"chat.message",
	"chat.memory",
	"chat.summary",
	"authoring.draft",
	"authoring.lore",
	"authoring.scene",
	"authoring.sceneImage",
	/** Runtime: the project comes before files. The real parent chain is draft → project → file. */
	"authoring.runtimeProject",
	"authoring.runtimeFile",
	/**
	 * Managed images are siblings of files, since both are children of the project. Their order
	 * relative to each other carries no meaning. Placing them after files is only for readers.
	 */
	"authoring.runtimeAsset",
	/**
	 * Persona library: no parent. In this array, the only meaningful position is the end. That is the
	 * safest spot for a collection cursor already in progress. It also stays out of room tombstone
	 * cascades, since the child list in `applyTombstone` omits this table. That omission is the
	 * contract.
	 */
	"chat.persona",
	/**
	 * Player saves: no parent, and not children of authoring records. Placing them at the end of the
	 * list, rather than after the draft's children, expresses that. These tables hold this member's
	 * progress through works, including works by other authors. So draft tombstone cascades must not
	 * catch them. The omission of these tables from the child list in `applyTombstone` is the
	 * contract.
	 */
	"runtime.playthrough",
	"runtime.persistent",
	/**
	 * The library entry for a runtime playthrough is product metadata, not saved state. For the same
	 * reason as the two above, it has no parent and goes at the end of the list (see `conversation.ts`
	 * in `@rowcat/runtime-persistence`).
	 */
	"runtime.conversation",
	/**
	 * Character: although it is a child of a room, it goes at the end. The parent (`chat.room`) is the
	 * first entry, so parent-before-child order holds wherever this sits. That leaves one criterion.
	 * Inserting it in the middle would shift the positions of later types, which is unsafe for a
	 * collection cursor already in progress. The codec list in `@rowcat/chat` uses the same place for
	 * the same reason.
	 */
	"chat.character",
] as const;

const TABLE_ORDER = SYNC_STORE_TABLE_ORDER;

type SyncType = (typeof TABLE_ORDER)[number];

/** Minimum shape of a stored record. All six types have this field, set up in phase 1a. */
type StoredRecord = SyncRecordShape;

const tableOf = (
	db: LocalDb,
	type: string,
): Table<StoredRecord, string> | null => {
	switch (type as SyncType) {
		case "chat.room":
			return db.rooms as unknown as Table<StoredRecord, string>;
		case "chat.message":
			return db.messages as unknown as Table<StoredRecord, string>;
		case "chat.memory":
			return db.chatMemories as unknown as Table<StoredRecord, string>;
		case "chat.character":
			return db.chatCharacters as unknown as Table<StoredRecord, string>;
		case "chat.summary":
			return db.chatSummaries as unknown as Table<StoredRecord, string>;
		case "authoring.draft":
			return db.storyDrafts as unknown as Table<StoredRecord, string>;
		case "authoring.lore":
			return db.draftLoreEntries as unknown as Table<StoredRecord, string>;
		case "authoring.scene":
			return db.draftStartScenes as unknown as Table<StoredRecord, string>;
		case "authoring.sceneImage":
			return db.draftSceneImages as unknown as Table<StoredRecord, string>;
		case "authoring.runtimeProject":
			return db.draftRuntimeProjects as unknown as Table<StoredRecord, string>;
		case "authoring.runtimeFile":
			return db.draftRuntimeFiles as unknown as Table<StoredRecord, string>;
		case "authoring.runtimeAsset":
			return db.draftRuntimeAssets as unknown as Table<StoredRecord, string>;
		case "chat.persona":
			return db.chatPersonas as unknown as Table<StoredRecord, string>;
		case "runtime.playthrough":
			return db.runtimePlaythroughs as unknown as Table<StoredRecord, string>;
		case "runtime.persistent":
			return db.runtimePersistentStates as unknown as Table<
				StoredRecord,
				string
			>;
		case "runtime.conversation":
			return db.runtimeConversations as unknown as Table<StoredRecord, string>;
		default:
			return null;
	}
};

/**
 * A key component that sorts above every value in IndexedDB key ordering. It relies on the rule
 * that arrays sort after all other types (`local-chat/store.ts` uses the same trick). The range
 * from `[1, ""]` to `[1, MAX]` is exactly 'all dirty records'.
 */
const MAX_COMPONENT: unknown[] = [];

/** Maps child type to its ordering field. Used by sibling normalization. */
const CHILD_ORDER_FIELD: Partial<
	Record<SyncType, "position" | "positionIndex">
> = {
	"authoring.lore": "positionIndex",
	"authoring.scene": "position",
	"authoring.sceneImage": "position",
	/**
	 * Runtime files are deliberately absent from this map. Normalization renumbers sibling positions,
	 * but code files have no position number. Their order is set by the path, and the path is a value
	 * the user chose. Adding one line here would make sync start rewriting the user's file names.
	 */
};

/**
 * `updatedAt` merges by max. Deletion counts as activity, so the list timestamp never moves
 * backward.
 */
const later = (a: string, b: string): string => (a >= b ? a : b);

export function createDexieSyncStore(
	db: LocalDb,
	registry: SyncCodecRegistry,
): SyncStore {
	/**
	 * Reads the state row, creating it on the spot if it is missing. On the normal path it always
	 * exists (created by `populate` or the v3 upgrade). It still does not throw when missing, because
	 * a failure here would block all of sync over a single state row.
	 */
	async function readRow(): Promise<LocalSyncState> {
		const stored = await db.syncState.get(SYNC_STATE_KEY);
		if (stored) return stored;
		const fresh = createLocalSyncState(newDeviceId());
		await db.syncState.put(fresh);
		return fresh;
	}

	const toState = (row: LocalSyncState): SyncLocalState => ({
		deviceId: row.deviceId,
		cursor: row.cursor,
		protocolEpoch: row.protocolEpoch,
		initialSyncDone: row.initialSyncDone,
		lastSyncedAt: row.lastSyncedAt,
		lastError: row.lastError,
	});

	/** Record to wire candidate. Tombstones have no payload, since there is nothing to encrypt. */
	function toOutbound(
		type: string,
		record: StoredRecord,
	): OutboundRecord | null {
		const codec = registry.get(type);
		if (!codec) return null;
		const deleted = record.deletedAt !== null;
		return {
			id: record.id,
			type,
			baseVersion: record.serverVersion,
			deleted,
			payload: deleted
				? null
				: {
						schemaVersion: codec.schemaVersion,
						rev: record.rev,
						deletedAt: record.deletedAt,
						data: codec.encode(record),
					},
			rev: record.rev,
		};
	}

	return {
		async readState() {
			return toState(await readRow());
		},

		async recordOutcome(outcome) {
			await db.transaction("rw", [db.syncState], async () => {
				const row = await readRow();
				await db.syncState.put({
					...row,
					...(outcome.syncedAt !== undefined
						? { lastSyncedAt: outcome.syncedAt }
						: {}),
					...(outcome.error !== undefined ? { lastError: outcome.error } : {}),
				});
			});
		},

		/**
		 * Collects push candidates in windows. The two paths differ.
		 * - `all: false` uses the `[dirty+id]` index, so the work scales with the number of dirty
		 *   records.
		 * - `all: true` uses the primary key (`id`). Correctness of bootstrap and full resync depends
		 *   on this path.
		 *
		 * The full-scan path is required because databases migrated from v1 and v2 can contain rows with
		 * `dirty=0` that never existed on the server (a migration bug, or some future path). A first sync
		 * that only checks `dirty` would skip them forever.
		 *
		 * Either way the cursor is `(type, id)`, not an offset. Pushes are confirmed during the scan and
		 * lower `dirty`, so an offset would shift and silently skip one record.
		 */
		async collectOutbound(
			options: CollectOutboundOptions,
		): Promise<OutboundBatch> {
			const records: OutboundRecord[] = [];
			const startType = options.after?.type ?? TABLE_ORDER[0];
			let startId = options.after?.id ?? "";
			let started = false;

			for (const type of TABLE_ORDER) {
				if (!started) {
					if (type !== startType) continue;
					started = true;
				} else {
					startId = "";
				}
				const table = tableOf(db, type);
				if (!table) continue;

				while (records.length < options.limit) {
					const remaining = options.limit - records.length;
					const rows = options.all
						? await table.where(":id").above(startId).limit(remaining).toArray()
						: await table
								.where("[dirty+id]")
								.between([1, startId], [1, MAX_COMPONENT], false, true)
								.limit(remaining)
								.toArray();
					if (rows.length === 0) break;
					for (const row of rows) {
						const outbound = toOutbound(type, row);
						if (outbound) records.push(outbound);
					}
					startId = rows[rows.length - 1].id;
					if (records.length >= options.limit)
						return { records, next: { type, id: startId } };
				}
			}
			return { records, next: null };
		},

		/**
		 * Confirms a push, in a single transaction. `serverVersion` is always updated. `dirty` is cleared
		 * only if the revision is still the one captured at collection time. That condition is the core
		 * of this method: if `dirty` were cleared unconditionally, edit B would never be uploaded.
		 *
		 * Updating `serverVersion` unconditionally also matters. Even with edit B still pending, the
		 * server accepted A and bumped its version, so the next push must use that version as
		 * `baseVersion` to pass.
		 */
		async commitPush(acks: PushAck[]) {
			const byType = new Map<string, PushAck[]>();
			for (const ack of acks) {
				const bucket = byType.get(ack.type);
				if (bucket) bucket.push(ack);
				else byType.set(ack.type, [ack]);
			}
			const tables = [...byType.keys()]
				.map((type) => tableOf(db, type))
				.filter(
					(table): table is Table<StoredRecord, string> => table !== null,
				);
			if (tables.length === 0) return;

			await db.transaction("rw", tables, async () => {
				for (const [type, bucket] of byType) {
					const table = tableOf(db, type);
					if (!table) continue;
					const rows = await table.bulkGet(bucket.map((ack) => ack.id));
					const next: StoredRecord[] = [];
					for (const [index, ack] of bucket.entries()) {
						const row = rows[index];
						if (!row) continue;
						const unchanged = compareRev(row.rev, ack.rev) === 0;
						next.push({
							...row,
							serverVersion: ack.version,
							dirty: unchanged ? 0 : row.dirty,
						});
					}
					if (next.length > 0) await table.bulkPut(next);
				}
			});
		},

		applyPull: (page) => applyPullPage(db, page),

		/**
		 * Prepares a full resync: cursor set to 0, epoch incremented by one, bootstrap cleared. Local
		 * data is not deleted. Clearing local data and re-downloading from the server is data
		 * destruction, not a full resync, and it loses every local change not yet on the server. The next
		 * bootstrap starts with PUSH ALL, so local data goes up to the server first.
		 */
		async resetCursor() {
			await db.transaction("rw", [db.syncState], async () => {
				const row = await readRow();
				await db.syncState.put({
					...row,
					cursor: 0,
					protocolEpoch: row.protocolEpoch + 1,
					initialSyncDone: false,
				});
			});
		},

		async forgetServerVersions() {
			const tables = TABLE_ORDER.map((type) => tableOf(db, type)).filter(
				(table): table is Table<StoredRecord, string> => table !== null,
			);
			await db.transaction("rw", tables, async () => {
				for (const table of tables)
					await table.toCollection().modify((row: StoredRecord) => {
						row.serverVersion = 0;
						row.dirty = 1;
					});
			});
		},
	};
}

/**
 * Applies one pulled page. This is the reason this store exists. All of these happen in one
 * transaction: record application, room tombstone cascade, sibling order normalization, HLC
 * absorption, and the cursor write. If interrupted, nothing is applied and the cursor stays where
 * it was. The same page can be fetched and applied again (idempotent). That is how this design
 * makes retries safe.
 */
async function applyPullPage(
	db: LocalDb,
	page: PullPage,
): Promise<ApplyPullResult> {
	const result: ApplyPullResult = {
		applied: 0,
		ignored: 0,
		conflicts: 0,
		notes: {},
		recovered: 0,
	};
	const note = (code: string): void => {
		result.notes[code] = (result.notes[code] ?? 0) + 1;
	};

	/**
	 * Recovery candidates reported by the codec. They are only collected here; writes happen inside
	 * the transaction. Two reasons the merge callback does not write in place. First, codec
	 * determinism: `merge` must be a function without side effects. Second, ordering: the copy must
	 * commit in the same transaction as the merge result, and that commit happens once, below.
	 */
	const candidates: SyncRecoveryRecord[] = [];

	/**
	 * Wall-clock time is read once, before entering the transaction. Reading it inside on every use
	 * would record one page's absorption as spanning several milliseconds. More importantly, it would
	 * make it impossible to reproduce in tests a clock that moved backward.
	 */
	const wallMs = Date.now();
	/**
	 * The observation time is also read only once, derived from the wall clock above. Reading it fresh
	 * per copy would record one page's observations as spanning several milliseconds, and would add a
	 * second clock source.
	 */
	const observedAt = new Date(wallMs).toISOString();

	/** Child collections that need normalization. Collected while records are applied. */
	const touchedParents = new Map<SyncType, Set<string>>();

	await db.transaction(
		"rw",
		[
			db.rooms,
			db.messages,
			db.chatMemories,
			db.chatCharacters,
			db.chatSummaries,
			db.storyDrafts,
			db.draftLoreEntries,
			db.draftStartScenes,
			db.draftSceneImages,
			db.draftRuntimeProjects,
			db.draftRuntimeFiles,
			db.draftRuntimeAssets,
			/**
			 * Persona library: listed here even though it is not a child of a room. The other tables in this
			 * list are children of rooms or drafts, or their parents. The library is an account asset and is
			 * not caught by cascades. It is still needed, because this transaction applies records of every
			 * sync type, and IndexedDB throws immediately on writes to a table not declared in the
			 * transaction. Leaving it out would make any pulled page containing persona records fail as a
			 * whole.
			 */
			db.chatPersonas,
			/**
			 * The two player save tables are here for the same reason: this transaction applies every sync
			 * type, and IndexedDB throws on writes to undeclared tables. Leaving them out would fail any
			 * pulled page that contains save records. The persona table is listed above for the same reason.
			 */
			db.runtimePlaythroughs,
			db.runtimePersistentStates,
			db.runtimeConversations,
			/**
			 * This table is not synced, but it is listed because of tombstone cascades (`applyTombstone`).
			 * When a draft is deleted remotely, its pending cover must be dropped too. IndexedDB throws on
			 * writes to tables not declared in the transaction, so leaving it out would fail the whole
			 * pulled page.
			 */
			db.draftCovers,
			/**
			 * The recovery copy must be inside this transaction. That is the whole point of this feature.
			 * There is one dangerous state: the canonical merge result is committed but the losing copy is
			 * not kept. That is exactly the loss this feature exists to prevent, and splitting the two
			 * writes would make that state possible. Declaring the table here closes that window.
			 */
			db.syncRecoveries,
			db.syncState,
		],
		async () => {
			const state = await db.syncState.get(SYNC_STATE_KEY);
			const row = state ?? createLocalSyncState(newDeviceId());
			let hlc = { t: row.hlcT, c: row.hlcC };

			for (const entry of page.entries) {
				if (entry.kind === "ignored") {
					/**
					 * Ignoring is by design, not data loss (§19). Unknown types, unknown schema versions, unknown
					 * envelopes, and corrupted ciphertext all stay invalid no matter how often they are retried.
					 * Blocking the cursor would stop this device's sync forever over one record. There is also no
					 * revision to absorb: a record that could not be decrypted has no `rev`.
					 */
					result.ignored++;
					continue;
				}

				const table = tableOf(db, entry.type);
				if (!table) {
					// The codec knows the type but no table exists for it. This is an assembly mistake. Skip
					// without writing.
					result.ignored++;
					continue;
				}
				const local = (await table.get(entry.id)) ?? null;

				if (entry.kind === "tombstone") {
					if (!local) {
						/**
						 * Tombstone for a record this device has never seen. It does not create a row. There is no
						 * resurrection risk: the server row is now a tombstone for good. Any other device that wants
						 * to re-upload a live version must first merge this tombstone, and deletion always wins. So
						 * no live content for this id can arrive. This is also why no hollow skeleton row is
						 * fabricated. Creating a room would require filling the playthrough snapshot with fake
						 * values, and those values could eventually reach the screen.
						 *
						 * Warning: the cascade still runs for rooms. Room children are deleted without their own
						 * tombstones, so the server keeps them as live ciphertext. A new device's bootstrap receives
						 * them before this tombstone (lower seq). Stopping here because no room row exists would
						 * leave the plaintext of the deleted conversation alive only on this device. No screen could
						 * open the parent, so there would be no visible symptom.
						 */
						if (entry.type === "chat.room")
							await cascadeRoomChildren(db, entry.id, entry.serverUpdatedAt);
						result.applied++;
						continue;
					}
					await applyTombstone(
						db,
						table,
						entry.type,
						local,
						entry.serverUpdatedAt,
						entry.version,
					);
					result.applied++;
					continue;
				}

				/**
				 * Absorb the revision whether or not the record is applied. Even if the received record is
				 * discarded, that revision has been seen. If the clock were not advanced after seeing it, the
				 * next local write would get a lower revision, reversing causality.
				 */
				hlc = absorbHlc(hlc, entry.rev, wallMs);

				const decision = decideInbound(local, {
					deleted: false,
					rev: entry.rev,
				});

				if (decision.action === "create") {
					await table.put({
						...entry.remote,
						serverVersion: entry.version,
						dirty: 0,
					});
					result.applied++;
					markTouched(touchedParents, entry.type, entry.remote);
					continue;
				}
				if (!local) continue;

				if (decision.action === "keep-deleted") {
					/**
					 * The local row is already deleted. Do not apply the content; only update `serverVersion`.
					 * Leave `dirty` alone. If our own tombstone has not been pushed yet, it must still go up.
					 */
					await table.put({ ...local, serverVersion: entry.version });
					result.applied++;
					if (local.dirty === 1) result.conflicts++;
					continue;
				}

				if (decision.action === "replay") {
					/**
					 * This version is older than what has already been applied. Do not revert the content. Set
					 * `dirty` instead, meaning our copy is newer and the server must be corrected. This guards
					 * against a replay where the server reverts to an old blob, and it is self-healing.
					 */
					await table.put({ ...local, serverVersion: entry.version, dirty: 1 });
					result.applied++;
					result.conflicts++;
					note(SYNC_MERGE_NOTE.staleInbound);
					continue;
				}

				const merged = entry.merge(local, {
					note,
					recover: (candidate) =>
						candidates.push(
							toRecoveryRecord(entry.type, entry.id, candidate, observedAt),
						),
				});
				const dirty = merged.remoteWins ? 0 : 1;
				await table.put({
					...merged.record,
					serverVersion: entry.version,
					dirty,
				});
				result.applied++;
				if (dirty === 1) result.conflicts++;
				markTouched(touchedParents, entry.type, merged.record);
			}

			await normalizeSiblings(db, touchedParents);
			result.recovered = await persistRecoveries(db, candidates);

			/**
			 * The cursor and absorbed clock are written in the same transaction. If this write is split from
			 * page application, the legacy defect returns.
			 */
			await db.syncState.put({
				...row,
				cursor: page.cursor,
				hlcT: hlc.t,
				hlcC: hlc.c,
				...(page.markInitialSyncDone ? { initialSyncDone: true } : {}),
			});
		},
	);

	return result;
}

/**
 * Applies a tombstone. For a room, its children are deleted in the same transaction. A room can
 * hold thousands of messages, but only one room tombstone travels on the wire. The receiving device
 * re-running the same cascade is the other half of the design. The point is not raising the
 * children's `dirty`. Raising it would make all thousands eligible for collection, so one delete
 * would become thousands of pushed records. Messages that were already dirty are left as they are.
 * That state is accurate, so it is not cleared.
 */
async function applyTombstone(
	db: LocalDb,
	table: Table<StoredRecord, string>,
	type: string,
	local: StoredRecord,
	serverUpdatedAt: string,
	version: number,
): Promise<void> {
	/**
	 * `deletedAt` is the server time. A tombstone has no ciphertext, so there is structurally no way
	 * to recover the deletion time that the originating device recorded. If each receiving device
	 * wrote its own time, each would end up with a different value, and messages deleted by the
	 * cascade would inherit those values.
	 */
	const deletedAt = local.deletedAt ?? serverUpdatedAt;
	await table.put({
		...local,
		deletedAt,
		updatedAt: later(local.updatedAt, serverUpdatedAt),
		serverVersion: version,
		// The server already has this tombstone, so there is nothing to send back.
		dirty: 0,
	});

	/**
	 * A draft was deleted remotely, so any cover pending on this device is dropped too. Without this
	 * line, the image of a manuscript deleted on another device would remain on this device only. That
	 * row never appears on any screen, since the draft is gone and there is nothing to open. Sync does
	 * not know about it either, so the picture the user believes they deleted stays forever, invisible
	 * to anyone. The rule that local deletion (`deleteDraft` in `local-authoring/store.ts`) must also
	 * drop it applies here too. If only one path is fixed, the symptom appears only on that path, and
	 * only after a later sync.
	 */
	if (type === "authoring.draft") {
		await db.draftCovers.delete(local.id);
		return;
	}

	if (type !== "chat.room") return;
	await cascadeRoomChildren(db, local.id, deletedAt);
}

/**
 * A room has four kinds of children: messages, memories, characters, and summaries. They are
 * deleted together with the same timestamp and the same rule. Missing one would leave an orphan
 * record that exists only on this device. The next outbound collection would then push it,
 * re-uploading content of an already-deleted room.
 *
 * Summaries have at most one row per room, but still go through the same helper for symmetry.
 * Writing get/put by hand here would let that one spot drift in shape the day a child type is
 * added.
 *
 * There are two callers: a tombstone for a known room and a tombstone for an unknown room
 * (`applyPullPage`). That is why it is a function. Writing the four in two places would let only
 * one side get updated when a child type is added.
 *
 * The sending side (`deleteRoom`) must also cascade all four. If only one side is fixed, the
 * mismatch shows up only after a round trip between two devices.
 */
async function cascadeRoomChildren(
	db: LocalDb,
	roomId: string,
	deletedAt: string,
): Promise<void> {
	await cascadeDelete(db.messages, roomId, deletedAt);
	await cascadeDelete(db.chatMemories, roomId, deletedAt);
	await cascadeDelete(db.chatCharacters, roomId, deletedAt);
	await cascadeDelete(db.chatSummaries, roomId, deletedAt);
	/**
	 * Personas are deliberately absent here; their absence is the rule. The library is an account
	 * asset, not a child of the room. The room holds a copy of the value, not a reference to the
	 * library row (`ChatRoom.persona`). Adding a line here would make deleting a conversation on one
	 * device also delete this device's library. The user never asked for that deletion, and it cannot
	 * be undone.
	 */
}

/**
 * Scans children by parent id and stamps them with the same deletion time. Does not raise `dirty`
 * or `rev`.
 */
async function cascadeDelete(
	table: Table<{ deletedAt: string | null }, string>,
	roomId: string,
	deletedAt: string,
): Promise<void> {
	const children = await table.where("roomId").equals(roomId).toArray();
	const cascaded = children
		.filter((child) => child.deletedAt === null)
		.map((child) => ({ ...child, deletedAt }));
	if (cascaded.length > 0) await table.bulkPut(cascaded);
}

function markTouched(
	touched: Map<SyncType, Set<string>>,
	type: string,
	record: SyncRecordShape,
): void {
	if (!(type in CHILD_ORDER_FIELD)) return;
	const draftId = (record as unknown as { draftId?: string }).draftId;
	if (!draftId) return;
	const bucket = touched.get(type as SyncType);
	if (bucket) bucket.add(draftId);
	else touched.set(type as SyncType, new Set([draftId]));
}

/**
 * Sibling order normalization. Cleans up duplicate order values created by concurrent reordering,
 * locally only.
 *
 * If two devices each reorder, each record follows its own HLC winner, so the same order value can
 * appear more than once. The display order is still deterministic. Queries such as
 * `sortStartScenes` build a total order with `(position, id)`, so two devices holding the same set
 * draw the same order. What this function fixes is the representation on top of that: it respreads
 * duplicate values across 0..n-1.
 *
 * It only touches anything when there are duplicates. This is the most important condition in the
 * function. Renumbering densely every time would break subsets split across page boundaries. If
 * only one child arrives first, its order value (say 3) would be pushed down to 0. When the real 0
 * arrives later, the two collide at the same spot and the original order is scrambled. Gaps (1, 4,
 * 7) do no harm.
 *
 * It does not raise `dirty` and does not issue a new revision. Raising either would make two
 * devices push normalization to each other forever. This is representation cleanup, not a new user
 * edit.
 *
 * Why no sequence CRDT: characters, lore, and scenes are usually fewer than ten. Concurrent
 * reordering is rare. When it goes wrong, the cost is an unexpected order, which dragging again
 * fixes, not data loss.
 */
async function normalizeSiblings(
	db: LocalDb,
	touched: Map<SyncType, Set<string>>,
): Promise<void> {
	for (const [type, draftIds] of touched) {
		const field = CHILD_ORDER_FIELD[type];
		const table = tableOf(db, type);
		if (!field || !table) continue;
		for (const draftId of draftIds) {
			const siblings = (
				await table.where("draftId").equals(draftId).toArray()
			).filter((row) => row.deletedAt === null) as Array<
				StoredRecord & Record<string, unknown>
			>;
			const positions = siblings.map((row) => Number(row[field] ?? 0));
			if (new Set(positions).size === positions.length) continue;

			siblings.sort((a, b) => {
				const left = Number(a[field] ?? 0);
				const right = Number(b[field] ?? 0);
				if (left !== right) return left - right;
				return a.id < b.id ? -1 : 1;
			});
			const rewritten = siblings
				.map((row, index) => ({ row, index }))
				.filter(({ row, index }) => Number(row[field] ?? 0) !== index)
				.map(({ row, index }) => ({ ...row, [field]: index }));
			if (rewritten.length > 0)
				await table.bulkPut(rewritten as unknown as StoredRecord[]);
		}
	}
}

/**
 * Turns a candidate into a row to store. Identity is produced by a pure function from the protocol.
 * Strings are not assembled here. The reason is not that the copy's identity must match between web
 * and mobile, since they never see each other's copies. It must be stable across runs on the same
 * device. If the rule existed in two versions, fixing only one would record the same losing value
 * as two different rows.
 */
const toRecoveryRecord = (
	type: string,
	recordId: string,
	candidate: MergeRecoveryCandidate,
	observedAt: string,
): SyncRecoveryRecord => ({
	id: syncRecoveryId(type, recordId, candidate.scope, candidate.losingRev),
	type,
	recordId,
	scope: candidate.scope,
	losingRev: candidate.losingRev,
	payload: candidate.payload,
	observedAt,
});

/**
 * Stores recovery copies. Rows that already exist are left untouched. The reason this uses no
 * `bulkPut` is `observedAt`. The same loss is observed many times: pull retries, reconnects,
 * reapplying the same page, process restarts. Overwriting would push the timestamp forward on each
 * observation, so a draft lost weeks ago would read as 'just happened'. The first observation time
 * marks the event.
 *
 * Read-then-write is safe because this code runs inside a transaction. Outside one, two runs could
 * create the same copy side by side. Here that window does not exist.
 *
 * `add` is intentionally not wrapped in try/catch. In Dexie, a primary key conflict aborts the
 * transaction, so one re-observation would roll back the whole page's apply.
 */
async function persistRecoveries(
	db: LocalDb,
	candidates: readonly SyncRecoveryRecord[],
): Promise<number> {
	if (candidates.length === 0) return 0;
	/** Observing the same loss twice within one page is normal (two entries for the same record). */
	const unique = new Map(candidates.map((row) => [row.id, row]));
	const existing = await db.syncRecoveries.bulkGet([...unique.keys()]);
	const fresh = [...unique.values()].filter(
		(_, index) => existing[index] === undefined,
	);
	if (fresh.length > 0) await db.syncRecoveries.bulkPut(fresh);
	return fresh.length;
}
