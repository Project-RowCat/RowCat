import {
	EMPTY_REMOTE_ASSET_ALLOWLIST,
	type RuntimeRemoteAssetAllowlist,
} from "@rowcat/runtime/asset";
import { isRuntimeBuiltinSpecifier } from "@rowcat/runtime/declarations";
import { runtimeBuiltinId } from "@rowcat/runtime-compiler/module-resolution";
import { validateRuntimeArtifact } from "./artifact.ts";
import {
	CURRENT_RUNTIME_SANDBOX,
	checkSandboxCompatibility,
	planRuntimeBootstrap,
	type RuntimeSandboxBuild,
} from "./bootstrap.ts";
import {
	DISPATCHER_BUILTIN_ID,
	DURABLE_STATE_BUILTIN_ID,
	RUNTIME_ROOT_BUILTIN_ID,
	type RuntimeBuiltinModule,
} from "./builtins/modules.ts";
import {
	DEFAULT_SESSION_LIMITS,
	type RuntimeCapabilityRegistry,
	type RuntimeConsoleLevel,
	type RuntimeConsoleSink,
	type RuntimeEventSource,
	type RuntimeHostCallOrigin,
	type RuntimeSessionLimits,
} from "./capabilities.ts";
import { type RuntimeCommandBatch, validateCommandBatch } from "./commands.ts";
import {
	CreatorExecutionError,
	isRuntimeHostErrorCode,
	parseCreatorStack,
	RUNTIME_HOST_ERROR_CODE,
	type RuntimeExecutionError,
	RuntimeHostError,
} from "./errors.ts";
import {
	createGenerationCapability,
	type RuntimeGenerationCapability,
	type RuntimeGenerationMetrics,
	type RuntimeGenerationOptions,
} from "./generation.ts";
import { createCallIdAllocator } from "./ids.ts";
import { type RuntimeSessionState, transition } from "./lifecycle.ts";
import {
	DEFAULT_ROOT_LIMITS,
	RuntimeHostNodeLedger,
	type RuntimePatchBatch,
	type RuntimeRootLimits,
	validatePatchBatch,
} from "./patches.ts";
import {
	DEFAULT_PERSISTENT_STATE_LIMITS,
	emptyPersistentStateSnapshot,
	type RuntimePersistentStateEntry,
	type RuntimePersistentStateLimits,
	type RuntimePersistentStateSnapshot,
	RuntimePersistentStateStore,
	validatePersistentStateSnapshot,
} from "./persistent-state.ts";
import {
	ExecutionAccount,
	type RuntimeBudgetPolicy,
} from "./scheduler/budget.ts";
import type { RuntimeHostSchedulerClock } from "./scheduler/clock.ts";
import { failureSeverity } from "./scheduler/failures.ts";
import type { RuntimeWorkPriority } from "./scheduler/priority.ts";
import {
	RuntimeScheduler,
	type RuntimeSchedulerMetrics,
	type RuntimeSchedulerObserver,
	type RuntimeTurnOutcome,
} from "./scheduler/scheduler.ts";
import {
	DEFAULT_STORY_STATE_LIMITS,
	emptyStoryStateSnapshot,
	isStoryStateKey,
	isStoryStateVersion,
	type RuntimeStoryStateEntry,
	type RuntimeStoryStateLimits,
	type RuntimeStoryStateSnapshot,
	RuntimeStoryStateStore,
	validateStoryStateSnapshot,
} from "./story-state.ts";
import type {
	RuntimeVmCallResult,
	RuntimeVmEmitDecision,
	RuntimeVmEngine,
	RuntimeVmFailure,
	RuntimeVmHostCallDecision,
	RuntimeVmInstance,
	RuntimeVmOutcome,
	RuntimeVmPromiseRef,
	RuntimeVmSlice,
} from "./vm/types.ts";
import {
	DEFAULT_WIRE_LIMITS,
	decodeWireValue,
	encodeWireValue,
	type RuntimeWireLimits,
	type RuntimeWireValue,
} from "./wire.ts";

/**
 * Session: everything about one artifact while it lives in an isolated VM.
 *
 * - Lifecycle: createRuntimeVmSession validates, creates the VM, installs the prelude and
 *   built-ins, then evaluates the author module graph (entry first). callExport serializes the
 *   arguments, runs VM turns, and loops through host calls until the result is ready. dispose
 *   cancels, aborts pending host calls, waits for the running turn to unwind, and releases the VM.
 * - Turns chain through the queue, never through the native stack. A host call made in a slice is
 *   only accepted, and its handler starts after the slice ends.
 * - Budgets count only VM time. Waiting for host handlers is not charged to the author.
 * - One VM turn runs at a time per session. Interleaving concurrent calls per turn is the
 *   question Phase 4's scheduler answers.
 * - After a fatal failure (budget, memory, or engine error) the VM may hold broken invariants.
 *   The session becomes `failed`, and only dispose is allowed.
 * - Root (Phase 4B): the lifetime of one author tree. Render and effects are scheduled as
 *   executions. Commit batches go to onCommit synchronously within the turn. Command batches go to
 *   onCommands after the commit. Author components and hook state never enter this realm. Commits
 *   are batched per commit, not per operation, so the bridge cost is paid once per interaction.
 */

export interface RuntimeVmSessionOptions {
	engine: RuntimeVmEngine;
	/** Unvalidated input. It is not trusted regardless of where it came from. */
	artifact: unknown;
	capabilities?: RuntimeCapabilityRegistry;
	/**
	 * Generation capability. If present, `generation.generate` is added to the capability table. If
	 * absent, the capability does not exist. Absence is the default (§36): creating a session must not
	 * create billable state. Enabling it is decided by the surface, such as the preview toggle or
	 * playthrough authorization.
	 */
	generation?: RuntimeGenerationOptions;
	/** Sandbox modules installed on top of the generated runtime (PoC bridge, test dispatcher). */
	builtins?: readonly RuntimeBuiltinModule[];
	/**
	 * Runtime build to install. Defaults to the build this code carries. Pass another value only to
	 * simulate a mismatched build in tests. Production has no second runtime.
	 */
	sandbox?: RuntimeSandboxBuild;
	limits?: Partial<RuntimeSessionLimits>;
	wireLimits?: Partial<RuntimeWireLimits>;
	onConsole?: RuntimeConsoleSink;
	sessionId?: string;
	/**
	 * Scheduler clock, policy, and observer. Platform adapters plug in their own yielding method here.
	 */
	scheduling?: RuntimeSessionSchedulingOptions;
	/**
	 * Playthrough snapshot to resume. Unvalidated. Without it, every stored value starts at the
	 * definition's `initial`. It is hydrated before the first render, so no frame shows `initial`
	 * while a saved value exists.
	 */
	storyState?: unknown;
	storyStateLimits?: Partial<RuntimeStoryStateLimits>;
	/**
	 * Called when a commit changes story state. The full canonical snapshot is passed. The save
	 * coordinator subscribes here.
	 */
	onStoryStateCommit?: (snapshot: RuntimeStoryStateSnapshot) => void;
	/**
	 * Persistent snapshot to resume: the member's long-term progress for the work. It is a separate
	 * argument from the playthrough snapshot on purpose. Merging them would force the save coordinator
	 * to split them again, and a wrong split would let a playthrough reset erase months of progress.
	 */
	persistentState?: unknown;
	persistentStateLimits?: Partial<RuntimePersistentStateLimits>;
	/** Called when a commit changes persistent state. The full canonical snapshot is passed. */
	onPersistentStateCommit?: (snapshot: RuntimePersistentStateSnapshot) => void;
}

export interface RuntimeSessionSchedulingOptions {
	clock?: RuntimeHostSchedulerClock;
	/**
	 * executionMs and maxJobsPerTurn are set by `limits`. Values given here for them are overridden.
	 */
	policy?: Partial<Omit<RuntimeBudgetPolicy, "executionMs" | "maxJobsPerTurn">>;
	observer?: RuntimeSchedulerObserver;
}

export type RuntimeCallOutcome =
	| { ok: true; value: RuntimeWireValue }
	| { ok: false; error: RuntimeExecutionError };

/**
 * One diagnostic from the root. It has the same shape as RuntimeRootDiagnostic inside the VM and
 * arrives over the wire.
 */
export interface RuntimeRootDiagnostic {
	readonly code: string;
	readonly kind: "creator" | "warning" | "limit";
	readonly message: string;
	readonly component: string | null;
}

