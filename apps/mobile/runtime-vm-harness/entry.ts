import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import {
	CreatorExecutionError,
	createRuntimeVmSession,
	type RuntimeExecutionError,
	RuntimeGenerationError,
	RuntimeHostError,
	type RuntimeVmSession,
	type RuntimeWireValue,
} from "@rowcat/runtime-host";
import {
	type PocHostBridge,
	runRuntimeVmPoc,
} from "@rowcat/runtime-host/poc/suite";
import { createQuickJsEngine } from "@rowcat/runtime-host/quickjs";
import type { RuntimeHostSchedulerClock } from "@rowcat/runtime-host/scheduler/clock";
import type {
	NativeRuntimeErrorInfo,
	NativeRuntimeFromVm,
	NativeRuntimeGeneration,
	NativeRuntimeGenerationResult,
	NativeRuntimeToVm,
} from "../src/lib/runtime-native/protocol.ts";
import { RUNTIME_WASM_FILE } from "../src/lib/runtime-native/runtime-assets.ts";

/**
 * Trusted runtime WebView: where the WASM VM host and reconciler run (iOS and Android).
 *
 * Hermes has no WebAssembly, so the only place QuickJS WASM can run in this app is the system
 * WebView, and this file stands up `@rowcat/runtime-host` inside it. Creator code still runs in the
 * WASM VM within it, not in the WebView's JS realm or Hermes. The file lives outside `src/` because
 * it uses `window` and `document`, vocabulary the product path's boundary checks forbid.
 *
 * Nothing of the creator's UI is drawn here; the reconciler's patch bundles cross the bridge to
 * React Native and this WebView stays a hidden 1x1 execution environment.
 *
 * Two bridges exist: Android uses `WebMessagePort` (two-way, one serialization; the production
 * path) and iOS uses `ReactNativeWebView.postMessage` plus injected scripts. On Android, native
 * hands over the port right after the page loads (`__rowcat_port__`); once received, this file no
 * longer uses `ReactNativeWebView`, because with both paths open a measurement cannot say which one
 * it belongs to.
 *
 * One commit is one message: nothing crosses per operation. The reconciler emits one bundle per
 * finished commit and one interaction arrives as one event message, so the native bridge's
 * millisecond cost is per interaction (`docs/creator-runtime/native-vm-host.md` §6-3).
 */

declare global {
	interface Window {
		ReactNativeWebView?: { postMessage(message: string): void };
		__rowcatHarness?: { receive(json: string): void };
	}
}

/* ── Bridge ────────────────────────────────────────────────────────────── */

let port: MessagePort | null = null;

const post = (message: NativeRuntimeFromVm): void => {
	const json = JSON.stringify(message);
	if (port !== null) {
		port.postMessage(json);
		return;
	}
	window.ReactNativeWebView?.postMessage(json);
};

/* ── PoC capability bridge (native answers) ────────────────────────────── */

const pendingHostCalls = new Map<
	number,
	{ resolve(value: RuntimeWireValue): void; reject(error: Error): void }
>();
let nextCallId = 1;

const askNative = (
	capability: string,
	payload: RuntimeWireValue,
): Promise<RuntimeWireValue> =>
	new Promise((resolve, reject) => {
		const id = nextCallId++;
		pendingHostCalls.set(id, { resolve, reject });
		post({ type: "host-call", id, capability, payload });
	});

const bridge: PocHostBridge = {
	echo: (payload) => askNative("test.echo", payload),
	fail: () => askNative("test.fail", null),
	slow: (signal) => {
		void askNative("test.slow", null);
		return new Promise((resolve) => {
			signal.addEventListener("abort", () => resolve("late"), { once: true });
		});
	},
};

/* ── Engine ────────────────────────────────────────────────────────────── */

/**
 * The WASM is a same-origin asset. The native transport layer creates this document's origin
 * (Android intercepts requests and serves app assets; iOS grants a readable file directory); this
 * only fetches one relative path, and there is no base64 byte path.
 */
