import { RUNTIME_ERROR_CODE, RuntimeError } from "./errors.ts";
import type { PersistentStateDefinition } from "./persistent-state.ts";
import type { StoryStateDefinition } from "./story-state.ts";

/**
 * The only place that knows what hooks actually do. This slice has no such place: every public hook
 * (`useState` and the rest) goes through `dispatcher()` here, and the value is always null. In
 * Phase 4 the reconciler installs its implementation just before render and removes it right after,
 * so creator code does not change.
 *
 * Why not a fake implementation now: a closure-variable `useState` would look like it works but
 * never re-render. Creators would then try to fix behavior that cannot be fixed. Doing nothing is
 * better.
 *
 * With no dispatcher the answer is deterministic: throw. Silently returning a default would let the
 * value flow through the tree and fail somewhere else.
 *
 * Rules of Hooks are not enforced here. Call order and conditional-call checks show up naturally
 * when the dispatcher counts its slots, and static checks are a separate compiler pass. A regex
 * imitation would be wrong, and it would wrongly reject valid code.
 */

export type RuntimeStateAction<S> = S | ((previous: S) => S);
export type RuntimeSetState<S> = (action: RuntimeStateAction<S>) => void;
export type RuntimeCleanup = () => void;
export interface RuntimeRef<T> {
	current: T;
}

/**
 * The minimum the reconciler fills in. It is not a copy of the public hook signatures. `useMemo`
 * and `useCallback` both mean the same value when dependencies match, so they fold into one method
 * here. The fold happens here, not in the public API, because the vocabulary creators see and the
 * vocabulary the VM implements have no reason to be identical.
 */
export interface RuntimeDispatcher {
	useState<S>(initial: S | (() => S)): [S, RuntimeSetState<S>];
	/**
	 * Differs from `useState` only in that the value belongs to the playthrough, not the component. So
	 * the slot holds no value, just the definition's key. The real value lives in the story-state
	 * engine.
	 */
	useStoryState<T>(
		definition: StoryStateDefinition<T>,
	): [T, RuntimeSetState<T>];
	/**
	 * Same slot shape as `useStoryState`, with a different registry. The two are not folded into one
	 * method with a brand check on the definition, because that check would itself decide the
	 * lifetime. If it were wrong, the screen would silently read a value from another lifetime.
	 */
	usePersistentState<T>(
		definition: PersistentStateDefinition<T>,
	): [T, RuntimeSetState<T>];
	useReducer<S, A>(
		reducer: (state: S, action: A) => S,
		initial: S,
	): [S, (action: A) => void];
	useMemo<T>(factory: () => T, deps: readonly unknown[] | undefined): T;
	useRef<T>(initial: T): RuntimeRef<T>;
	useEffect(
		// biome-ignore lint/suspicious/noConfusingVoidType: must match the public hook type in `hooks.ts`.
		effect: () => void | RuntimeCleanup,
		deps: readonly unknown[] | undefined,
	): void;
}

let current: RuntimeDispatcher | null = null;

/**
 * Swaps the dispatcher. Only the reconciler calls this. It is not exported from the public root
 * (`index.ts` does not re-export this module). If creator code could call it, creators would define
 * hook semantics.
 */
export function setRuntimeDispatcher(
	next: RuntimeDispatcher | null,
): RuntimeDispatcher | null {
	const previous = current;
	current = next;
	return previous;
}

/** Whether a render is in progress. A predicate that is also used outside the hooks. */
export function hasRuntimeDispatcher(): boolean {
	return current !== null;
}

/**
 * The single route by which a hook obtains its implementation. With no dispatcher installed, it
 * throws at that point.
 */
export function dispatcher(hook: string): RuntimeDispatcher {
	if (current === null)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hookOutsideRender,
			`${hook}() can be used only while a runtime component renders.`,
		);
	return current;
}
