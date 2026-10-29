import type { Rev } from "@rowcat/contracts/sync";
import { type HlcState, tickHlc } from "@rowcat/sync";
import { newDeviceId } from "./clock.ts";
import type { LocalDb } from "./db.ts";
import {
	createLocalSyncState,
	type LocalSyncState,
	SYNC_STATE_KEY,
} from "./sync-state.ts";

/**
 * Persistence adapter for the logical clock. The algorithm (tick, absorb, compare) lives in
 * @rowcat/sync. This file only reads the stored state, calls that pure function, and writes
 * the result back. Keeping one implementation prevents another platform from picking different
 * winners for the same records.
 *
 * Call only inside an already-open write transaction. If issuing a revision and saving the record
 * it belongs to were split, a crash between them could leave records saved with the clock
 * unchanged. The next write would then reissue the same revision.
 *
 * Callers must include db.syncState in their transaction's table list. Otherwise Dexie rejects the
 * call, so the mismatch cannot pass silently.
 */

/**
 * Reads the state row, creating it in place when it is missing.
 *
 * The normal path always has the row: populate creates it for new databases, and the v3 upgrade
 * creates it for existing ones. It is created rather than thrown because throwing would fail the
 * user's write at that moment. Continuing with a new device id is the better outcome. Only the
 * revision's tie-break axis changes, and the records are unaffected.
 */
async function readState(db: LocalDb): Promise<LocalSyncState> {
	const stored = await db.syncState.get(SYNC_STATE_KEY);
	if (stored) return stored;
	const fresh = createLocalSyncState(newDeviceId());
	await db.syncState.put(fresh);
	return fresh;
}

/**
 * Issues several next revisions in one read and one write.
 *
 * A single transaction often edits several records (a message and its room, a child and its parent,
 * every reordered sibling). Requesting the count at once avoids rereading and rewriting the state
 * row each time. The results match a sequence of single ticks, and issue order is fixed to argument
 * order.
 *
 * Returned revisions are distinct and ascending. If two records shared one value, a later merge
 * could not determine their order.
 */
export async function nextRevs(db: LocalDb, count: number): Promise<Rev[]> {
	const state = await readState(db);
	let hlc: HlcState = { t: state.hlcT, c: state.hlcC };
	const revs: Rev[] = [];
	/**
	 * Reads the wall clock once. Reading it per tick would let one logical write span two milliseconds
	 * within the same transaction.
	 */
	const wallMs = Date.now();
	for (let i = 0; i < count; i++) {
		const ticked = tickHlc(hlc, wallMs, state.deviceId);
		hlc = ticked.state;
		revs.push(ticked.rev);
	}
	await db.syncState.put({ ...state, hlcT: hlc.t, hlcC: hlc.c });
	return revs;
}

export async function nextRev(db: LocalDb): Promise<Rev> {
	const [rev] = await nextRevs(db, 1);
	return rev;
}

/**
 * For diagnostics and tests. Returns null when the state row is missing and does not create one,
 * unlike readState.
 */
export const readSyncState = async (
	db: LocalDb,
): Promise<LocalSyncState | null> =>
	(await db.syncState.get(SYNC_STATE_KEY)) ?? null;
