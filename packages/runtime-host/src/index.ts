/**
 * `@rowcat/runtime-host`: the trusted host that runs a compiled `RuntimeArtifact` in an isolated
 * JavaScript VM.
 *
 * - Pipeline: artifact validation (artifact.ts), VM creation with the prelude and builtins (vm/*,
 *   builtins/*), evaluation of the creator's ESM graph (session.ts), wire round trips (wire.ts),
 *   capability requests and promise resumption (capabilities.ts), budgets, memory, call limits, and
 *   cancellation (capabilities.ts, session.ts), ending with idempotent disposal.
 * - Depends on none of React, React Native, Monaco, the authoring repo, Dexie, SQLite, the RowCat
 *   API client, generation, payments, or UI. Product packages contribute only contract shapes and
 *   constants (@rowcat/runtime-compiler/contracts, @rowcat/runtime/declarations).
 * - Never compiles. The TypeScript compiler is not imported; input is always an already-emitted
 *   artifact.
 * - No engine name in the root public API. The engine comes from the ./quickjs subpath, and the
 *   caller passes it as `engine`. The session only knows the RuntimeVmEngine interface. The engine
 *   choice is provisional (docs/creator-runtime/vm-poc.md), and reversing it is kept cheap on
 *   purpose.
 * - A sandbox PoC, not an operational security review. Already in place: separate realm, no host
 *   object exposure, zero capabilities at start, explicit serialization, CPU interrupt, memory
 *   limit, call limit, deterministic disposal. Deferred: operational numeric limits and the
 *   security review itself.
 * - The studio folder in apps/web does not import this package, and its boundary check enforces
 *   that. Phase 3 consumers are only the tests and two PoC harnesses.
 */