export interface RuntimeRootMountOptions {
	/**
	 * One commit batch. Only validated batches arrive. It is called synchronously and must not
	 * re-enter the VM, though it may enqueue work.
	 */
	onCommit: (batch: RuntimePatchBatch) => void;
	/**
	 * Command batch (scroll, focus). It is delivered after onCommit of the same turn, and that order
	 * is the callback's whole contract. Authors often call scrollToEnd() on the line after setState.
	 * If the command reached the screen before the commit, the view would scroll to the old end before
	 * the content grew.
	 *
	 * Without this callback the command is accepted and dropped, not rejected. Headless consumers (the
	 * MCP preview, the test harness) must run sessions without a screen. Rejecting here would make
	 * author code fail only in those consumers.
	 */
	onCommands?: (batch: RuntimeCommandBatch) => void;
	onDiagnostic?: (diagnostic: RuntimeRootDiagnostic) => void;
	/**
	 * A render or effects request from the host failed, for example on an author render exception. The
	 * previous commit stays in place.
	 */
	onRootError?: (
		error: RuntimeExecutionError,
		work: "render" | "effects",
	) => void;
	/** Entry point. Defaults to the default export of the artifact's entry module. */
	entry?: { moduleId: string; exportName: string };
	limits?: Partial<RuntimeRootLimits>;
}

export type RuntimeEventOutcome =
	| { ok: true; handled: true }
	| { ok: true; handled: false; reason: "stale" | "no-root" | "disposed" }
	| { ok: false; error: RuntimeExecutionError };

/**
 * Root metrics observed by the host. These are a separate axis from the VM-side counts
 * (`rootMetrics`).
 */
export interface RuntimeRootHostMetrics {
	commits: number;
	patchesReceived: number;
	diagnostics: number;
	rendersScheduled: number;
	effectFlushesScheduled: number;
	commandFlushesScheduled: number;
	commandBatches: number;
	commandsReceived: number;
	rejectedCommandBatches: number;
	eventsDispatched: number;
	rootErrors: number;
	rejectedCommits: number;
	liveHostNodes: number;
	revision: number;
}

/**
 * Per-phase creation timings in milliseconds. For measurement only. None of them is evidence of
 * correctness.
 */
export interface RuntimeSessionTimings {
	/**
	 * WASM instantiation plus runtime and context creation. The first session also counts WASM
	 * compilation.
	 */
	createVmMs: number;
	bootstrapMs: number;
	/** Evaluation of the author module graph. The entry point is evaluated first. */
	evaluateGraphMs: number;
}

export interface RuntimeVmSession {
	readonly id: string;
	readonly state: RuntimeSessionState;
	readonly timings: RuntimeSessionTimings;
	/**
	 * Remote image addresses this session may use. This is the list the validated artifact declares,
	 * unchanged. The surface that builds the asset resolver reads it. A remote address outside the
	 * list cannot become a proxy address (authorizeRuntimeAssetTarget).
	 *
	 * The session owns the list on purpose. In a global set, addresses declared by artwork A would
	 * open in artwork B's session. That leak is invisible on screen, because the images still load.
	 * The list dies with the session.
	 */
	readonly remoteAssets: RuntimeRemoteAssetAllowlist;
	callExport(
		moduleId: string,
		exportName: string,
		args: readonly RuntimeWireValue[],
		options?: { priority?: RuntimeWorkPriority },
	): Promise<RuntimeCallOutcome>;
	/** Heap usage reported by the engine. For measurement only, not a basis for correctness. */
	memoryUsedBytes(): number | null;
	/** Scheduler and bridge metrics. Profiling input only, not a basis for correctness. */
	metrics(): RuntimeSessionMetrics;
	/**
	 * Binds an internal built-in export into the dispatcher slot. Passing null clears the slot. This
	 * is the channel the Phase 4B reconciler uses to install its implementation. In this slice the
	 * slot is empty, so hooks throw deterministically. Author modules cannot be bound here, and the
	 * session rejects them.
	 */
	bindDispatcher(
		source: { moduleId: string; exportName: string } | null,
	): Promise<RuntimeCallOutcome>;
	hasDispatcher(): Promise<boolean>;
	/**
	 * Mounts the author tree: renders the entry's default export and sends the first commit batch to
	 * onCommit. If a root already exists, the new entry replaces it (an ordinary reconcile). On
	 * failure (a render exception or a limit) no batch is sent, and the session stays usable.
	 */
	mountRoot(options: RuntimeRootMountOptions): Promise<RuntimeCallOutcome>;
	/**
	 * Invokes one handler by id. It is queued at userBlocking priority and does not enter the VM on
	 * this call stack. An id that matches no live handler returns handled: false. Stale events are
	 * normal.
	 */
	dispatchEvent(
		handlerId: number,
		payload?: RuntimeWireValue,
		/** `media` for an event nobody pressed: interaction-only capabilities (generation) refuse it. */
		source?: RuntimeEventSource,
	): Promise<RuntimeEventOutcome>;
	/**
	 * Runs cleanup functions, emits a batch that removes every node, then releases the root. The
	 * session itself stays alive.
	 */
	unmountRoot(): Promise<RuntimeCallOutcome>;
	/**
	 * Resolves once all queued work has run. A test helper for waiting until render and effect chains
	 * come to rest.
	 */
	settle(): Promise<void>;
	/** Root metrics from inside the VM. Null when there is no root. */
	rootMetrics(): Promise<RuntimeWireValue | null>;
	/**
	 * The current canonical story-state snapshot. It is frozen and shares nothing with this session.
	 * Keys whose definitions have been removed (unknown entries) are kept as they are. Only an
	 * explicit playthrough reset deletes them. That reset belongs to whoever creates a new session,
	 * not to this one.
	 */
	storyStateSnapshot(): RuntimeStoryStateSnapshot;
	/** The current canonical persistent snapshot. A playthrough reset does not reach it. */
	persistentStateSnapshot(): RuntimePersistentStateSnapshot;
	/** Idempotent. Later calls return the first call's promise. */
	dispose(): Promise<void>;
}

const CONSOLE_LEVELS: ReadonlySet<string> = new Set(["log", "warn", "error"]);

let sessionCounter = 0;

interface Completion {
	callId: number;
	ok: boolean;
	json: string;
}

/**
 * One execution: everything about one public operation while it lives in the VM. Calls, graph
 * evaluation, dispatcher binding, and slot lookup all have this shape.
 *
 * The queue holds logical work that points to this execution, not engine handles. The promise ref
 * is an opaque integer issued by the adapter. Each execution has one budget account, and its turns
 * draw it down.
 */
interface Execution {
	readonly id: number;
	readonly kind: "call" | "graph" | "bind" | "probe";
	/**
	 * The origin the host attaches. It is the only fact that capability authorization reads
	 * (capabilities.ts).
	 */
	readonly origin: RuntimeHostCallOrigin;
	readonly priority: RuntimeWorkPriority;
	readonly account: ExecutionAccount;
	readonly start: (slice: RuntimeVmSlice) => RuntimeVmOutcome<ExecutionStart>;
	readonly onSettled?: () => RuntimeVmOutcome<void>;
	readonly wantValue: boolean;
	readonly resolve: (outcome: RuntimeCallOutcome) => void;
	hostCalls: number;
	pendingHostCalls: number;
	ref: RuntimeVmPromiseRef | null;
	settled: boolean;
}

type ExecutionStart =
	| { kind: "value"; value: RuntimeWireValue }
	| RuntimeVmCallResult;

/**
 * A logical work item in the queue. Its kind changes: if a start turn leaves a promise pending, the
 * same item is requeued as a pump. The object is not recreated, because the scheduler reinserts the
 * same item on requeue. That keeps sequence numbers and metrics attached to one execution.
 */
interface Work {
	kind: "start" | "pump" | "host-completion";
	readonly execution: Execution;
	completion?: Completion;
}

const hostFailureJson = (code: string, message: string): string =>
	JSON.stringify({ code, message });

/**
 * Whether a wire value is a plain object. Array.isArray does not narrow readonly arrays, so this
 * check is kept separate.
 */
const wireRecord = (
	value: RuntimeWireValue,
): { readonly [key: string]: RuntimeWireValue } | null =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as { readonly [key: string]: RuntimeWireValue })
		: null;

const now = (): number =>
	typeof performance === "object" && typeof performance.now === "function"
		? performance.now()
		: Date.now();

/**
 * Metrics the session exports: scheduler counts, bridge counts, and root counts. Not a basis for
 * correctness.
 */
export interface RuntimeSessionMetrics {
	scheduler: RuntimeSchedulerMetrics;
	hostCallsIssued: number;
	consoleLines: number;
	root: RuntimeRootHostMetrics;
	storyState: RuntimeStoryStateHostMetrics;
	persistentState: RuntimeStoryStateHostMetrics;
	/**
	 * Generation metrics. Null when this session has no generation capability installed. A zero-filled
	 * table is not returned, because the two cases differ. Enabled but never called is one case. Not
	 * callable at all is the other. Losing that distinction would leave no way to ask which one a
	 * report of 'the AI does not run' describes.
	 */
	generation: RuntimeGenerationMetrics | null;
}

/**
 * Story-state metrics observed by the host. A separate axis from the VM-side counts
 * (`rootMetrics`).
 */
export interface RuntimeStoryStateHostMetrics {
	entries: number;
	serializedLength: number;
	commits: number;
}

/**
 * The root state this session knows: options and host-side metrics. Authority over the tree stays
 * in the VM, and this ledger is not a copy of it.
 *
 * The host counts, from its own side, how many nodes the renderer currently holds. The one reason
 * to count: the host enforces maxHostNodes itself, rather than trusting the number the VM reports.
 */
