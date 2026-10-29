import type { RuntimeNode } from "../node.ts";
import {
	type RuntimeDispatcher,
	type RuntimeRef,
	type RuntimeSetState,
	type RuntimeStateAction,
	setRuntimeDispatcher,
} from "./dispatcher.ts";
import {
	RUNTIME_ERROR_CODE,
	RuntimeError,
	type RuntimeErrorCode,
} from "./errors.ts";
import {
	type PersistentStateDefinition,
	persistentStateKeyOf,
	queuePersistentState,
	readPersistentState,
} from "./persistent-state.ts";
import { runtimePhase, withRuntimePhase } from "./phase.ts";
import {
	queueStoryState,
	readStoryState,
	type StoryStateDefinition,
	storyStateKeyOf,
} from "./story-state.ts";

/**
 * The real hook implementation: component instances and slots, plus a dispatcher that exists only
 * during render.
 *
 * - Instance: one mounted function component. Everything that survives between renders lives
 *   here.
 * - Slot: one hook call, found by number, so call order is the identity.
 * - Committed slots (`instance.hooks`): the values on screen.
 * - Work slots (`instance.wip`): the values the current render produces. Nothing changes until
 *   commit.
 *
 * Render only reads committed slots. If a render throws, the previous commit must stay
 * authoritative (atomic commit). So render never touches `hooks`; it builds a fresh `wip` and reads
 * the state queue without consuming it. Folding the same queue over the same base gives the same
 * result, so a retry after a failed render is deterministic. The queue is emptied only at commit.
 *
 * Setters capture (instance, index), not the slot object. Slot objects are recreated on each commit
 * (the work slot becomes the committed slot), so a setter holding a slot would write to an old one
 * after the first commit. Capturing the instance and index always writes to the currently committed
 * slot.
 *
 * Rules of Hooks are enforced at runtime, not statically. If a component calls a different number
 * or kind of hooks than the previous commit, it throws on the spot (`runtime_hook_order_changed`).
 * Slots are not re-resolved: re-resolving would put `useMemo`'s value where `useRef` was, and the
 * screen would be wrong without any error.
 */

export interface ComponentInstance {
	/** VM identity, for diagnostics only. It is not a host node id. */
	readonly id: number;
	readonly type: (props: never) => RuntimeNode;
	/** For diagnostics only. Not the basis of identity. */
	readonly name: string;
	hooks: HookSlot[];
	wip: HookSlot[] | null;
	/** Whether the first commit has passed. Before it there is no hook count to compare against. */
	committed: boolean;
	/** Whether the instance has been unmounted. Setter calls after that are ignored. */
	disposed: boolean;
	readonly root: InstanceRootBinding;
}

/** What an instance needs from its root: a re-render request, and a way to pass warnings along. */
export interface InstanceRootBinding {
	requestRender(): void;
	warn(code: RuntimeErrorCode, message: string, component: string): void;
}

export interface StateSlot {
	readonly kind: "state";
	value: unknown;
	/** A value or an updater function. The commit empties the queue. */
	readonly queue: unknown[];
	readonly setter: RuntimeSetState<unknown>;
}

export interface ReducerSlot {
	readonly kind: "reducer";
	value: unknown;
	readonly queue: unknown[];
	readonly dispatch: (action: unknown) => void;
}

export interface MemoSlot {
	readonly kind: "memo";
	readonly deps: readonly unknown[] | undefined;
	readonly value: unknown;
}

/**
 * Story-state slot: holds no value. The value lives in the story-state engine, so only the
 * definition's key and the setter remain here. For the same reason the slot has no queue: the queue
 * belongs to the engine. If two components read the same definition and each had its own queue,
 * they would not see the same value.
 */
export interface StoryStateSlot {
	readonly kind: "storyState";
	readonly key: string;
	readonly setter: RuntimeSetState<unknown>;
}

/**
 * Persistent-state slot: same shape as the story-state slot, different lifetime. The `kind` tag is
 * the whole point of this type. Folding both into one type with the registry in another field would
 * make the slot-order check (`openSlot`) treat them as the same, and a screen that swapped the two
 * hooks conditionally would silently read a value from the other lifetime, with no error.
 */
