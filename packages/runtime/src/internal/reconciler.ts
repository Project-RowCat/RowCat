import {
	isRuntimeHostComponent,
	type RuntimeHostKind,
	runtimeHostKindOf,
} from "../component.ts";
import { Fragment } from "../jsx-runtime.ts";
import {
	isRuntimeElement,
	type RuntimeElement,
	type RuntimeNode,
} from "../node.ts";
import type { RuntimeControlKind } from "./control.ts";
import {
	RUNTIME_ERROR_CODE,
	RuntimeError,
	type RuntimeErrorCode,
} from "./errors.ts";
import type { HandlerRegistry } from "./handlers.ts";
import {
	type CleanupWork,
	type ComponentInstance,
	commitInstance,
	createComponentInstance,
	type EffectWork,
	type InstanceRootBinding,
	renderComponent,
	unmountInstance,
} from "./hooks-runtime.ts";
import {
	CHILDLESS_HOST_KINDS,
	CONTROL_KIND_FOR_HOST,
	CONTROL_PROP_NAME,
	controlIdOf,
	equalHostValue,
	type HostValue,
	normalizeHostProps,
} from "./host-props.ts";

/**
 * Reconciler: small things, precisely. Three stages, kept apart for atomicity.
 *
 * - Render (renderTree): reads the previous committed tree and builds the next tree fresh. Calls
 *   components, normalizes children and matches pairs. The previous tree is not changed.
 * - Commit (planCommit): compares the two trees and builds a patch plan: create, props, text,
 *   insert, move, remove. Nothing is applied yet.
 * - Apply (applyCommit): runs only after the host accepts the batch. Commits instances, releases
 *   handlers, unmounts, and queues effect work.
 *
 * If render throws, the next tree is discarded. If the host rejects the batch, the plan is
 * discarded. In neither case do the previous tree or the committed hooks change. So render only
 * holds the previous fiber by reference, and the plan records registry numbers as 'to release if
 * accepted' and 'to release if rejected'.
 *
 * Identity: under one parent, a keyed child is identified by (key, kind). An unkeyed child is
 * identified by (position, kind). Kind is a text node, a host primitive, or a component function.
 * Function names are never read, because minification erases them. A duplicate key among siblings
 * is a warning, and the later one is judged by position. This is deterministic and invents no
 * identity.
 *
 * Children: null, booleans and undefined are nothing. Arrays and fragments flatten in place.
 * Adjacent strings and numbers merge into one text node, so `<Text>Count: {n}</Text>` is one node.
 * Any other value is runtime_invalid_runtime_node.
 *
 * Recursion: tree depth is set by the creator (recursive components), and recursion here follows
 * it. maxTreeDepth trips first and turns a VM stack overflow into a structural failure. Under that
 * limit, the frame count is a small constant multiple of depth.
 */

export interface ReconcilerLimits {
	readonly maxTreeDepth: number;
	readonly maxHostNodes: number;
	readonly maxPatchesPerCommit: number;
}

export type HostNodeKind = RuntimeHostKind | "#text";

export type RuntimePatch =
	| { readonly op: "create"; readonly id: number; readonly kind: HostNodeKind }
	| { readonly op: "remove"; readonly id: number }
	| {
			readonly op: "insert";
			readonly parent: number;
			readonly child: number;
			readonly index: number;
	  }
	| {
			readonly op: "move";
			readonly parent: number;
			readonly child: number;
			readonly index: number;
	  }
	| {
			readonly op: "set-prop";
			readonly id: number;
			readonly name: string;
			readonly value: HostValue;
	  }
	| { readonly op: "remove-prop"; readonly id: number; readonly name: string }
	| { readonly op: "set-text"; readonly id: number; readonly value: string };

/** Id of the synthetic root container. It is not a renderer primitive. */
export const ROOT_HOST_ID = 0;

type Handler = (...args: unknown[]) => unknown;
type ComponentType = (props: never) => RuntimeNode;

export interface RootFiber {
	readonly kind: "root";
	readonly children: Fiber[];
	prev: RootFiber | null;
}