interface RootState {
	options: RuntimeRootMountOptions;
	limits: RuntimeRootLimits;
	revision: number;
	tree: RuntimeHostNodeLedger;
}

/**
 * Maps root work kinds to VM export names. This table is the single place that vocabulary is
 * defined.
 */
const ROOT_WORK_EXPORT: Readonly<
	Record<"render" | "effects" | "commands", string>
> = Object.freeze({
	render: "flushRender",
	effects: "flushEffects",
	commands: "flushCommands",
});

const emptyRootMetrics = (): RuntimeRootHostMetrics => ({
	commits: 0,
	patchesReceived: 0,
	diagnostics: 0,
	rendersScheduled: 0,
	effectFlushesScheduled: 0,
	commandFlushesScheduled: 0,
	commandBatches: 0,
	commandsReceived: 0,
	rejectedCommandBatches: 0,
	eventsDispatched: 0,
	rootErrors: 0,
	rejectedCommits: 0,
	liveHostNodes: 0,
	revision: 0,
});

class Session implements RuntimeVmSession {
	readonly id: string;
	state: RuntimeSessionState = "creating";
	/**
	 * Remote addresses the validated artifact declares. They are frozen when the session starts and
	 * never change.
	 */
	remoteAssets: RuntimeRemoteAssetAllowlist = EMPTY_REMOTE_ASSET_ALLOWLIST;
	timings: RuntimeSessionTimings = {
		createVmMs: 0,
		bootstrapMs: 0,
		evaluateGraphMs: 0,
	};
	private readonly vm: RuntimeVmInstance;
	private readonly internalBuiltinIds: ReadonlySet<string>;
	private readonly capabilities: RuntimeCapabilityRegistry;
	private readonly limits: RuntimeSessionLimits;
	private readonly wireLimits: RuntimeWireLimits;
	private readonly onConsole: RuntimeConsoleSink | undefined;
	private readonly ids = createCallIdAllocator();
	private readonly scheduler: RuntimeScheduler<Work>;
	/**
	 * Open host calls, mapped to the execution that issued each one. Disposal clears the whole map.
	 */
	private readonly pending = new Map<number, Execution>();
	/**
	 * Executions waiting on the host, outside the queue. They leave when a completion arrives or on
	 * disposal.
	 */
	private readonly waiting = new Set<Execution>();
	private readonly abort = new AbortController();
	/**
	 * The execution whose turn is running now. It is the only way the bridge can tell which execution
	 * owns a call.
	 */
	private current: Execution | null = null;
	private cancelRequested = false;
	private disposal: Promise<void> | null = null;
	private consoleLines = 0;
	private nextExecutionId = 1;
	private root: RootState | null = null;
	private readonly rootMetricsCounters = emptyRootMetrics();
	/**
	 * This session's playthrough snapshot. The trusted host holds it. The VM only knows values in its
	 * own realm.
	 */
	readonly storyStore = new RuntimeStoryStateStore();
	storyStateLimits: RuntimeStoryStateLimits = DEFAULT_STORY_STATE_LIMITS;
	onStoryStateCommit:
		| ((snapshot: RuntimeStoryStateSnapshot) => void)
		| undefined;
	/**
	 * This session's persistent snapshot. It is a separate store instance from the playthrough store.
	 */
	readonly persistentStore = new RuntimePersistentStateStore();
	persistentStateLimits: RuntimePersistentStateLimits =
		DEFAULT_PERSISTENT_STATE_LIMITS;
	onPersistentStateCommit:
		| ((snapshot: RuntimePersistentStateSnapshot) => void)
		| undefined;
	/** The artifact's entry module. mountRoot uses it as the default entry point. */
	entryModuleId = "";
	/**
	 * The generation capability installed in this session. Null when absent, and that fact goes
	 * straight into metrics. The session only reads it. Authorization, concurrency, and budget
	 * decisions all live inside the capability. A copy here would let the two places drift apart.
	 */
	generationCapability: RuntimeGenerationCapability | null = null;

	constructor(
		id: string,
		vm: RuntimeVmInstance,
		internalBuiltinIds: ReadonlySet<string>,
		capabilities: RuntimeCapabilityRegistry,
		limits: RuntimeSessionLimits,
		wireLimits: RuntimeWireLimits,
		onConsole: RuntimeConsoleSink | undefined,
		scheduling: RuntimeSessionSchedulingOptions | undefined,
	) {
		this.id = id;
		this.vm = vm;
		this.internalBuiltinIds = internalBuiltinIds;
		this.capabilities = capabilities;
		this.limits = limits;
		this.wireLimits = wireLimits;
		this.onConsole = onConsole;
		this.scheduler = new RuntimeScheduler<Work>({
			clock: scheduling?.clock,
			observer: scheduling?.observer,
			policy: {
				...scheduling?.policy,
				executionMs: limits.executionMs,
				maxJobsPerTurn: limits.maxJobsPerSlice,
			},
			runTurn: (work, slice) => this.runTurn(work, slice),
			accountsOf: (work) => [work.item.execution.account],
			onDiscard: (work, reason) => this.discard(work.item.execution, reason),
			isCancelled: () => this.cancelRequested,
		});
	}

	hostCall(capability: string, payloadJson: string): RuntimeVmHostCallDecision {
		const rejected = (
			code: string,
			message: string,
		): RuntimeVmHostCallDecision => ({
			kind: "rejected",
			code,
			message,
		});
		const execution = this.current;
		if (this.state !== "running" || this.cancelRequested || execution === null)
			return rejected(
				RUNTIME_HOST_ERROR_CODE.cancelled,
				"session is not running",
			);
		if (
			this.pending.size >= this.limits.maxPendingHostCalls ||
			execution.hostCalls >= this.limits.maxHostCallsPerExecution
		)
			return rejected(
				RUNTIME_HOST_ERROR_CODE.hostCallLimitExceeded,
				"too many host calls",
			);
		/**
		 * Uses hasOwn: capabilities['constructor'] must not return Object. Only names listed in the table
		 * count as capabilities.
		 */
		const handler = Object.hasOwn(this.capabilities, capability)
			? this.capabilities[capability]
			: undefined;
		if (handler === undefined)
			return rejected(
				RUNTIME_HOST_ERROR_CODE.hostCapabilityUnknown,
				`unknown capability ${capability}`,
			);
		const payload = decodeWireValue(payloadJson, this.wireLimits);
		if (!payload.ok)
			return rejected(RUNTIME_HOST_ERROR_CODE.wireValueInvalid, payload.reason);

		const callId = this.ids.next();
		execution.hostCalls += 1;
		execution.pendingHostCalls += 1;
		this.pending.set(callId, execution);
		/** The handler starts outside this slice. The microtask boundary is what makes that so. */
		void Promise.resolve().then(() =>
			this.dispatch(callId, handler, payload.value, execution.origin),
		);
		return { kind: "accepted", callId };
	}

	private async dispatch(
		callId: number,
		handler: RuntimeCapabilityRegistry[string],
		payload: RuntimeWireValue,
		origin: RuntimeHostCallOrigin,
	): Promise<void> {
		let completion: Completion;
		try {
			const result = await handler(payload, {
				sessionId: this.id,
				callId,
				signal: this.abort.signal,
				origin,
			});
			const encoded = encodeWireValue(result, this.wireLimits);
			completion = encoded.ok
				? { callId, ok: true, json: encoded.json }
				: {
						callId,
						ok: false,
						json: hostFailureJson(
							RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
							`host result is not a wire value: ${encoded.reason}`,
						),
					};
		} catch (cause) {
			/**
			 * Host stacks and messages do not enter the VM. Only a failure that carries a code passes its
			 * code and message along.
			 */
			completion =
				cause instanceof RuntimeHostError
					? {
							callId,
							ok: false,
							json: hostFailureJson(cause.code, cause.message),
						}
					: {
							callId,
							ok: false,
							json: hostFailureJson(
								RUNTIME_HOST_ERROR_CODE.hostCallFailed,
								"host capability failed",
							),
						};
		}
		/**
		 * If disposal already removed the execution, this completion goes nowhere and does not re-enter
		 * the VM. If the entry remains, the completion is queued. Even while another turn is running,
		 * this path never enters the VM directly. That is the whole no-re-entry rule (see the
		 * scheduler.ts header).
		 */
		const execution = this.pending.get(callId);
		if (execution === undefined) return;
		this.pending.delete(callId);
		execution.pendingHostCalls -= 1;
		this.waiting.delete(execution);
		this.scheduler.enqueue(
			{ kind: "host-completion", execution, completion },
			execution.priority,
			"host-completion",
		);
	}

	log(level: string, argsJson: string): void {
		if (this.onConsole === undefined) return;
		if (this.consoleLines >= this.limits.maxConsoleLines) return;
		this.consoleLines += 1;
		if (!CONSOLE_LEVELS.has(level)) return;
		const decoded = decodeWireValue(argsJson, this.wireLimits);
		if (!decoded.ok || !Array.isArray(decoded.value)) return;
		this.onConsole(level as RuntimeConsoleLevel, decoded.value);
	}