export interface PersistentStateSlot {
	readonly kind: "persistentState";
	readonly key: string;
	readonly setter: RuntimeSetState<unknown>;
}

export interface RefSlot {
	readonly kind: "ref";
	readonly ref: RuntimeRef<unknown>;
}

export type EffectCreate = () => unknown;

export interface EffectSlot {
	readonly kind: "effect";
	readonly create: EffectCreate;
	readonly deps: readonly unknown[] | undefined;
	/**
	 * The cleanup returned by the last effect that ran. The next run of the effect, or unmount, calls
	 * it.
	 */
	cleanup: (() => unknown) | null;
	/**
	 * Whether the commit should run this effect. Decided at hook-call time by comparing with the
	 * previous commit.
	 */
	readonly shouldRun: boolean;
}

export type HookSlot =
	| StateSlot
	| StoryStateSlot
	| PersistentStateSlot
	| ReducerSlot
	| MemoSlot
	| RefSlot
	| EffectSlot;

export interface EffectWork {
	readonly instance: ComponentInstance;
	readonly index: number;
	readonly create: EffectCreate;
}

export interface CleanupWork {
	readonly instance: ComponentInstance;
	readonly index: number;
}

interface RenderFrame {
	instance: ComponentInstance;
	cursor: number;
}

let frame: RenderFrame | null = null;
let nextInstanceId = 1;

export function createComponentInstance(
	type: (props: never) => RuntimeNode,
	root: InstanceRootBinding,
): ComponentInstance {
	const name =
		typeof type.name === "string" && type.name.length > 0
			? type.name
			: "(anonymous)";
	return {
		id: nextInstanceId++,
		type,
		name,
		hooks: [],
		wip: null,
		committed: false,
		disposed: false,
		root,
	};
}

const orderChanged = (instance: ComponentInstance, why: string): RuntimeError =>
	new RuntimeError(
		RUNTIME_ERROR_CODE.hookOrderChanged,
		`${instance.name}'s hook call order differs from the previous render: ${why}. Hooks must be called in the same order, outside conditions, loops and nested functions.`,
	);

function currentFrame(hook: string): RenderFrame {
	if (frame === null)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hookOutsideRender,
			`${hook}() can be used only while a runtime component renders.`,
		);
	return frame;
}

/**
 * Opens one slot: assigns its number and checks that the same position in the previous commit has
 * the same kind. The first render has nothing to compare against, so it accepts any kind. After
 * that each position has a fixed kind.
 */
function openSlot<K extends HookSlot["kind"]>(
	hook: string,
	kind: K,
): {
	instance: ComponentInstance;
	index: number;
	previous: Extract<HookSlot, { kind: K }> | null;
	push(slot: HookSlot): void;
} {
	const current = currentFrame(hook);
	const { instance } = current;
	const index = current.cursor;
	current.cursor += 1;
	const wip = instance.wip;
	if (wip === null)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hookOutsideRender,
			`${hook}() can be used only while a runtime component renders.`,
		);
	let previous: Extract<HookSlot, { kind: K }> | null = null;
	if (instance.committed) {
		const slot = instance.hooks[index];
		if (slot === undefined)
			throw orderChanged(
				instance,
				`hook #${index + 1} (${hook}) did not exist before`,
			);
		if (slot.kind !== kind)
			throw orderChanged(
				instance,
				`slot #${index + 1} was ${slot.kind} before and is ${kind} now`,
			);
		previous = slot as Extract<HookSlot, { kind: K }>;
	}
	return {
		instance,
		index,
		previous,
		push: (slot) => {
			wip.push(slot);
		},
	};
}

export function depsEqual(
	left: readonly unknown[] | undefined,
	right: readonly unknown[] | undefined,
): boolean {
	if (left === undefined || right === undefined) return false;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1)
		if (!Object.is(left[index], right[index])) return false;
	return true;
}

