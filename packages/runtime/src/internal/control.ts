import { RUNTIME_ERROR_CODE, RuntimeError } from "./errors.ts";
import { runtimePhase } from "./phase.ts";
import { RUNTIME_CONTROL } from "./symbols.ts";

/**
 * A controller is the narrow channel through which creator code asks the host to perform one
 * command.
 *
 * It is passed as the `controller` prop (for example `<ScrollView controller={scroll}>`). Calls
 * such as `scroll.scrollToEnd()` queue a single-capability command. After commit, the reconciler
 * emits the batch to the port, and the trusted renderer maps the controller id to the host node it
 * knows.
 *
 * Not a React `ref`: a ref would hand creators a platform object. An `HTMLInputElement` exposes the
 * whole DOM, and QuickJS has no such object in the first place.
 *
 * Not a host node number: if creators could construct node ids, the API would become a general
 * command channel to any host node, and validation would be the only guard.
 *
 * The creator holds an opaque object. The integer lives under a symbol key (`RUNTIME_CONTROL` in
 * `symbols.ts`), and that module is outside the compiler's allowlist, so creators cannot write the
 * syntax to reach it.
 *
 * Lifetime follows ordinary prop rules: `{ "$control": 7 }` is set on mount, kept on move, removed
 * by remove-prop, and dropped with the subtree on unmount.
 *
 * Control ids are never reused within a session, so a stale controller never points at a new node.
 */

/** Kind of controller. The kind decides which primitives a controller may attach to. */
export type RuntimeControlKind = "scroll" | "text-entry";

export interface RuntimeControlRef {
	readonly id: number;
	readonly kind: RuntimeControlKind;
}

/** Internal to one controller. Creator code cannot write this key. */
export interface RuntimeControlled {
	readonly [RUNTIME_CONTROL]: RuntimeControlRef;
}

/**
 * Controller ids increase monotonically within a session and are never reused. The counter is
 * module-level, as for host node ids. After a root is disposed and remounted, a renderer may still
 * hold an old table. Reusing an id would let that table point at a new controller.
 */
let nextControlId = 1;

export function allocateRuntimeControl(
	kind: RuntimeControlKind,
): RuntimeControlRef {
	const ref: RuntimeControlRef = Object.freeze({ id: nextControlId, kind });
	nextControlId += 1;
	return ref;
}

export function isRuntimeControl(value: unknown): value is RuntimeControlled {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { [RUNTIME_CONTROL]?: unknown })[RUNTIME_CONTROL] ===
			"object"
	);
}

export function runtimeControlRef(value: unknown): RuntimeControlRef | null {
	return isRuntimeControl(value)
		? (value as RuntimeControlled)[RUNTIME_CONTROL]
		: null;
}

/**
 * One controller command, as a finite discriminated union rather than a method name. There is no
 * `runtime.callNodeMethod(id, "scrollTo", ...)` shape for this reason: once a string selects the
 * operation, the set of strings becomes the host API, and that set diverges as platforms are added.
 */
export type RuntimeHostCommand =
	| {
			readonly op: "scroll";
			readonly control: number;
			readonly to: "start" | "end";
	  }
	| {
			readonly op: "scroll";
			readonly control: number;
			readonly to: "offset";
			readonly offset: number;
	  }
	| { readonly op: "focus"; readonly control: number }
	| { readonly op: "blur"; readonly control: number };

/**
 * The receiving end of commands. The root fills it, and this module does not know what is on the
 * other side (same shape and reason as `host-port.ts`). With no root, for example a late callback
 * after disposal, commands are silently dropped. Throwing would let cleanup code for an
 * already-gone screen kill the creator's execution.
 */
export interface RuntimeCommandSink {
	enqueue(control: RuntimeControlRef, command: RuntimeHostCommand): void;
}

let sink: RuntimeCommandSink | null = null;

export function setRuntimeCommandSink(
	next: RuntimeCommandSink | null,
): RuntimeCommandSink | null {
	const previous = sink;
	sink = next;
	return previous;
}

export function hasRuntimeCommandSink(): boolean {
	return sink !== null;
}

/**
 * Submits one command: checks the phase first, then hands it to the root. The phase check lives
 * here so the answer is the same whether or not a root exists. A call during render is a creator
 * error regardless of the root, and that error must not look different from one deployment to the
 * next.
 */
export function submitRuntimeCommand(
	control: RuntimeControlRef,
	command: RuntimeHostCommand,
): void {
	const phase = runtimePhase();
	if (phase === "render" || phase === "commit")
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hostCommandInvalidPhase,
			"Scroll and focus commands can't be called during render. Call them in an event handler or an effect.",
		);
	sink?.enqueue(control, command);
}