export {
	type ArtifactValidation,
	validateRuntimeArtifact,
} from "./artifact.ts";
export {
	BOOTSTRAP_STAGES,
	CURRENT_RUNTIME_SANDBOX,
	checkSandboxCompatibility,
	planRuntimeBootstrap,
	type RuntimeBootstrapPlan,
	type RuntimeBootstrapStage,
	type RuntimeSandboxBuild,
	type SandboxCompatibility,
} from "./bootstrap.ts";
export {
	DISPATCHER_BUILTIN_ID,
	HOST_BRIDGE_BUILTIN_ID,
	HOST_CAPABILITY_BUILTIN_ID,
	HOST_PORT_BUILTIN_ID,
	HOST_PORT_INSTALLER_BUILTIN_ID,
	PUBLIC_BUILTIN_IDS,
	RUNTIME_ROOT_BUILTIN_ID,
	RUNTIME_SANDBOX_BUILTINS,
	type RuntimeBuiltinModule,
	STORY_STATE_BUILTIN_ID,
	SYMBOLS_BUILTIN_ID,
} from "./builtins/modules.ts";
export {
	DEFAULT_SESSION_LIMITS,
	type RuntimeCapabilityHandler,
	type RuntimeCapabilityRegistry,
	type RuntimeConsoleLevel,
	type RuntimeConsoleSink,
	type RuntimeEventSource,
	type RuntimeHostCallContext,
	type RuntimeHostCallOrigin,
	type RuntimeSessionLimits,
} from "./capabilities.ts";
export {
	type CommandBatchValidation,
	type RuntimeCommandBatch,
	type RuntimeHostCommand,
	validateCommandBatch,
} from "./commands.ts";
export {
	CreatorExecutionError,
	type CreatorStackFrame,
	HOST_ERROR_MARK,
	isRuntimeHostErrorCode,
	parseCreatorStack,
	RUNTIME_HOST_ERROR_CODE,
	type RuntimeExecutionError,
	RuntimeHostError,
	type RuntimeHostErrorCode,
} from "./errors.ts";
export {
	createGenerationCapability,
	DEFAULT_GENERATION_LIMITS,
	RUNTIME_GENERATION_CAPABILITY_NAME,
	type RuntimeGenerationCapability,
	RuntimeGenerationError,
	type RuntimeGenerationFailureReason,
	type RuntimeGenerationHostContext,
	type RuntimeGenerationHostMessage,
	type RuntimeGenerationHostRequest,
	type RuntimeGenerationLimits,
	type RuntimeGenerationMetrics,
	type RuntimeGenerationOptions,
	type RuntimeGenerationPort,
	readGenerationRequest,
} from "./generation.ts";
export { type CallIdAllocator, createCallIdAllocator } from "./ids.ts";
export {
	canTransition,
	type RuntimeSessionState,
	transition,
} from "./lifecycle.ts";
export {
	assetPathOf,
	controlIdOf,
	DEFAULT_ROOT_LIMITS,
	handlerIdOf,
	type PatchBatchValidation,
	ROOT_HOST_NODE_ID,
	type RuntimeHostNodeKind,
	RuntimeHostNodeLedger,
	type RuntimeHostValue,
	type RuntimePatch,
	type RuntimePatchBatch,
	type RuntimeRootLimits,
	validatePatchBatch,
} from "./patches.ts";
export {
	canonicalPersistentStateSnapshot,
	DEFAULT_PERSISTENT_STATE_LIMITS,
	emptyPersistentStateSnapshot,
	PERSISTENT_STATE_FORMAT_VERSION,
	type PersistentStateValidation,
	type RuntimePersistentStateEntry,
	type RuntimePersistentStateLimits,
	type RuntimePersistentStateSnapshot,
	RuntimePersistentStateStore,
	validatePersistentStateSnapshot,
} from "./persistent-state.ts";
export {
	DEFAULT_BUDGET_POLICY,
	type RuntimeBudgetPolicy,
} from "./scheduler/budget.ts";
export {
	defaultSchedulerClock,
	type RuntimeHostSchedulerClock,
} from "./scheduler/clock.ts";
export {
	failureSeverity,
	type RuntimeFailureSeverity,
} from "./scheduler/failures.ts";
export {
	compareWorkOrder,
	RUNTIME_WORK_PRIORITIES,
	type RuntimeWorkPriority,
} from "./scheduler/priority.ts";
export type {
	RuntimeSchedulerMetrics,
	RuntimeSchedulerObserver,
} from "./scheduler/scheduler.ts";
export {
	createRuntimeVmSession,
	type RuntimeCallOutcome,
	type RuntimeEventOutcome,
	type RuntimeRootDiagnostic,
	type RuntimeRootHostMetrics,
	type RuntimeRootMountOptions,
	type RuntimeSessionMetrics,
	type RuntimeSessionSchedulingOptions,
	type RuntimeSessionTimings,
	type RuntimeStoryStateHostMetrics,
	type RuntimeVmSession,
	type RuntimeVmSessionOptions,
} from "./session.ts";
export {
	canonicalStoryStateSnapshot,
	DEFAULT_STORY_STATE_LIMITS,
	emptyStoryStateSnapshot,
	isStoryStateKey,
	isStoryStateVersion,
	type RuntimeStoryStateEntry,
	type RuntimeStoryStateLimits,
	type RuntimeStoryStateSnapshot,
	RuntimeStoryStateStore,
	STORY_STATE_FORMAT_VERSION,
	type StoryStateValidation,
	validateStoryStateSnapshot,
} from "./story-state.ts";
export {
	RUNTIME_STACK_LIMITS,
	type RuntimeStackLimit,
	type RuntimeVmPlatform,
} from "./vm/stack-limits.ts";
export type {
	RuntimeVmCallResult,
	RuntimeVmCreateOptions,
	RuntimeVmDispatcherSlot,
	RuntimeVmEmitDecision,
	RuntimeVmEngine,
	RuntimeVmExportRef,
	RuntimeVmFailure,
	RuntimeVmHostBindings,
	RuntimeVmHostCallDecision,
	RuntimeVmInstance,
	RuntimeVmOutcome,
	RuntimeVmPromiseRef,
	RuntimeVmPromiseState,
	RuntimeVmSlice,
} from "./vm/types.ts";
export {
	checkWireValue,
	DEFAULT_WIRE_LIMITS,
	decodeWireValue,
	encodeWireValue,
	type RuntimeWireLimits,
	type RuntimeWireValue,
	type WireCheck,
	type WireDecode,
} from "./wire.ts";
