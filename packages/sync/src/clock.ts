import type { Rev } from "@rowcat/contracts/sync";

/**
 * Hybrid Logical Clock: the time axis for merge decisions. Pure functions only. The key constraint
 * is that wall time is injected rather than read with `Date.now()`, for three reasons:
 * 1. This code runs inside a storage transaction. If it read the clock itself, two calls in the
 *    same transaction could see different milliseconds, blurring the boundary of 'one write'.
 * 2. The same input must give the same result, so web and mobile pick the same winner. Reading
 *    the clock internally would make that equivalence impossible to check with tests.
 * 3. Clocks can move backward. What the algorithm does then is its core, and reproducing that
 *    case requires time to be an argument.
 */

/**
 * Persisted clock state, one per device. Kept separate from `Rev`. `Rev` is attached to records and
 * must carry the device id. The state belongs to the device itself, so it has no reason to repeat
 * the id. Merging them would store the same string again in every state row, creating a place where
 * the two could disagree.
 */
export interface HlcState {
	t: number;
	c: number;
}

export const HLC_ORIGIN: HlcState = { t: 0, c: 0 };

/**
 * Result of one tick: the next state and the revision issued at that moment. The caller persists
 * the state.
 */
export interface HlcTick {
	state: HlcState;
	rev: Rev;
}

/**
 * Folds the value to a non-negative integer. NaN and negative clock values really do arrive:
 * corrupt stored rows, unparseable timestamps, test fixtures. Left alone, NaN makes every
 * comparison false and the clock stops being a total order, so merges decided with it differ across
 * devices. Folding once here keeps every downstream value valid.
 */
const safeInt = (value: number): number =>
	Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const normalize = (state: HlcState): HlcState => ({
	t: safeInt(state.t),
	c: safeInt(state.c),
});

/**
 * Local write: issues the next revision. If wall time moved forward, use it and reset the counter
 * to 0. Otherwise (same millisecond, or the clock went backward), keep `t` and increment the
 * counter. This rule is the whole of HLC: `t` never decreases. A device whose clock went backward
 * could issue a revision older than its own latest record. On the next sync its newest edit would
 * lose to its older one, so the text just written would appear to vanish. This is exactly the
 * failure wall-clock LWW suffers, and this rule prevents it.
 */
export function tickHlc(
	state: HlcState,
	wallMs: number,
	deviceId: string,
): HlcTick {
	const current = normalize(state);
	const wall = safeInt(wallMs);
	const next: HlcState =
		wall > current.t ? { t: wall, c: 0 } : { t: current.t, c: current.c + 1 };
	return { state: next, rev: { t: next.t, c: next.c, d: deviceId } };
}

/**
 * Absorbs a remote revision. Call it whether or not the record is applied. Even if the record is
 * discarded, the revision has been seen. If the clock is not advanced, the next local write could
 * receive a lower revision and reverse causality ('I wrote after seeing that edit, yet mine is
 * older'). Times from the future are absorbed as well: rejecting them would split the two clocks,
 * and split clocks pick different winners for the same input.
 *
 * Slice 1a has no remote source. The function lives here anyway because it keeps the same
 * invariants as `tickHlc` (t never decreases; the counter is unique for a given t). A separate copy
 * would have to re-prove those invariants.
 */
export function absorbHlc(
	state: HlcState,
	remote: Rev,
	wallMs: number,
): HlcState {
	const local = normalize(state);
	const wall = safeInt(wallMs);
	const remoteT = safeInt(remote.t);
	const remoteC = safeInt(remote.c);

	const t = Math.max(local.t, remoteT, wall);
	if (t === local.t && t === remoteT)
		return { t, c: Math.max(local.c, remoteC) + 1 };
	if (t === remoteT) return { t, c: remoteC + 1 };
	if (t === local.t) return { t, c: local.c + 1 };
	return { t, c: 0 };
}

/**
 * Total order: compares `t`, then `c`, then `d` (device id, lexicographic). The device id matters.
 * Two devices can reach the same (t, c) offline, and a zero result would push tie-breaking into
 * every merge rule, each one wrong in a different way.
 *
 * There are two more copies of this function, in the codecs of `@rowcat/chat` and
 * `@rowcat/authoring`. They cannot import this package because of an intentional layering rule (the
 * protocol must not become a hub that knows every domain), so the copies cannot be removed.
 * Instead, `apps/web/src/lib/local-sync/codec-order.test.ts` checks that all three return the same
 * answers. Changing this implementation fails that test first, so a copy cannot ship out of date.
 */
export function compareRev(a: Rev, b: Rev): number {
	const at = safeInt(a.t);
	const bt = safeInt(b.t);
	if (at !== bt) return at < bt ? -1 : 1;
	const ac = safeInt(a.c);
	const bc = safeInt(b.c);
	if (ac !== bc) return ac < bc ? -1 : 1;
	if (a.d === b.d) return 0;
	return a.d < b.d ? -1 : 1;
}

/** The later of the two. If fully equal, returns the first argument (deterministic). */
export const maxRev = (a: Rev, b: Rev): Rev => (compareRev(b, a) > 0 ? b : a);