const wasmBinary = async (): Promise<ArrayBuffer> => {
	const response = await fetch(
		new URL(RUNTIME_WASM_FILE, document.baseURI).toString(),
	);
	/**
	 * `file://` has no HTTP status: WKWebView answers `status: 0` even for a successful file request,
	 * so `response.ok` is false and judging by it alone would make the runtime always fail to start on
	 * iOS (first seen on a real device). Status is therefore checked only when present (Android's
	 * synthetic https origin); otherwise the bytes decide: zero bytes fails, and the engine validates
	 * the rest (a non-module throws at instantiation).
	 */
	if (response.status !== 0 && !response.ok)
		throw new Error(`runtime wasm asset: HTTP ${response.status}`);
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength === 0) throw new Error("runtime wasm asset is empty");
	return bytes;
};

const engine = createQuickJsEngine(variant, { wasmBinary });

/** WebView yield: a `MessageChannel` makes the macrotask boundary, avoiding `setTimeout(0)`'s minimum delay. */
const webviewClock = (): RuntimeHostSchedulerClock => {
	const channel = new MessageChannel();
	let waiters: (() => void)[] = [];
	channel.port1.onmessage = () => {
		const current = waiters;
		waiters = [];
		for (const waiter of current) waiter();
	};
	return {
		now: () => performance.now(),
		yield: () =>
			new Promise((resolve) => {
				waiters.push(resolve);
				channel.port2.postMessage(null);
			}),
	};
};

/* ── PoC suite ─────────────────────────────────────────────────────────── */

/**
 * Stack probe candidates, from the table's 128 KiB upward; the suite stops at the first ceiling
 * that leaks. The probe runs last because a leaking ceiling can corrupt this WebView's JS thread,
 * so earlier results must already have gone out to native.
 */
const STACK_CEILINGS = [128, 192, 256, 320, 512].map((kib) => kib * 1024);

function runPoc(platform: string): void {
	runRuntimeVmPoc({
		engine,
		platform: `${platform} · webview (${navigator.userAgent})`,
		bridge,
		scheduling: { clock: webviewClock() },
		stackProbe: {
			ceilings: STACK_CEILINGS,
			engineFor: (stackCeilingBytes) =>
				createQuickJsEngine(variant, { wasmBinary, stackCeilingBytes }),
		},
		onStep: (step) => post({ type: "poc-step", step }),
	}).then(
		(report) => post({ type: "poc-report", report }),
		(cause) =>
			post({
				type: "poc-failure",
				message:
					cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
			}),
	);
}

/* ── Runtime session ───────────────────────────────────────────────────── */

/** Host file paths and engine internals stop here; only the sentence, code and component chain go out. */
function toErrorInfo(error: unknown): NativeRuntimeErrorInfo {
	if (error instanceof CreatorExecutionError)
		return {
			kind: "creator",
			name: error.creatorName,
			message: error.message,
			code: error.runtimeCode,
			componentStack: [...error.componentStack],
		};
	if (error instanceof RuntimeHostError)
		return {
			kind: "host",
			name: error.name,
			message: error.message,
			code: error.code,
			componentStack: [],
		};
	return {
		kind: "host",
		name: error instanceof Error ? error.name : "Error",
		message: error instanceof Error ? error.message : String(error),
		code: null,
		componentStack: [],
	};
}

interface Current {
	generation: NativeRuntimeGeneration;
	session: RuntimeVmSession;
}

/* ── Generation capability (Hermes answers) ────────────────────────────── */

interface PendingGeneration {
	generation: NativeRuntimeGeneration;
	settle(result: NativeRuntimeGenerationResult): void;
}

const pendingGenerations = new Map<number, PendingGeneration>();
let nextGenerationRequestId = 1;

/** Rejects every open generation with one reason; called by stop, restart and session replacement. */
function rejectPendingGenerations(message: string): void {
	const open = [...pendingGenerations.values()];
	pendingGenerations.clear();
	for (const entry of open)
		entry.settle({ ok: false, reason: "cancelled", message });
}

/**
 * The runtime's generation port is one round trip. Provider requests never happen in this document
 * (§86): credentials and transport live in Hermes, and this only sends a request over the bridge
 * and awaits the answer, which is why this file has no SDK, key store or `fetch`.
 */