	/**
	 * Emitted by the runtime infrastructure. Synchronous and within the current turn. It never
	 * re-enters the VM. It only enqueues (schedule), validates and forwards (commit), or reports
	 * (diagnostic). If a consumer callback throws, the failure belongs to the host and is folded into
	 * a rejection. The VM then treats the commit as not accepted and keeps the previous tree.
	 */
	emit(channel: string, json: string): RuntimeVmEmitDecision {
		const rejected = (
			code: string,
			message: string,
		): RuntimeVmEmitDecision => ({
			ok: false,
			code,
			message,
		});
		if (
			this.state !== "running" ||
			this.cancelRequested ||
			this.current === null
		)
			return rejected(
				RUNTIME_HOST_ERROR_CODE.cancelled,
				"session is not running",
			);
		const root = this.root;
		if (root === null)
			return rejected(
				RUNTIME_HOST_ERROR_CODE.rootNotMounted,
				"no root is mounted",
			);
		switch (channel) {
			case "schedule": {
				const decoded = decodeWireValue(json, this.wireLimits);
				const work = decoded.ok ? wireRecord(decoded.value)?.work : null;
				if (work !== "render" && work !== "effects" && work !== "commands")
					return rejected(
						RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
						"unknown work",
					);
				this.scheduleRootWork(work);
				return { ok: true };
			}
			case "commit": {
				const validated = validatePatchBatch(json, root.limits, {
					expectedRevision: root.revision + 1,
					tree: root.tree,
				});
				if (!validated.ok) {
					this.rootMetricsCounters.rejectedCommits += 1;
					return rejected(
						validated.limit
							? RUNTIME_HOST_ERROR_CODE.patchLimitExceeded
							: RUNTIME_HOST_ERROR_CODE.patchBatchInvalid,
						validated.reason,
					);
				}
				const { batch } = validated;
				try {
					root.options.onCommit(batch);
				} catch {
					this.rootMetricsCounters.rejectedCommits += 1;
					return rejected(
						RUNTIME_HOST_ERROR_CODE.hostCallFailed,
						"commit consumer failed",
					);
				}
				root.revision = batch.revision;
				/**
				 * The ledger advances only after the consumer accepts the batch. A rejected batch leaves no
				 * trace.
				 */
				validated.commit();
				this.rootMetricsCounters.commits += 1;
				this.rootMetricsCounters.patchesReceived += batch.patches.length;
				this.rootMetricsCounters.revision = batch.revision;
				this.rootMetricsCounters.liveHostNodes = root.tree.size;
				return { ok: true };
			}
			/**
			 * Story-state delta. It arrives only after the UI commit is accepted (§39). If rejected here,
			 * the VM does not commit the value and keeps it pending. The VM already validated it under the
			 * same rules. The check runs again for the same reason as for patch batches: VM code is
			 * ultimately the author's territory, and this realm is the final authority.
			 */
			case "story-state": {
				const decoded = decodeWireValue(json, this.wireLimits);
				if (!decoded.ok)
					return rejected(
						RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
						decoded.reason,
					);
				const delta = this.readStoryDelta(decoded.value);
				if (delta === null)
					return rejected(
						RUNTIME_HOST_ERROR_CODE.storyStateCommitInvalid,
						"story state commit has an unexpected shape",
					);
				this.storyStore.apply(delta);
				try {
					this.onStoryStateCommit?.(this.storyStore.snapshot());
				} catch {
					/* A failure in a snapshot consumer is not a runtime failure. The commit is already valid. */
				}
				return { ok: true };
			}
			/**
			 * Persistent-state delta. It uses a different channel and a different store from playthrough
			 * state. The lifetime is not written into the payload. If it were, this switch would read a
			 * field to choose the store, and the one way that can go wrong is a playthrough reset erasing
			 * permanent progress. The channel name makes that choice instead.
			 */
			case "persistent-state": {
				const decoded = decodeWireValue(json, this.wireLimits);
				if (!decoded.ok)
					return rejected(
						RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
						decoded.reason,
					);
				const delta = this.readPersistentDelta(decoded.value);
				if (delta === null)
					return rejected(
						RUNTIME_HOST_ERROR_CODE.storyStateCommitInvalid,
						"persistent state commit has an unexpected shape",
					);
				this.persistentStore.apply(delta);
				try {
					this.onPersistentStateCommit?.(this.persistentStore.snapshot());
				} catch {
					/* A failure in a snapshot consumer is not a runtime failure. The commit is already valid. */
				}
				return { ok: true };
			}
			/**
			 * Command batch: same turn as the commit, after it. The revision is compared to enforce the
			 * order. This channel and commit pass through the same emit chain, so the order cannot break on
			 * the normal path. Still, the revision is checked by value instead of relying on that. If
			 * someone later reorders one bridge, the bug would silently steer the wrong node.
			 */
			case "commands": {
				const validated = validateCommandBatch(json, root.limits, {
					revision: root.revision,
				});
				if (!validated.ok) {
					this.rootMetricsCounters.rejectedCommandBatches += 1;
					return rejected(
						validated.limit
							? RUNTIME_HOST_ERROR_CODE.patchLimitExceeded
							: RUNTIME_HOST_ERROR_CODE.patchBatchInvalid,
						validated.reason,
					);
				}
				this.rootMetricsCounters.commandBatches += 1;
				this.rootMetricsCounters.commandsReceived +=
					validated.batch.commands.length;
				try {
					root.options.onCommands?.(validated.batch);
				} catch {
					/**
					 * A consumer failure is not a rejection. A command records intent, not screen state. Rejecting
					 * it would make the VM resend the same intent at the next settle, a loop that repeats the same
					 * command forever against a failing renderer.
					 */
				}
				return { ok: true };
			}
			case "diagnostic": {
				const decoded = decodeWireValue(json, this.wireLimits);
				if (!decoded.ok) return { ok: true };
				const value = wireRecord(decoded.value);
				if (
					value === null ||
					typeof value.code !== "string" ||
					typeof value.message !== "string"
				)
					return { ok: true };
				this.rootMetricsCounters.diagnostics += 1;
				const kind =
					value.kind === "warning" || value.kind === "limit"
						? value.kind
						: "creator";
				try {
					root.options.onDiagnostic?.({
						code: value.code,
						kind,
						message: value.message,
						component:
							typeof value.component === "string" ? value.component : null,
					});
				} catch {
					/* A failure in a diagnostic consumer is not a runtime failure. */
				}
				return { ok: true };
			}
			default:
				return rejected(
					RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
					`unknown channel ${channel}`,
				);
		}
	}

	/**
	 * Turns a root work request from the VM into an execution. Render runs at normal priority and
	 * effects at background. Nothing awaits the result, so failures go to onRootError. This runs
	 * inside a turn, and enqueue never runs a turn inline, so there is no re-entry.
	 */
	private scheduleRootWork(work: "render" | "effects" | "commands"): void {
		const exportName = ROOT_WORK_EXPORT[work];
		if (work === "render") this.rootMetricsCounters.rendersScheduled += 1;
		else if (work === "effects")
			this.rootMetricsCounters.effectFlushesScheduled += 1;
		else this.rootMetricsCounters.commandFlushesScheduled += 1;
		void this.submit(
			"call",
			work,
			work === "effects" ? "background" : "normal",
			(slice) =>
				this.vm.callBuiltinExport(
					RUNTIME_ROOT_BUILTIN_ID,
					exportName,
					"[]",
					slice,
				),
		).then((outcome) => {
			if (outcome.ok) return;
			this.rootMetricsCounters.rootErrors += 1;
			/**
			 * Work dropped by disposal or session failure is not a root error. The consumer already knows
			 * about it.
			 */
			if (
				outcome.error instanceof RuntimeHostError &&
				(outcome.error.code === RUNTIME_HOST_ERROR_CODE.cancelled ||
					outcome.error.code === RUNTIME_HOST_ERROR_CODE.disposed)
			)
				return;
			/**
			 * onRootError covers only render and effects. A failure while draining commands fits neither, so
			 * it is reported as a render failure. Inside the VM, that execution only exports one queue to a
			 * port. If it fails, the previous commit remains the authority.
			 */
			this.root?.options.onRootError?.(
				outcome.error,
				work === "effects" ? "effects" : "render",
			);
		});
	}

