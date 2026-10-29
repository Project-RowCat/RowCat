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
import type { DraftCoverFiles } from "./draft-cover-store.ts";
import { insertRecoveries } from "./recovery-store.ts";
import type { MobileDatabase, SqlRunner } from "./sqlite.ts";
import { readSyncState, writeSyncState } from "./sync-state.ts";
import {
	CHILD_ORDER_FIELD,
	type RecordTable,
	type SqlRow,
	type SyncType,
	TABLE_ORDER,
	tableOf,
} from "./tables.ts";

/**
 * SQLite implementation of `SyncStore`. The transaction boundary is the point of this file.
 *
 * `applyPull` is why this adapter exists: record application, room cascades, sibling order
 * normalization, HLC absorption and the cursor write all happen in **one transaction**. If they
 * were split, a cursor could commit without its records, and that page's records would never be
 * sent again (the legacy sync's worst defect). That requires conversations, authoring and the
 * cursor to share one database connection; `stores.ts` gives the mobile scope a single connection
 * for all three.
 *
 * The engine decrypts and decodes before entering the transaction. Holding network and crypto work
 * inside the write lock would block every other write.
 */

/** Merges `updatedAt` as max: deletion counts as activity, so the list time never moves backwards. */
const later = (a: string, b: string): string => (a >= b ? a : b);

const readRecord = async (
	tx: SqlRunner,
	table: RecordTable,
	id: string,
): Promise<SyncRecordShape | null> => {
	const row = await tx.first<SqlRow>(
		`SELECT * FROM ${table.table} WHERE id = ?`,
		[id],
	);
	return row ? table.fromRow(row) : null;
};

/**
 * The file location used to remove the cover of a draft deleted remotely. Same port and name as the
 * cover store. Injected, as in `draft-cover-store.ts`, so `expo-file-system` stays out of the test
 * graph, which has no polyfills.
 *
 * Not optional: if an assembly could omit it, the deleted draft's image would stay on the device
 * forever with no symptom.
 */
export interface SyncDraftCoverFiles {
	/** This member's cover directory (`viewerDraftCoverDirName`), the same value the cover store receives. */
	dirName: string;
	files: Pick<DraftCoverFiles, "remove" | "candidates">;
}

/** A cover whose row this page deleted; the basis for removing its file after commit. */
interface DroppedCover {
	draftId: string;
	/** `null` when the row was already gone; the file is then found by scanning name candidates, as in `clear`. */
	fileName: string | null;
}

