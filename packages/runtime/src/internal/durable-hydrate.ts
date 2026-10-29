import { unsealDurableStateRegistries } from "./durable-state.ts";
import {
	hydratePersistentState,
	type PersistentStateSnapshotWire,
	resetPersistentStateScope,
} from "./persistent-state.ts";
import {
	hydrateStoryState,
	resetStoryStateScope,
	type StoryStateSnapshotWire,
} from "./story-state.ts";

/**
 * The single host entry point for hydrating both lifetimes at once.
 *
 * It is one call because splitting it leaves a window. After the playthrough is hydrated but before
 * the persistent one is, the persistent registry is still open, and a definition registered in that
 * window would show a value that is not in this session's snapshot. The single seal flag and this
 * single call are the same fact stated twice.
 *
 * If either hydration throws, this throws. A half-hydrated session is never handed to the caller,
 * so a failed migration cannot change any stored value. The product storage layer writes only after
 * the session has started.
 */
export function hydrateDurableState(
	storySnapshot: unknown,
	persistentSnapshot: unknown,
	limits?: unknown,
): {
	story: StoryStateSnapshotWire;
	persistent: PersistentStateSnapshotWire;
} {
	const story = hydrateStoryState(storySnapshot, limits);
	const persistent = hydratePersistentState(persistentSnapshot, limits);
	return { story, persistent };
}

/**
 * Tests only. A registry belongs to one session, and the host process holds several sessions.
 * Inside the VM this function has no caller, because the built-in module does not re-export it.
 */
export function resetDurableStateRuntime(): void {
	resetStoryStateScope();
	resetPersistentStateScope();
	unsealDurableStateRegistries();
}