/** Folds the queue over the base value. Does not empty the queue; that is the commit's job. */
function foldStateQueue(base: unknown, queue: readonly unknown[]): unknown {
	let value = base;
	for (let index = 0; index < queue.length; index += 1) {
		const action = queue[index];
		value =
			typeof action === "function"
				? (action as (v: unknown) => unknown)(value)
				: action;
	}
	return value;
}

/**
 * Setter: enqueues the update and asks the root to re-render. Calls during render are rejected
 * (`runtime_state_update_during_render`). For a component that no longer exists, it logs a warning
 * and ignores the call: one late async callback must not kill the runtime. If the queue is empty
 * and the new value is `Object.is` equal to the current value, nothing happens, so `setState(v =>
 * v)` does not cause a render.
 */
function makeSetter(
	instance: ComponentInstance,
	index: number,
): RuntimeSetState<unknown> {
	return (action: RuntimeStateAction<unknown>) => {
		if (runtimePhase() === "render")
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.stateUpdateDuringRender,
				`${instance.name} tried to change state during render. State can be updated only in events or effects.`,
			);
		if (instance.disposed) {
			instance.root.warn(
				RUNTIME_ERROR_CODE.updateAfterUnmount,
				`${instance.name} is already gone. The state update was ignored.`,
				instance.name,
			);
			return;
		}
		const slot = instance.hooks[index];
		if (slot === undefined || slot.kind !== "state") return;
		if (slot.queue.length === 0) {
			const next =
				typeof action === "function"
					? (action as (v: unknown) => unknown)(slot.value)
					: action;
			if (Object.is(next, slot.value)) return;
			slot.queue.push(next);
		} else slot.queue.push(action);
		instance.root.requestRender();
	};
}

/**
 * Story-state setter: the same function for as long as the slot's identity holds. It captures
 * (instance, index), not a value, for the same reason as `useState`. A call on a removed component
 * logs a warning and is ignored: a late callback must not change the playthrough's progress, since
 * that component's lifetime has ended. If the value breaks the rules (not serializable, over a
 * limit), it throws on the spot. Found at snapshot time instead, the problem would surface after
 * many commits had already passed over that value.
 */
function makeStorySetter(
	instance: ComponentInstance,
	index: number,
): RuntimeSetState<unknown> {
	return (action: RuntimeStateAction<unknown>) => {
		if (runtimePhase() === "render")
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.stateUpdateDuringRender,
				`${instance.name} tried to change story state during render. State can be updated only in events or effects.`,
			);
		if (instance.disposed) {
			instance.root.warn(
				RUNTIME_ERROR_CODE.updateAfterUnmount,
				`${instance.name} is already gone. The story state update was ignored.`,
				instance.name,
			);
			return;
		}
		const slot = instance.hooks[index];
		if (slot === undefined || slot.kind !== "storyState") return;
		if (queueStoryState(slot.key, action)) instance.root.requestRender();
	};
}

/**
 * Same rules as `makeStorySetter`, with a different registry. One function taking the registry as
 * an argument would be shorter, but a call site that passed the wrong registry would still compile
 * and pass tests while changing a value of the other lifetime. The check on the slot's `kind` is
 * the defense, and that check must compare a different constant for each lifetime.
 */
function makePersistentSetter(
	instance: ComponentInstance,
	index: number,
): RuntimeSetState<unknown> {
	return (action: RuntimeStateAction<unknown>) => {
		if (runtimePhase() === "render")
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.stateUpdateDuringRender,
				`${instance.name} tried to change persistent state during render. State can be updated only in events or effects.`,
			);
		if (instance.disposed) {
			instance.root.warn(
				RUNTIME_ERROR_CODE.updateAfterUnmount,
				`${instance.name} is already gone. The persistent state update was ignored.`,
				instance.name,
			);
			return;
		}
		const slot = instance.hooks[index];
		if (slot === undefined || slot.kind !== "persistentState") return;
		if (queuePersistentState(slot.key, action)) instance.root.requestRender();
	};
}

