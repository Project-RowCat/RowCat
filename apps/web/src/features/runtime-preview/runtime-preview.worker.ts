import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import wasmUrl from "@jitl/quickjs-ng-wasmfile-release-sync/wasm?url";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import {
	compileRuntimeProject,
	type RuntimeCompileHandle,
} from "@rowcat/runtime-compiler";
import type { RuntimeArtifact } from "@rowcat/runtime-compiler/contracts";
import { portableRuntimeEnvironment } from "@rowcat/runtime-compiler/environment/portable";
import { originalPositionFor } from "@rowcat/runtime-compiler/source-map";
import {
	CreatorExecutionError,
	createRuntimeVmSession,
	emptyPersistentStateSnapshot,
	emptyStoryStateSnapshot,
	type RuntimeEventSource,
	type RuntimeExecutionError,
	RuntimeGenerationError,
	RuntimeHostError,
	type RuntimePersistentStateSnapshot,
	type RuntimeStoryStateSnapshot,
	type RuntimeVmEngine,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { createQuickJsEngine } from "@rowcat/runtime-host/quickjs";
import { workerSchedulerClock } from "#/lib/runtime-vm/worker-clock.ts";
import {
	createRuntimeCommitFlow,
	type RuntimeCommitFlow,
} from "#/lib/runtime-watchdog/commit-flow.ts";
import type {
	PreviewErrorInfo,
	PreviewGeneration,
	PreviewGenerationResult,
	PreviewWorkerMessage,
	PreviewWorkerRequest,
} from "./protocol.ts";
import { previewErrorFrames } from "./runtime-preview-frames.ts";
import { runtimeLibFiles } from "./runtime-preview-libs.ts";

/**
 * Preview worker: trusted host code runs here. There is no DOM.
 * - The worker only requests generation; it never generates. The generation port sends one
 *   message to the main realm and waits for the reply. SDK clients, BYO credentials and the payment
 *   cache live in the main realm. Moving them here would create a second copy of the trusted
 *   generation stack. So this file has no `fetch`, except the WASM fetch of our own bundled asset.
 * - The saved snapshot outlives the VM. Restart discards the VM and `useState` starts over; saved
 *   state survives only because it is an explicit snapshot kept here. The QuickJS heap is not
 *   saved, since it holds closures, promises and module objects that have no storage format.
 * - Its lifetime is the worker's. It is not kept across browser reload, closing the studio or
 *   other devices. The snapshot is authoring-tool memory, not product save.
 * - The worker is not isolation. Creator code runs in QuickJS/WASM inside it; the worker only
 *   keeps the main thread responsive. There is no `eval`, `Function` or `import()` here. Infinite
 *   loops are stopped by the VM execution budget.
 * - Start and stop share one request chain: a new `start` waits for the previous teardown, so two
 *   sessions never overlap. Generation numbers let the main thread drop stale replies.
 * - Compilation is authoritative here. The studio's check is only an early gate. The worker
 *   recompiles fully and creates no VM on failure, so it never silently runs an old artifact.
 *   Keeping the program handle (`previous`) between sessions is a speed concern, not a correctness
 *   one.
 * - Main paces and watches a running session exactly as it does product playback: commits wait on
 *   main's `ack` once a few are unanswered (commit-flow.ts), and `ping` is answered here, between
 *   turns (liveness.ts). Every path that ends a session releases the flow first, or stop and dispose
 *   would wait on a scheduler parked on main's silence.
 */

interface Current {
	generation: PreviewGeneration;
	session: RuntimeVmSession;
	/**
	 * The artifact this session runs. It is the source for the source map that turns creator stack
	 * frames back into source coordinates.
	 */
	artifact: RuntimeArtifact;
	flow: RuntimeCommitFlow;
}

/**
 * A generation waiting for the main thread's reply. When the generation changes, all of these are
 * rejected as `cancelled`.
 */
interface PendingGeneration {
	generation: PreviewGeneration;
	settle: (result: PreviewGenerationResult) => void;
}

const post = (message: PreviewWorkerMessage): void => {
	self.postMessage(message);
};

let engine: RuntimeVmEngine | null = null;
const engineFor = (): RuntimeVmEngine => {
	if (engine === null)
		engine = createQuickJsEngine(variant, {
			wasmBinary: () =>
				fetch(wasmUrl).then((response) => response.arrayBuffer()),
		});
	return engine;
};

const environment = portableRuntimeEnvironment(runtimeLibFiles());
let previous: RuntimeCompileHandle | undefined;
let current: Current | null = null;
let chain: Promise<void> = Promise.resolve();
/** This preview's playthrough snapshot: one of the two state values carried across VM instances. */
let storySnapshot: RuntimeStoryStateSnapshot = emptyStoryStateSnapshot();
/**
 * This preview's long progress, which playthrough reset never touches. There are two variables
 * because the two lifetimes differ. Merging them would force reset to decide which keys to clear,
 * and a wrong decision there would erase unlocks worth several chapters.
 */
let persistentSnapshot: RuntimePersistentStateSnapshot =
	emptyPersistentStateSnapshot();
const pendingGenerations = new Map<number, PendingGeneration>();
let nextGenerationRequestId = 1;

/** Rejects every open generation with one reason. Called by stop, restart and worker teardown. */
function rejectPendingGenerations(message: string): void {
	const open = [...pendingGenerations.values()];
	pendingGenerations.clear();
	for (const entry of open)
		entry.settle({ ok: false, reason: "cancelled", message });
}

/**
 * The worker-side generation port. One round trip is all it does. Cancellation belongs to the
 * session's AbortSignal, so no second cancel mechanism is made here. When the signal fires, open
 * promises reject at once. A late reply finds nothing in `pendingGenerations` and is dropped
 * instead of entering a dead VM.
 */
function previewGenerationPort(generation: PreviewGeneration) {
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
				const finish = (result: PreviewGenerationResult): void => {
					pendingGenerations.delete(requestId);
					context.signal.removeEventListener("abort", onAbort);
					if (result.ok) resolve(result.text);
					else
						reject(new RuntimeGenerationError(result.reason, result.message));
				};
				function onAbort(): void {
					finish({
						ok: false,
						reason: "cancelled",
						message: "preview stopped",
					});
				}
				if (context.signal.aborted) {
					reject(new RuntimeGenerationError("cancelled", "preview stopped"));
					return;
				}
				context.signal.addEventListener("abort", onAbort, { once: true });
				pendingGenerations.set(requestId, { generation, settle: finish });
				post({
					type: "generation-request",
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

/**
 * Host file paths and worker stacks end here. Only messages, code and component chains reach the
 * screen.
 */
function toErrorInfo(error: RuntimeExecutionError | unknown): PreviewErrorInfo {
	if (error instanceof CreatorExecutionError)
		return {
			kind: "creator",
			name: error.creatorName,
			message: error.message,
			code: error.runtimeCode,
			componentStack: [...error.componentStack],
			/**
			 * The stack is resolved with the artifact of the session that is running. With no session (an
			 * exception during start), there are no frames: resolving with an old session's artifact would
			 * map to lines of different code.
			 */
			frames: current
				? previewErrorFrames(
						error.frames,
						current.artifact,
						originalPositionFor,
					)
				: [],
		};
	if (error instanceof RuntimeHostError)
		return {
			kind: "host",
			name: error.name,
			message: error.message,
			code: error.code,
			componentStack: [],
			frames: [],
		};
	return {
		kind: "host",
		name: error instanceof Error ? error.name : "Error",
		message: error instanceof Error ? error.message : String(error),
		code: null,
		componentStack: [],
		frames: [],
	};
}

async function stopCurrent(): Promise<void> {
	rejectPendingGenerations("preview stopped");
	if (current === null) return;
	const { generation, session, flow } = current;
	current = null;
	flow.release();
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

/**
 * After a fatal failure the session is discarded and the failure is reported. True means the
 * session is dead.
 */
async function failIfDead(
	generation: PreviewGeneration,
	session: RuntimeVmSession,
	flow: RuntimeCommitFlow,
	error: RuntimeExecutionError,
): Promise<boolean> {
	if (session.state !== "failed") return false;
	if (current?.session === session) current = null;
	flow.release();
	await session.dispose();
	post({
		type: "failed",
		generation,
		failure: { stage: "runtime", error: toErrorInfo(error) },
	});
	return true;
}

async function start(
	generation: PreviewGeneration,
	entry: string,
	files: { path: string; content: string }[],
	resetStory: boolean,
	resetPersistent: boolean,
	generationEnabled: boolean,
): Promise<void> {
	await stopCurrent();
	/**
	 * Reset happens before the session is built. If it came later, hydration in between would read the
	 * old playthrough once, and that frame would reach the screen.
	 */
	if (resetStory) {
		storySnapshot = emptyStoryStateSnapshot();
		post({ type: "story-state", generation, snapshot: storySnapshot });
	}
	if (resetPersistent) {
		persistentSnapshot = emptyPersistentStateSnapshot();
		post({
			type: "persistent-state",
			generation,
			snapshot: persistentSnapshot,
		});
	}
	post({ type: "status", generation, stage: "compiling" });
	const result = compileRuntimeProject(
		{ apiVersion: RUNTIME_API_VERSION, entry, files },
		environment,
		previous === undefined ? {} : { previous },
	);
	previous = result.handle;
	if (!result.ok) {
		post({
			type: "failed",
			generation,
			failure: { stage: "compile", diagnostics: [...result.diagnostics] },
		});
		return;
	}
	post({ type: "status", generation, stage: "starting" });

	/** Per session: a new session's revisions start again from 1. */
	const flow = createRuntimeCommitFlow(workerSchedulerClock());
	let session: RuntimeVmSession;
	try {
		session = await createRuntimeVmSession({
			engine: engineFor(),
			artifact: result.artifact,
			onConsole: (level, args) =>
				post({ type: "console", generation, level, args: [...args] }),
			scheduling: { clock: flow.clock },
			storyState: storySnapshot,
			persistentState: persistentSnapshot,
			/**
			 * Absent capabilities are left out of the table. In a disabled preview, `generate()` reports 'no
			 * such capability' rather than 'no permission'. To a creator those are different messages.
			 */
			...(generationEnabled
				? { generation: { port: previewGenerationPort(generation) } }
				: {}),
			onStoryStateCommit: (snapshot) => {
				storySnapshot = snapshot;
				post({ type: "story-state", generation, snapshot });
			},
			onPersistentStateCommit: (snapshot) => {
				persistentSnapshot = snapshot;
				post({ type: "persistent-state", generation, snapshot });
			},
		});
	} catch (error) {
		post({
			type: "failed",
			generation,
			failure: { stage: "start", error: toErrorInfo(error) },
		});
		return;
	}
	current = { generation, session, artifact: result.artifact, flow };
	/**
	 * Hydration results are reported before mounting. If a migration upgraded the story state, this is
	 * the current snapshot, and the next restart reads that upgraded state.
	 */
	storySnapshot = session.storyStateSnapshot();
	post({ type: "story-state", generation, snapshot: storySnapshot });
	persistentSnapshot = session.persistentStateSnapshot();
	post({ type: "persistent-state", generation, snapshot: persistentSnapshot });

	/**
	 * The remote-asset allowlist is sent before mounting, because the first commit is drawn using that
	 * list (`remote-assets`).
	 */
	post({
		type: "remote-assets",
		generation,
		remoteAssets: [...session.remoteAssets],
	});

	const mounted = await session.mountRoot({
		onCommit: (batch) => {
			flow.committed(batch.revision);
			post({ type: "commit", generation, batch });
		},
		/**
		 * Sent after the commit. That ordering is the §12 guarantee, and this line carries it unchanged.
		 */
		onCommands: (batch) => post({ type: "commands", generation, batch }),
		onDiagnostic: (diagnostic) =>
			post({ type: "diagnostic", generation, diagnostic }),
		onRootError: (error, work) => {
			void failIfDead(generation, session, flow, error).then((dead) => {
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
		if (await failIfDead(generation, session, flow, mounted.error)) return;
		/**
		 * The frame is resolved before the session is torn down. An exception from the first render
		 * arrives here, and it is the failure creators meet most often. If `current` were cleared first,
		 * `toErrorInfo` would lose the artifact and the message would lack source coordinates. This
		 * happened once.
		 */
		const error = toErrorInfo(mounted.error);
		current = null;
		flow.release();
		await session.dispose();
		post({
			type: "failed",
			generation,
			failure: { stage: "start", error },
		});
		return;
	}
	/**
	 * The list was already delivered via `remote-assets`; the copy here is for observation
	 * (instrumentation).
	 */
	post({
		type: "started",
		generation,
		remoteAssets: [...session.remoteAssets],
	});
}

async function event(
	generation: PreviewGeneration,
	handlerId: number,
	payload: string | null,
	source: RuntimeEventSource,
): Promise<void> {
	if (current === null || current.generation !== generation) return;
	const { session, flow } = current;
	const outcome = await session.dispatchEvent(handlerId, payload, source);
	if (outcome.ok) return;
	if (await failIfDead(generation, session, flow, outcome.error)) return;
	/** The handler threw synchronously. Only that event is lost; the session stays alive. */
	post({
		type: "root-error",
		generation,
		error: toErrorInfo(outcome.error),
		work: "event",
	});
}

/**
 * Passes a wake from main through the current session's flow gate. A wake for no session or another
 * generation runs at once; what it would wake checks the generation itself and drops it.
 */
function admit(generation: PreviewGeneration, run: () => void): void {
	if (current?.generation === generation) current.flow.admit(run);
	else run();
}

self.addEventListener(
	"message",
	(message: MessageEvent<PreviewWorkerRequest>) => {
		const request = message.data;
		if (request === null || typeof request !== "object") return;
		switch (request.type) {
			case "start":
				chain = chain
					.then(() =>
						start(
							request.generation,
							request.entry,
							request.files,
							request.resetStory === true,
							request.resetPersistent === true,
							request.generationEnabled === true,
						),
					)
					.catch((error: unknown) =>
						post({
							type: "failed",
							generation: request.generation,
							failure: { stage: "start", error: toErrorInfo(error) },
						}),
					);
				return;
			case "stop":
				/**
				 * Released here, not only inside stopCurrent: the chain may still be inside `start` with the
				 * scheduler parked on main's acknowledgements, and main stopped answering when it sent this.
				 */
				if (current?.generation === request.generation) current.flow.release();
				chain = chain
					.then(async () => {
						if (current?.generation === request.generation) await stopCurrent();
						else
							post({
								type: "stopped",
								generation: request.generation,
								cleanups: 0,
							});
					})
					.catch(() =>
						post({
							type: "stopped",
							generation: request.generation,
							cleanups: 0,
						}),
					);
				return;
			case "event":
				/**
				 * Events do not wait on the chain; the session's scheduler orders them. They do wait on the
				 * flow gate: an event would start a drain the gate never sees (commit-flow.ts), so while main
				 * is behind it is held, in order, until main catches up or the session ends.
				 */
				admit(request.generation, () => {
					void event(
						request.generation,
						request.handlerId,
						request.payload ?? null,
						request.source === "media" ? "media" : "interaction",
					);
				});
				return;
			case "ack":
				if (current?.generation === request.generation)
					current.flow.acknowledged(request.revision);
				return;
			case "ping":
				/**
				 * Answered at once and from here only. Reaching this line means no VM turn is running, which is
				 * the whole fact main asks about.
				 */
				post({
					type: "pong",
					generation: request.generation,
					seq: request.seq,
				});
				return;
			case "generation-result": {
				const pending = pendingGenerations.get(request.requestId);
				/** Drop replies from an old generation. Its promise was already settled as cancelled. */
				if (pending === undefined || pending.generation !== request.generation)
					return;
				/**
				 * A reply wakes the VM like an event does, so it waits on the gate the same way. Settled only if
				 * still open: a stop may have rejected it as cancelled while it was held.
				 */
				admit(request.generation, () => {
					if (pendingGenerations.get(request.requestId) === pending)
						pending.settle(request.result);
				});
				return;
			}
			case "reset-story":
				/**
				 * Reset for a stopped preview. It goes through the chain because a preceding `stop` may not
				 * have released the session yet. If that session's last commit restored the snapshot, the reset
				 * would be undone.
				 */
				chain = chain.then(() => {
					storySnapshot = emptyStoryStateSnapshot();
					post({
						type: "story-state",
						generation: request.generation,
						snapshot: storySnapshot,
					});
				});
				return;
			case "reset-persistent":
				/**
				 * Same chain reason as the playthrough reset: the last commit must not restore the long
				 * progress.
				 */
				chain = chain.then(() => {
					persistentSnapshot = emptyPersistentStateSnapshot();
					post({
						type: "persistent-state",
						generation: request.generation,
						snapshot: persistentSnapshot,
					});
				});
				return;
		}
	},
);
