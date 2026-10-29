import {
	canonicalDurableStateSnapshot,
	DEFAULT_DURABLE_STATE_LIMITS,
	DURABLE_SNAPSHOT_FORMAT_VERSION,
	type DurableStateValidation,
	emptyDurableStateSnapshot,
	isDurableStateKey,
	isDurableStateVersion,
	type RuntimeDurableStateEntry,
	type RuntimeDurableStateLimits,
	type RuntimeDurableStateSnapshot,
	RuntimeDurableStateStore,
	validateDurableStateSnapshot,
} from "./durable-snapshot.ts";
import type { RuntimeWireLimits } from "./wire.ts";

/**
 * Host contract for playthrough state, the first lifetime of the saved snapshot core.
 *
 * The state machine is in `durable-snapshot.ts`. This file only holds the name of this lifetime.
 * The name matters at call sites: `storyStore` and `persistentStore` can be two instances of the
 * same class, and the name says which channel a session binds each one to.
 *
 * Rules and rationale are in the header of `durable-snapshot.ts`.
 */

export const STORY_STATE_FORMAT_VERSION = DURABLE_SNAPSHOT_FORMAT_VERSION;

export type RuntimeStoryStateEntry = RuntimeDurableStateEntry;
export type RuntimeStoryStateSnapshot = RuntimeDurableStateSnapshot;
export type RuntimeStoryStateLimits = RuntimeDurableStateLimits;
export type StoryStateValidation = DurableStateValidation;

export const DEFAULT_STORY_STATE_LIMITS: RuntimeStoryStateLimits =
	DEFAULT_DURABLE_STATE_LIMITS;

export const isStoryStateKey = isDurableStateKey;
export const isStoryStateVersion = isDurableStateVersion;
export const emptyStoryStateSnapshot = emptyDurableStateSnapshot;
export const canonicalStoryStateSnapshot = canonicalDurableStateSnapshot;

export function validateStoryStateSnapshot(
	value: unknown,
	limits: RuntimeStoryStateLimits = DEFAULT_STORY_STATE_LIMITS,
	wireLimits?: RuntimeWireLimits,
): StoryStateValidation {
	return validateDurableStateSnapshot("story state", value, limits, wireLimits);
}

/** Trusted store holding the snapshot of the current playthrough. */
export class RuntimeStoryStateStore extends RuntimeDurableStateStore {}
