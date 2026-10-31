/**
 * Engine adapter boundary: everything the session knows about the VM.
 *
 * No QuickJS name (`QuickJSContext`, `QuickJSHandle`, and so on) appears in this file. The session
 * (`session.ts`) sees only this interface, so changing engines means replacing one file under
 * `vm/`. Values always cross as wire strings. Handles, host objects, and promises never cross this
 * boundary.
 *
 * Slice: every synchronous section that enters the VM receives one `RuntimeVmSlice`, which carries
 * its deadline and cancellation check. The adapter wires both into the engine's interrupt handler.
 * `Promise.race(timeout)` cannot stop a synchronous infinite loop; the engine has to do it.
 *
 * Deliberately narrow: only what the PoC needs. Methods added in advance would fix their contracts
 * now, with no code yet to test those contracts.
 */

export interface RuntimeVmSlice {
	/** Deadline on the same clock as `now()`. Past it, the engine aborts execution. */
	deadline: number;
	/**
	 * Same clock as the deadline. The adapter does not read `Date.now()` directly, because the
	 * scheduler's clock may be `performance.now()`. Mixing the two clocks makes the deadline always in
	 * the past, so execution is cut at the first interrupt check. This actually happened.
	 */
	now(): number;
	/** True when the session is being disposed. Cuts execution regardless of the deadline. */
	isCancelled(): boolean;
}

/**
 * The engine folds failures inside the VM into our vocabulary. Engine error classes do not pass
 * beyond this point.
 */
export type RuntimeVmFailure =
	| {
			kind: "thrown";
			name: string;
			message: string;
			stack: string;
			/** Host error code attached by trusted code in the sandbox. Creator errors never carry it. */
			hostCode: string | null;
			/**
			 * Runtime (`RuntimeError`) code. This is the axis for creator errors such as hook order and
			 * render-time updates.
			 */
			runtimeCode?: string | null;
			/**
			 * Component stack attached by the reconciler (`App > Panel > Leaf`). Absent for errors outside
			 * render.
			 */
			componentStack?: string | null;
	  }
	| {
			kind: "interrupted";
			/**
			 * `read`: the cut came from the short budget for reading a thrown value, not from the turn's
			 * deadline. Only the message differs; the weight is the same.
			 */
			during?: "read";
	  }
	| { kind: "memory" }
	| { kind: "engine"; message: string }
	/**
	 * Lookup failed because the target is missing: the module is absent, the export is absent, or the
	 * export is not a function.
	 */
	| { kind: "lookup"; reason: "module" | "export" | "not_callable" };

export type RuntimeVmOutcome<T> =
	| { ok: true; value: T }
	| { ok: false; failure: RuntimeVmFailure };

/**
 * Opaque reference to a promise inside the VM. The adapter owns it and releases it through
 * `release`.
 */
export interface RuntimeVmPromiseRef {
	readonly id: number;
}

export type RuntimeVmCallResult =
	| { kind: "settled"; json: string }
	| { kind: "pending"; promise: RuntimeVmPromiseRef };

export type RuntimeVmPromiseState =
	| { type: "pending" }
	| { type: "fulfilled"; json: string }
	| { type: "rejected"; failure: RuntimeVmFailure };

/**
 * The synchronous question the adapter asks the session when the VM calls a native `hostCall`. The
 * session answers only whether it accepted the call. If accepted, the adapter creates a VM-side
 * promise and returns it. Actual handling starts on the host event loop after the slice ends, not
 * inside the VM. That is the entire re-entrancy guard: a host handler is never called from within
 * the VM.
 */
export type RuntimeVmHostCallDecision =
	| { kind: "accepted"; callId: number }
	| { kind: "rejected"; code: string; message: string };

/**
 * Synchronous reply from the channel through which trusted code inside the VM emits to the host.
 * Capability calls differ: the creator requests them and receives a promise. Commit batches, job
 * requests, and diagnostics come from runtime infrastructure, and the answer is only whether they
 * were received. One batch is one call, so the native bridge's millisecond cost is paid per commit
 * rather than per operation.
 */
export type RuntimeVmEmitDecision =
	| { ok: true }
	| { ok: false; code: string; message: string };

export interface RuntimeVmHostBindings {
	hostCall(capability: string, payloadJson: string): RuntimeVmHostCallDecision;
	log(level: string, argsJson: string): void;
	emit(channel: string, json: string): RuntimeVmEmitDecision;
}