function makeDispatch(
	instance: ComponentInstance,
	index: number,
): (action: unknown) => void {
	return (action) => {
		if (runtimePhase() === "render")
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.stateUpdateDuringRender,
				`${instance.name} called dispatch during render. State can be updated only in events or effects.`,
			);
		if (instance.disposed) {
			instance.root.warn(
				RUNTIME_ERROR_CODE.updateAfterUnmount,
				`${instance.name} is already gone. The dispatch was ignored.`,
				instance.name,
			);
			return;
		}
		const slot = instance.hooks[index];
		if (slot === undefined || slot.kind !== "reducer") return;
		slot.queue.push(action);
		instance.root.requestRender();
	};
}

const renderDispatcher: RuntimeDispatcher = {
	useState<S>(initial: S | (() => S)): [S, RuntimeSetState<S>] {
		const { instance, index, previous, push } = openSlot("useState", "state");
		if (previous === null) {
			const value =
				typeof initial === "function" ? (initial as () => S)() : initial;
			const setter = makeSetter(instance, index);
			push({ kind: "state", value, queue: [], setter });
			return [value, setter as RuntimeSetState<S>];
		}
		const value = foldStateQueue(previous.value, previous.queue) as S;
		push({
			kind: "state",
			value,
			queue: previous.queue,
			setter: previous.setter,
		});
		return [value, previous.setter as RuntimeSetState<S>];
	},

	useStoryState<T>(
		definition: StoryStateDefinition<T>,
	): [T, RuntimeSetState<T>] {
		const { instance, index, previous, push } = openSlot(
			"useStoryState",
			"storyState",
		);
		const key = storyStateKeyOf(definition);
		/**
		 * A hook slot means one definition for as long as it is mounted. If a condition passes a
		 * different definition, the slot's setter cannot say which storage key it writes, and the screen
		 * would silently change another state.
		 */
		if (previous !== null && previous.key !== key)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.storyStateHookChanged,
				`${instance.name}'s hook #${index + 1} was story state "${previous.key}" before and is "${key}" now. One hook slot reads only one story state.`,
			);
		const setter = previous?.setter ?? makeStorySetter(instance, index);
		push({ kind: "storyState", key, setter });
		return [readStoryState(key) as T, setter as RuntimeSetState<T>];
	},

	usePersistentState<T>(
		definition: PersistentStateDefinition<T>,
	): [T, RuntimeSetState<T>] {
		const { instance, index, previous, push } = openSlot(
			"usePersistentState",
			"persistentState",
		);
		const key = persistentStateKeyOf(definition);
		if (previous !== null && previous.key !== key)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.persistentStateHookChanged,
				`${instance.name}'s hook #${index + 1} was persistent state "${previous.key}" before and is "${key}" now. One hook slot reads only one persistent state.`,
			);
		const setter = previous?.setter ?? makePersistentSetter(instance, index);
		push({ kind: "persistentState", key, setter });
		return [readPersistentState(key) as T, setter as RuntimeSetState<T>];
	},

	useReducer<S, A>(
		reducer: (state: S, action: A) => S,
		initial: S,
	): [S, (action: A) => void] {
		const { instance, index, previous, push } = openSlot(
			"useReducer",
			"reducer",
		);
		if (previous === null) {
			const dispatch = makeDispatch(instance, index);
			push({ kind: "reducer", value: initial, queue: [], dispatch });
			return [initial, dispatch];
		}
		/** The reducer is taken from render time: a reducer whose closure changed folds the queue. */
		let value = previous.value as S;
		for (let entry = 0; entry < previous.queue.length; entry += 1)
			value = reducer(value, previous.queue[entry] as A);
		push({
			kind: "reducer",
			value,
			queue: previous.queue,
			dispatch: previous.dispatch,
		});
		return [value, previous.dispatch];
	},

	useMemo<T>(factory: () => T, deps: readonly unknown[] | undefined): T {
		const { previous, push } = openSlot("useMemo", "memo");
		if (previous !== null && depsEqual(previous.deps, deps)) {
			push(previous);
			return previous.value as T;
		}
		const value = factory();
		push({ kind: "memo", deps, value });
		return value;
	},

	useRef<T>(initial: T): RuntimeRef<T> {
		const { previous, push } = openSlot("useRef", "ref");
		if (previous !== null) {
			push(previous);
			return previous.ref as RuntimeRef<T>;
		}
		const ref: RuntimeRef<unknown> = { current: initial };
		push({ kind: "ref", ref });
		return ref as RuntimeRef<T>;
	},

	useEffect(effect: EffectCreate, deps: readonly unknown[] | undefined): void {
		const { previous, push } = openSlot("useEffect", "effect");
		const shouldRun =
			previous === null ||
			deps === undefined ||
			!depsEqual(previous.deps, deps);
		push({
			kind: "effect",
			create: effect,
			deps,
			cleanup: previous === null ? null : previous.cleanup,
			shouldRun,
		});
	},
};