function nativeGenerationPort(generation: NativeRuntimeGeneration) {
	return {
		generate: (
			request: {
				readonly messages: readonly {
					readonly role: "user" | "assistant";
					readonly content: string;
				}[];
				readonly instructions: string;
				readonly maxOutputCharacters: number;
			},
			context: { readonly signal: AbortSignal },
		): Promise<string> =>
			new Promise<string>((resolve, reject) => {
				const requestId = nextGenerationRequestId++;
				const finish = (result: NativeRuntimeGenerationResult): void => {
					pendingGenerations.delete(requestId);
					context.signal.removeEventListener("abort", onAbort);
					if (result.ok) resolve(result.text);
					else reject(new RuntimeGenerationError(result.reason, result.message));
				};
				function onAbort(): void {
					finish({ ok: false, reason: "cancelled", message: "player stopped" });
				}
				if (context.signal.aborted) {
					reject(new RuntimeGenerationError("cancelled", "player stopped"));
					return;
				}
				context.signal.addEventListener("abort", onAbort, { once: true });
				pendingGenerations.set(requestId, { generation, settle: finish });
				post({
					type: "runtime-host-call",
					generation,
					requestId,
					request: {
						messages: request.messages.map((message) => ({
							role: message.role,
							content: message.content,
						})),
						instructions: request.instructions,
						maxOutputCharacters: request.maxOutputCharacters,
					},
				});
			}),
	};
}

let current: Current | null = null;
/** `start` and `stop` go through one chain so B's start waits for A's cleanup. */
let chain: Promise<void> = Promise.resolve();

async function stopCurrent(): Promise<void> {
	rejectPendingGenerations("player stopped");
	if (current === null) return;
	const { generation, session } = current;
	current = null;
	let cleanups = 0;
	if (session.state === "ready" || session.state === "running") {
		const unmounted = await session.unmountRoot();
		if (unmounted.ok) {
			const value = unmounted.value as { cleanups?: unknown } | null;
			if (typeof value?.cleanups === "number") cleanups = value.cleanups;
		}
		await session.settle();
	}
	await session.dispose();
	post({ type: "stopped", generation, cleanups });
}

/** Discards a session after a fatal failure and reports it; returns true when the session died. */
async function failIfDead(
	generation: NativeRuntimeGeneration,
	session: RuntimeVmSession,
	error: RuntimeExecutionError,
): Promise<boolean> {
	if (session.state !== "failed") return false;
	if (current?.session === session) current = null;
	await session.dispose();
	post({
		type: "failed",
		generation,
		failure: { stage: "runtime", error: toErrorInfo(error) },
	});
	return true;
}

async function start(
	generation: NativeRuntimeGeneration,
	artifact: unknown,
	storyState: unknown,
	persistentState: unknown,
	generationEnabled: boolean,
): Promise<void> {
	await stopCurrent();
	let session: RuntimeVmSession;
	try {
		session = await createRuntimeVmSession({
			engine,
			artifact,
			onConsole: (level, args) =>
				post({ type: "console", generation, level, args: [...args] }),
			scheduling: { clock: webviewClock() },
			/**
			 * Snapshots are the values Hermes supplies. Absent, the host default (empty snapshot) applies;
			 * that branch belongs to the diagnostic harness with no saves, since the product path always
			 * sends them.
			 */
			...(storyState === undefined ? {} : { storyState }),
			...(persistentState === undefined ? {} : { persistentState }),
			/**
			 * Without the capability it is not placed in the table, so in an unapproved session `generate()`
			 * gets "no such capability" rather than "not authorized".
			 */
			...(generationEnabled
				? { generation: { port: nativeGenerationPort(generation) } }
				: {}),
			onStoryStateCommit: (snapshot) =>
				post({ type: "story-state", generation, snapshot }),
			onPersistentStateCommit: (snapshot) =>
				post({ type: "persistent-state", generation, snapshot }),
		});
	} catch (error) {
		post({
			type: "failed",
			generation,
			failure: { stage: "start", error: toErrorInfo(error) },
		});
		return;
	}
	current = { generation, session };

	/**
	 * Reports the hydration result before mounting. If a migration raised the version this value is
	 * the current state, and Hermes makes it durable in SQLite (§84, §121).
	 */
	post({
		type: "hydrated",
		generation,
		storyState: session.storyStateSnapshot(),
		persistentState: session.persistentStateSnapshot(),
	});

	const mounted = await session.mountRoot({
		onCommit: (batch) => post({ type: "commit", generation, batch }),
		/** Arrives after the commit; the bridge preserves order, and that order carries §12's promise. */
		onCommands: (batch) => post({ type: "commands", generation, batch }),
		onDiagnostic: (diagnostic) =>
			post({ type: "diagnostic", generation, diagnostic }),
		onRootError: (error, work) => {
			void failIfDead(generation, session, error).then((dead) => {
				if (!dead)
					post({
						type: "root-error",
						generation,
						error: toErrorInfo(error),
						work,
					});
			});
		},
	});
	if (!mounted.ok) {
		if (await failIfDead(generation, session, mounted.error)) return;
		current = null;
		await session.dispose();
		post({
			type: "failed",
			generation,
			failure: { stage: "start", error: toErrorInfo(mounted.error) },
		});
		return;
	}
	/** The authorization list comes from the validated session, so Hermes does not re-read the artifact. */
	post({ type: "started", generation, remoteAssets: [...session.remoteAssets] });
}