export interface HostFiber {
	readonly kind: "host";
	readonly hostKind: RuntimeHostKind;
	readonly key: string | number | null;
	readonly position: number;
	readonly hostId: number;
	readonly values: Record<string, HostValue>;
	readonly handlers: Record<string, Handler>;
	/** Only committed fibers carry this. The plan fills it in, and apply confirms it. */
	handlerIds: Record<string, number>;
	readonly children: Fiber[];
	prev: HostFiber | null;
}

export interface TextFiber {
	readonly kind: "text";
	readonly position: number;
	readonly hostId: number;
	readonly text: string;
	prev: TextFiber | null;
}

export interface ComponentFiber {
	readonly kind: "component";
	readonly type: ComponentType;
	readonly key: string | number | null;
	readonly position: number;
	readonly instance: ComponentInstance;
	readonly children: Fiber[];
	prev: ComponentFiber | null;
}

export type Fiber = HostFiber | TextFiber | ComponentFiber;

export interface RenderContext {
	readonly limits: ReconcilerLimits;
	readonly nextHostId: () => number;
	readonly binding: InstanceRootBinding;
	readonly warn: (
		code: RuntimeErrorCode,
		message: string,
		component: string,
	) => void;
	/**
	 * Instances whose hooks this render ran. If the render fails, these are the work slots to discard.
	 */
	readonly rendered: ComponentInstance[];
	/** Fibers reused from the previous tree. The commit unmounts the rest. */
	readonly reused: Set<Fiber>;
	/** Host node count in the next tree, text nodes included. */
	hostNodes: number;
	readonly stack: string[];
	componentRenders: number;
	/**
	 * Controllers attached to this tree, as id to kind. When the commit is accepted, the root uses
	 * this table as the authorized set. Commands for controllers not in it are not sent
	 * (runtime_host_control_unbound).
	 *
	 * The table is collected during render, so a controller attached to two live nodes is rejected
	 * right then. If the later one simply won, the answer would depend on sibling order and could
	 * change from commit to commit.
	 */
	readonly controls: Map<number, RuntimeControlKind>;
}

/**
 * A normalized child. `position` is its place.
 *
 * Position is the number in the flattened list, and an empty value still takes one slot. In `[A,
 * cond && B, C]`, C is at position 2 whether or not `cond` is true. If empty values were removed
 * before counting, turning `cond` off would move C to position 1 and wipe the state of the unkeyed
 * C. Conditional rendering is the most common syntax, so this matters.
 *
 * A merged text run keeps the position of its first piece, and each later piece still takes one
 * slot. A sibling after `<Text>Count: {n}</Text>` therefore does not shift when `n` appears or
 * disappears.
 */
type NormalizedChild =
	| { readonly kind: "text"; readonly text: string; readonly position: number }
	| {
			readonly kind: "element";
			readonly element: RuntimeElement;
			readonly position: number;
	  };

const invalidNode = (what: string): RuntimeError =>
	new RuntimeError(
		RUNTIME_ERROR_CODE.invalidRuntimeNode,
		`A value that can't be placed in the tree: ${what}. Only elements, strings, numbers, null, booleans and arrays can be children.`,
	);

/**
 * Flattens one child, or an array, into a flat list. This uses a stack rather than recursion.
 *
 * Nesting of arrays is set by the creator, so no frame is spent per level. The depth of elements
 * themselves is counted by fiber depth and bounded there.
 */
