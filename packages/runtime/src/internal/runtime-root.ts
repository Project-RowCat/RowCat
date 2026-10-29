import { isRuntimeHostComponent } from "../component.ts";
import { jsx } from "../jsx-runtime.ts";
import type { RuntimeNode } from "../node.ts";
import {
	type RuntimeControlKind,
	type RuntimeControlRef,
	type RuntimeHostCommand,
	setRuntimeCommandSink,
} from "./control.ts";
import {
	RUNTIME_ERROR_CODE,
	RUNTIME_ERROR_KIND,
	RuntimeError,
	type RuntimeErrorCode,
} from "./errors.ts";
import { HandlerRegistry } from "./handlers.ts";
import {
	type CleanupWork,
	type ComponentInstance,
	discardRender,
	type EffectWork,
	type InstanceRootBinding,
	releaseInstance,
} from "./hooks-runtime.ts";
import { type RuntimeHostPort, runtimeHostPort } from "./host-port.ts";
import {
	commitPersistentState,
	pendingPersistentStateDelta,
	persistentStateMetrics,
} from "./persistent-state.ts";
import { withRuntimePhase } from "./phase.ts";
import {
	abandonCommit,
	applyCommit,
	type Fiber,
	planCommit,
	planUnmountAll,
	type ReconcilerLimits,
	type RenderContext,
	type RootFiber,
	type RuntimePatch,
	renderTree,
} from "./reconciler.ts";
import {
	commitStoryState,
	pendingStoryStateDelta,
	storyStateMetrics,
} from "./story-state.ts";

/**
 * The runtime root: one active creator tree per session, and its lifecycle.
 *
 * - mountRoot renders App and emits the first commit. setState and dispatch queue an update and
 *   request one 'render' work item from the host.
 * - flushRender folds the queue and emits one commit batch if anything changed. A commit with
 *   effects requests one 'effects' work item. flushEffects runs cleanups, then effects.
 * - dispatchEvent calls a registry handler. A stale handler number is reported as stale, not as a
 *   failure.
 * - Control commands are queued and go out only after the commit they belong to. They request a
 *   'commands' work item only when no render is scheduled.
 * - unmountRoot runs cleanups, empties the registry, and emits one batch that removes every node.
 *
 * Commands never precede their commit. The usual shape is setMessages(...) followed by
 * scrollToEnd(). If the command reached the renderer first, the screen would stop before the list
 * grew. A pending render drains the queue after its commit. A dependency-less useEffect that
 * scrolls would re-trigger its own render, so commands issued during effects run after the commit,
 * with nothing to wait for.
 *
 * Scheduling is the host's job. This file has no timers or microtasks. Updates within one scheduler
 * task fold into one render. A continuation after await is another work item with its own render.
 * Effects never run recursively inside a commit. Infinite loops are cut by the host's budget.
 *
 * Commits are atomic. If render throws, or the host rejects the batch, the previous tree stays
 * authoritative and nothing changes.
 *
 * State stays in this realm. Only serialized batches, work requests and diagnostics go out. Only
 * handler numbers and wire values come in. The heap is not the storage format.
 */

export interface RuntimeRootLimits extends ReconcilerLimits {
	/**
	 * Maximum number of control commands emitted per settle.
	 *
	 * This API is for occasional intent, such as 'to the latest message' or 'focus the reply box'. The
	 * limit pins down that it is not a per-frame scroll channel. Exceeding it rejects the run.
	 */
	readonly maxCommandsPerFlush: number;
}

/**
 * Not an operating value. The host can change it through the options of mountRoot. That a limit
 * exists is part of the design.
 */
export const DEFAULT_ROOT_LIMITS: RuntimeRootLimits = Object.freeze({
	maxTreeDepth: 64,
	maxHostNodes: 5_000,
	maxPatchesPerCommit: 50_000,
	maxCommandsPerFlush: 64,
});

