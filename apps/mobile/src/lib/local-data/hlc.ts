import type { Rev } from "@rowcat/contracts/sync";
import { type HlcState, tickHlc } from "@rowcat/sync";
import type { SqlRunner } from "./sqlite.ts";
import { readSyncState, writeSyncState } from "./sync-state.ts";

/**
 * Persistent adapter for the logical clock. The algorithm lives in `@rowcat/sync` (tick, absorb,
 * compare); this file only reads the stored state, calls the pure function, and writes the result
 * back in the same transaction. Copying the algorithm here would give mobile its own version, and
 * the day the two disagree on the winner for the same pair of records is the day a user's
 * manuscript is lost.
 *
 * Call only inside an already-open write transaction. The argument is `SqlRunner`, not
 * `MobileDatabase`, so the type reflects that: issuing a revision and storing the record that
 * receives it must commit together. If the app dies between them, the record is stored but the
 * clock is not advanced, and the next write reissues the same revision. Autocommit `MobileDatabase`
 * also satisfies `SqlRunner`; the rule rests on every caller living inside a transaction callback.
 */

/**
 * Issues several consecutive revisions in one read and one write. Many transactions update several
 * records at once (a message and its room, a child and its parent, all reordered siblings). Taking
 * the count up front avoids re-reading and re-writing the state row per record; the result is the
 * same, and issue order is fixed to argument order.
 */
export async function nextRevs(tx: SqlRunner, count: number): Promise<Rev[]> {
	const state = await readSyncState(tx);
	let hlc: HlcState = { t: state.hlcT, c: state.hlcC };
	const revs: Rev[] = [];
	/**
	 * Read the wall clock once. Reading it per tick would let the time change inside one transaction,
	 * recording a single logical write as if it spanned several milliseconds.
	 */
	const wallMs = Date.now();
	for (let i = 0; i < count; i++) {
		const ticked = tickHlc(hlc, wallMs, state.deviceId);
		hlc = ticked.state;
		revs.push(ticked.rev);
	}
	await writeSyncState(tx, { ...state, hlcT: hlc.t, hlcC: hlc.c });
	return revs;
}

/** One revision. A readable wrapper for the common case of `nextRevs(tx, 1)`. */
export async function nextRev(tx: SqlRunner): Promise<Rev> {
	const [rev] = await nextRevs(tx, 1);
	return rev;
}