function normalizeChildren(node: RuntimeNode): NormalizedChild[] {
	const out: NormalizedChild[] = [];
	const stack: RuntimeNode[] = [node];
	let position = 0;
	let pendingText: string | null = null;
	let pendingPosition = 0;
	const flushText = (): void => {
		if (pendingText === null) return;
		out.push({ kind: "text", text: pendingText, position: pendingPosition });
		pendingText = null;
	};
	while (stack.length > 0) {
		const value = stack.pop() as RuntimeNode;
		if (Array.isArray(value)) {
			for (let index = value.length - 1; index >= 0; index -= 1)
				stack.push(value[index] as RuntimeNode);
			continue;
		}
		const at = position;
		position += 1;
		if (value === null || value === undefined || typeof value === "boolean")
			continue;
		if (typeof value === "string" || typeof value === "number") {
			const text = typeof value === "number" ? String(value) : value;
			if (pendingText === null) {
				pendingText = text;
				pendingPosition = at;
			} else pendingText += text;
			continue;
		}
		if (!isRuntimeElement(value)) {
			if (
				typeof value === "object" &&
				typeof (value as { then?: unknown }).then === "function"
			)
				throw new RuntimeError(
					RUNTIME_ERROR_CODE.asyncComponentUnsupported,
					"The component returned a promise. Async components are not supported; write it with state and effects.",
				);
			throw invalidNode(
				typeof value === "object"
					? "an object that is not a runtime element"
					: typeof value,
			);
		}
		if (value.type === Fragment) {
			/** A fragment takes no position. Its children are spread into its place. */
			position -= 1;
			const children = (value.props as { children?: RuntimeNode }).children;
			if (children !== undefined) stack.push(children);
			continue;
		}
		if (typeof value.type !== "function")
			throw invalidNode(
				typeof value.type === "string"
					? `the string tag "${value.type}"`
					: `an element whose type is ${typeof value.type}`,
			);
		flushText();
		out.push({ kind: "element", element: value, position: at });
	}
	flushText();
	return out;
}

const sameIdentity = (fiber: Fiber, next: NormalizedChild): boolean => {
	if (next.kind === "text") return fiber.kind === "text";
	const { type } = next.element;
	if (isRuntimeHostComponent(type))
		return fiber.kind === "host" && fiber.hostKind === runtimeHostKindOf(type);
	return fiber.kind === "component" && fiber.type === type;
};

const keyOf = (fiber: Fiber): string | number | null =>
	fiber.kind === "text" ? null : fiber.key;

function reconcileChildren(
	prevChildren: readonly Fiber[],
	node: RuntimeNode,
	depth: number,
	context: RenderContext,
): Fiber[] {
	const nexts = normalizeChildren(node);
	const prevKeyed = new Map<string | number, Fiber>();
	const prevByPosition = new Map<number, Fiber>();
	for (const fiber of prevChildren) {
		const key = keyOf(fiber);
		if (key !== null && !prevKeyed.has(key)) prevKeyed.set(key, fiber);
		prevByPosition.set(fiber.position, fiber);
	}
	const seenKeys = new Set<string | number>();
	const out: Fiber[] = [];
	for (let index = 0; index < nexts.length; index += 1) {
		const next = nexts[index] as NormalizedChild;
		let candidate: Fiber | null = null;
		const key = next.kind === "element" ? next.element.key : null;
		let positional = key === null;
		if (key !== null) {
			if (seenKeys.has(key)) {
				context.warn(
					RUNTIME_ERROR_CODE.duplicateKey,
					`The same sibling list has key "${String(key)}" more than once. Later ones are matched by position.`,
					context.stack[context.stack.length - 1] ?? "(root)",
				);
				positional = true;
			} else {
				seenKeys.add(key);
				const keyed = prevKeyed.get(key);
				if (
					keyed !== undefined &&
					!context.reused.has(keyed) &&
					sameIdentity(keyed, next)
				)
					candidate = keyed;
			}
		}
		if (candidate === null && positional) {
			/**
			 * Matches by position: same position, same kind, same key (or no key).
			 *
			 * A later duplicate key reuses the fiber that had that key at that position. This is
			 * deterministic, and it does not remount on every render.
			 */
			const same = prevByPosition.get(next.position);
			if (
				same !== undefined &&
				keyOf(same) === key &&
				!context.reused.has(same) &&
				sameIdentity(same, next)
			)
				candidate = same;
		}
		out.push(buildFiber(candidate, next, depth, context));
	}
	return out;
}

