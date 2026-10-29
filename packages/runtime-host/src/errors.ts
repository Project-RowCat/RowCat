/**
 * Error model for the runtime host. It separates creator failures from host failures.
 * - CreatorExecutionError: creator code threw. This happened inside the VM. The stack is mapped
 *   back through module ids.
 * - RuntimeHostError: a problem with the VM, the bridge, the artifact, or a limit. Its code says
 *   what went wrong.
 *
 * The two stay separate classes because their consumers differ. The first is a value the studio's
 * Problems view draws. The second is either our bug (engine or bridge) or a sign that the creator
 * exceeded a limit. Folding them together would put 'memory limit exceeded' beside the creator's
 * TypeError in the same shape, and the creator would then search their own code for the cause.
 *
 * Engine messages are not part of the contract. QuickJS reports interrupts as `InternalError:
 * interrupted` and out-of-memory as `out of memory`. That mapping stays inside the adapter
 * (`vm/quickjs.ts`). The codes here are ours and do not change when the engine changes.
 */

export const RUNTIME_HOST_ERROR_CODE = {
	artifactInvalid: "runtime_artifact_invalid",
	/**
	 * The runtime build to install does not match this host's version or digest. Raised before the VM
	 * is created.
	 */
	sandboxIncompatible: "runtime_sandbox_incompatible",
	vmInitializationFailed: "runtime_vm_initialization_failed",
	moduleEvaluationFailed: "runtime_module_evaluation_failed",
	moduleUnknown: "runtime_module_unknown",
	exportMissing: "runtime_export_missing",
	exportNotCallable: "runtime_export_not_callable",
	wireValueInvalid: "runtime_wire_value_invalid",
	hostCapabilityUnknown: "runtime_host_capability_unknown",
	hostCallFailed: "runtime_host_call_failed",
	hostCallLimitExceeded: "runtime_host_call_limit_exceeded",
	executionBudgetExceeded: "runtime_execution_budget_exceeded",
	/** A promise never settles: no host call is pending and no work remains. */
	executionStalled: "runtime_execution_stalled",
	memoryLimitExceeded: "runtime_memory_limit_exceeded",
	cancelled: "runtime_cancelled",
	disposed: "runtime_disposed",
	/**
	 * A session used after an earlier fatal failure. The VM state cannot be trusted, so the session is
	 * not re-entered.
	 */
	sessionFailed: "runtime_session_failed",
	internalVmError: "runtime_internal_vm_error",
	rootNotMounted: "runtime_root_not_mounted",
	/** A patch batch emitted by the VM is outside the wire shape. The host is the final authority. */
	patchBatchInvalid: "runtime_patch_batch_invalid",
	/** The patch batch exceeded a host limit: bytes, patch count, or node count. */
	patchLimitExceeded: "runtime_patch_limit_exceeded",
	/**
	 * The durable snapshot handed to the session is outside the contract. Raised before the VM is
	 * created.
	 */
	storyStateSnapshotInvalid: "runtime_story_state_snapshot_invalid",
	/**
	 * Durable-state hydration failed: validation, migration, or version check. This is not an engine
	 * failure. The cause is in `cause`, usually a `CreatorExecutionError`, whose `runtimeCode` says
	 * what went wrong.
	 */
	storyStateBootstrapFailed: "runtime_story_state_bootstrap_failed",
	/**
	 * A durable-state delta emitted by the VM is outside the contract. The host is the final
	 * authority.
	 */
	storyStateCommitInvalid: "runtime_story_state_commit_invalid",

	/*
	 * Generation capability (Phase 6C). These strings must match `RUNTIME_ERROR_CODE` in
	 * `@rowcat/runtime` exactly. A capability handler's `RuntimeHostError` code crosses the bridge and
	 * becomes a `RuntimeError` inside the VM. If the two vocabularies diverged, a translation table
	 * would sit at that point, and one side would eventually be fixed without the other. Keeping them
	 * identical makes the mapping an identity.
	 */
	generationUnavailable: "runtime_generation_unavailable",
	/**
	 * The execution did not start from user interaction. Requests from effects, rendering, or
	 * background work are not billed.
	 */
	generationNotAuthorized: "runtime_generation_not_authorized",
	generationInsufficientBalance: "runtime_generation_insufficient_balance",
	/** A generation is already running. There is one per session. */
	generationBusy: "runtime_generation_busy",
	/** Cancelled by session disposal or surface shutdown. */
	generationCancelled: "runtime_generation_cancelled",
	generationInvalidRequest: "runtime_generation_invalid_request",
	/** The provider or network failed. The original error never reaches the VM. */
	generationFailed: "runtime_generation_failed",
} as const;

export type RuntimeHostErrorCode =
	(typeof RUNTIME_HOST_ERROR_CODE)[keyof typeof RUNTIME_HOST_ERROR_CODE];

