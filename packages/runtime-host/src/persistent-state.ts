import {
	canonicalDurableStateSnapshot,
	DEFAULT_DURABLE_STATE_LIMITS,
	DURABLE_SNAPSHOT_FORMAT_VERSION,
	type DurableStateValidation,
	emptyDurableStateSnapshot,
	type RuntimeDurableStateEntry,
	type RuntimeDurableStateLimits,
	type RuntimeDurableStateSnapshot,
	RuntimeDurableStateStore,
	validateDurableStateSnapshot,
} from "./durable-snapshot.ts";
import type { RuntimeWireLimits } from "./wire.ts";

/**
 * The host contract for persistent state: membership plus a work's long-running progress.
 *
 * It has the same shape as the playthrough snapshot but lives in a different place. The two
 * lifetimes are not combined into one snapshot, because storage has to separate them. A combined {
 * storyState, persistentState } record would put chapter progress from device A and ending unlocks
 * from device B into one conflict domain, where a whole-record last-write-wins drops one of them.
 * Two snapshots mean two records, so both updates survive.
 *
 * The same structure is why play reset never reaches this side. Reset is a single clear() on the
 * playthrough store, and no path to this store exists in that operation.
 */

export const PERSISTENT_STATE_FORMAT_VERSION = DURABLE_SNAPSHOT_FORMAT_VERSION;

export type RuntimePersistentStateEntry = RuntimeDurableStateEntry;
export type RuntimePersistentStateSnapshot = RuntimeDurableStateSnapshot;
export type RuntimePersistentStateLimits = RuntimeDurableStateLimits;
export type PersistentStateValidation = DurableStateValidation;

export const DEFAULT_PERSISTENT_STATE_LIMITS: RuntimePersistentStateLimits =
	DEFAULT_DURABLE_STATE_LIMITS;

export const emptyPersistentStateSnapshot = emptyDurableStateSnapshot;
export const canonicalPersistentStateSnapshot = canonicalDurableStateSnapshot;

export function validatePersistentStateSnapshot(
	value: unknown,
	limits: RuntimePersistentStateLimits = DEFAULT_PERSISTENT_STATE_LIMITS,
	wireLimits?: RuntimeWireLimits,
): PersistentStateValidation {
	return validateDurableStateSnapshot(
		"persistent state",
		value,
		limits,
		wireLimits,
	);
}

/** The trusted store for one member's and one work's long-running progress. */
export class RuntimePersistentStateStore extends RuntimeDurableStateStore {}