	private toError(failure: RuntimeVmFailure): RuntimeExecutionError {
		switch (failure.kind) {
			case "interrupted":
				return this.cancelRequested
					? new RuntimeHostError(
							RUNTIME_HOST_ERROR_CODE.cancelled,
							"execution was cancelled",
						)
					: new RuntimeHostError(
							RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded,
							`execution exceeded its budget of ${this.limits.executionMs}ms`,
						);
			case "memory":
				return new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.memoryLimitExceeded,
					`vm exceeded its memory limit of ${this.limits.memoryBytes} bytes`,
				);
			case "engine":
				return new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.internalVmError,
					failure.message,
				);
			case "lookup":
				return new RuntimeHostError(
					failure.reason === "module"
						? RUNTIME_HOST_ERROR_CODE.moduleUnknown
						: failure.reason === "export"
							? RUNTIME_HOST_ERROR_CODE.exportMissing
							: RUNTIME_HOST_ERROR_CODE.exportNotCallable,
					`cannot call export: ${failure.reason}`,
				);
			case "thrown":
				if (failure.hostCode !== null)
					return new RuntimeHostError(
						isRuntimeHostErrorCode(failure.hostCode)
							? failure.hostCode
							: RUNTIME_HOST_ERROR_CODE.hostCallFailed,
						failure.message,
					);
				return new CreatorExecutionError(
					failure.name,
					failure.message,
					parseCreatorStack(failure.stack),
					{
						runtimeCode: failure.runtimeCode ?? null,
						componentStack: failure.componentStack ?? null,
					},
				);
		}
	}

	private decoded(json: string): RuntimeCallOutcome {
		const decoded = decodeWireValue(json, this.wireLimits);
		if (decoded.ok) return { ok: true, value: decoded.value };
		return {
			ok: false,
			error: new RuntimeHostError(
				RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
				decoded.reason,
			),
		};
	}

	private finish(execution: Execution, outcome: RuntimeCallOutcome): void {
		if (execution.settled) return;
		execution.settled = true;
		this.waiting.delete(execution);
		if (execution.ref !== null) {
			this.vm.release(execution.ref);
			execution.ref = null;
		}
		execution.resolve(outcome);
	}

	/**
	 * Folds a VM failure into the execution's result. A fatal failure fails the session and stops the
	 * scheduler. Everything after that, queued and waiting alike, receives sessionFailed.
	 */
	private fail(
		execution: Execution,
		failure: RuntimeVmFailure,
	): RuntimeTurnOutcome {
		this.finish(execution, { ok: false, error: this.toError(failure) });
		if (failureSeverity(failure) === "recoverable") return { kind: "done" };
		if (this.state === "running") this.state = transition(this.state, "failed");
		this.rejectWaiting(RUNTIME_HOST_ERROR_CODE.sessionFailed);
		return { kind: "fatal" };
	}

	private discard(execution: Execution, reason: "cancelled" | "failed"): void {
		this.finish(execution, {
			ok: false,
			error: this.unavailableError(reason),
		});
	}

	private unavailableError(reason: "cancelled" | "failed"): RuntimeHostError {
		return reason === "failed"
			? new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.sessionFailed,
					"session failed earlier and cannot run creator code again",
				)
			: new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.cancelled,
					"execution was cancelled",
				);
	}

	private rejectWaiting(
		code:
			| typeof RUNTIME_HOST_ERROR_CODE.sessionFailed
			| typeof RUNTIME_HOST_ERROR_CODE.cancelled,
	): void {
		for (const execution of [...this.waiting])
			this.finish(execution, {
				ok: false,
				error: this.unavailableError(
					code === RUNTIME_HOST_ERROR_CODE.sessionFailed
						? "failed"
						: "cancelled",
				),
			});
	}

	/**
	 * One turn. This is the only place the scheduler calls, and the only place the VM is entered.
	 * - start: begins an execution (call, graph evaluation, binding, lookup). A value finishes it. A
	 *   promise turns it into a pump.
	 * - host-completion: delivers a completion to the VM-side promise, then pumps.
	 * - pump: runs VM jobs up to the cap and checks the promise state. The decision after the pump
	 *   is half of this function. If the result is settled, the turn is done. If work remains, the
	 *   item requeues at the back of its priority. If it waits on the host, it leaves the queue
	 *   (waiting). If nothing can make progress, the result is executionStalled.
	 */
	private runTurn(
		work: { item: Work },
		slice: RuntimeVmSlice,
	): RuntimeTurnOutcome {
		const { execution } = work.item;
		this.current = execution;
		this.state = transition(this.state, "running");
		try {
			/**
			 * A completion arrives for an execution that has already finished. Do not drop it. Resolve the
			 * promise, then run the VM's remaining jobs.
			 *
			 * This branch is needed. Event handlers may run without awaiting their promise (void
			 * reply(...)), so the UI is not blocked. The dispatchEvent execution is settled at that point,
			 * but a host call it started is still open. If the completion only resolved the promise, the
			 * continuation after await (for example setStoryState) would never run. The screen would stay on
			 * `Typing…` with no error.
			 *
			 * So this is an ordinary turn. this.current points at the execution, so new host calls from the
			 * continuation have an owner. Leftover work is requeued.
			 */
			if (execution.settled) {
				if (work.item.kind === "host-completion" && work.item.completion)
					this.vm.settleHostCall(
						work.item.completion.callId,
						work.item.completion.ok,
						work.item.completion.json,
					);
				const outcome = this.drain(execution, slice);
				if (outcome.kind === "requeue") {
					work.item.kind = "pump";
					work.item.completion = undefined;
				}
				return outcome;
			}
			const outcome = this.turnBody(work.item, slice);
			/**
			 * Requeueing always produces a pump. A start is never run twice, and a completion is never
			 * delivered twice.
			 */
			if (outcome.kind === "requeue") {
				work.item.kind = "pump";
				work.item.completion = undefined;
			}
			return outcome;
		} finally {
			this.current = null;
			if (this.state === "running")
				this.state = transition(this.state, "ready");
		}
	}

	private turnBody(item: Work, slice: RuntimeVmSlice): RuntimeTurnOutcome {
		const { execution } = item;
		if (item.kind === "start") {
			if (execution.account.remainingMs() <= 0)
				return this.fail(execution, { kind: "interrupted" });
			const first = execution.start(slice);
			if (!first.ok) return this.fail(execution, first.failure);
			if (first.value.kind === "value") {
				this.finish(execution, { ok: true, value: first.value.value });
				return { kind: "done" };
			}
			if (first.value.kind === "settled")
				return this.settleWith(execution, first.value.json);
			execution.ref = first.value.promise;
		} else if (
			item.kind === "host-completion" &&
			item.completion !== undefined
		) {
			const { completion } = item;
			this.vm.settleHostCall(completion.callId, completion.ok, completion.json);
		}
		return this.pump(execution, slice);
	}

	private settleWith(execution: Execution, json: string): RuntimeTurnOutcome {
		const adopted = execution.onSettled?.();
		if (adopted !== undefined && !adopted.ok)
			return this.fail(execution, adopted.failure);
		this.finish(execution, this.decoded(json));
		return { kind: "done" };
	}

	private pump(
		execution: Execution,
		slice: RuntimeVmSlice,
	): RuntimeTurnOutcome {
		const jobs = this.vm.runJobs(this.limits.maxJobsPerSlice, slice);
		if (!jobs.ok) return this.fail(execution, jobs.failure);
		const ref = execution.ref;
		if (ref === null)
			return this.fail(execution, {
				kind: "engine",
				message: "execution has no promise",
			});
		const state = this.vm.promiseState(ref, slice, execution.wantValue);
		if (state.type === "fulfilled") {
			const outcome = this.settleWith(execution, state.json);
			if (outcome.kind === "fatal") return outcome;
			return this.afterPump(jobs.value.more, slice);
		}
		if (state.type === "rejected") {
			const outcome = this.fail(execution, state.failure);
			if (outcome.kind === "fatal") return outcome;
			return this.afterPump(jobs.value.more, slice);
		}
		if (this.cancelRequested)
			return this.fail(execution, { kind: "interrupted" });
		/**
		 * This pump may have settled another execution's promise, so the waiting executions are swept
		 * once.
		 */
		const swept = this.sweep(slice);
		if (swept !== null) return swept;
		if (jobs.value.more) return { kind: "requeue" };
		if (execution.pendingHostCalls > 0 || this.othersAlive(execution)) {
			this.waiting.add(execution);
			return { kind: "waiting" };
		}
		this.finish(execution, {
			ok: false,
			error: new RuntimeHostError(
				RUNTIME_HOST_ERROR_CODE.executionStalled,
				"the result promise can never settle: no pending host calls and no queued jobs",
			),
		});
		return { kind: "done" };
	}

	/**
	 * Runs work that has no owner: a turn for an execution that is already settled. It is separate
	 * from pump because there is no promise to watch. The execution's result was already sent. What
	 * runs here is the continuation left in the realm, the then-callback of a floating promise. That
	 * continuation may settle another execution's promise, so it goes through sweep. If work remains,
	 * the same item is requeued, so one slice never monopolizes the VM.
	 */
	private drain(
		execution: Execution,
		slice: RuntimeVmSlice,
	): RuntimeTurnOutcome {
		const jobs = this.vm.runJobs(this.limits.maxJobsPerSlice, slice);
		if (!jobs.ok) return this.fail(execution, jobs.failure);
		const swept = this.sweep(slice);
		if (swept !== null) return swept;
		if (jobs.value.more) return { kind: "requeue" };
		this.settleQuiescent();
		return { kind: "done" };
	}

	/**
	 * When an execution ends, leftover work passes to the next turn, whose owner is the next
	 * execution.
	 */
	private afterPump(more: boolean, slice: RuntimeVmSlice): RuntimeTurnOutcome {
		const swept = this.sweep(slice);
		if (swept !== null) return swept;
		if (more && this.waiting.size > 0) {
			/**
			 * Jobs may remain while the queue holds no execution. One waiting execution moves back to pump
			 * duty.
			 */
			const [next] = this.waiting;
			if (next !== undefined) {
				this.waiting.delete(next);
				this.scheduler.enqueue(
					{ kind: "pump", execution: next },
					next.priority,
				);
			}
		}
		this.settleQuiescent();
		return { kind: "done" };
	}

	private sweep(slice: RuntimeVmSlice): RuntimeTurnOutcome | null {
		const turnOwner = this.current;
		for (const execution of [...this.waiting]) {
			if (execution.ref === null) continue;
			/**
			 * Serialization runs guest code (getters and Proxy traps). Host calls that come out of it must
			 * be attributed to the owner of the result. If this.current still pointed at the turn's owner, a
			 * call made from another execution's value would be charged to this turn's execution. Its
			 * completion would then go to an execution that has already finished and be dropped.
			 */
			this.current = execution;
			const state = this.vm.promiseState(
				execution.ref,
				slice,
				execution.wantValue,
			);
			this.current = turnOwner;
			if (state.type === "pending") continue;
			const outcome =
				state.type === "fulfilled"
					? this.settleWith(execution, state.json)
					: this.fail(execution, state.failure);
			if (outcome.kind === "fatal") return outcome;
		}
		this.settleQuiescent();
		return null;
	}

	/** An unsettled execution with nothing left to wait for is a full stall. */
	private settleQuiescent(): void {
		if (this.vm.hasPendingJobs() || this.pending.size > 0) return;
		for (const execution of [...this.waiting])
			if (execution.pendingHostCalls === 0)
				this.finish(execution, {
					ok: false,
					error: new RuntimeHostError(
						RUNTIME_HOST_ERROR_CODE.executionStalled,
						"the result promise can never settle: no pending host calls and no queued jobs",
					),
				});
	}

	private othersAlive(self: Execution): boolean {
		for (const execution of this.waiting)
			if (execution !== self && execution.pendingHostCalls > 0) return true;
		return this.pending.size > 0;
	}

	private unavailable(): RuntimeExecutionError | null {
		switch (this.state) {
			case "ready":
			case "running":
				return null;
			case "failed":
				return this.unavailableError("failed");
			default:
				return new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.disposed,
					"session is disposed",
				);
		}
	}

	private submit(
		kind: Execution["kind"],
		origin: RuntimeHostCallOrigin,
		priority: RuntimeWorkPriority,
		start: Execution["start"],
		extra: {
			onSettled?: () => RuntimeVmOutcome<void>;
			wantValue?: boolean;
		} = {},
	): Promise<RuntimeCallOutcome> {
		const unavailable = this.unavailable();
		if (unavailable !== null)
			return Promise.resolve({ ok: false, error: unavailable });
		return new Promise((resolve) => {
			const execution: Execution = {
				id: this.nextExecutionId++,
				kind,
				origin,
				priority,
				account: new ExecutionAccount(this.limits.executionMs),
				start,
				wantValue: extra.wantValue ?? true,
				resolve,
				hostCalls: 0,
				pendingHostCalls: 0,
				ref: null,
				settled: false,
				...(extra.onSettled === undefined
					? {}
					: { onSettled: extra.onSettled }),
			};
			this.scheduler.enqueue({ kind: "start", execution }, priority);
		});
	}

	callExport(
		moduleId: string,
		exportName: string,
		args: readonly RuntimeWireValue[],
		options: { priority?: RuntimeWorkPriority } = {},
	): Promise<RuntimeCallOutcome> {
		const encoded = encodeWireValue(args, this.wireLimits);
		if (!encoded.ok)
			return Promise.resolve({
				ok: false,
				error: new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
					`arguments are not wire values: ${encoded.reason}`,
				),
			});
		return this.submit("call", "call", options.priority ?? "normal", (slice) =>
			this.vm.callExport(moduleId, exportName, encoded.json, slice),
		);
	}

	/**
	 * Called only during creation. Graph evaluation is an ordinary execution and goes through the same
	 * scheduler.
	 */
	evaluateGraph(
		entryId: string,
		moduleIds: readonly string[],
	): Promise<RuntimeCallOutcome> {
		return this.submit(
			"graph",
			"graph",
			"normal",
			(slice) => this.vm.evaluateGraph(entryId, moduleIds, slice),
			{ onSettled: () => this.vm.adoptGraph(), wantValue: false },
		);
	}

	bindDispatcher(
		source: { moduleId: string; exportName: string } | null,
	): Promise<RuntimeCallOutcome> {
		/**
		 * Neither author modules nor public built-ins can be the dispatcher. An author module would let
		 * the author define what hooks mean. A public built-in would mix a slot implementation into the
		 * public vocabulary. Only internal built-ins are allowed.
		 */
		if (source !== null && !this.internalBuiltinIds.has(source.moduleId))
			return Promise.resolve({
				ok: false,
				error: new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.moduleUnknown,
					`dispatcher source must be an internal builtin, got ${source.moduleId}`,
				),
			});
		return this.submit("bind", "bind", "immediate", (slice) => {
			const outcome = this.vm.bindDispatcher(source, slice);
			return outcome.ok
				? { ok: true, value: { kind: "value", value: null } }
				: outcome;
		});
	}

	async hasDispatcher(): Promise<boolean> {
		const outcome = await this.submit("probe", "bind", "immediate", (slice) => {
			const probed = this.vm.hasDispatcher(slice);
			return probed.ok
				? { ok: true, value: { kind: "value", value: probed.value } }
				: probed;
		});
		return outcome.ok && outcome.value === true;
	}

	memoryUsedBytes(): number | null {
		if (this.state === "disposed" || this.state === "disposing") return null;
		return this.vm.memoryUsedBytes();
	}

	metrics(): RuntimeSessionMetrics {
		return {
			scheduler: this.scheduler.metrics(),
			hostCallsIssued: this.ids.issued(),
			consoleLines: this.consoleLines,
			root: { ...this.rootMetricsCounters },
			storyState: {
				entries: this.storyStore.size,
				serializedLength: this.storyStore.serializedLength,
				commits: this.storyStore.appliedCommits,
			},
			persistentState: {
				entries: this.persistentStore.size,
				serializedLength: this.persistentStore.serializedLength,
				commits: this.persistentStore.appliedCommits,
			},
			generation: this.generationCapability?.metrics() ?? null,
		};
	}

	mountRoot(options: RuntimeRootMountOptions): Promise<RuntimeCallOutcome> {
		const limits: RuntimeRootLimits = {
			...DEFAULT_ROOT_LIMITS,
			...options.limits,
		};
		const entry = options.entry ?? {
			moduleId: this.entryModuleId,
			exportName: "default",
		};
		/**
		 * Root state is set up before the mount execution. The first commit arrives through emit while
		 * the mount runs. Without this state, that commit would be rejected. On replacement (a root
		 * already exists), the revision and node count carry over, because the VM's root is the same root
		 * and its counts continue.
		 */
		const previous = this.root;
		this.root = {
			options,
			limits,
			revision: previous?.revision ?? 0,
			tree: previous?.tree ?? new RuntimeHostNodeLedger(),
		};
		const argsJson = JSON.stringify([
			{
				maxTreeDepth: limits.maxTreeDepth,
				maxHostNodes: limits.maxHostNodes,
				maxPatchesPerCommit: limits.maxPatchesPerCommit,
				/** The limit the VM counts first. It must equal the host's maxCommandsPerBatch. */
				maxCommandsPerFlush: limits.maxCommandsPerBatch,
			},
		]);
		return this.submit("call", "mount", "normal", (slice) =>
			this.vm.callBuiltinExport(
				RUNTIME_ROOT_BUILTIN_ID,
				"mountRoot",
				argsJson,
				slice,
				[entry],
			),
		).then((outcome) => {
			/**
			 * If the first mount fails, the root returns to none. A failed replacement keeps the old root.
			 */
			if (!outcome.ok && previous === null && this.root?.revision === 0)
				this.root = null;
			return outcome;
		});
	}

	async dispatchEvent(
		handlerId: number,
		payload: RuntimeWireValue = null,
		/** `media` for an event nobody pressed (`RuntimeHostCallOrigin`); interaction is the default because presses and inputs are every other caller. */
		source: RuntimeEventSource = "interaction",
	): Promise<RuntimeEventOutcome> {
		this.rootMetricsCounters.eventsDispatched += 1;
		const encoded = encodeWireValue([handlerId, payload], this.wireLimits);
		if (!encoded.ok)
			return {
				ok: false,
				error: new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
					`event payload is not a wire value: ${encoded.reason}`,
				),
			};
		const outcome = await this.submit(
			"call",
			source === "media" ? "media" : "event",
			"userBlocking",
			(slice) =>
				this.vm.callBuiltinExport(
					RUNTIME_ROOT_BUILTIN_ID,
					"dispatchEvent",
					encoded.json,
					slice,
				),
		);
		if (!outcome.ok) return outcome;
		const value = wireRecord(outcome.value);
		if (value !== null) {
			if (value.handled === true) return { ok: true, handled: true };
			const reason = value.reason;
			if (reason === "stale" || reason === "no-root" || reason === "disposed")
				return { ok: true, handled: false, reason };
		}
		return {
			ok: false,
			error: new RuntimeHostError(
				RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
				"event result has an unexpected shape",
			),
		};
	}

	unmountRoot(): Promise<RuntimeCallOutcome> {
		if (this.root === null)
			return Promise.resolve({
				ok: false,
				error: new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.rootNotMounted,
					"no root is mounted",
				),
			});
		return this.submit("call", "unmount", "immediate", (slice) =>
			this.vm.callBuiltinExport(
				RUNTIME_ROOT_BUILTIN_ID,
				"unmountRoot",
				"[]",
				slice,
			),
		).then((outcome) => {
			this.root = null;
			return outcome;
		});
	}

	settle(): Promise<void> {
		return this.scheduler.idle();
	}

	/**
	 * Reads one delta. This is an allowlist. Any shape difference, however small, returns null, and
	 * the store stays unchanged.
	 */
	private readDurableDelta(
		store: RuntimePersistentStateStore | RuntimeStoryStateStore,
		limits: RuntimeStoryStateLimits,
		value: RuntimeWireValue,
	): RuntimeStoryStateEntry[] | null {
		const record = wireRecord(value);
		if (record === null || record.formatVersion !== 1) return null;
		if (!Array.isArray(record.entries)) return null;
		const entries: RuntimeStoryStateEntry[] = [];
		const seen = new Set<string>();
		let total = 0;
		for (const item of record.entries as readonly RuntimeWireValue[]) {
			const entry = wireRecord(item);
			if (entry === null) return null;
			if (!isStoryStateKey(entry.key) || seen.has(entry.key)) return null;
			if (!isStoryStateVersion(entry.version)) return null;
			if (entry.value === undefined) return null;
			const length = JSON.stringify(entry.value).length;
			if (length > limits.maxEntrySerializedLength) return null;
			total += length;
			if (total > limits.maxSnapshotSerializedLength) return null;
			seen.add(entry.key);
			entries.push({
				key: entry.key,
				version: entry.version,
				value: entry.value,
			});
		}
		/**
		 * The limit applies to the store after the delta is applied, not to the delta alone. The count
		 * must match how apply works. apply overwrites existing keys. An earlier version counted
		 * store.size + entries.length, which counted an overwritten key twice. The bug appeared only in
		 * works whose definitions exceed half the limit (64 entries). The first run worked. Once a save
		 * existed, hydration re-applied all definitions over restore(saved), hit this check, and the work
		 * could never open again.
		 *
		 * Total length is measured the same way. Measuring only the delta lets many small deltas push the
		 * store past the snapshot limit. Such a snapshot fails validateDurableStateSnapshot in the next
		 * session, so a save written in one session could not be opened in the next.
		 */
		let added = 0;
		let projected = store.serializedLength;
		for (const entry of entries) {
			if (!store.has(entry.key)) added += 1;
			projected +=
				JSON.stringify(entry.value).length -
				store.serializedLengthOf(entry.key);
		}
		if (store.size + added > limits.maxEntries) return null;
		if (projected > limits.maxSnapshotSerializedLength) return null;
		return entries;
	}

	private readStoryDelta(
		value: RuntimeWireValue,
	): RuntimeStoryStateEntry[] | null {
		return this.readDurableDelta(this.storyStore, this.storyStateLimits, value);
	}

	private readPersistentDelta(
		value: RuntimeWireValue,
	): RuntimePersistentStateEntry[] | null {
		return this.readDurableDelta(
			this.persistentStore,
			this.persistentStateLimits,
			value,
		);
	}

	/**
	 * Runs once, after the author modules are evaluated and before the first mount. The VM seals the
	 * registry, identifies the snapshot, runs migrations, and returns a result for every defined key.
	 * Applying those results to the stores makes the migrated version the current snapshot. The next
	 * session reads that version as is, so migration runs once per hydration, not once per render.
	 */
	async hydrateDurableState(
		storySnapshot: RuntimeStoryStateSnapshot,
		persistentSnapshot: RuntimePersistentStateSnapshot,
	): Promise<RuntimeCallOutcome> {
		/**
		 * The limit has different names in the two realms. The host counts snapshot entries, and the VM
		 * counts definitions. It is the same axis under two names. If the host spreads the limits through
		 * unchanged, the VM finds no matching name and silently uses its defaults.
		 */
		const argsJson = JSON.stringify([
			storySnapshot,
			persistentSnapshot,
			{
				maxDefinitions: this.storyStateLimits.maxEntries,
				maxEntrySerializedLength:
					this.storyStateLimits.maxEntrySerializedLength,
				maxSnapshotSerializedLength:
					this.storyStateLimits.maxSnapshotSerializedLength,
			},
		]);
		const outcome = await this.submit("call", "mount", "immediate", (slice) =>
			this.vm.callBuiltinExport(
				DURABLE_STATE_BUILTIN_ID,
				"hydrateDurableState",
				argsJson,
				slice,
			),
		);
		if (!outcome.ok) return outcome;
		const record = wireRecord(outcome.value);
		const resolvedStory =
			record === null || record.story === undefined
				? null
				: this.readStoryDelta(record.story);
		const resolvedPersistent =
			record === null || record.persistent === undefined
				? null
				: this.readPersistentDelta(record.persistent);
		if (resolvedStory === null || resolvedPersistent === null)
			return {
				ok: false,
				error: new RuntimeHostError(
					RUNTIME_HOST_ERROR_CODE.storyStateCommitInvalid,
					"durable state hydration returned an unexpected shape",
				),
			};
		/**
		 * Both stores are applied only after both results are valid. Applying one at a time would leave
		 * the first store migrated if the second had a bad shape. The session would then fail to start,
		 * yet the host's snapshot would already have changed.
		 */
		this.storyStore.apply(resolvedStory);
		this.persistentStore.apply(resolvedPersistent);
		return outcome;
	}

	storyStateSnapshot(): RuntimeStoryStateSnapshot {
		return this.storyStore.snapshot();
	}

	persistentStateSnapshot(): RuntimePersistentStateSnapshot {
		return this.persistentStore.snapshot();
	}

	async rootMetrics(): Promise<RuntimeWireValue | null> {
		if (this.root === null) return null;
		const outcome = await this.submit("call", "call", "immediate", (slice) =>
			this.vm.callBuiltinExport(
				RUNTIME_ROOT_BUILTIN_ID,
				"rootMetrics",
				"[]",
				slice,
			),
		);
		return outcome.ok ? outcome.value : null;
	}

	dispose(): Promise<void> {
		if (this.disposal === null) this.disposal = this.disposeOnce();
		return this.disposal;
	}

	/**
	 * Disposal runs ahead of ordinary work. First the cancel flag is set, and the interrupt handler
	 * reads it to end a running turn. Then the queue is emptied, and onDiscard rejects each execution
	 * as cancelled. Open host calls are aborted by signal. A late completion finds nothing in pending
	 * and is dropped. Only after that does disposal wait for the last turn to unwind before releasing
	 * the VM.
	 */
	private async disposeOnce(): Promise<void> {
		this.cancelRequested = true;
		this.root = null;
		this.state = transition(this.state, "disposing");
		this.abort.abort();
		this.scheduler.stop("cancelled");
		this.pending.clear();
		this.rejectWaiting(RUNTIME_HOST_ERROR_CODE.cancelled);
		await this.scheduler.idle();
		this.vm.dispose();
		this.state = transition(this.state, "disposed");
	}
}