/**
 * Renders one component: installs the dispatcher, calls it, and always removes the dispatcher.
 * `try/finally` is the whole point. If creator code throws and the dispatcher and frame stay in
 * place, the next component's hooks would run against the wrong instance. The hook-count check runs
 * only on the success path, since the hook count of a render that threw is discarded anyway.
 */
export function renderComponent(
	instance: ComponentInstance,
	props: unknown,
): RuntimeNode {
	const outer = frame;
	const previousDispatcher = setRuntimeDispatcher(renderDispatcher);
	instance.wip = [];
	frame = { instance, cursor: 0 };
	let output: RuntimeNode;
	try {
		output = withRuntimePhase("render", () =>
			(instance.type as (props: unknown) => RuntimeNode)(props),
		);
		if (instance.committed && frame.cursor !== instance.hooks.length)
			throw orderChanged(
				instance,
				`there were ${instance.hooks.length} hooks before and ${frame.cursor} now`,
			);
	} catch (error) {
		instance.wip = null;
		throw error;
	} finally {
		frame = outer;
		setRuntimeDispatcher(previousDispatcher);
	}
	return output;
}

/**
 * Turns the work slots into committed slots. Returns the effect work this commit passes to the
 * scheduler. The queue is emptied here: the updates the render read have become values. Updates
 * arriving after this call belong to the next render.
 */
export function commitInstance(instance: ComponentInstance): EffectWork[] {
	const wip = instance.wip;
	if (wip === null) return [];
	const work: EffectWork[] = [];
	for (let index = 0; index < wip.length; index += 1) {
		const slot = wip[index] as HookSlot;
		if (slot.kind === "state" || slot.kind === "reducer") slot.queue.length = 0;
		if (slot.kind === "effect" && slot.shouldRun)
			work.push({ instance, index, create: slot.create });
	}
	instance.hooks = wip;
	instance.wip = null;
	instance.committed = true;
	return work;
}

/** After a failed render, drops the work slots. The committed slots have not changed at all. */
export function discardRender(instance: ComponentInstance): void {
	instance.wip = null;
}

/**
 * Kills the instance. Returns cleanup work for effects that have not yet been cleaned up. The hook
 * slots are not cleared immediately, because cleanup functions still live in them.
 * `releaseInstance` clears them after cleanup runs.
 */
export function unmountInstance(instance: ComponentInstance): CleanupWork[] {
	instance.disposed = true;
	instance.wip = null;
	const work: CleanupWork[] = [];
	for (let index = 0; index < instance.hooks.length; index += 1) {
		const slot = instance.hooks[index] as HookSlot;
		if (slot.kind === "effect" && slot.cleanup !== null)
			work.push({ instance, index });
		if (slot.kind === "state" || slot.kind === "reducer") slot.queue.length = 0;
	}
	return work;
}

export function releaseInstance(instance: ComponentInstance): void {
	instance.hooks = [];
	instance.wip = null;
}

/** Whether a render is in progress. Used by the reconciler in assertions. */
export function isRendering(): boolean {
	return frame !== null;
}