async function dispatch(
	generation: NativeRuntimeGeneration,
	handlerId: number,
	payload: string | undefined,
	source: "interaction" | "media",
): Promise<void> {
	if (current === null || current.generation !== generation) return;
	const { session } = current;
	const outcome = await session.dispatchEvent(handlerId, payload ?? null, source);
	if (outcome.ok) return;
	if (await failIfDead(generation, session, outcome.error)) return;
	/** The handler's synchronous part threw; only that event is lost and the session survives. */
	post({
		type: "root-error",
		generation,
		error: toErrorInfo(outcome.error),
		work: "event",
	});
}

/* ── Incoming messages ─────────────────────────────────────────────────── */

function receive(json: string): void {
	let message: NativeRuntimeToVm;
	try {
		message = JSON.parse(json) as NativeRuntimeToVm;
	} catch {
		return;
	}
	switch (message.type) {
		case "hello":
			/** A single liveness answer; leaves state alone even mid-session. */
			post({ type: "ready" });
			return;
		case "poc-run":
			runPoc(message.platform);
			return;
		case "host-result": {
			const waiter = pendingHostCalls.get(message.id);
			if (waiter === undefined) return;
			pendingHostCalls.delete(message.id);
			if (message.ok) waiter.resolve(message.value);
			else waiter.reject(new Error(message.message));
			return;
		}
		case "runtime-host-result": {
			const pending = pendingGenerations.get(message.requestId);
			/** Answers from an older generation are dropped; that promise was already settled as cancelled. */
			if (pending === undefined || pending.generation !== message.generation)
				return;
			pending.settle(message.result);
			return;
		}
		case "start":
			chain = chain
				.then(() =>
					start(
						message.generation,
						message.artifact,
						message.storyState,
						message.persistentState,
						message.generationEnabled === true,
					),
				)
				.catch((error: unknown) =>
					post({
						type: "failed",
						generation: message.generation,
						failure: { stage: "start", error: toErrorInfo(error) },
					}),
				);
			return;
		case "stop":
			chain = chain
				.then(async () => {
					if (current?.generation === message.generation) await stopCurrent();
					else
						post({
							type: "stopped",
							generation: message.generation,
							cleanups: 0,
						});
				})
				.catch(() =>
					post({ type: "stopped", generation: message.generation, cleanups: 0 }),
				);
			return;
		case "event":
			/** Events do not wait on the chain; the session's scheduler owns ordering. */
			void dispatch(
				message.generation,
				message.handlerId,
				message.payload,
				message.source === "media" ? "media" : "interaction",
			);
			return;
	}
}

window.__rowcatHarness = { receive };

/** Android port handover: native creates the channel and sends the page-side port here; afterwards both directions flow without script evaluation. */
window.addEventListener("message", (event: MessageEvent) => {
	if (event.data !== "__rowcat_port__") return;
	const received = event.ports[0];
	if (received === undefined) return;
	port = received;
	port.onmessage = (message: MessageEvent) => {
		if (typeof message.data === "string") receive(message.data);
	};
	port.start?.();
	post({ type: "ready" });
});

window.addEventListener("error", (event) => {
	post({ type: "poc-failure", message: `window error: ${event.message}` });
});

/**
 * iOS has no port handover, so the document standing is readiness. On Android this `ready` goes out
 * before the port and again through that channel; native counts only the first.
 */
post({ type: "ready" });