const CODES: ReadonlySet<string> = new Set(
	Object.values(RUNTIME_HOST_ERROR_CODE),
);

export const isRuntimeHostErrorCode = (
	value: unknown,
): value is RuntimeHostErrorCode =>
	typeof value === "string" && CODES.has(value);

/**
 * Key of the marker that trusted sandbox code attaches to host errors. If an error object created
 * inside the VM has a string property with this name whose value is our code, the host reads it as
 * a `RuntimeHostError`, not as a creator error. Creator code can forge this property. The only gain
 * is that the creator's own error is classified as a host error; no privilege follows.
 */
export const HOST_ERROR_MARK = "rowcatHostCode";

/** Property where a `RuntimeError`'s code lives. The `@rowcat/runtime` class uses this name. */
export const RUNTIME_CODE_MARK = "code";

/**
 * Property name the reconciler uses to attach a component stack to render errors. Matches
 * `COMPONENT_STACK_MARK` in `@rowcat/runtime`.
 */
export const COMPONENT_STACK_MARK = "rowcatComponentStack";

export class RuntimeHostError extends Error {
	readonly code: RuntimeHostErrorCode;

	/** `cause` is for tracing back. If a creator error is the cause, it is stored here. */
	constructor(code: RuntimeHostErrorCode, message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "RuntimeHostError";
		this.code = code;
	}
}

/**
 * One frame of the creator's stack. If the engine gives no location, there is no line or column.
 */
export interface CreatorStackFrame {
	functionName: string | null;
	moduleId: string | null;
	line: number | null;
	column: number | null;
}

/**
 * An error thrown by creator code. `name` and `message` are copied from the VM value as is. `stack`
 * is not a string but frames that we parsed. If the engine's stack string format became a consumer
 * contract, the studio would break the day the engine changed. Module ids belong to the artifact,
 * so they match the names the creator sees in the editor.
 */
export class CreatorExecutionError extends Error {
	readonly creatorName: string;
	readonly frames: readonly CreatorStackFrame[];
	/**
	 * The runtime code, such as `runtime_hook_order_changed`. Present only when a `RuntimeError` was
	 * thrown, not for a creator's plain `TypeError`. It is a different vocabulary from the host error
	 * codes.
	 */
	readonly runtimeCode: string | null;
	/**
	 * The chain of component names the reconciler attached, such as App, Panel, Leaf. Empty outside
	 * rendering.
	 */
	readonly componentStack: readonly string[];

	constructor(
		creatorName: string,
		message: string,
		frames: readonly CreatorStackFrame[],
		extra: { runtimeCode?: string | null; componentStack?: string | null } = {},
	) {
		super(message);
		this.name = "CreatorExecutionError";
		this.creatorName = creatorName;
		this.frames = frames;
		this.runtimeCode = extra.runtimeCode ?? null;
		this.componentStack =
			extra.componentStack === undefined || extra.componentStack === null
				? []
				: extra.componentStack.split(" > ").filter((name) => name.length > 0);
	}
}

export type RuntimeExecutionError = CreatorExecutionError | RuntimeHostError;

/**
 * Folds the engine's stack string into frames. The one recognized format is `at <name>
 * (<module>:<line>:<column>)`. A line that does not match becomes a frame with only a name. Such
 * lines are kept because they still mark a place creator code passed through. Modules the host
 * injected (`<rowcat:...>`) are removed because they are not creator code.
 */
/**
 * Upper bound on frame count. One recursive call in guest (creator) code can produce a stack tens
 * of thousands of lines long.
 */
const MAX_CREATOR_STACK_FRAMES = 64;

export function parseCreatorStack(stack: string): CreatorStackFrame[] {
	const frames: CreatorStackFrame[] = [];
	for (const raw of stack.split("\n")) {
		if (frames.length >= MAX_CREATOR_STACK_FRAMES) break;
		const line = raw.trim();
		if (line.length === 0) continue;
		const located = /^at\s+(.*?)\s*\((.+?):(\d+):(\d+)\)$/.exec(line);
		if (located) {
			const [, fn, moduleId, ln, col] = located;
			if (moduleId?.startsWith("<")) continue;
			frames.push({
				functionName: fn && fn.length > 0 ? fn : null,
				moduleId: moduleId ?? null,
				line: Number(ln),
				column: Number(col),
			});
			continue;
		}
		const bare =
			/^at\s+(.*?)\s*\((.+?)\)$/.exec(line) ?? /^at\s+(.*)$/.exec(line);
		if (!bare) continue;
		const moduleId = bare[2] ?? null;
		if (moduleId?.startsWith("<")) continue;
		frames.push({
			functionName: bare[1] && bare[1].length > 0 ? bare[1] : null,
			moduleId,
			line: null,
			column: null,
		});
	}
	return frames;
}