function buildFiber(
	prev: Fiber | null,
	next: NormalizedChild,
	depth: number,
	context: RenderContext,
): Fiber {
	if (depth > context.limits.maxTreeDepth)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.treeDepthExceeded,
			`The tree depth exceeds the limit (${context.limits.maxTreeDepth}).`,
		);
	if (prev !== null) context.reused.add(prev);

	if (next.kind === "text") {
		countHostNode(context);
		const previous = prev as TextFiber | null;
		return {
			kind: "text",
			position: next.position,
			hostId: previous === null ? context.nextHostId() : previous.hostId,
			text: next.text,
			prev: previous,
		};
	}

	const { element } = next;
	const props = element.props as Record<string, unknown>;

	if (isRuntimeHostComponent(element.type)) {
		countHostNode(context);
		const previous = prev as HostFiber | null;
		const hostKind = runtimeHostKindOf(element.type) as RuntimeHostKind;
		const normalized = normalizeHostProps(props, hostKind);
		/**
		 * A kind that holds no children is rejected here.
		 *
		 * The type already blocks this, but the type is not a boundary. Nodes built by computation, or
		 * values passed through `as`, get past it. Placing them elsewhere silently would make the screen
		 * differ from the creator's code. Dropping them would lose the text without a message.
		 */
		if (
			CHILDLESS_HOST_KINDS.has(hostKind) &&
			(props as { children?: RuntimeNode }).children !== undefined
		)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.invalidRuntimeNode,
				`<${hostKind}> does not hold children.`,
			);
		registerControl(hostKind, normalized.values, context);
		const children = reconcileChildren(
			previous === null ? [] : previous.children,
			(props as { children?: RuntimeNode }).children,
			depth + 1,
			context,
		);
		return {
			kind: "host",
			hostKind,
			key: element.key,
			position: next.position,
			hostId: previous === null ? context.nextHostId() : previous.hostId,
			values: normalized.values,
			handlers: normalized.handlers,
			handlerIds: {},
			children,
			prev: previous,
		};
	}

	const previous = prev as ComponentFiber | null;
	const type = element.type as ComponentType;
	const instance =
		previous === null
			? createComponentInstance(type, context.binding)
			: previous.instance;
	context.rendered.push(instance);
	context.stack.push(instance.name);
	let children: Fiber[];
	try {
		context.componentRenders += 1;
		const output = renderComponent(instance, props);
		if (
			typeof output === "object" &&
			output !== null &&
			!Array.isArray(output) &&
			typeof (output as { then?: unknown }).then === "function"
		)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.asyncComponentUnsupported,
				`${instance.name} returned a promise. Async components are not supported; write it with state and effects.`,
			);
		/**
		 * Children are built under this name too, so an error in a child is attributed to this component
		 * on the stack.
		 */
		children = reconcileChildren(
			previous === null ? [] : previous.children,
			output,
			depth + 1,
			context,
		);
	} catch (error) {
		markComponentStack(error, context.stack);
		throw error;
	} finally {
		context.stack.pop();
	}
	return {
		kind: "component",
		type,
		key: element.key,
		position: next.position,
		instance,
		children,
		prev: previous,
	};
}

/**
 * Records the controller attached to this node in the authorization table. A duplicate fails the
 * render.
 *
 * The primitive decides the kind (`CONTROL_KIND_FOR_HOST`). Normalization has already matched the
 * kind, so the value that reaches here always has the right kind. This function answers only
 * whether there is exactly one.
 */
function registerControl(
	kind: RuntimeHostKind,
	values: Record<string, HostValue>,
	context: RenderContext,
): void {
	const value = values[CONTROL_PROP_NAME];
	if (value === undefined) return;
	const id = controlIdOf(value);
	if (id === null) return;
	if (context.controls.has(id))
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hostControlAlreadyBound,
			"The same controller is attached in two places. One controller attaches to one node only.",
		);
	context.controls.set(id, CONTROL_KIND_FOR_HOST[kind] as RuntimeControlKind);
}

function countHostNode(context: RenderContext): void {
	context.hostNodes += 1;
	if (context.hostNodes > context.limits.maxHostNodes)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hostNodeLimitExceeded,
			`The host node count exceeds the limit (${context.limits.maxHostNodes}).`,
		);
}

