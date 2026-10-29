import {
	createDurableScope,
	DEFAULT_DURABLE_STATE_LIMITS,
	DURABLE_STATE_VERSION_MAX,
	type DurableStateEntryWire,
	type DurableStateInput,
	type DurableStateInputChecked,
	type DurableStateLimits,
	type DurableStateMigration,
	type DurableStateSnapshotWire,
} from "./durable-state.ts";
import { RUNTIME_ERROR_CODE } from "./errors.ts";
import type { Serializable } from "./serializable.ts";
import { RUNTIME_PERSISTENT_STATE } from "./symbols.ts";

/**
 * Persistent state: the second lifetime of the saved-state core, for long progress tied to a member
 * and a work.
 *
 * - useState lasts for the runtime session and is lost when the VM dies.
 * - useStoryState lasts for one playthrough and is cleared by a playthrough reset.
 * - usePersistentState is not cleared by a playthrough reset.
 *
 * Ending lists, unlocks, stats and episode counts must survive a new game. The guarantee is
 * structural: separate registries, snapshots and save records mean no playthrough reset can reach
 * this value.
 *
 * The mechanism is durable-state.ts. This file owns only the identity of this lifetime (brand,
 * error codes, registry). A copy would let a fix to migration failure direction or to pending-value
 * atomicity land on one side only.
 *
 * Keys live in separate namespaces. `defineStoryState({ key: 'progress' })` and
 * `definePersistentState({ key: 'progress' })` can coexist without conflict.
 */

export type PersistentStateMigration<T> = DurableStateMigration<T>;

export interface PersistentStateDefinition<T> {
	/**
	 * Brand of this lifetime.
	 *
	 * There is no alias such as `type PersistentStateDefinition<T> = StoryStateDefinition<T>`. With an
	 * alias, each hook would accept the other's definition, and a screen would silently read a value
	 * from the wrong lifetime.
	 */
	readonly [RUNTIME_PERSISTENT_STATE]: true;
	readonly key: string;
	readonly version: number;
	readonly initial: T;
	readonly migrate: PersistentStateMigration<T> | null;
}

export type PersistentStateInput<T> = DurableStateInput<T>;
export type PersistentStateInputChecked<T> = DurableStateInputChecked<T>;
export type PersistentStateLimits = DurableStateLimits;
export type PersistentStateEntryWire = DurableStateEntryWire;
export type PersistentStateSnapshotWire = DurableStateSnapshotWire;

export const PERSISTENT_STATE_VERSION_MAX = DURABLE_STATE_VERSION_MAX;
export const DEFAULT_PERSISTENT_STATE_LIMITS: PersistentStateLimits =
	DEFAULT_DURABLE_STATE_LIMITS;

const scope = createDurableScope({
	label: "Persistent state",
	defineApi: "definePersistentState",
	hookApi: "usePersistentState()",
	codes: {
		invalidDefinition: RUNTIME_ERROR_CODE.invalidPersistentState,
		definitionLate: RUNTIME_ERROR_CODE.persistentStateDefinitionLate,
		duplicateKey: RUNTIME_ERROR_CODE.persistentStateDuplicateKey,
		valueInvalid: RUNTIME_ERROR_CODE.persistentStateValueInvalid,
		limitExceeded: RUNTIME_ERROR_CODE.persistentStateLimitExceeded,
		migrationFailed: RUNTIME_ERROR_CODE.persistentStateMigrationFailed,
		migrationInvalid: RUNTIME_ERROR_CODE.persistentStateMigrationInvalid,
		versionNewer: RUNTIME_ERROR_CODE.persistentStateVersionNewer,
		snapshotInvalid: RUNTIME_ERROR_CODE.persistentStateSnapshotInvalid,
	},
});

/**
 * Whether a value is a persistent-state definition. Playthrough state definitions do not pass this
 * check.
 */
export function isPersistentStateDefinition(
	value: unknown,
): value is PersistentStateDefinition<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { [RUNTIME_PERSISTENT_STATE]?: unknown })[
			RUNTIME_PERSISTENT_STATE
		] === true
	);
}

export function createPersistentStateDefinition<T>(
	input: PersistentStateInputChecked<T>,
): PersistentStateDefinition<T> {
	const base = scope.createDefinition(input);
	return Object.freeze({
		[RUNTIME_PERSISTENT_STATE]: true as const,
		key: base.key,
		version: base.version,
		initial: base.initial,
		migrate: base.migrate,
	});
}

export function registerPersistentStateDefinition<T>(
	definition: PersistentStateDefinition<T>,
): void {
	scope.register(definition as never);
}

export function persistentStateKeyOf(definition: unknown): string {
	return scope.keyOf(definition, isPersistentStateDefinition);
}

export function hydratePersistentState(
	snapshot: unknown,
	nextLimits?: unknown,
): PersistentStateSnapshotWire {
	return scope.hydrate(snapshot, nextLimits);
}

export function readPersistentState(key: string): Serializable {
	return scope.read(key);
}

export function queuePersistentState(key: string, action: unknown): boolean {
	return scope.queue(key, action);
}

export function pendingPersistentStateDelta(): PersistentStateEntryWire[] {
	return scope.pendingDelta();
}

export function commitPersistentState(): number {
	return scope.commit();
}

export function persistentStateMetrics(): {
	persistentDefinitions: number;
	persistentStateReads: number;
	persistentStateUpdates: number;
	persistentStateCommits: number;
	persistentStateEntriesCommitted: number;
	persistentStateMigrations: number;
	persistentStateMigrationFailures: number;
} {
	const counters = scope.metrics();
	return {
		persistentDefinitions: counters.definitions,
		persistentStateReads: counters.reads,
		persistentStateUpdates: counters.updates,
		persistentStateCommits: counters.commits,
		persistentStateEntriesCommitted: counters.entriesCommitted,
		persistentStateMigrations: counters.migrations,
		persistentStateMigrationFailures: counters.migrationFailures,
	};
}

/** Called by tests only. */
export function resetPersistentStateScope(): void {
	scope.reset();
}