export interface RuntimeRootMetrics {
	componentRenders: number;
	storyDefinitions: number;
	storyStateReads: number;
	storyStateUpdates: number;
	storyStateCommits: number;
	storyStateEntriesCommitted: number;
	storyStateMigrations: number;
	storyStateMigrationFailures: number;
	storyStateCommitsRejected: number;
	persistentDefinitions: number;
	persistentStateReads: number;
	persistentStateUpdates: number;
	persistentStateCommits: number;
	persistentStateEntriesCommitted: number;
	persistentStateMigrations: number;
	persistentStateMigrationFailures: number;
	persistentStateCommitsRejected: number;
	commits: number;
	patchesEmitted: number;
	hostNodes: number;
	componentInstances: number;
	liveHandlers: number;
	effectRuns: number;
	effectCleanups: number;
	commandsQueued: number;
	commandsEmitted: number;
	/** Commands dropped because their controller is not attached. A warning goes out with them. */
	commandsDropped: number;
	renderFailures: number;
	effectFailures: number;
	revision: number;
}

export interface RuntimePatchBatch {
	readonly revision: number;
	readonly patches: readonly RuntimePatch[];
}

/**
 * A diagnostic sent to the host. The message is written for the creator; the code is the primary
 * key.
 */
export interface RuntimeRootDiagnostic {
	readonly code: RuntimeErrorCode;
	readonly kind: "creator" | "warning" | "limit";
	readonly message: string;
	readonly component: string | null;
}

export type RuntimeRootWork = "render" | "effects" | "commands";

/**
 * A batch of control commands. It carries the revision of the tree it targets.
 *
 * The renderer compares that value with its own revision. If delivery is out of order (a race in
 * the bridge or worker), the mismatch shows up there. Otherwise commands would silently control the
 * wrong node.
 */
export interface RuntimeCommandBatch {
	readonly revision: number;
	readonly commands: readonly RuntimeHostCommand[];
}

export type RuntimeEventResult =
	| { readonly handled: true }
	| {
			readonly handled: false;
			readonly reason: "stale" | "no-root" | "disposed";
	  };

const stringify = JSON.stringify;
const parse = JSON.parse;

type EffectQueueEntry =
	| { readonly kind: "cleanup"; readonly work: CleanupWork }
	| { readonly kind: "effect"; readonly work: EffectWork };

/**
 * Host node id. Monotonic within the session, and it does not reset when the root changes.
 *
 * Disposing and remounting the root does not reuse old numbers. The renderer may still hold the old
 * tree until the removal batch arrives. If an id pointed to a different node in that window, the
 * wrong node would be patched.
 */
let nextHostId = 1;

export class RuntimeRoot {
	private readonly port: RuntimeHostPort;
	private readonly limits: RuntimeRootLimits;
	private readonly handlers = new HandlerRegistry();
	private committed: RootFiber | null = null;
	private app: ((props: never) => RuntimeNode) | null = null;
	private hostNodes = 0;
	private revision = 0;
	private renderRequested = false;
	private effectsRequested = false;
	private commandsRequested = false;
	private closed = false;
	private readonly effectQueue: EffectQueueEntry[] = [];
	/** Control commands not yet sent, in order. For the same target, the later command wins. */
	private readonly commandQueue: RuntimeHostCommand[] = [];
	/**
	 * Controllers attached to the committed tree. The table collected during render arrives here at
	 * commit. Commands for controllers outside this table are not sent.
	 *
	 * The verdict is made inside the VM because this is the only place where a reason can be returned
	 * to the creator. Commands get no reply, so a command the renderer discards is not read anywhere.
	 */
	private controls: ReadonlyMap<number, RuntimeControlKind> = new Map();
	private readonly counters = {
		componentRenders: 0,
		commits: 0,
		patchesEmitted: 0,
		effectRuns: 0,
		effectCleanups: 0,
		commandsQueued: 0,
		commandsEmitted: 0,
		commandsDropped: 0,
		renderFailures: 0,
		effectFailures: 0,
		storyStateCommitsRejected: 0,
		persistentStateCommitsRejected: 0,
	};
	private readonly binding: InstanceRootBinding;