/**
 * Attaches the component stack to a creator error. The name is for diagnostics. File paths are not
 * included.
 */
export const COMPONENT_STACK_MARK = "rowcatComponentStack";

function markComponentStack(error: unknown, stack: readonly string[]): void {
	if (typeof error !== "object" || error === null) return;
	if (Object.hasOwn(error, COMPONENT_STACK_MARK)) return;
	try {
		Object.defineProperty(error, COMPONENT_STACK_MARK, {
			value: stack.join(" > "),
			enumerable: false,
			writable: false,
			configurable: false,
		});
	} catch {
		/* A frozen error object cannot take the mark, so it passes through without a stack. */
	}
}

/** Builds the next tree. The previous tree is read only. */
export function renderTree(
	prev: RootFiber | null,
	node: RuntimeNode,
	context: RenderContext,
): RootFiber {
	const children = reconcileChildren(
		prev === null ? [] : prev.children,
		node,
		1,
		context,
	);
	return { kind: "root", children, prev };
}

export interface CommitPlan {
	readonly patches: RuntimePatch[];
	/** Numbers the plan obtained from the registry. Released if the commit is rejected. */
	readonly acquired: number[];
	/**
	 * Numbers to release if the commit is accepted: changed handlers and handlers of removed nodes.
	 */
	readonly released: number[];
	/** Instances in the next tree. If the commit is accepted, their work slots are committed. */
	readonly instances: ComponentInstance[];
	/** Instances present only in the previous tree. If the commit is accepted, they are unmounted. */
	readonly unmounted: ComponentInstance[];
	readonly hostNodes: number;
}

interface PlanContext {
	readonly registry: HandlerRegistry;
	readonly limits: ReconcilerLimits;
	readonly reused: ReadonlySet<Fiber>;
	readonly plan: CommitPlan;
}

function emit(context: PlanContext, patch: RuntimePatch): void {
	context.plan.patches.push(patch);
	if (context.plan.patches.length > context.limits.maxPatchesPerCommit)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.patchLimitExceeded,
			`The patch count in one commit exceeds the limit (${context.limits.maxPatchesPerCommit}).`,
		);
}

/**
 * Host ids that a fiber contributes to its parent's host child list. A component is flattened, so
 * it contributes its children's ids.
 */
function topHostIds(fiber: Fiber, out: number[]): void {
	if (fiber.kind === "component") {
		for (const child of fiber.children) topHostIds(child, out);
		return;
	}
	out.push(fiber.hostId);
}

/**
 * Host ids that a reused previous fiber contributes to the parent's list, after removals.
 *
 * If a reused component's old child is removed in this commit, that component's plan emits
 * `remove`. So when the parent counts the list the renderer currently holds, removed ids must be
 * left out. Including them would assume ordering operations on nodes that are already gone.
 */
function survivingHostIds(
	fiber: Fiber,
	reused: ReadonlySet<Fiber>,
	out: number[],
): void {
	if (fiber.kind === "component") {
		for (const child of fiber.children)
			if (reused.has(child)) survivingHostIds(child, reused, out);
		return;
	}
	out.push(fiber.hostId);
}

/** Subtree being removed. Collects instances and handler numbers. The parent emits the patches. */
function collectUnmount(fiber: Fiber, context: PlanContext): void {
	if (fiber.kind === "component") {
		context.plan.unmounted.push(fiber.instance);
	} else if (fiber.kind === "host") {
		for (const name of Object.keys(fiber.handlerIds))
			context.plan.released.push(fiber.handlerIds[name] as number);
	}
	if (fiber.kind !== "text")
		for (const child of fiber.children) collectUnmount(child, context);
}

