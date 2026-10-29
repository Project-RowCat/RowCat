import type { RuntimeWireValue } from "./wire.ts";

/**
 * Host capabilities: the list of what the sandbox may request from the outside world. It is an
 * explicit table looked up by name, not reflection. Calling a host object's property by string, as
 * in `host[name](payload)`, would make `constructor`, `__proto__`, and `toString` capabilities.
 * Only ad-hoc name checks would stop that. A name missing from the table fails.
 */
export interface RuntimeHostCallContext {
	readonly sessionId: string;
	readonly callId: number;
	/**
	 * Aborted when the session is disposed. This is host-side implementation state that creator code
	 * never sees.
	 */
	readonly signal: AbortSignal;
	/**
	 * Where the execution that made this call started. Authorization can differ per capability, and
	 * this is the only fact needed for that decision that the VM cannot forge: the host creates each
	 * execution and names it. Today only generation reads this value, and its rule is one line: only
	 * `event` is user interaction. Stages inside the VM (`render`, `effect`) cannot answer this. When
	 * an event handler passes an `await`, the continuation's stage is `idle`, but it is the same
	 * execution, and a generation called there is still the result of the button the user pressed.
	 */
	readonly origin: RuntimeHostCallOrigin;
}

/**
 * Origin of an execution, named by the host:
 * - event: `dispatchEvent` for a press or an input, the only execution started by user interaction
 * - media: `dispatchEvent` for an event the platform raised by itself (a sound reaching its end). It
 *   goes through the same handler path as a press but is not a press, so whatever requires an
 *   interaction (generation) refuses it. Folded into `event`, `<Audio onEnded>` could call
 *   `generate()` in a loop with nobody touching the screen.
 * - mount: `mountRoot`
 * - render: flushRender requested by the VM
 * - effects: flushEffects requested by the VM
 * - commands: flushCommands requested by the VM. It only drains a queue to the port and runs no
 *   creator code.
 * - unmount: `unmountRoot`
 * - call: `callExport`, used by harnesses, tests, and later surfaces
 * - graph, bind: module graph evaluation and dispatcher binding, part of boot
 */
/**
 * What raised an event, as the trusted renderer saw it. Creator code cannot name this: the renderer
 * decides it at the DOM or native callback, before anything crosses into the VM.
 */
export type RuntimeEventSource = "interaction" | "media";

export type RuntimeHostCallOrigin =
	| "event"
	| "media"
	| "mount"
	| "render"
	| "effects"
	| "commands"
	| "unmount"
	| "call"
	| "graph"
	| "bind";

export type RuntimeCapabilityHandler = (
	payload: RuntimeWireValue,
	context: RuntimeHostCallContext,
) => Promise<RuntimeWireValue> | RuntimeWireValue;

export interface RuntimeCapabilityRegistry {
	readonly [name: string]: RuntimeCapabilityHandler;
}

export type RuntimeConsoleLevel = "log" | "warn" | "error";

/**
 * The sink the sandbox `console` reaches. Arguments arrive already serialized as wire values.
 * Neither host objects nor VM handles reach this sink.
 */
export type RuntimeConsoleSink = (
	level: RuntimeConsoleLevel,
	args: readonly RuntimeWireValue[],
) => void;

/**
 * Session limits. These are not production values: they are conservative PoC defaults that tests
 * override. That limits exist, and where they are enforced, is the structure. The numbers are
 * decided in Phase 4.
 */
export interface RuntimeSessionLimits {
	/**
	 * Time one `callExport` may spend inside the VM, in milliseconds. Time spent waiting on the host
	 * is not counted.
	 */
	executionMs: number;
	/**
	 * Linear memory cap for the VM, enforced per session through the `maximum` of
	 * `WebAssembly.Memory`. It cannot go below the Emscripten build's initial memory (16MiB).
	 */
	memoryBytes: number;
	/**
	 * VM stack limit. Runaway recursion becomes a `RangeError` here. The engine cuts off at its own
	 * safe limit (128KiB in QuickJS). Above that, the host thread's stack would overflow and the
	 * failure would leak into the host.
	 */
	maxStackBytes: number;
	maxPendingHostCalls: number;
	maxHostCallsPerExecution: number;
	maxJobsPerSlice: number;
	/**
	 * Maximum number of console lines the session forwards to the host. Lines beyond it are dropped
	 * silently.
	 */
	maxConsoleLines: number;
}

export const DEFAULT_SESSION_LIMITS: RuntimeSessionLimits = Object.freeze({
	executionMs: 1_000,
	memoryBytes: 32 * 1024 * 1024,
	maxStackBytes: 128 * 1024,
	maxPendingHostCalls: 32,
	maxHostCallsPerExecution: 1_000,
	maxJobsPerSlice: 1_000,
	maxConsoleLines: 1_000,
});