	constructor(port: RuntimeHostPort, limits: Partial<RuntimeRootLimits> = {}) {
		this.port = port;
		this.limits = Object.freeze({ ...DEFAULT_ROOT_LIMITS, ...limits });
		this.binding = {
			requestRender: () => this.requestRender(),
			warn: (code, message, component) =>
				this.diagnose(code, message, component),
		};
		/**
		 * Fills the other side of the channel here. There is one active root per session, so a later root
		 * takes this slot. Disposal clears the slot only while it still holds this root.
		 *
		 * Otherwise an old root that dies late would remove the new root's channel.
		 */
		setRuntimeCommandSink(this);
	}

	/**
	 * Queues one command. This implements `RuntimeCommandSink`.
	 *
	 * Three checks run in order:
	 * - Is the controller attached? If not, the command is dropped with a warning. Controllers on
	 *   conditionally drawn inputs are often legitimately not attached.
	 * - Is it within the per-settle limit? If not, the run is rejected.
	 * - Is a render scheduled? If so, that render drains the queue, so no separate work item is
	 *   requested.
	 */
	enqueue(control: RuntimeControlRef, command: RuntimeHostCommand): void {
		if (this.closed) return;
		if (this.controls.get(control.id) !== control.kind) {
			this.counters.commandsDropped += 1;
			this.diagnose(
				RUNTIME_ERROR_CODE.hostControlUnbound,
				"The controller is not attached to any node on the current screen, so the command was not sent.",
				null,
			);
			return;
		}
		if (this.commandQueue.length >= this.limits.maxCommandsPerFlush)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.hostCommandLimitExceeded,
				`The control commands sent at once exceed the limit (${this.limits.maxCommandsPerFlush}).`,
			);
		this.commandQueue.push(command);
		this.counters.commandsQueued += 1;
		/**
		 * If a render is scheduled, nothing is requested. The queue empties after that render's commit,
		 * so the scrollToEnd() on the line after setState sees the end of the grown list.
		 */
		if (this.renderRequested) return;
		this.requestCommands();
	}

	/**
	 * Emits the queue at the given revision. The queue is cleared only after a successful emit. A
	 * rejected batch is retried on the next settle.
	 */
	private emitCommands(revision: number): void {
		if (this.commandQueue.length === 0) return;
		const batch: RuntimeCommandBatch = {
			revision,
			commands: [...this.commandQueue],
		};
		const decision = this.port.emit("commands", stringify(batch));
		if (!decision.ok) {
			/**
			 * A command is intent, not screen state. A rejection gives no reason to roll the tree back.
			 * Leaving the queue intact means the next settle sends the same intent again.
			 */
			this.diagnose(
				RUNTIME_ERROR_CODE.commitRejected,
				`The host did not accept the control command bundle: ${decision.message}`,
				null,
			);
			return;
		}
		this.counters.commandsEmitted += this.commandQueue.length;
		this.commandQueue.length = 0;
	}

	/**
	 * The host's 'commands' work item. Yields if a render is scheduled.
	 *
	 * That one yield is what takes this slice out of the scheduler's ordering. Whichever ran first, a
	 * command request or a setState from another run, draining the queue is always the later settle.
	 */
	flushCommands(): { emitted: number } {
		this.commandsRequested = false;
		if (this.closed || this.renderRequested) return { emitted: 0 };
		const pending = this.commandQueue.length;
		this.emitCommands(this.revision);
		return { emitted: pending - this.commandQueue.length };
	}

	private diagnose(
		code: RuntimeErrorCode,
		message: string,
		component: string | null,
	): void {
		const diagnostic: RuntimeRootDiagnostic = {
			code,
			kind: RUNTIME_ERROR_KIND[code],
			message,
			component,
		};
		/** Diagnostics are best effort. If the port rejects them, execution has no reason to stop. */
		try {
			this.port.emit("diagnostic", stringify(diagnostic));
		} catch {
			/* No port, or the port threw. Diagnostics may be lost. */
		}
	}

	private request(work: RuntimeRootWork): void {
		const decision = this.port.emit("schedule", stringify({ work }));
		if (!decision.ok)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.commitRejected,
				`The host did not accept the ${work} work request: ${decision.message}`,
			);
	}

	private requestRender(): void {
		if (this.closed || this.renderRequested) return;
		this.renderRequested = true;
		this.request("render");
	}

	private requestEffects(): void {
		if (this.closed || this.effectsRequested) return;
		this.effectsRequested = true;
		this.request("effects");
	}

	private requestCommands(): void {
		if (this.closed || this.commandsRequested) return;
		this.commandsRequested = true;
		this.request("commands");
	}

	private assertAlive(): void {
		if (this.closed)
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.rootDisposed,
				"This root has been disposed.",
			);
	}

	/**
	 * One render: build the tree, plan, ask the host, and apply if accepted.
	 *
	 * If there are no patches, no batch is sent and the revision does not advance. The commit still
	 * counts as successful, so effects run. A dependency-less useEffect must run on every render, and
	 * whether this render changed the screen does not affect that.
	 */
	private performRender(): { rendered: true; revision: number } {
		const app = this.app as (props: never) => RuntimeNode;
		const context: RenderContext = {
			limits: this.limits,
			nextHostId: () => nextHostId++,
			binding: this.binding,
			warn: (code, message, component) =>
				this.diagnose(code, message, component),
			rendered: [],
			reused: new Set<Fiber>(),
			hostNodes: 0,
			stack: [],
			componentRenders: 0,
			controls: new Map<number, RuntimeControlKind>(),
		};
		let next: RootFiber;
		try {
			next = renderTree(this.committed, jsx(app, {}), context);
		} catch (error) {
			this.counters.renderFailures += 1;
			this.counters.componentRenders += context.componentRenders;
			for (const instance of context.rendered) discardRender(instance);
			throw error;
		}
		this.counters.componentRenders += context.componentRenders;

		const plan = withRuntimePhase("commit", () => {
			try {
				return planCommit(
					this.committed,
					next,
					context.reused,
					this.handlers,
					this.limits,
					context.hostNodes,
				);
			} catch (error) {
				for (const instance of context.rendered) discardRender(instance);
				throw error;
			}
		});

		/**
		 * Story state deltas are peeked, not consumed. If the host does not accept the UI batch, this
		 * render is treated as if it never happened. The pending values remain, so the next render reads
		 * the same values (the atomicity rule in the header).
		 */
		const storyDelta = pendingStoryStateDelta();
		const persistentDelta = pendingPersistentStateDelta();

		if (plan.patches.length > 0) {
			const batch: RuntimePatchBatch = {
				revision: this.revision + 1,
				patches: plan.patches,
			};
			const decision = this.port.emit("commit", stringify(batch));
			if (!decision.ok) {
				abandonCommit(plan, this.handlers);
				for (const instance of context.rendered) discardRender(instance);
				this.counters.renderFailures += 1;
				throw new RuntimeError(
					RUNTIME_ERROR_CODE.commitRejected,
					`The host did not accept the commit bundle: ${decision.message}`,
				);
			}
			this.revision = batch.revision;
			this.counters.patchesEmitted += plan.patches.length;
		}

		/**
		 * Story state goes out after the UI. This ordering is the design in spec section 39: if the patch
		 * is rejected, the story state does not advance either. In the reverse order, the rejected
		 * render's values would already sit in the host snapshot.
		 *
		 * A rejection on this channel is a host bug, since the VM validates the same rules first
		 * (serializability, item limits). So the commit is not rolled back here, because the UI has
		 * already gone out. The pending value is kept and a diagnostic is raised, so the next update
		 * re-sends the same delta.
		 */
		let storyCommitted = storyDelta.length === 0;
		if (storyDelta.length > 0) {
			const decision = this.port.emit(
				"story-state",
				stringify({ formatVersion: 1, entries: storyDelta }),
			);
			if (decision.ok) storyCommitted = true;
			else {
				this.counters.storyStateCommitsRejected += 1;
				this.diagnose(
					RUNTIME_ERROR_CODE.commitRejected,
					`The host did not accept the story state bundle: ${decision.message}`,
					null,
				);
			}
		}

		/**
		 * Persistent state uses the same order as playthrough state, on a different channel.
		 *
		 * Folding both into one channel and putting the lifetime in the payload would make the host
		 * choose the storage location from that field. A wrong judgment there would erase months of
		 * progress on a playthrough reset. The channel name makes that judgment instead.
		 */
		let persistentCommitted = persistentDelta.length === 0;
		if (persistentDelta.length > 0) {
			const decision = this.port.emit(
				"persistent-state",
				stringify({ formatVersion: 1, entries: persistentDelta }),
			);
			if (decision.ok) persistentCommitted = true;
			else {
				this.counters.persistentStateCommitsRejected += 1;
				this.diagnose(
					RUNTIME_ERROR_CODE.commitRejected,
					`The host did not accept the persistent state bundle: ${decision.message}`,
					null,
				);
			}
		}

		const applied = withRuntimePhase("commit", () =>
			applyCommit(plan, next, this.handlers),
		);
		if (storyCommitted) commitStoryState();
		if (persistentCommitted) commitPersistentState();
		this.committed = next;
		/**
		 * The authorization table belongs to the committed tree. If render throws or the host does not
		 * accept the batch, this line is never reached, and the previous table remains authoritative.
		 *
		 * This is where a controller's lifetime matches the screen's lifetime exactly.
		 */
		this.controls = context.controls;
		this.hostNodes = plan.hostNodes;
		this.counters.commits += 1;
		/**
		 * Commands go out after the commit. This order is the whole promise of spec section 12. The
		 * patches for the just-grown list have already reached the host, so the end that scrollToEnd()
		 * sees is the end after growth.
		 */
		this.emitCommands(this.revision);
		for (const work of applied.cleanups)
			this.effectQueue.push({ kind: "cleanup", work });
		for (const work of applied.effects)
			this.effectQueue.push({ kind: "effect", work });
		if (this.effectQueue.length > 0) this.requestEffects();
		return { rendered: true, revision: this.revision };
	}

	/**
	 * Places the entry point and renders now. Giving a different App to an already-mounted root is an
	 * ordinary replacement.
	 */
	mount(app: unknown): { revision: number } {
		this.assertAlive();
		if (typeof app !== "function" || isRuntimeHostComponent(app))
			throw new RuntimeError(
				RUNTIME_ERROR_CODE.rootEntryInvalid,
				"The entry point's default export is not a component function.",
			);
		this.app = app as (props: never) => RuntimeNode;
		this.renderRequested = false;
		const result = this.performRender();
		return { revision: result.revision };
	}

	flushRender(): { rendered: boolean; revision: number } {
		if (this.closed || !this.renderRequested)
			return { rendered: false, revision: this.revision };
		this.renderRequested = false;
		if (this.app === null) return { rendered: false, revision: this.revision };
		return this.performRender();
	}

	private runCleanup(work: CleanupWork): void {
		const slot = work.instance.hooks[work.index];
		if (slot === undefined || slot.kind !== "effect" || slot.cleanup === null)
			return;
		const { cleanup } = slot;
		slot.cleanup = null;
		this.counters.effectCleanups += 1;
		try {
			withRuntimePhase("cleanup", () => cleanup());
		} catch (error) {
			this.counters.effectFailures += 1;
			this.diagnose(
				RUNTIME_ERROR_CODE.effectFailed,
				`${work.instance.name}'s effect cleanup failed: ${describe(error)}`,
				work.instance.name,
			);
		}
	}

	private runEffect(work: EffectWork): void {
		const { instance } = work;
		if (instance.disposed) return;
		const slot = instance.hooks[work.index];
		if (slot === undefined || slot.kind !== "effect") return;
		this.runCleanup({ instance, index: work.index });
		this.counters.effectRuns += 1;
		let result: unknown;
		try {
			result = withRuntimePhase("effect", () => work.create());
		} catch (error) {
			this.counters.effectFailures += 1;
			this.diagnose(
				RUNTIME_ERROR_CODE.effectFailed,
				`${instance.name}'s effect failed: ${describe(error)}`,
				instance.name,
			);
			return;
		}
		if (typeof result === "function") {
			slot.cleanup = result as () => unknown;
			return;
		}
		if (
			typeof result === "object" &&
			result !== null &&
			typeof (result as { then?: unknown }).then === "function"
		)
			this.diagnose(
				RUNTIME_ERROR_CODE.effectReturnedPromise,
				`${instance.name}'s effect returned a promise. A promise is not a cleanup function; call the async function separately inside the effect.`,
				instance.name,
			);
	}

	flushEffects(): { cleanups: number; effects: number } {
		this.effectsRequested = false;
		let cleanups = 0;
		let effects = 0;
		if (this.closed) {
			this.effectQueue.length = 0;
			return { cleanups, effects };
		}
		/**
		 * Effects queued while this run executes (from a setState inside an effect) belong to a later
		 * run. Only the current list is spliced out. The rest waits for the next request.
		 *
		 * A render is a separate work item, so no commit can happen here. The rule is still stated
		 * explicitly.
		 */
		const queue = this.effectQueue.splice(0, this.effectQueue.length);
		for (const entry of queue) {
			if (entry.kind === "cleanup") {
				this.runCleanup(entry.work);
				cleanups += 1;
				if (
					!entry.work.instance.hooks.some(
						(slot) => slot.kind === "effect" && slot.cleanup !== null,
					)
				)
					releaseInstance(entry.work.instance);
			} else {
				this.runEffect(entry.work);
				effects += 1;
			}
		}
		if (this.effectQueue.length > 0) this.requestEffects();
		return { cleanups, effects };
	}

	dispatchEvent(
		handlerId: number,
		payload: unknown,
	): Promise<RuntimeEventResult> {
		if (this.closed)
			return Promise.resolve({ handled: false, reason: "disposed" });
		const handler = this.handlers.lookup(handlerId);
		if (handler === null)
			return Promise.resolve({ handled: false, reason: "stale" });
		/**
		 * The synchronous part is the `event` phase. The continuation after await is outside this
		 * function, so it runs in the `idle` phase, and a setState there gets its own render.
		 *
		 * The result is wrapped in a promise so that microtasks the handler leaves behind are drained
		 * within this run.
		 */
		let result: unknown;
		try {
			result = withRuntimePhase("event", () =>
				payload === null || payload === undefined
					? handler()
					: handler(payload),
			);
		} catch (error) {
			return Promise.reject(error);
		}
		return Promise.resolve(result).then(() => ({ handled: true }) as const);
	}

	/**
	 * Root disposal. Stops accepting events, runs cleanups now, empties the registry, and emits one
	 * batch that removes every node.
	 *
	 * The session itself is kept. VM disposal is a separate host operation.
	 */
	dispose(): { cleanups: number; revision: number } {
		if (this.closed) return { cleanups: 0, revision: this.revision };
		this.closed = true;
		let cleanups = 0;
		const tree = this.committed;
		this.committed = null;
		this.app = null;
		const pending = this.effectQueue.splice(0, this.effectQueue.length);
		/**
		 * Effects that have not run yet are skipped. There is no place to run them, and no commit will
		 * call their cleanups.
		 */
		for (const entry of pending)
			if (entry.kind === "cleanup") {
				this.runCleanup(entry.work);
				cleanups += 1;
			}
		if (tree !== null) {
			const plan = planUnmountAll(tree, this.handlers, this.limits);
			const instances: ComponentInstance[] = plan.unmounted;
			const applied = applyCommit(plan, tree, this.handlers);
			for (const work of applied.cleanups) {
				this.runCleanup(work);
				cleanups += 1;
			}
			for (const instance of instances) releaseInstance(instance);
			if (plan.patches.length > 0) {
				const batch: RuntimePatchBatch = {
					revision: this.revision + 1,
					patches: plan.patches,
				};
				const decision = this.port.emit("commit", stringify(batch));
				if (decision.ok) {
					this.revision = batch.revision;
					this.counters.patchesEmitted += plan.patches.length;
					this.counters.commits += 1;
				}
			}
		}
		this.handlers.clear();
		this.hostNodes = 0;
		/**
		 * Controller authorization and unsent commands disappear with the tree. The channel is cleared
		 * only while this root still occupies it.
		 *
		 * If an old root dying late removed the new session's slot, every command of that session would
		 * vanish silently.
		 */
		this.controls = new Map();
		this.commandQueue.length = 0;
		const previous = setRuntimeCommandSink(null);
		if (previous !== null && previous !== this) setRuntimeCommandSink(previous);
		return { cleanups, revision: this.revision };
	}

	/**
	 * Whether this root was disposed. The module-level API uses it to decide whether to create a new
	 * root.
	 */
	get disposed(): boolean {
		return this.closed;
	}

	metrics(): RuntimeRootMetrics {
		return {
			...this.counters,
			...storyStateMetrics(),
			...persistentStateMetrics(),
			componentInstances: countInstances(this.committed),
			hostNodes: this.hostNodes,
			liveHandlers: this.handlers.size,
			revision: this.revision,
		};
	}
}

