import type {
	DraftConflictRecovery,
	DraftRecoveryStore,
} from "@rowcat/authoring";
import { parseDraftConflictRecovery } from "@rowcat/authoring";
import type { SyncRecoveryRecord } from "@rowcat/sync";
import type { MobileDatabase, SqlRunner } from "./sqlite.ts";
import type { SqlRow } from "./tables.ts";

/**
 * SQLite implementation of `DraftRecoveryStore`, with the **same contract** as the web Dexie
 * implementation.
 *
 * Having no write methods is half of that contract. The only place a copy is created is the
 * transaction that commits a merge (`applyPull` in `sync-store.ts`). Opening `save` here would let
 * copies be created outside a merge, pointing at no losing value.
 *
 * The other half is that copies do **not follow draft deletion**. When a draft is gone its copies
 * remain: a lost paragraph of a manuscript deleted on another device may be here, and cascading the
 * delete would make the user unaware that it ever existed.
 *
 * The row ↔ record mapping lives here, not in `tables.ts`, on purpose. That file maps **sync
 * records** (`RecordTable` requires `SyncRecordShape`), and this row has none of those axes.
 * Forcing it in would make this table look like a sync table.
 */

const SELECT = `SELECT id, type, record_id, scope, payload, losing_rev_t, losing_rev_c, losing_rev_d, observed_at FROM sync_recovery`;

/** Most recently lost value first. Ties are broken by id to form a total order. */
const ORDER = `ORDER BY observed_at DESC, id DESC`;

const toRow = (row: SqlRow): SyncRecoveryRecord => ({
	id: String(row.id ?? ""),
	type: String(row.type ?? ""),
	recordId: String(row.record_id ?? ""),
	scope: String(row.scope ?? ""),
	losingRev: {
		t: Number(row.losing_rev_t ?? 0),
		c: Number(row.losing_rev_c ?? 0),
		d: String(row.losing_rev_d ?? ""),
	},
	payload: parsePayload(row.payload),
	observedAt: String(row.observed_at ?? ""),
});

/**
 * Opens the stored JSON. A corrupted value yields `null`, and that row silently drops out of the
 * list.
 *
 * Not throwing is a property of the list: one broken row turning into an error would hide the
 * intact copies beside it. A feature built to recover values would then block recovering them.
 */
const parsePayload = (value: unknown): unknown => {
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

const parseAll = (rows: SqlRow[]): DraftConflictRecovery[] => {
	const parsed: DraftConflictRecovery[] = [];
	for (const row of rows) {
		const recovery = parseDraftConflictRecovery(toRow(row));
		if (recovery) parsed.push(recovery);
	}
	return parsed;
};

export function createMobileDraftRecoveryStore(
	db: MobileDatabase,
): DraftRecoveryStore {
	return {
		async list() {
			return parseAll(await db.all<SqlRow>(`${SELECT} ${ORDER}`));
		},

		async listForDraft(draftId: string) {
			return parseAll(
				await db.all<SqlRow>(`${SELECT} WHERE record_id = ? ${ORDER}`, [
					draftId,
				]),
			);
		},

		/**
		 * Permanently discards this local copy. **The canonical draft is never touched.**
		 *
		 * A missing id is also success. Two screens discarding the same copy concurrently is normal, and
		 * failing the late one would show an error for a row that is already gone.
		 */
		async discard(id: string) {
			await db.run(`DELETE FROM sync_recovery WHERE id = ?`, [id]);
		},
	};
}

/**
 * Records copies. **Rows that already exist are left alone.**
 *
 * Only called inside `applyPull`'s transaction, which is why it takes the executor as an argument.
 * With a default `db`, a caller outside the transaction could appear, and then "the canonical value
 * was overwritten but no copy exists" becomes representable.
 *
 * `INSERT OR IGNORE` because of `observed_at`. The same loss is observed many times (pull retries,
 * reconnects, reapplying the same page, app restarts). Overwriting would push that timestamp
 * forward on every observation, and the user would read a manuscript lost weeks ago as something
 * that just happened. The first observation's time is the event's time.
 *
 * The returned count is the number of rows **actually newly created**. It is counted before
 * inserting rather than read from `changes`, because drivers report that value differently. The
 * number is a diagnostic output, and a wrong value there is silent.
 */
export async function insertRecoveries(
	tx: SqlRunner,
	rows: readonly SyncRecoveryRecord[],
): Promise<number> {
	if (rows.length === 0) return 0;
	/** Seeing the same loss twice within one page is normal (two entries for the same record). */
	const unique = new Map(rows.map((row) => [row.id, row]));
	let inserted = 0;
	for (const row of unique.values()) {
		const existing = await tx.first<SqlRow>(
			`SELECT id FROM sync_recovery WHERE id = ?`,
			[row.id],
		);
		if (existing) continue;
		await tx.run(
			`INSERT OR IGNORE INTO sync_recovery
				(id, type, record_id, scope, payload, losing_rev_t, losing_rev_c, losing_rev_d, observed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				row.id,
				row.type,
				row.recordId,
				row.scope,
				JSON.stringify(row.payload),
				row.losingRev.t,
				row.losingRev.c,
				row.losingRev.d,
				row.observedAt,
			],
		);
		inserted += 1;
	}
	return inserted;
}