export function createSqliteSyncStore(
	db: MobileDatabase,
	registry: SyncCodecRegistry,
	draftCovers: SyncDraftCoverFiles,
): SyncStore {
	const toState = (row: SyncLocalState): SyncLocalState => ({
		deviceId: row.deviceId,
		cursor: row.cursor,
		protocolEpoch: row.protocolEpoch,
		initialSyncDone: row.initialSyncDone,
		lastSyncedAt: row.lastSyncedAt,
		lastError: row.lastError,
	});

	/** Record → wire candidate. Tombstones carry no payload, since there is nothing to encrypt. */
	const toOutbound = (
		type: string,
		record: SyncRecordShape,
	): OutboundRecord | null => {
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
	};

	return {
		async readState() {
			return toState(await readSyncState(db));
		},

		async recordOutcome(outcome) {
			await db.transaction(async (tx) => {
				const row = await readSyncState(tx);
				await writeSyncState(tx, {
					...row,
					...(outcome.syncedAt !== undefined
						? { lastSyncedAt: outcome.syncedAt }
						: {}),
					...(outcome.error !== undefined ? { lastError: outcome.error } : {}),
				});
			});
		},

		/**
		 * Collects push candidates one window at a time. The whole account is never loaded into memory.
		 *
		 * Two paths:
		 *
		 * ```text
		 * all: false   dirty = 1 AND id > ?    uses the (dirty, id) index
		 * all: true    id > ?                  uses the primary key; bootstrap correctness depends on this
		 * ```
		 *
		 * The full-scan path is required: a row can have `dirty = 0` and still never have existed on the
		 * server, through migration or any other path. A first sync that reads only dirty rows would skip
		 * those forever.
		 *
		 * Does not use OFFSET. Pushes confirmed during the scan clear dirty, which shifts an offset and
		 * silently skips a record. The cursor is always `(type, id)`.
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
				const table = tableOf(type);
				if (!table) continue;

				while (records.length < options.limit) {
					const remaining = options.limit - records.length;
					const rows = options.all
						? await db.all<SqlRow>(
								`SELECT * FROM ${table.table} WHERE id > ? ORDER BY id ASC LIMIT ?`,
								[startId, remaining],
							)
						: await db.all<SqlRow>(
								`SELECT * FROM ${table.table} WHERE dirty = 1 AND id > ?
								 ORDER BY id ASC LIMIT ?`,
								[startId, remaining],
							);
					if (rows.length === 0) break;
					for (const row of rows) {
						const outbound = toOutbound(type, table.fromRow(row));
						if (outbound) records.push(outbound);
					}
					startId = String(rows[rows.length - 1].id);
					if (records.length >= options.limit)
						return { records, next: { type, id: startId } };
				}
			}
			return { records, next: null };
		},

		/**
		 * Push confirmation, in one transaction.
		 *
		 * `serverVersion` is always updated, but `dirty` is cleared only when the revision still matches
		 * the one collected. This condition is the whole method:
		 *
		 * ```text
		 * edit A → push starts → edit B → push response arrives
		 * clearing dirty unconditionally → edit B is never pushed.
		 * ```
		 *
		 * Updating `serverVersion` unconditionally matters too. With edit B still pending, the server has
		 * accepted A and bumped the version, so the next push must send that version as `baseVersion`.
		 *
		 * The comparison uses `compareRev` rather than an SQL column comparison because that function
		 * folds `NaN`, negatives and fractions once. Local rows skip contract validation, so such values
		 * can appear, and an unfolded comparison is not a total order.
		 */
		async commitPush(acks: PushAck[]) {
			if (acks.length === 0) return;
			await db.transaction(async (tx) => {
				for (const ack of acks) {
					const table = tableOf(ack.type);
					if (!table) continue;
					const local = await readRecord(tx, table, ack.id);
					if (!local) continue;
					const unchanged = compareRev(local.rev, ack.rev) === 0;
					await tx.run(
						`UPDATE ${table.table} SET server_version = ?, dirty = ? WHERE id = ?`,
						[ack.version, unchanged ? 0 : local.dirty, ack.id],
					);
				}
			});
		},

		applyPull: (page) => applyPullPage(db, page, draftCovers),

		/**
		 * Prepares a full resync: cursor 0, epoch +1, bootstrap cleared.
		 *
		 * Local data is not deleted. Emptying locally and re-downloading would be local data destruction,
		 * not a full resync, and would lose every local change the server does not have.
		 */
		async resetCursor() {
			await db.transaction(async (tx) => {
				const row = await readSyncState(tx);
				await writeSyncState(tx, {
					...row,
					cursor: 0,
					protocolEpoch: row.protocolEpoch + 1,
					initialSyncDone: false,
				});
			});
		},

		async forgetServerVersions() {
			await db.transaction(async (tx) => {
				for (const type of TABLE_ORDER) {
					const table = tableOf(type);
					if (!table) continue;
					await tx.run(
						`UPDATE ${table.table} SET server_version = 0, dirty = 1`,
						[],
					);
				}
			});
		},
	};
}

/**
 * Applies one pull page. This is why the store exists.
 *
 * Inside one transaction:
 *
 * ```text
 * record application · room tombstone cascade · sibling order normalization · HLC absorption · cursor write
 * ```
 *
 * On failure nothing applies and the cursor stays put. Re-fetching and re-applying the same page is
 * idempotent, which is what makes retries safe.
 */