/**
 * Loader policy: where an import from an author module resolves.
 * - Host-injected modules (<rowcat:...>) may point at any known name.
 * - Built-ins point only at built-ins.
 * - Author modules point only at entries in their own dependency table. One exception: the JSX
 *   transform that the compiler injects imports @rowcat/runtime/jsx-runtime. It is not in the
 *   table, and the public built-in names are accepted by name. Anything else returns null. That is
 *   a deterministic failure. Node resolution, npm, the file system, and the host's import() never
 *   get a chance after it.
 */
/**
 * Driver modules the host injects directly. Only these modules may point at any known name. Their
 * ids must equal the adapter's constants, and session.test.ts checks that.
 */
const HOST_DRIVER_MODULE_IDS: ReadonlySet<string> = new Set([
	"<rowcat:builtins>",
	"<rowcat:graph>",
	"<rowcat:prelude>",
]);

function createResolver(
	moduleDependencies: ReadonlyMap<string, ReadonlyMap<string, string>>,
	builtinIds: ReadonlySet<string>,
	importableIds: ReadonlySet<string>,
	knownIds: ReadonlySet<string>,
): (base: string, specifier: string) => string | null {
	return (base, specifier) => {
		/**
		 * This is an exact set, not a prefix check. For a while it used startsWith('<rowcat:'). That let
		 * an artifact with module id '<rowcat:pwn.ts' open every internal module, because validation
		 * checked only the extension and the id passed. Validation now accepts only canonical paths, but
		 * the loader does not rely on that. It knows only the driver names, by name.
		 */
		if (HOST_DRIVER_MODULE_IDS.has(base))
			return knownIds.has(specifier) ? specifier : null;
		if (builtinIds.has(base))
			return builtinIds.has(specifier) ? specifier : null;
		const table = moduleDependencies.get(base);
		if (table === undefined) return null;
		const resolved = table.get(specifier);
		if (resolved !== undefined)
			return builtinIds.has(resolved) && !importableIds.has(resolved)
				? null
				: resolved;
		if (isRuntimeBuiltinSpecifier(specifier)) {
			const id = runtimeBuiltinId(specifier);
			return importableIds.has(id) ? id : null;
		}
		return null;
	};
}

