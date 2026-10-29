import {
	newQuickJSWASMModuleFromVariant,
	newVariant,
	type QuickJSContext,
	type QuickJSDeferredPromise,
	type QuickJSHandle,
	type QuickJSRuntime,
	type QuickJSSyncVariant,
	type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import {
	PRELUDE_MODULE_ID,
	RUNTIME_PRELUDE_SOURCE,
} from "../builtins/prelude.ts";
import {
	COMPONENT_STACK_MARK,
	HOST_ERROR_MARK,
	RUNTIME_CODE_MARK,
} from "../errors.ts";
import type {
	RuntimeVmCallResult,
	RuntimeVmCreateOptions,
	RuntimeVmEngine,
	RuntimeVmExportRef,
	RuntimeVmFailure,
	RuntimeVmInstance,
	RuntimeVmOutcome,
	RuntimeVmPromiseRef,
	RuntimeVmPromiseState,
	RuntimeVmSlice,
} from "./types.ts";

/**
 * QuickJS (quickjs-emscripten) adapter. This is the only file that knows the engine.
 * - Engine names stay in this file. Sessions see only the interfaces in `types.ts`. Replacing the
 *   engine means replacing this file, which `boundaries.test.ts` enforces.
 * - The caller picks the variant and the WASM byte source: a file on Node, an asset URL in
 *   browsers, or bundled bytes in WebView. WASM is compiled once per engine (memoized). Each
 *   session creates its own runtime and context.
 * - Engine errors are folded into our vocabulary only in `classify`. `InternalError: interrupted`
 *   maps to `interrupted`, and `InternalError: out of memory` maps to `memory`. A creator can
 *   imitate this by throwing such an error, but only their own session fails.
 * - The `Eval` intrinsic is not disabled. `Eval: false` blocks `JS_Eval` itself, which makes
 *   modules unevaluable. The prelude blocks dynamic code instead. That is not isolation, and the
 *   prelude header says so.
 * - Handles stay inside this file. Instances own the namespaces, promises, and trusted functions,
 *   and `dispose` releases them. Temporary handles are released in `try/finally`, since handle
 *   leaks become crashes in sessions that are opened repeatedly.
 */

export interface QuickJsEngineOptions {
	/**
	 * The WASM binary is required. Whether it comes from a file (Node), an asset URL (browser), or
	 * bundled bytes (WebView) is the caller's concern. This adapter accepts only bytes.
	 */
	wasmBinary: ArrayBuffer | (() => Promise<ArrayBuffer>);
	/**
	 * Upper bound on the QuickJS stack (bytes) this platform may let a session request. The session's
	 * `maxStackBytes` is clamped to this value. The default is `QUICKJS_MAX_STACK_BYTES`. A platform
	 * adapter passes a value it measured on its own thread stack (`vm/stack-limits.ts`). Not exposed
	 * to creator code.
	 */
	stackCeilingBytes?: number;
}

/**
 * Upper bound on the QuickJS stack a session may request. The host thread stack is the real limit.
 *
 * QuickJS checks C stack usage inside the Emscripten linear memory. WASM call frames, however, sit
 * on the host thread's native stack (V8 places JS and WASM frames on one stack), and part of that
 * stack is already used when host JS enters the VM. A low QuickJS limit can therefore still
 * overflow when entry is deep. The overflow leaks a `RangeError` to the host and corrupts the
 * runtime (an assertion in `JS_FreeRuntime`).
 *
 * Measured with quickjs-ng 0.12.1, quickjs-emscripten 0.32.0, and Node 22: on a shallow stack
 * (tsx), 256 KiB was caught cleanly and leaks began at 320 KiB. On a deeper stack (vitest worker),
 * even 256 KiB leaked. 128 KiB (recursion depth about 800) was clean in both. The margin differs
 * per platform, so Phase 4 must re-measure on each (`docs/creator-runtime/vm-poc.md`).
 */
export const QUICKJS_MAX_STACK_BYTES = 128 * 1024;

/**
 * The subset of `WebAssembly` this file uses, typed here so tsconfig pulls in neither DOM nor Node
 * types. Browsers, Node, and WebView all provide the same standard object, and this file calls only
 * two members.
 */
interface WasmMemory {
	readonly buffer: ArrayBuffer;
}
interface WasmApi {
	compile(bytes: ArrayBuffer): Promise<WebAssembly.Module>;
	Memory: new (descriptor: { initial: number; maximum: number }) => WasmMemory;
}
const wasm = (): WasmApi =>
	(globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

/**
 * Initial linear memory of the Emscripten build (16 MiB). The session memory limit cannot go below
 * this.
 */
const WASM_PAGE_BYTES = 65_536;
const WASM_INITIAL_PAGES = 256;

/**
 * One engine. WASM is compiled once and instantiated fresh for each session.
 *
 * The per-session instance is the whole reason for the memory limit. `setMemoryLimit` effectively
 * does nothing in this build: QuickJS accounting relies on `malloc_usable_size`, which the
 * Emscripten build does not provide, so accounting stays at 0. The limit then rejects only a single
 * allocation larger than the whole limit (observed: the VM grew to 2 GiB under an 8 MiB limit).
 * Setting `WebAssembly.Memory.maximum` to the session's limit makes growth fail at that point, and
 * QuickJS reports it as an ordinary `out of memory` (observed: 34 ms at a 32 MiB limit). The memory
 * belongs to the instance, so each session has its own, which adds one more layer of isolation
 * between sessions.
 */
export function createQuickJsEngine(
	variant: QuickJSSyncVariant,
	options: QuickJsEngineOptions,
): RuntimeVmEngine {
	let compiling: Promise<WebAssembly.Module> | null = null;
	const compile = (): Promise<WebAssembly.Module> => {
		if (compiling === null)
			compiling = (async () => {
				const binary =
					typeof options.wasmBinary === "function"
						? await options.wasmBinary()
						: options.wasmBinary;
				return wasm().compile(binary);
			})();
		return compiling;
	};
	return {
		name: "quickjs-emscripten",
		create: async (createOptions) => {
			const wasmModule = await compile();
			const maximum = Math.max(
				WASM_INITIAL_PAGES,
				Math.ceil(createOptions.memoryBytes / WASM_PAGE_BYTES),
			);
			const memory = new (wasm().Memory)({
				initial: WASM_INITIAL_PAGES,
				maximum,
			});
			const module = await newQuickJSWASMModuleFromVariant(
				newVariant(variant, {
					wasmModule,
					wasmMemory: memory as never,
				}),
			);
			return new QuickJsInstance(
				module,
				memory,
				createOptions,
				options.stackCeilingBytes ?? QUICKJS_MAX_STACK_BYTES,
			);
		},
	};
}

/**
 * Limits applied before guest-chosen strings leave the host. The values are not production
 * settings.
 */
const MAX_ERROR_MESSAGE_CHARS = 4 * 1024;
const MAX_ERROR_STACK_CHARS = 16 * 1024;

/**
 * How long reading a thrown value may take (`classify`). An error's `name`, `message` and `stack`
 * read in microseconds; this exists for the value whose getters were written to never return.
 */
const CLASSIFY_BUDGET_MS = 25;

/**
 * Classification before any slice has run (a failure while the prelude installs) has no clock to
 * borrow. Creator code is not running yet then, so a slice that interrupts at the first check loses
 * nothing real.
 */
const CLASSIFY_WITHOUT_CLOCK: RuntimeVmSlice = {
	deadline: 0,
	now: () => 1,
	isCancelled: () => true,
};

/** A thrown value that could not be read in time, or whose reading threw. */
const UNREADABLE_FAILURE: RuntimeVmFailure = {
	kind: "thrown",
	name: "Error",
	message: "",
	stack: "",
	hostCode: null,
};
const MAX_CONSOLE_LINE_CHARS = 64 * 1024;
const clip = (value: string, max: number): string =>
	value.length > max ? `${value.slice(0, max)}…` : value;

const BUILTINS_MODULE_ID = "<rowcat:builtins>";
const GRAPH_MODULE_ID = "<rowcat:graph>";

interface TrustedFunctions {
	serialize: QuickJSHandle;
	deserialize: QuickJSHandle;
	invoke: QuickJSHandle;
	invokeWith: QuickJSHandle;
}

class QuickJsInstance implements RuntimeVmInstance {
	private readonly runtime: QuickJSRuntime;
	private readonly context: QuickJSContext;
	private readonly memory: WasmMemory;
	private readonly options: RuntimeVmCreateOptions;
	private currentSlice: RuntimeVmSlice | null = null;
	/** The most recent slice, kept after it ends only for its clock and cancellation (`classify`). */
	private lastSlice: RuntimeVmSlice | null = null;
	private trusted: TrustedFunctions | null = null;
	private readonly namespaces = new Map<string, QuickJSHandle>();
	private readonly builtinNamespaces = new Map<string, QuickJSHandle>();
	private readonly promises = new Map<number, QuickJSHandle>();
	private readonly deferreds = new Map<number, QuickJSDeferredPromise>();
	private nextPromiseId = 1;
	private graphRef: RuntimeVmPromiseRef | null = null;
	private disposed = false;

	constructor(
		module: QuickJSWASMModule,
		memory: WasmMemory,
		options: RuntimeVmCreateOptions,
		stackCeilingBytes: number,
	) {
		this.options = options;
		this.memory = memory;
		this.runtime = module.newRuntime();
		/**
		 * Accounting is broken in this build, so this is effectively decorative. On a working build it
		 * adds one more limit.
		 */
		this.runtime.setMemoryLimit(options.memoryBytes);
		this.runtime.setMaxStackSize(
			Math.min(options.maxStackBytes, stackCeilingBytes),
		);
		this.context = this.runtime.newContext();
		/**
		 * The interrupt handler is set once, and the slice decides its outcome. The VM should never run
		 * outside a slice. If it does, the handler errs toward not interrupting. That state is an adapter
		 * bug, and it is not reported as a budget overrun.
		 */
		this.runtime.setInterruptHandler(() => {
			const slice = this.currentSlice;
			if (slice === null) return false;
			return slice.isCancelled() || slice.now() > slice.deadline;
		});
		this.runtime.setModuleLoader(
			(name) => {
				const source = options.modules.get(name);
				return source === undefined
					? { error: new Error(`unknown module ${name}`) }
					: source;
			},
			(base, specifier) => {
				const resolved = options.resolve(base, specifier);
				return resolved === null
					? { error: new Error(`cannot resolve "${specifier}" from ${base}`) }
					: resolved;
			},
		);
	}

	private slice<T>(slice: RuntimeVmSlice, fn: () => T): T {
		this.currentSlice = slice;
		this.lastSlice = slice;
		try {
			return fn();
		} finally {
			this.currentSlice = null;
		}
	}

	private hostErrorHandle(code: string, message: string): QuickJSHandle {
		const error = this.context.newError({ name: "RowCatHostError", message });
		const codeHandle = this.context.newString(code);
		try {
			this.context.defineProp(error, HOST_ERROR_MARK, {
				value: codeHandle,
				enumerable: false,
				configurable: false,
			});
		} finally {
			codeHandle.dispose();
		}
		return error;
	}

	/**
	 * Converts an error handle inside the VM into our vocabulary. The handle is released here.
	 *
	 * **Reading a thrown value can run creator code** — a `toJSON`, a getter on `name`/`message`/
	 * `stack`, a proxy trap — and this runs after the execution's slice has ended, where the interrupt
	 * handler never interrupts. It used to read through `context.dump`, which also calls
	 * `JSON.stringify`, so `throw { toJSON() { for (;;) {} } }` ran unbounded on the host thread: past the
	 * execution budget, past stop and dispose. So classification gets a slice of its own
	 * (`CLASSIFY_BUDGET_MS`, on the clock of the slice that just ran) and reads three properties instead
	 * of dumping the value. A read that is interrupted or throws folds to an unnamed creator error.
	 *
	 * Not dumping objects also closes the second defect: `dump` disposes a promise's handle itself,
	 * after which reading or disposing that handle here was a use-after-free that escaped the scheduler
	 * as an unhandled rejection (`throw new Promise(() => {})` killed a Node host).
	 */
	private classify(error: QuickJSHandle): RuntimeVmFailure {
		const outer = this.currentSlice;
		const basis = outer ?? this.lastSlice;
		this.currentSlice =
			basis === null
				? CLASSIFY_WITHOUT_CLOCK
				: {
						deadline: basis.now() + CLASSIFY_BUDGET_MS,
						now: () => basis.now(),
						isCancelled: () => basis.isCancelled(),
					};
		try {
			return this.readFailure(error);
		} catch {
			return UNREADABLE_FAILURE;
		} finally {
			this.currentSlice = outer;
			if (error.alive) error.dispose();
		}
	}

	private readFailure(error: QuickJSHandle): RuntimeVmFailure {
		const type = this.context.typeof(error);
		/** Primitives carry no code to run; `dump` only reads them. */
		if (type !== "object" && type !== "function")
			return {
				kind: "thrown",
				name: "Error",
				message: clip(
					String(this.context.dump(error)),
					MAX_ERROR_MESSAGE_CHARS,
				),
				stack: "",
				hostCode: null,
			};
		const name = this.stringProp(error, "name");
		const message = this.stringProp(error, "message");
		const stack = this.stringProp(error, "stack");
		/**
		 * Creator-defined strings are clipped here. Guest code can make `name`, `message`, and `stack`
		 * arbitrarily long. Passed through unchanged, diagnostics, UI, and logs would carry that size.
		 */
		const errorName = clip(name ?? "Error", 256);
		const errorMessage = clip(message ?? "", MAX_ERROR_MESSAGE_CHARS);
		if (errorName === "InternalError") {
			if (errorMessage === "interrupted") return { kind: "interrupted" };
			if (errorMessage.includes("out of memory")) return { kind: "memory" };
		}
		const hostCode = this.stringProp(error, HOST_ERROR_MARK);
		/**
		 * The runtime code is read only from `RuntimeError`. Creators may attach `code` to their own
		 * errors, but that value must not be read in the runtime's vocabulary.
		 */
		const runtimeCode =
			errorName === "RuntimeError"
				? this.stringProp(error, RUNTIME_CODE_MARK)
				: null;
		return {
			kind: "thrown",
			name: errorName,
			message: errorMessage,
			stack: clip(stack ?? "", MAX_ERROR_STACK_CHARS),
			hostCode,
			runtimeCode,
			componentStack: this.stringProp(error, COMPONENT_STACK_MARK),
		};
	}

	private stringProp(error: QuickJSHandle, name: string): string | null {
		const handle = this.context.getProp(error, name);
		try {
			return this.context.typeof(handle) === "string"
				? this.context.getString(handle)
				: null;
		} finally {
			handle.dispose();
		}
	}

	private engineFailure(cause: unknown): RuntimeVmOutcome<never> {
		return {
			ok: false,
			failure: {
				kind: "engine",
				message: cause instanceof Error ? cause.message : String(cause),
			},
		};
	}

	private installNative(): void {
		const { context } = this;
		const { bindings, wireLimitsJson } = this.options;
		const native = context.newObject();
		const hostCall = context.newFunction("hostCall", (capability, payload) => {
			const decision = bindings.hostCall(
				context.typeof(capability) === "string"
					? context.getString(capability)
					: "",
				context.typeof(payload) === "string" ? context.getString(payload) : "",
			);
			if (decision.kind === "rejected")
				return { error: this.hostErrorHandle(decision.code, decision.message) };
			const deferred = context.newPromise();
			this.deferreds.set(decision.callId, deferred);
			return deferred.handle;
		});
		const log = context.newFunction("log", (level, args) => {
			/**
			 * A console line's size is also set by the guest, so characters are clipped separately from the
			 * line-count limit.
			 */
			bindings.log(
				context.typeof(level) === "string" ? context.getString(level) : "log",
				clip(
					context.typeof(args) === "string" ? context.getString(args) : "[]",
					MAX_CONSOLE_LINE_CHARS,
				),
			);
		});
		/**
		 * Export channel. It is synchronous, and the answer is one JSON string. The session never
		 * re-enters the VM from here; it only enqueues.
		 */
		const emit = context.newFunction("emit", (channel, json) => {
			const decision = bindings.emit(
				context.typeof(channel) === "string" ? context.getString(channel) : "",
				context.typeof(json) === "string" ? context.getString(json) : "",
			);
			return context.newString(JSON.stringify(decision));
		});
		const limits = context.newString(wireLimitsJson);
		try {
			context.setProp(native, "hostCall", hostCall);
			context.setProp(native, "log", log);
			context.setProp(native, "emit", emit);
			context.setProp(native, "limits", limits);
			context.setProp(context.global, "__rowcatNative", native);
		} finally {
			hostCall.dispose();
			log.dispose();
			emit.dispose();
			limits.dispose();
			native.dispose();
		}
	}

	bootstrap(
		builtinIds: readonly string[],
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<void> {
		try {
			this.installNative();
			const prelude = this.slice(slice, () =>
				this.context.evalCode(RUNTIME_PRELUDE_SOURCE, PRELUDE_MODULE_ID, {
					type: "global",
					strict: true,
				}),
			);
			if (prelude.error)
				return { ok: false, failure: this.classify(prelude.error) };
			const trusted = prelude.value;
			try {
				this.trusted = {
					serialize: this.context.getProp(trusted, "serialize"),
					deserialize: this.context.getProp(trusted, "deserialize"),
					invoke: this.context.getProp(trusted, "invoke"),
					invokeWith: this.context.getProp(trusted, "invokeWith"),
				};
			} finally {
				trusted.dispose();
			}

			/**
			 * Imports modules in plan order and holds their namespaces. The dispatcher binding finds
			 * built-in exports through this table. It is kept separate from the creator module namespaces
			 * (`namespaces`).
			 */
			const lines = builtinIds.map(
				(id, index) => `import * as b${index} from ${JSON.stringify(id)};`,
			);
			lines.push(
				`export const modules = { ${builtinIds
					.map((id, index) => `${JSON.stringify(id)}: b${index}`)
					.join(", ")} };`,
			);
			const builtins = this.slice(slice, () =>
				this.context.evalCode(lines.join("\n"), BUILTINS_MODULE_ID, {
					type: "module",
				}),
			);
			if (builtins.error)
				return { ok: false, failure: this.classify(builtins.error) };
			const adopted = this.adoptNamespaces(
				builtins.value,
				this.builtinNamespaces,
			);
			builtins.value.dispose();
			if (!adopted.ok) return adopted;

			const cleanup = this.context.evalCode(
				"delete globalThis.__rowcatBridge;",
				PRELUDE_MODULE_ID,
				{ type: "global" },
			);
			if (cleanup.error)
				return { ok: false, failure: this.classify(cleanup.error) };
			cleanup.value.dispose();
			return { ok: true, value: undefined };
		} catch (cause) {
			return this.engineFailure(cause);
		}
	}

	private track(handle: QuickJSHandle): RuntimeVmPromiseRef {
		const ref = { id: this.nextPromiseId++ };
		this.promises.set(ref.id, handle);
		return ref;
	}

	/**
	 * Folds a call or evaluation result handle into either a settled value or a promise reference.
	 * Ownership of the handle passes to this function.
	 */
	private settle(
		handle: QuickJSHandle,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<RuntimeVmCallResult> {
		const state = this.context.getPromiseState(handle);
		if (state.type === "pending")
			return {
				ok: true,
				value: { kind: "pending", promise: this.track(handle) },
			};
		if (state.type === "rejected") {
			handle.dispose();
			return { ok: false, failure: this.classify(state.error) };
		}
		try {
			if (state.notAPromise === true) return this.serialized(handle, slice);
			try {
				return this.serialized(state.value, slice);
			} finally {
				state.value.dispose();
			}
		} finally {
			handle.dispose();
		}
	}

	private serialized(
		value: QuickJSHandle,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<RuntimeVmCallResult> {
		const trusted = this.trusted;
		if (trusted === null) return this.engineFailure("vm is not bootstrapped");
		const result = this.slice(slice, () =>
			this.context.callFunction(
				trusted.serialize,
				this.context.undefined,
				value,
			),
		);
		if (result.error)
			return { ok: false, failure: this.classify(result.error) };
		try {
			return {
				ok: true,
				value: { kind: "settled", json: this.context.getString(result.value) },
			};
		} finally {
			result.value.dispose();
		}
	}

	evaluateGraph(
		entryId: string,
		moduleIds: readonly string[],
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<RuntimeVmCallResult> {
		/**
		 * The entry point comes first, so evaluation order follows the creator's import order. Other
		 * modules are already evaluated if the entry reaches them. Only modules the entry does not reach
		 * are evaluated here for the first time.
		 */
		const ordered = [entryId, ...moduleIds.filter((id) => id !== entryId)];
		const lines = ordered.map(
			(id, index) => `import * as m${index} from ${JSON.stringify(id)};`,
		);
		lines.push(
			`export const modules = { ${ordered
				.map((id, index) => `${JSON.stringify(id)}: m${index}`)
				.join(", ")} };`,
		);
		try {
			const result = this.slice(slice, () =>
				this.context.evalCode(lines.join("\n"), GRAPH_MODULE_ID, {
					type: "module",
				}),
			);
			if (result.error)
				return { ok: false, failure: this.classify(result.error) };
			const state = this.context.getPromiseState(result.value);
			if (state.type === "rejected") {
				result.value.dispose();
				return { ok: false, failure: this.classify(state.error) };
			}
			const ref = this.track(result.value);
			this.graphRef = ref;
			if (state.type === "pending")
				return { ok: true, value: { kind: "pending", promise: ref } };
			if (state.value !== result.value) state.value.dispose();
			return { ok: true, value: { kind: "settled", json: "null" } };
		} catch (cause) {
			return this.engineFailure(cause);
		}
	}

	/**
	 * Takes child namespaces from the promise or namespace of a module that exports `modules = {…}`.
	 */
	private adoptNamespaces(
		handle: QuickJSHandle,
		into: Map<string, QuickJSHandle>,
	): RuntimeVmOutcome<void> {
		try {
			const state = this.context.getPromiseState(handle);
			if (state.type === "rejected")
				return { ok: false, failure: this.classify(state.error) };
			if (state.type === "pending")
				return this.engineFailure("module namespace promise is not fulfilled");
			const namespace = state.notAPromise === true ? handle : state.value;
			const modules = this.context.getProp(namespace, "modules");
			try {
				const names = this.context.getOwnPropertyNames(modules);
				if (names.error)
					return { ok: false, failure: this.classify(names.error) };
				try {
					for (const name of names.value) {
						const id = this.context.getString(name);
						into.set(id, this.context.getProp(modules, id));
					}
				} finally {
					names.value.dispose();
				}
			} finally {
				modules.dispose();
				if (namespace !== handle) namespace.dispose();
			}
			return { ok: true, value: undefined };
		} catch (cause) {
			return this.engineFailure(cause);
		}
	}

	adoptGraph(): RuntimeVmOutcome<void> {
		const ref = this.graphRef;
		const handle = ref === null ? undefined : this.promises.get(ref.id);
		if (handle === undefined)
			return this.engineFailure("graph was not evaluated");
		return this.adoptNamespaces(handle, this.namespaces);
	}

	/** One export from a built-in namespace. The caller releases it. */
	private builtinExport(
		moduleId: string,
		exportName: string,
	): QuickJSHandle | null {
		const namespace = this.builtinNamespaces.get(moduleId);
		if (namespace === undefined) return null;
		const value = this.context.getProp(namespace, exportName);
		if (this.context.typeof(value) === "undefined") {
			value.dispose();
			return null;
		}
		return value;
	}

	bindDispatcher(
		source: { moduleId: string; exportName: string } | null,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<void> {
		const { dispatcher } = this.options;
		const setter = this.builtinExport(dispatcher.moduleId, dispatcher.setter);
		if (setter === null)
			return this.engineFailure(
				`dispatcher slot ${dispatcher.moduleId}.${dispatcher.setter} is not installed`,
			);
		let value: QuickJSHandle | null = null;
		try {
			if (source !== null) {
				value = this.builtinExport(source.moduleId, source.exportName);
				if (value === null)
					return {
						ok: false,
						failure: { kind: "lookup", reason: "export" },
					};
			}
			const result = this.slice(slice, () =>
				this.context.callFunction(
					setter,
					this.context.undefined,
					value ?? this.context.null,
				),
			);
			if (result.error)
				return { ok: false, failure: this.classify(result.error) };
			result.value.dispose();
			return { ok: true, value: undefined };
		} catch (cause) {
			return this.engineFailure(cause);
		} finally {
			value?.dispose();
			setter.dispose();
		}
	}

	hasDispatcher(slice: RuntimeVmSlice): RuntimeVmOutcome<boolean> {
		const { dispatcher } = this.options;
		const probe = this.builtinExport(dispatcher.moduleId, dispatcher.probe);
		if (probe === null)
			return this.engineFailure(
				`dispatcher probe ${dispatcher.moduleId}.${dispatcher.probe} is not installed`,
			);
		try {
			const result = this.slice(slice, () =>
				this.context.callFunction(probe, this.context.undefined),
			);
			if (result.error)
				return { ok: false, failure: this.classify(result.error) };
			try {
				return { ok: true, value: this.context.dump(result.value) === true };
			} finally {
				result.value.dispose();
			}
		} catch (cause) {
			return this.engineFailure(cause);
		} finally {
			probe.dispose();
		}
	}

	callExport(
		moduleId: string,
		exportName: string,
		argsJson: string,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<RuntimeVmCallResult> {
		const trusted = this.trusted;
		if (trusted === null) return this.engineFailure("vm is not bootstrapped");
		const namespace = this.namespaces.get(moduleId);
		if (namespace === undefined)
			return { ok: false, failure: { kind: "lookup", reason: "module" } };
		const fn = this.context.getProp(namespace, exportName);
		try {
			const type = this.context.typeof(fn);
			if (type === "undefined")
				return { ok: false, failure: { kind: "lookup", reason: "export" } };
			if (type !== "function")
				return {
					ok: false,
					failure: { kind: "lookup", reason: "not_callable" },
				};
			const args = this.context.newString(argsJson);
			try {
				const result = this.slice(slice, () =>
					this.context.callFunction(
						trusted.invoke,
						this.context.undefined,
						fn,
						args,
					),
				);
				if (result.error)
					return { ok: false, failure: this.classify(result.error) };
				return this.settle(result.value, slice);
			} finally {
				args.dispose();
			}
		} catch (cause) {
			return this.engineFailure(cause);
		} finally {
			fn.dispose();
		}
	}

	/**
	 * One export from a creator module or a built-in namespace, or `null` if missing. The caller
	 * releases it.
	 */
	private anyExport(ref: RuntimeVmExportRef): QuickJSHandle | null {
		const namespace =
			this.namespaces.get(ref.moduleId) ??
			this.builtinNamespaces.get(ref.moduleId);
		if (namespace === undefined) return null;
		const value = this.context.getProp(namespace, ref.exportName);
		if (this.context.typeof(value) === "undefined") {
			value.dispose();
			return null;
		}
		return value;
	}

	callBuiltinExport(
		moduleId: string,
		exportName: string,
		argsJson: string,
		slice: RuntimeVmSlice,
		leading: readonly RuntimeVmExportRef[] = [],
	): RuntimeVmOutcome<RuntimeVmCallResult> {
		const trusted = this.trusted;
		if (trusted === null) return this.engineFailure("vm is not bootstrapped");
		if (!this.builtinNamespaces.has(moduleId))
			return { ok: false, failure: { kind: "lookup", reason: "module" } };
		const fn = this.builtinExport(moduleId, exportName);
		if (fn === null)
			return { ok: false, failure: { kind: "lookup", reason: "export" } };
		const handles: QuickJSHandle[] = [];
		try {
			if (this.context.typeof(fn) !== "function")
				return {
					ok: false,
					failure: { kind: "lookup", reason: "not_callable" },
				};
			const array = this.context.newArray();
			handles.push(array);
			for (let index = 0; index < leading.length; index += 1) {
				const value = this.anyExport(leading[index] as RuntimeVmExportRef);
				if (value === null)
					return { ok: false, failure: { kind: "lookup", reason: "export" } };
				handles.push(value);
				this.context.setProp(array, index, value);
			}
			const args = this.context.newString(argsJson);
			handles.push(args);
			const result = this.slice(slice, () =>
				this.context.callFunction(
					trusted.invokeWith,
					this.context.undefined,
					fn,
					array,
					args,
				),
			);
			if (result.error)
				return { ok: false, failure: this.classify(result.error) };
			return this.settle(result.value, slice);
		} catch (cause) {
			return this.engineFailure(cause);
		} finally {
			for (const handle of handles) handle.dispose();
			fn.dispose();
		}
	}

	promiseState(
		ref: RuntimeVmPromiseRef,
		slice: RuntimeVmSlice,
		wantValue = true,
	): RuntimeVmPromiseState {
		const handle = this.promises.get(ref.id);
		if (handle === undefined)
			return {
				type: "rejected",
				failure: { kind: "engine", message: "unknown promise reference" },
			};
		const state = this.context.getPromiseState(handle);
		if (state.type === "pending") return { type: "pending" };
		if (state.type === "rejected")
			return { type: "rejected", failure: this.classify(state.error) };
		const value = state.notAPromise === true ? handle : state.value;
		try {
			if (!wantValue) return { type: "fulfilled", json: "null" };
			const outcome = this.serialized(value, slice);
			if (!outcome.ok) return { type: "rejected", failure: outcome.failure };
			return {
				type: "fulfilled",
				json: outcome.value.kind === "settled" ? outcome.value.json : "null",
			};
		} finally {
			if (value !== handle) value.dispose();
		}
	}

	release(ref: RuntimeVmPromiseRef): void {
		const handle = this.promises.get(ref.id);
		if (handle === undefined) return;
		this.promises.delete(ref.id);
		if (this.graphRef?.id === ref.id) this.graphRef = null;
		handle.dispose();
	}

	settleHostCall(callId: number, ok: boolean, json: string): void {
		const deferred = this.deferreds.get(callId);
		if (deferred === undefined) return;
		this.deferreds.delete(callId);
		const value = this.context.newString(json);
		try {
			if (ok) deferred.resolve(value);
			else deferred.reject(value);
		} finally {
			value.dispose();
			deferred.dispose();
		}
	}

	runJobs(
		maxJobs: number,
		slice: RuntimeVmSlice,
	): RuntimeVmOutcome<{ executed: number; more: boolean }> {
		try {
			const result = this.slice(slice, () =>
				this.runtime.executePendingJobs(maxJobs),
			);
			if (result.error)
				return { ok: false, failure: this.classify(result.error) };
			return {
				ok: true,
				value: { executed: result.value, more: this.runtime.hasPendingJob() },
			};
		} catch (cause) {
			return this.engineFailure(cause);
		}
	}

	hasPendingJobs(): boolean {
		return this.runtime.hasPendingJob();
	}

	/**
	 * The session's linear memory size. This is not QuickJS accounting, which stays at 0 in this
	 * build. It is the bytes the host actually provided, and it never shrinks, because WASM memory
	 * does not shrink.
	 */
	memoryUsedBytes(): number | null {
		return this.memory.buffer.byteLength;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const deferred of this.deferreds.values()) deferred.dispose();
		this.deferreds.clear();
		for (const handle of this.promises.values()) handle.dispose();
		this.promises.clear();
		for (const handle of this.namespaces.values()) handle.dispose();
		this.namespaces.clear();
		for (const handle of this.builtinNamespaces.values()) handle.dispose();
		this.builtinNamespaces.clear();
		if (this.trusted !== null) {
			this.trusted.serialize.dispose();
			this.trusted.deserialize.dispose();
			this.trusted.invoke.dispose();
			this.trusted.invokeWith.dispose();
			this.trusted = null;
		}
		this.runtime.removeInterruptHandler();
		/**
		 * Corrupted instances are discarded. After a host stack overflow or an out-of-memory condition,
		 * the runtime can abort in Emscripten at the leak assertion in `JS_FreeRuntime`, and that abort
		 * arrives as a host exception. The instance belongs to the session, so dropping the reference
		 * frees its linear memory and leaves other sessions unaffected. Throwing here would make disposal
		 * itself a failing step, and the session has already failed.
		 */
		try {
			this.context.dispose();
			this.runtime.dispose();
		} catch {
			// See above: a corrupted instance is dropped, not reported.
		}
	}
}
