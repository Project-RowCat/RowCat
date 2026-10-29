import {
	createPersistentStateDefinition,
	isPersistentStateDefinition,
	PERSISTENT_STATE_VERSION_MAX,
	type PersistentStateDefinition,
	type PersistentStateInput,
	type PersistentStateInputChecked,
	type PersistentStateMigration,
	registerPersistentStateDefinition,
} from "./internal/persistent-state.ts";
import {
	isSerializable,
	type Serializable,
	type SerializableShape,
} from "./internal/serializable.ts";
import {
	createStoryStateDefinition,
	isStoryStateDefinition,
	registerStoryStateDefinition,
	STORY_STATE_VERSION_MAX,
	type StoryStateDefinition,
	type StoryStateInput,
	type StoryStateInputChecked,
	type StoryStateMigration,
} from "./internal/story-state.ts";

/**
 * The definition of stored state, and where it is used: `useStoryState()`. Three lifetimes:
 * - useState: lasts for this runtime session; owned by the component.
 * - useStoryState: lasts for this playthrough or save; owned by the playthrough.
 * - usePersistentState: long-term progress for a member and a work; owned by the member and work.
 *   The most important fact here is that the two definitions are different types. Their brand
 *   symbols differ, so passing a persistent definition to useStoryState, or the reverse, is a type
 *   error. If they mixed, the screen would be silently wrong, and the symptom would appear only
 *   when a play reset erased months of progress. The runtime still does not know where state is
 *   stored. There is no server, Dexie, SQLite, or sync here. It knows only key, version, and value.
 *   That ignorance is what lets one engine behave the same in studio preview, web, native, and
 *   tests. Where snapshots are kept belongs to the product storage layer, which does not pass
 *   through this package. Rules are in internal/durable-state.ts and the docs under
 *   docs/creator-runtime/.
 */

export type {
	PersistentStateDefinition,
	PersistentStateInput,
	PersistentStateInputChecked,
	PersistentStateMigration,
	Serializable,
	SerializableShape,
	StoryStateDefinition,
	StoryStateInput,
	StoryStateInputChecked,
	StoryStateMigration,
};
export {
	isPersistentStateDefinition,
	isSerializable,
	isStoryStateDefinition,
	PERSISTENT_STATE_VERSION_MAX,
	STORY_STATE_VERSION_MAX,
};

/**
 * Declares one story-state value, once, at module top level. Registration happens while creator
 * modules are evaluated, and the registry is sealed when evaluation ends. Calling this during
 * render is rejected (runtime_story_state_definition_late): if a new storage schema appeared
 * silently during rendering, a session's snapshot could not say what it contains. `migrate` is the
 * only way to read an old version. Without it, saved data from an old version will not open, and
 * that failure happens before the first render.
 */
export function defineStoryState<T>(
	definition: StoryStateInputChecked<T>,
): StoryStateDefinition<T> {
	const created = createStoryStateDefinition(definition);
	registerStoryStateDefinition(created);
	return created;
}

/**
 * Declares one persistent value. The rules match defineStoryState; only the lifetime differs. The
 * value survives a play reset (a new game). It is the place for data that a reset must not erase,
 * such as an ending list, unlocks, or a run count. The key space is separate from defineStoryState.
 * The same key in both lifetimes does not collide, and the values do not overwrite each other.
 */
export function definePersistentState<T>(
	definition: PersistentStateInputChecked<T>,
): PersistentStateDefinition<T> {
	const created = createPersistentStateDefinition(definition);
	registerPersistentStateDefinition(created);
	return created;
}