function planHostProps(
	fiber: HostFiber,
	previous: HostFiber | null,
	context: PlanContext,
): void {
	const id = fiber.hostId;
	const prevValues = previous === null ? {} : previous.values;
	for (const name of Object.keys(fiber.values)) {
		const value = fiber.values[name] as HostValue;
		if (
			previous !== null &&
			Object.hasOwn(prevValues, name) &&
			equalHostValue(prevValues[name] as HostValue, value)
		)
			continue;
		emit(context, { op: "set-prop", id, name, value });
	}
	if (previous !== null)
		for (const name of Object.keys(prevValues))
			if (!Object.hasOwn(fiber.values, name))
				emit(context, { op: "remove-prop", id, name });

	const prevHandlers = previous === null ? {} : previous.handlers;
	const prevIds = previous === null ? {} : previous.handlerIds;
	for (const name of Object.keys(fiber.handlers)) {
		const fn = fiber.handlers[name] as Handler;
		const previousId = Object.hasOwn(prevIds, name)
			? (prevIds[name] as number)
			: null;
		if (previousId !== null && prevHandlers[name] === fn) {
			fiber.handlerIds[name] = previousId;
			continue;
		}
		const handlerId = context.registry.acquire(fn);
		context.plan.acquired.push(handlerId);
		fiber.handlerIds[name] = handlerId;
		if (previousId !== null) context.plan.released.push(previousId);
		emit(context, { op: "set-prop", id, name, value: { $handler: handlerId } });
	}
	if (previous !== null)
		for (const name of Object.keys(prevIds))
			if (!Object.hasOwn(fiber.handlers, name)) {
				context.plan.released.push(prevIds[name] as number);
				emit(context, { op: "remove-prop", id, name });
			}
}

/**
 * Aligns the host child order of one parent, using only operations the renderer can apply in
 * sequence.
 *
 * `current` is the list the renderer holds at this point, since removals have already been emitted.
 * For each slot: if the node there is not the right one, a new node is `insert`ed, or an existing
 * node is `move`d into place. `current` is updated the same way, so each later operation can assume
 * the earlier ones.
 */
function planChildOrder(
	parent: number,
	current: number[],
	next: readonly number[],
	context: PlanContext,
): void {
	const present = new Set(current);
	for (let index = 0; index < next.length; index += 1) {
		const child = next[index] as number;
		if (current[index] === child) continue;
		if (!present.has(child)) {
			emit(context, { op: "insert", parent, child, index });
			current.splice(index, 0, child);
			present.add(child);
			continue;
		}
		const at = current.indexOf(child);
		current.splice(at, 1);
		current.splice(index, 0, child);
		emit(context, { op: "move", parent, child, index });
	}
}

/** Plans one child list in this order: removals, then each child's subtree, then the order. */
function planChildren(
	parent: number,
	prevChildren: readonly Fiber[],
	children: readonly Fiber[],
	context: PlanContext,
): number[] {
	const current: number[] = [];
	for (const fiber of prevChildren) {
		if (context.reused.has(fiber)) {
			survivingHostIds(fiber, context.reused, current);
			continue;
		}
		const removed: number[] = [];
		topHostIds(fiber, removed);
		for (const id of removed) emit(context, { op: "remove", id });
		collectUnmount(fiber, context);
	}
	const next: number[] = [];
	for (const fiber of children) {
		planFiber(fiber, context);
		topHostIds(fiber, next);
	}
	planChildOrder(parent, current, next, context);
	return next;
}