/** VM value prefixed to a built-in call: one export from a creator module or a built-in module. */
export interface RuntimeVmExportRef {
	moduleId: string;
	exportName: string;
}

/**
 * Dispatcher slot placeholder. The adapter performs the binding using these names. The hook
 * implementation (the Phase 4B reconciler) is a value in the VM realm, so the host cannot pass it
 * in. The host can only say 'plug this export of this built-in module into the slot', and the
 * target can only be an internal built-in. The session enforces this. In this slice the slot is
 * empty and hooks throw deterministically.
 */
export interface RuntimeVmDispatcherSlot {
	/** The module that holds the slot (`rowcat:internal/dispatcher`). */
	moduleId: string;
	/** Export name that sets the value into the slot. Passing `null` clears it. */
	setter: string;
	probe: string;
}

export interface RuntimeVmCreateOptions {
	memoryBytes: number;
	maxStackBytes: number;
	dispatcher: RuntimeVmDispatcherSlot;
	wireLimitsJson: string;
	/**
	 * Every module the loader knows, both built-in and creator modules. Anything outside this table
	 * does not exist.
	 */
	modules: ReadonlyMap<string, string>;
	/** Normalization policy. `null` means that import fails deterministically. */
	resolve(baseId: string, specifier: string): string | null;
	bindings: RuntimeVmHostBindings;
}

export interface RuntimeVmInstance {
	/** Builds the prelude and the built-in modules. Creator code does not run yet. */
	bootstrap(
		builtinIds: readonly string[],
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<void>;
	/**
	 * Evaluates the creator module graph, entry first and the rest after. With top-level `await`, the
	 * result is a promise and goes through the session's same loop.
	 */
	evaluateGraph(
		entryId: string,
		moduleIds: readonly string[],
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<RuntimeVmCallResult>;
	/** Captures namespaces after graph evaluation finishes. Called after the promise settles. */
	adoptGraph(): RuntimeVmOutcome<void>;
	callExport(
		moduleId: string,
		exportName: string,
		argsJson: string,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<RuntimeVmCallResult>;
	/**
	 * Calls an export of a built-in module. Root mount, render, effects, and events enter the VM
	 * through this path.
	 *
	 * `leading` is a VM value prepended to the wire arguments, such as the entry point's default
	 * export. It is the only way for the host to name a value that cannot cross the wire (a function).
	 * That value lives only within this call, and no handle leaves it.
	 */
	callBuiltinExport(
		moduleId: string,
		exportName: string,
		argsJson: string,
		slice: RuntimeVmSlice,
		leading?: readonly RuntimeVmExportRef[],
	): RuntimeVmOutcome<RuntimeVmCallResult>;
	/**
	 * Promise state. The slice is needed because serializing a settled value can invoke creator
	 * getters, which must also run under the interrupt.
	 */
	promiseState(
		ref: RuntimeVmPromiseRef,
		slice: RuntimeVmSlice,
		/**
		 * If false, the settled value is not serialized. Used where the value itself is not needed, such
		 * as graph evaluation.
		 */
		wantValue?: boolean,
	): RuntimeVmPromiseState;
	release(ref: RuntimeVmPromiseRef): void;
	/**
	 * Plugs a built-in module export into the dispatcher slot (`null` clears it), or queries the
	 * slot's state. Called only between turns, never while creator code is running. The session
	 * enforces this ordering.
	 */
	bindDispatcher(
		source: { moduleId: string; exportName: string } | null,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<void>;
	hasDispatcher(slice: RuntimeVmSlice): RuntimeVmOutcome<boolean>;
	/**
	 * Delivers a host call result to the VM-side promise. The reaction runs during the next `runJobs`.
	 */
	settleHostCall(callId: number, ok: boolean, json: string): void;
	/** Runs pending VM jobs. If `more` is true, work remains. */
	runJobs(
		maxJobs: number,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<{ executed: number; more: boolean }>;
	hasPendingJobs(): boolean;
	/** Heap usage the engine reports, in bytes. `null` if unknown. */
	memoryUsedBytes(): number | null;
	dispose(): void;
}

export interface RuntimeVmEngine {
	readonly name: string;
	create(options: RuntimeVmCreateOptions): Promise<RuntimeVmInstance>;
}