export async function createRuntimeVmSession(
	options: RuntimeVmSessionOptions,
): Promise<RuntimeVmSession> {
	/**
	 * The compatibility check runs before VM creation. On a mismatched runtime, author modules are not
	 * evaluated and no VM is created. A session that fails here holds no resources.
	 */
	const sandbox = options.sandbox ?? CURRENT_RUNTIME_SANDBOX;
	const compatible = checkSandboxCompatibility(sandbox);
	if (!compatible.ok)
		throw new RuntimeHostError(
			RUNTIME_HOST_ERROR_CODE.sandboxIncompatible,
			compatible.reason,
		);
	const plan = planRuntimeBootstrap(sandbox, options.builtins ?? []);
	const { builtins, builtinIds, importableIds } = plan;
	const validated = validateRuntimeArtifact(options.artifact, {
		builtins: importableIds,
	});
	if (!validated.ok) throw validated.error;
	const { artifact } = validated;

	const limits: RuntimeSessionLimits = {
		...DEFAULT_SESSION_LIMITS,
		...options.limits,
	};
	/**
	 * Snapshot validation runs before VM creation. That we wrote the snapshot earlier is no reason to
	 * trust this JSON. A person may have edited it, another build may have written it, or it may have
	 * been truncated in transit. A session that fails here holds no resources.
	 */
	const storyStateLimits: RuntimeStoryStateLimits = {
		...DEFAULT_STORY_STATE_LIMITS,
		...options.storyStateLimits,
	};
	const storyStateInput = validateStoryStateSnapshot(
		options.storyState ?? emptyStoryStateSnapshot(),
		storyStateLimits,
	);
	if (!storyStateInput.ok)
		throw new RuntimeHostError(
			RUNTIME_HOST_ERROR_CODE.storyStateSnapshotInvalid,
			storyStateInput.reason,
		);
	const validatedStoryState = storyStateInput.snapshot;
	const persistentStateLimits: RuntimePersistentStateLimits = {
		...DEFAULT_PERSISTENT_STATE_LIMITS,
		...options.persistentStateLimits,
	};
	const persistentStateInput = validatePersistentStateSnapshot(
		options.persistentState ?? emptyPersistentStateSnapshot(),
		persistentStateLimits,
	);
	if (!persistentStateInput.ok)
		throw new RuntimeHostError(
			RUNTIME_HOST_ERROR_CODE.storyStateSnapshotInvalid,
			persistentStateInput.reason,
		);
	const validatedPersistentState = persistentStateInput.snapshot;
	const wireLimits: RuntimeWireLimits = {
		...DEFAULT_WIRE_LIMITS,
		...options.wireLimits,
	};

	const modules = new Map<string, string>();
	for (const builtin of builtins) modules.set(builtin.id, builtin.source);
	const dependencies = new Map<string, ReadonlyMap<string, string>>();
	for (const module of artifact.modules) {
		modules.set(module.id, module.code);
		dependencies.set(
			module.id,
			new Map(module.dependencies.map((d) => [d.specifier, d.resolved])),
		);
	}
	const knownIds = new Set(modules.keys());

	/**
	 * The generation capability is added to the table only when the caller enables it explicitly. The
	 * order also matters. The caller's capabilities are spread first and generation last, so a test
	 * cannot inject a fake under the same name and hide this wiring. The capability's authorization
	 * lives in generation.ts.
	 */
	const generation =
		options.generation === undefined
			? null
			: createGenerationCapability(options.generation);
	const capabilities: RuntimeCapabilityRegistry = {
		...(options.capabilities ?? {}),
		...(generation?.capabilities ?? {}),
	};

	sessionCounter += 1;
	const id = options.sessionId ?? `runtime-vm-${sessionCounter}`;
	let session: Session | null = null;
	const createStarted = now();
	const vm = await options.engine.create({
		memoryBytes: limits.memoryBytes,
		maxStackBytes: limits.maxStackBytes,
		dispatcher: {
			moduleId: DISPATCHER_BUILTIN_ID,
			setter: "setRuntimeDispatcher",
			probe: "hasRuntimeDispatcher",
		},
		wireLimitsJson: JSON.stringify(wireLimits),
		modules,
		resolve: createResolver(dependencies, builtinIds, importableIds, knownIds),
		bindings: {
			hostCall: (capability, payload) =>
				session?.hostCall(capability, payload) ?? {
					kind: "rejected",
					code: RUNTIME_HOST_ERROR_CODE.cancelled,
					message: "session is not running",
				},
			log: (level, args) => session?.log(level, args),
			emit: (channel, json) =>
				session?.emit(channel, json) ?? {
					ok: false,
					code: RUNTIME_HOST_ERROR_CODE.cancelled,
					message: "session is not running",
				},
		},
	});
	session = new Session(
		id,
		vm,
		new Set(builtins.filter((m) => m.internal === true).map((m) => m.id)),
		capabilities,
		limits,
		wireLimits,
		options.onConsole,
		options.scheduling,
	);
	session.timings.createVmMs = now() - createStarted;
	session.entryModuleId = artifact.entry;
	/**
	 * The authorization list comes from the validated value. Reading it from the raw JSON
	 * (options.artifact) would let a shape that validation rejected reach the resolver. The list would
	 * then be what the artifact claims, not what was verified.
	 */
	session.remoteAssets = Object.freeze(
		new Set(artifact.remoteAssets ?? []),
	) as ReadonlySet<string>;
	session.generationCapability = generation;
	session.storyStateLimits = storyStateLimits;
	session.onStoryStateCommit = options.onStoryStateCommit;
	session.persistentStateLimits = persistentStateLimits;
	session.onPersistentStateCommit = options.onPersistentStateCommit;
	/**
	 * Unknown entries stay here. The VM accepts only defined keys. A key whose definition was removed
	 * stays in this store and is included in the next export. If an author removes a module briefly
	 * and reattaches it, that must not erase the player's progress.
	 */
	session.storyStore.restore(validatedStoryState);
	session.persistentStore.restore(validatedPersistentState);
	const bootstrapStarted = now();

	const bootstrapSlice: RuntimeVmSlice = {
		deadline: now() + limits.executionMs,
		now,
		isCancelled: () => false,
	};
	const bootstrapped = vm.bootstrap(
		plan.stages.flatMap((stage) => stage.moduleIds),
		bootstrapSlice,
	);
	if (!bootstrapped.ok) {
		vm.dispose();
		throw new RuntimeHostError(
			RUNTIME_HOST_ERROR_CODE.vmInitializationFailed,
			bootstrapped.failure.kind === "thrown" ||
				bootstrapped.failure.kind === "engine"
				? bootstrapped.failure.message
				: bootstrapped.failure.kind,
		);
	}
	session.state = transition(session.state, "ready");
	session.timings.bootstrapMs = now() - bootstrapStarted;

	const evaluateStarted = now();
	const evaluated = await session.evaluateGraph(
		artifact.entry,
		artifact.modules.map((module) => module.id),
	);
	if (!evaluated.ok) {
		await session.dispose();
		throw new RuntimeHostError(
			RUNTIME_HOST_ERROR_CODE.moduleEvaluationFailed,
			`creator module graph failed to evaluate: ${evaluated.error.message}`,
			evaluated.error,
		);
	}
	session.timings.evaluateGraphMs = now() - evaluateStarted;

	/**
	 * Story-state hydration runs after the author graph is evaluated and before the session is handed
	 * out. Two reasons. Definitions are registered during module evaluation, so before that it is
	 * unknown what to hydrate. And a half-hydrated session, if exposed, would show `initial` on its
	 * first render and then switch to the saved values. That frame would be wrong.
	 *
	 * A failure here stops the session from starting: a migration failure, a newer snapshot version,
	 * or a broken snapshot. It is not classified as an engine failure. The cause is in `cause`, and
	 * the author usually has to fix it.
	 */
	const storyStateHydrated = await session.hydrateDurableState(
		validatedStoryState,
		validatedPersistentState,
	);
	if (!storyStateHydrated.ok) {
		await session.dispose();
		throw new RuntimeHostError(
			RUNTIME_HOST_ERROR_CODE.storyStateBootstrapFailed,
			`story state could not be hydrated: ${storyStateHydrated.error.message}`,
			storyStateHydrated.error,
		);
	}
	return session;
}