function planFiber(fiber: Fiber, context: PlanContext): void {
	if (fiber.kind === "text") {
		if (fiber.prev === null) {
			emit(context, { op: "create", id: fiber.hostId, kind: "#text" });
			emit(context, { op: "set-text", id: fiber.hostId, value: fiber.text });
		} else if (fiber.prev.text !== fiber.text)
			emit(context, { op: "set-text", id: fiber.hostId, value: fiber.text });
		return;
	}
	if (fiber.kind === "host") {
		if (fiber.prev === null)
			emit(context, { op: "create", id: fiber.hostId, kind: fiber.hostKind });
		planHostProps(fiber, fiber.prev, context);
		planChildren(
			fiber.hostId,
			fiber.prev === null ? [] : fiber.prev.children,
			fiber.children,
			context,
		);
		return;
	}
	context.plan.instances.push(fiber.instance);
	/**
	 * A component does not align its own child order against a host node. The nearest host ancestor
	 * aligns the order using its flattened list. This function plans only each child's subtree.
	 *
	 * Removal of old children that disappear is emitted by that host ancestor, since planChildren
	 * flattens with topHostIds. Unmount collection must happen here, because the host ancestor does
	 * not know the previous component's child list.
	 */
	const prevChildren = fiber.prev === null ? [] : fiber.prev.children;
	for (const previous of prevChildren)
		if (!context.reused.has(previous)) {
			const removed: number[] = [];
			topHostIds(previous, removed);
			for (const id of removed) emit(context, { op: "remove", id });
			collectUnmount(previous, context);
		}
	for (const child of fiber.children) planFiber(child, context);
}

/**
 * Builds the commit plan for the next tree. It applies nothing. The only exception is taking
 * numbers from the registry. Those numbers are written into the plan and released on rejection.
 */
export function planCommit(
	prev: RootFiber | null,
	next: RootFiber,
	reused: ReadonlySet<Fiber>,
	registry: HandlerRegistry,
	limits: ReconcilerLimits,
	hostNodes: number,
): CommitPlan {
	const plan: CommitPlan = {
		patches: [],
		acquired: [],
		released: [],
		instances: [],
		unmounted: [],
		hostNodes,
	};
	const context: PlanContext = { registry, limits, reused, plan };
	const prevChildren = prev === null ? [] : prev.children;
	try {
		/** The root is also a host parent, so child order and removals follow the same rules. */
		planChildren(ROOT_HOST_ID, prevChildren, next.children, context);
	} catch (error) {
		/**
		 * If planning throws midway (for example at the patch limit), release the numbers obtained so
		 * far. Planning must have no side effects.
		 */
		abandonCommit(plan, registry);
		throw error;
	}
	return plan;
}

export interface CommitApplied {
	readonly effects: EffectWork[];
	readonly cleanups: CleanupWork[];
}

/** The host accepted the batch. Instances, handler numbers and unmounts are now final. */
export function applyCommit(
	plan: CommitPlan,
	next: RootFiber,
	registry: HandlerRegistry,
): CommitApplied {
	const cleanups: CleanupWork[] = [];
	const effects: EffectWork[] = [];
	for (const instance of plan.unmounted)
		for (const work of unmountInstance(instance)) cleanups.push(work);
	for (const id of plan.released) registry.release(id);
	for (const instance of plan.instances)
		for (const work of commitInstance(instance)) effects.push(work);
	forgetPrevious(next);
	return { effects, cleanups };
}

/**
 * The host rejected the batch. Release the numbers obtained. The tree and instances are unchanged.
 */
export function abandonCommit(
	plan: CommitPlan,
	registry: HandlerRegistry,
): void {
	for (const id of plan.acquired) registry.release(id);
}

/**
 * A committed tree does not hold the previous tree. If it did, trees would accumulate with every
 * commit.
 */
function forgetPrevious(root: RootFiber): void {
	root.prev = null;
	const stack: Fiber[] = [...root.children];
	while (stack.length > 0) {
		const fiber = stack.pop() as Fiber;
		fiber.prev = null;
		if (fiber.kind !== "text")
			for (const child of fiber.children) stack.push(child);
	}
}

/** Plans unmounting the whole tree. Root disposal uses it. */
export function planUnmountAll(
	root: RootFiber,
	registry: HandlerRegistry,
	limits: ReconcilerLimits,
): CommitPlan {
	const plan: CommitPlan = {
		patches: [],
		acquired: [],
		released: [],
		instances: [],
		unmounted: [],
		hostNodes: 0,
	};
	const context: PlanContext = { registry, limits, reused: new Set(), plan };
	for (const fiber of root.children) {
		const removed: number[] = [];
		topHostIds(fiber, removed);
		for (const id of removed) emit(context, { op: "remove", id });
		collectUnmount(fiber, context);
	}
	return plan;
}
