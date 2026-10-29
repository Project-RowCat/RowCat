import {
	createScrollController,
	createTextEntryController,
	type RuntimeScrollController,
	type RuntimeTextEntryController,
} from "./controller.ts";
import { RUNTIME_GENERATION, type RuntimeGeneration } from "./generation.ts";
import {
	dispatcher,
	type RuntimeCleanup,
	type RuntimeRef,
	type RuntimeSetState,
	type RuntimeStateAction,
} from "./internal/dispatcher.ts";
import type { PersistentStateDefinition } from "./internal/persistent-state.ts";
import type { StoryStateDefinition } from "./internal/story-state.ts";

/**
 * Public hooks: the shape resembles React; the implementation is ours.
 *
 * - Names and signatures are borrowed from React to reduce learning cost. Authors already know
 *   them, and different names would teach the same concepts twice.
 * - React is not imported. Calling React's hooks here would tie author components to React rather
 *   than RowCat's reconciler, and the runtime could then not run without React.
 * - Each function forwards to the currently installed dispatcher and throws on the spot if none
 *   is installed (internal/dispatcher.ts explains why).
 */

export type { RuntimeCleanup, RuntimeRef, RuntimeSetState, RuntimeStateAction };

/**
 * A value the component remembers. The lazy-initializer form (`useState(() => expensive())`) exists
 * so the computation runs only on the first render. Consequently, state whose type S is itself a
 * function cannot be expressed here. React already accepted this trade-off; such state should be
 * wrapped in an object.
 */
export function useState<S>(initial: S | (() => S)): [S, RuntimeSetState<S>] {
	return dispatcher("useState").useState(initial);
}

/**
 * The value this playthrough remembers. The store owns it, not the component.
 * - useState: this session only; restarts from scratch.
 * - useStoryState: this playthrough; survives the VM dying and restarting. Two components reading
 *   the same definition see the same value. A write in one shows in the other's next render, and
 *   the two updates fold into one render. The definition must be created at module top level by
 *   `defineStoryState`: a hook slot means one definition while mounted, so passing a different one
 *   at the same place is rejected (runtime_story_state_hook_changed).
 */
export function useStoryState<T>(
	definition: StoryStateDefinition<T>,
): [T, RuntimeSetState<T>] {
	return dispatcher("useStoryState").useStoryState(definition);
}

/**
 * A value remembered across a member's long progress through a work. A play reset does not clear
 * it.
 * - useState: this session.
 * - useStoryState: this playthrough; a new game resets it.
 * - usePersistentState: member plus work; survives new games. For things like ending lists,
 *   unlocks and episode counts that a restart must not erase. The definition must come from
 *   `definePersistentState` at module top level. A `defineStoryState` definition is rejected by the
 *   type, because the two lifetimes carry different brands.
 */
export function usePersistentState<T>(
	definition: PersistentStateDefinition<T>,
): [T, RuntimeSetState<T>] {
	return dispatcher("usePersistentState").usePersistentState(definition);
}

export function useReducer<S, A>(
	reducer: (state: S, action: A) => S,
	initial: S,
): [S, (action: A) => void] {
	return dispatcher("useReducer").useReducer(reducer, initial);
}

/**
 * Same value while the dependencies are unchanged. This is a hint, not a guarantee that the factory
 * is skipped.
 */
export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T {
	return dispatcher("useMemo").useMemo(factory, deps);
}

/**
 * Same function while the dependencies are unchanged. It folds onto useMemo, an implementation
 * fact. Two public names remain because the intent differs: a call site using this says the
 * callback's identity must be preserved.
 */
export function useCallback<T extends (...args: never[]) => unknown>(
	callback: T,
	deps?: readonly unknown[],
): T {
	return dispatcher("useCallback").useMemo(() => callback, deps);
}

/**
 * A slot that survives renders. Changing it does not re-render, which is the difference from
 * useState, so keeping a value that appears on screen here would leave the screen stale.
 */
export function useRef<T>(initial: T): RuntimeRef<T> {
	return dispatcher("useRef").useRef(initial);
}

/**
 * Runs after the render. The returned cleanup function is what the reconciler calls when the
 * component goes away. Omitting `deps` runs the effect on every render; an empty array runs it
 * once. The two are different, so the default is not collapsed.
 */
export function useEffect(
	// biome-ignore lint/suspicious/noConfusingVoidType: the effect gives back a cleanup function or nothing; only this type expresses both.
	effect: () => void | RuntimeCleanup,
	deps?: readonly unknown[],
): void {
	dispatcher("useEffect").useEffect(effect, deps);
}

/**
 * The generation capability this runtime can call.
 *
 * - Why a hook: there is no global `generate()` by rule. Obtaining the capability must live
 *   within a component's (or custom hook's) lifetime, so if the capability later varies by session
 *   or environment, that decision is already in the right place.
 * - This hook fills one slot and always returns the same object (section 24).
 * - It is called during render like any hook, but `generate()` must not be called during render:
 *   the same tree rendered twice would bill twice, which is what that rule prevents.
 */
export function useGeneration(): RuntimeGeneration {
	return dispatcher("useGeneration").useMemo(() => RUNTIME_GENERATION, EMPTY);
}

/**
 * Handle for controlling this screen's one scroll view. The returned object keeps the same identity
 * within a mounted slot, as useGeneration does. So putting it in a useEffect dependency list does
 * not rerun the effect every render, and the controller prop is not re-sent on each commit. One
 * controller attaches to one ScrollView only; two lists need two controllers.
 */
export function useScrollController(): RuntimeScrollController {
	return dispatcher("useScrollController").useMemo(
		createScrollController,
		EMPTY,
	);
}

/**
 * Handle for controlling focus of this screen's one text input. Passing it to a primitive other
 * than TextInput or TextArea rejects that render (runtime_host_control_wrong_kind). The type
 * catches this first, but types are not the boundary.
 */
export function useTextEntryController(): RuntimeTextEntryController {
	return dispatcher("useTextEntryController").useMemo(
		createTextEntryController,
		EMPTY,
	);
}

/**
 * Constant empty array for memos with no dependencies. Creating a new array per render would itself
 * count as a dependency change.
 */
const EMPTY: readonly unknown[] = Object.freeze([]);
