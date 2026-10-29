import {
	checkDurableStateKey,
	checkDurableStateVersion,
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
import { RUNTIME_STORY_STATE } from "./symbols.ts";

/**
 * - Playthrough state is the first lifetime of the save-state core. Module evaluation calls
 *   defineStoryState, which registers the definition. The host calls hydrateStoryState with a
 *   snapshot, which seals the registry. Then version check, migration, and validation produce the
 *   committed value. useStoryState reads the committed value plus this turn's pending value;
 *   setStoryState writes only the pending value. A successful root commit (commitStoryState) makes
 *   pending values committed and emits only the changed keys as a delta.
 * - The mechanism lives in durable-state.ts. This file owns only the identity of this lifetime:
 *   the brand symbol, the error codes, and one registry. persistent-state.ts builds its own
 *   registry on the same mechanism, so the same key in both lifetimes does not collide.
 * - Hook state differs from playthrough state in lifetime, not implementation. Hook state dies
 *   with its component. Here the value lives in the module, and the hook slot holds only the key
 *   and a setter.
 * - The module knows nothing about the host: no storage location, accounts, or slot count. It
 *   knows only key, version, and value, so the same engine behaves identically in studio preview,
 *   web, native, and tests.
 */

export type StoryStateMigration<T> = DurableStateMigration<T>;

export interface StoryStateDefinition<T> {
	/**
	 * Brand of this lifetime. The type-level brand is what keeps it distinct from persistent
	 * definitions.
	 */
	readonly [RUNTIME_STORY_STATE]: true;
	readonly key: string;
	readonly version: number;
	readonly initial: T;
	readonly migrate: StoryStateMigration<T> | null;
}

export type StoryStateInput<T> = DurableStateInput<T>;
export type StoryStateInputChecked<T> = DurableStateInputChecked<T>;
export type StoryStateLimits = DurableStateLimits;
export type StoryStateEntryWire = DurableStateEntryWire;
export type StoryStateSnapshotWire = DurableStateSnapshotWire;

export const STORY_STATE_VERSION_MAX = DURABLE_STATE_VERSION_MAX;
export const DEFAULT_STORY_STATE_LIMITS: StoryStateLimits =
	DEFAULT_DURABLE_STATE_LIMITS;

export const checkStoryStateKey = checkDurableStateKey;
export const checkStoryStateVersion = checkDurableStateVersion;

const scope = createDurableScope({
	label: "Story state",
	defineApi: "defineStoryState",
	hookApi: "useStoryState()",
	codes: {
		invalidDefinition: RUNTIME_ERROR_CODE.invalidStoryState,
		definitionLate: RUNTIME_ERROR_CODE.storyStateDefinitionLate,
		duplicateKey: RUNTIME_ERROR_CODE.storyStateDuplicateKey,
		valueInvalid: RUNTIME_ERROR_CODE.storyStateValueInvalid,
		limitExceeded: RUNTIME_ERROR_CODE.storyStateLimitExceeded,
		migrationFailed: RUNTIME_ERROR_CODE.storyStateMigrationFailed,
		migrationInvalid: RUNTIME_ERROR_CODE.storyStateMigrationInvalid,
		versionNewer: RUNTIME_ERROR_CODE.storyStateVersionNewer,
		snapshotInvalid: RUNTIME_ERROR_CODE.storyStateSnapshotInvalid,
	},
});

/**
 * Whether a value is a story-state definition. Persistent state definitions must not pass this
 * check.
 */
export function isStoryStateDefinition(
	value: unknown,
): value is StoryStateDefinition<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { [RUNTIME_STORY_STATE]?: unknown })[RUNTIME_STORY_STATE] === true
	);
}

export function createStoryStateDefinition<T>(
	input: StoryStateInputChecked<T>,
): StoryStateDefinition<T> {
	const base = scope.createDefinition(input);
	return Object.freeze({
		[RUNTIME_STORY_STATE]: true as const,
		key: base.key,
		version: base.version,
		initial: base.initial,
		migrate: base.migrate,
	});
}

export function registerStoryStateDefinition<T>(
	definition: StoryStateDefinition<T>,
): void {
	scope.register(definition as never);
}

export function storyStateKeyOf(definition: unknown): string {
	return scope.keyOf(definition, isStoryStateDefinition);
}

export function hydrateStoryState(
	snapshot: unknown,
	nextLimits?: unknown,
): StoryStateSnapshotWire {
	return scope.hydrate(snapshot, nextLimits);
}

export function readStoryState(key: string): Serializable {
	return scope.read(key);
}

export function queueStoryState(key: string, action: unknown): boolean {
	return scope.queue(key, action);
}

export function pendingStoryStateDelta(): StoryStateEntryWire[] {
	return scope.pendingDelta();
}

export function commitStoryState(): number {
	return scope.commit();
}

/**
 * Metrics the root reads. Names differ per lifetime because both lifetimes are reported in one
 * table (rootMetrics). With shared names one would overwrite the other, and a reader could not tell
 * which lifetime a count belongs to.
 */
export function storyStateMetrics(): {
	storyDefinitions: number;
	storyStateReads: number;
	storyStateUpdates: number;
	storyStateCommits: number;
	storyStateEntriesCommitted: number;
	storyStateMigrations: number;
	storyStateMigrationFailures: number;
} {
	const counters = scope.metrics();
	return {
		storyDefinitions: counters.definitions,
		storyStateReads: counters.reads,
		storyStateUpdates: counters.updates,
		storyStateCommits: counters.commits,
		storyStateEntriesCommitted: counters.entriesCommitted,
		storyStateMigrations: counters.migrations,
		storyStateMigrationFailures: counters.migrationFailures,
	};
}

/**
 * Test-only reset. It does not unseal the registry: sealing is shared by both lifetimes, and
 * resetDurableRuntime releases it.
 */
export function resetStoryStateScope(): void {
	scope.reset();
}