async function applyPullPage(
	db: MobileDatabase,
	page: PullPage,
	draftCovers: SyncDraftCoverFiles,
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
	 * Recovery candidates named by the codec. They are only collected here; writes happen inside the
	 * transaction.
	 *
	 * Two reasons: codec determinism (`merge` must be side-effect free), and ordering. A copy must
	 * commit in the **same transaction** as the merge result, and that commit happens once below.
	 */
	const candidates: SyncRecoveryRecord[] = [];

	/**
	 * The wall clock is read once, before entering the transaction. Reading it per record would record
	 * one page's absorption as spanning several milliseconds, and would make a clock that moved
	 * backwards impossible to reproduce in tests.
	 */
	const wallMs = Date.now();
	/**
	 * The observation time is also read once, derived from `wallMs`. Reading it per copy would record
	 * one page's observations across several milliseconds and create a second clock source.
	 */
	const observedAt = new Date(wallMs).toISOString();

	/** Child collections that need normalization, gathered while applying. */
	const touchedParents = new Map<SyncType, Set<string>>();

	/** Covers whose rows a remote deletion removed. Their files are removed after commit (`applyTombstone`). */
	const droppedCovers: DroppedCover[] = [];

	await db.transaction(async (tx) => {
		const row = await readSyncState(tx);
		let hlc = { t: row.hlcT, c: row.hlcC };

		for (const entry of page.entries) {
			if (entry.kind === "ignored") {
				/**
				 * Ignoring is by design, not data loss. An unknown type, unknown schema version, unknown
				 * envelope or corrupted ciphertext never becomes valid on retry. Blocking the cursor would halt
				 * this device's sync forever on that one record. There is no revision to absorb either.
				 */
				result.ignored++;
				continue;
			}

			const table = tableOf(entry.type);
			if (!table) {
				// The codec exists but the table does not: an assembly mistake. Skip without writing.
				result.ignored++;
				continue;
			}
			const local = await readRecord(tx, table, entry.id);

			if (entry.kind === "tombstone") {
				if (!local) {
					/**
					 * Tombstone for a record never seen locally. **Does not create a row.**
					 *
					 * No resurrection risk: the server row is now a tombstone forever, and another device
					 * re-sending a live copy must merge this tombstone first, where deletion always wins. This
					 * also avoids fabricating an empty skeleton row. A room would need a fake value in the
					 * playback snapshot slot, and that value can eventually reach the screen.
					 *
					 * ⚠️ **A room still cascades.** Room children are deleted without their own tombstones, so the
					 * server keeps them as live ciphertext, and a new device's bootstrap receives them **before**
					 * this tombstone (lower seq). Stopping here because no room row exists would leave the deleted
					 * conversation's plaintext on this device only, and since no screen can open the parent there
					 * is no symptom.
					 */
					if (entry.type === "chat.room")
						await cascadeRoomChildren(tx, entry.id, entry.serverUpdatedAt);
					result.applied++;
					continue;
				}
				await applyTombstone(
					tx,
					table,
					local,
					entry.serverUpdatedAt,
					entry.version,
					droppedCovers,
				);
				result.applied++;
				continue;
			}

			/**
			 * Absorbs the revision whether or not the record is applied.
			 *
			 * Even a discarded record's revision has been seen. If the clock were not advanced, the next
			 * local write would get a lower revision and causality would invert.
			 */
			hlc = absorbHlc(hlc, entry.rev, wallMs);

			const decision = decideInbound(local, { deleted: false, rev: entry.rev });

			if (decision.action === "create") {
				await table.upsert(tx, {
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
				 * The local copy is already deleted. Do not apply the content, only update `serverVersion`.
				 * `dirty` is left alone: an unpushed local tombstone must still go up.
				 */
				await tx.run(
					`UPDATE ${table.table} SET server_version = ? WHERE id = ?`,
					[entry.version, entry.id],
				);
				result.applied++;
				if (local.dirty === 1) result.conflicts++;
				continue;
			}

			if (decision.action === "replay") {
				/**
				 * An older version than one already applied. Do not revert content; set `dirty` instead, since
				 * our side is newer and the server needs correcting. This defends against replays that roll the
				 * server back to an old blob, and repairs it.
				 */
				await tx.run(
					`UPDATE ${table.table} SET server_version = ?, dirty = 1 WHERE id = ?`,
					[entry.version, entry.id],
				);
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
			await table.upsert(tx, {
				...merged.record,
				serverVersion: entry.version,
				dirty,
			});
			result.applied++;
			if (dirty === 1) result.conflicts++;
			markTouched(touchedParents, entry.type, merged.record);
		}

		await normalizeSiblings(tx, touchedParents);
		/**
		 * Recovery copies must live **inside this transaction**. The one dangerous state is the canonical
		 * merge result committing while the losing copy does not. That is exactly the loss this feature
		 * prevents.
		 */
		result.recovered = await insertRecoveries(tx, candidates);

		/**
		 * The cursor and absorbed clock are written **in the same transaction**. Separating this line
		 * from page application brings back the legacy defect.
		 */
		await writeSyncState(tx, {
			...row,
			cursor: page.cursor,
			hlcT: hlc.t,
			hlcC: hlc.c,
			...(page.markInitialSyncDone ? { initialSyncDone: true } : {}),
		});
	});

	/**
	 * Cover files are removed **only after the transaction commits**. Removing them inside the
	 * transaction would leave a row whose file is already gone when the page rolls back (a broken
	 * cover), and file deletion cannot be undone.
	 *
	 * A failure does not fail this page: records and cursor are already committed, and the leftover
	 * file is read by no screen and disappears with the member's directory (`purge.ts`). Local
	 * deletion (`draft-list-panel.tsx`) makes the same call.
	 */
	for (const cover of droppedCovers) {
		try {
			const names = cover.fileName
				? [cover.fileName]
				: draftCovers.files.candidates(cover.draftId);
			for (const name of names)
				draftCovers.files.remove(draftCovers.dirName, name);
		} catch {
			// Swallowed for the reason above.
		}
	}

	return result;
}

/**
 * Applies a tombstone. For a room, its **children are deleted in the same transaction too.**
 *
 * A room can hold thousands of messages, so the wire carries only the room tombstone. The receiving
 * device re-running the same cascade is the other half of the design.
 *
 * The point is **not raising** the children's `dirty`. Raising it would make thousands of records
 * push candidates, so one deletion would become thousands of pushes. Messages that were already
 * dirty stay dirty; that is the accurate state, so it is not cleared.
 */
async function applyTombstone(
	tx: SqlRunner,
	table: RecordTable,
	local: SyncRecordShape,
	serverUpdatedAt: string,
	version: number,
	/** Covers whose files go after commit. This function deletes their rows inside the transaction. */
	droppedCovers: DroppedCover[],
): Promise<void> {
	/**
	 * `deletedAt` is the **server time**. A tombstone has no ciphertext, so the deletion time the
	 * originating device wrote cannot be recovered. If each receiving device wrote its own time,
	 * devices would keep different values, and messages cascaded with the room would inherit them.
	 */
	const deletedAt = local.deletedAt ?? serverUpdatedAt;
	await tx.run(
		`UPDATE ${table.table}
		 SET deleted_at = ?, updated_at = ?, server_version = ?, dirty = 0
		 WHERE id = ?`,
		// The server already holds this tombstone, so there is nothing to send back.
		[deletedAt, later(local.updatedAt, serverUpdatedAt), version, local.id],
	);

	/**
	 * The draft was deleted remotely, so any cover pending on this device is dropped too (the same
	 * spot and reason as `local-sync/store.ts` on web).
	 *
	 * Without this line, the image of a manuscript deleted on another device would survive **on this
	 * device only**. No screen can open a cover without its draft, and sync does not know the row, so
	 * the image the user believes they deleted stays in the document directory forever. Local deletion
	 * (`draft-list-panel.tsx`) must clear it too, and the same rule applies here.
	 *
	 * The row is deleted **inside this transaction** and only its name is collected; the file goes
	 * after commit (`applyPullPage`). Like the cover store's `clear`, the order is row first, then
	 * file. The reverse would leave a rolled-back page with a row whose file is gone, which shows as a
	 * broken cover.
	 */
	if (table.type === "authoring.draft") {
		const cover = await tx.first<SqlRow>(
			"SELECT file_name FROM authoring_draft_cover WHERE draft_id = ?",
			[local.id],
		);
		await tx.run("DELETE FROM authoring_draft_cover WHERE draft_id = ?", [
			local.id,
		]);
		droppedCovers.push({
			draftId: local.id,
			fileName: cover?.file_name ? String(cover.file_name) : null,
		});
		return;
	}

	if (table.type !== "chat.room") return;
	await cascadeRoomChildren(tx, local.id, deletedAt);
}

/**
 * A room has **four** children: messages, memories, characters and summary. They are deleted
 * together with the same timestamp and rule. Missing one leaves orphan records alive only on this
 * device; the next outbound collection picks them up and **re-uploads the content of an
 * already-deleted room.**
 *
 * Two call sites: a tombstone for a known room and one for an unseen room (`applyPullPage`). The
 * function is extracted because writing the four in two places means one copy gets fixed when a
 * child type is added.
 *
 * **The sending side (`deleteRoom`) must cascade all four too.** Fixing only one side reveals the
 * mismatch only after a round trip between two devices.
 */
async function cascadeRoomChildren(
	tx: SqlRunner,
	roomId: string,
	deletedAt: string,
): Promise<void> {
	for (const child of [
		"chat_message",
		"chat_memory",
		"chat_character",
		"chat_summary",
	])
		await tx.run(
			`UPDATE ${child} SET deleted_at = ? WHERE room_id = ? AND deleted_at IS NULL`,
			[deletedAt, roomId],
		);
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
 * Sibling order normalization. Cleans **duplicate order values** that concurrent reorders created,
 * locally only.
 *
 * If two devices each reorder, each record follows its own HLC winner, so one order value can
 * appear more than once. Display order is still deterministic: lookups such as `sortCharacters`
 * build a total order from `(position, id)`. This fixes the representation on top of that.
 *
 * **Only touches rows when duplicates exist.** This is the most important condition. Renumbering
 * densely every time fails on a page-boundary subset: if one child arrives first with order 3,
 * pressing it to 0, and the real 0 arrives later, the two collide at the same spot and **the
 * original order is scrambled.** Gaps (1, 4, 7) cause no harm.
 *
 * **Does not set `dirty` or issue a new revision.** Doing so would make two devices push each
 * other's normalization forever. This is representation cleanup, not a new user edit.
 */
async function normalizeSiblings(
	tx: SqlRunner,
	touched: Map<SyncType, Set<string>>,
): Promise<void> {
	for (const [type, draftIds] of touched) {
		const field = CHILD_ORDER_FIELD[type];
		const table = tableOf(type);
		if (!field || !table?.order) continue;
		for (const draftId of draftIds) {
			const rows = await tx.all<SqlRow>(
				`SELECT id, ${table.order} AS position FROM ${table.table}
				 WHERE draft_id = ? AND deleted_at IS NULL`,
				[draftId],
			);
			const siblings = rows.map((row) => ({
				id: String(row.id),
				position: Number(row.position ?? 0),
			}));
			const positions = siblings.map((row) => row.position);
			if (new Set(positions).size === positions.length) continue;

			siblings.sort((a, b) =>
				a.position !== b.position
					? a.position - b.position
					: a.id < b.id
						? -1
						: 1,
			);
			for (const [index, sibling] of siblings.entries())
				if (sibling.position !== index)
					await tx.run(
						`UPDATE ${table.table} SET ${table.order} = ? WHERE id = ?`,
						[index, sibling.id],
					);
		}
	}
}

/**
 * Candidate → stored row. Identity comes from a pure protocol function.
 *
 * The string is not assembled here because identity must match across runs. With two copies of the
 * rule, fixing only one leaves the same loss as two rows, and the symptom, "the same notice shows
 * twice", hides the cause.
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