function countInstances(root: RootFiber | null): number {
	if (root === null) return 0;
	let count = 0;
	const stack: Fiber[] = [...root.children];
	while (stack.length > 0) {
		const fiber = stack.pop() as Fiber;
		if (fiber.kind === "component") count += 1;
		if (fiber.kind !== "text")
			for (const child of fiber.children) stack.push(child);
	}
	return count;
}

const describe = (error: unknown): string =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error);

let active: RuntimeRoot | null = null;

/**
 * Places the entry point's default export and emits the first commit. The options are a JSON string
 * (limits).
 *
 * If a root already exists, the new App is given to the same root. A different kind means the old
 * tree is unmounted and the new one mounted, which is an ordinary replacement. If the root was
 * disposed, a new root is created.
 */
export function mountRoot(
	app: unknown,
	options?: unknown,
): { revision: number } {
	if (active === null || active.disposed) {
		const limits =
			typeof options === "string" && options.length > 0
				? (parse(options) as Partial<RuntimeRootLimits>)
				: typeof options === "object" && options !== null
					? (options as Partial<RuntimeRootLimits>)
					: {};
		active = new RuntimeRoot(runtimeHostPort(), limits);
	}
	return active.mount(app);
}

export function flushRender(): { rendered: boolean; revision: number } {
	if (active === null) return { rendered: false, revision: 0 };
	return active.flushRender();
}

export function flushEffects(): { cleanups: number; effects: number } {
	if (active === null) return { cleanups: 0, effects: 0 };
	return active.flushEffects();
}

export function flushCommands(): { emitted: number } {
	if (active === null) return { emitted: 0 };
	return active.flushCommands();
}

export function dispatchEvent(
	handlerId: unknown,
	payload: unknown,
): Promise<RuntimeEventResult> {
	if (active === null || typeof handlerId !== "number")
		return Promise.resolve({ handled: false, reason: "no-root" });
	return active.dispatchEvent(handlerId, payload);
}

export function unmountRoot(): { cleanups: number; revision: number } {
	if (active === null) return { cleanups: 0, revision: 0 };
	const result = active.dispose();
	active = null;
	return result;
}

export function rootMetrics(): RuntimeRootMetrics | null {
	return active === null ? null : active.metrics();
}

/** Test only: whether an active root exists. */
export function hasActiveRoot(): boolean {
	return active !== null;
}
