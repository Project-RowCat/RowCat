/**
 * Re-exports only the snapshot types, so the main thread does not import the runtime-host root. The
 * root would bring the QuickJS engine and the generated sandbox string into the main bundle. The
 * renderer package follows the same rule with its patches subpath. Only the two snapshot subpaths
 * are imported, as runtime-persistence already does.
 */
export type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
export type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
