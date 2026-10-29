import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import wasmUrl from "@jitl/quickjs-ng-wasmfile-release-sync/wasm?url";
import {
	CreatorExecutionError,
	createRuntimeVmSession,
	RUNTIME_HOST_ERROR_CODE,
	type RuntimeEventSource,
	type RuntimeExecutionError,
	RuntimeGenerationError,
	RuntimeHostError,
	type RuntimeVmEngine,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { createQuickJsEngine } from "@rowcat/runtime-host/quickjs";
import { workerSchedulerClock } from "#/lib/runtime-vm/worker-clock.ts";
import type {
	PlayerErrorInfo,
	PlayerGeneration,
	PlayerGenerationResult,
	PlayerWorkerMessage,
	PlayerWorkerRequest,
} from "./protocol.ts";

/**
 * Product playback worker, where published artifacts run. No DOM and no compiler live here.
 *
 * - Message flow: start (clear the current session, validate the artifact on the host, hydrate
 *   from the saved snapshot, mountRoot, started); event (dispatchEvent at userBlocking priority);
 *   stop (unmount cleanup, settle, dispose, stopped); generation-result (settle an open promise
 *   with a result from main).
 * - No compiler. The studio preview worker compiles source to TypeScript. Reusing it here would
 *   ship the TypeScript compiler and lib.es2022.d.ts to every player's device, giving players a
 *   tool for code they never write. This worker only receives the artifact the server already
 *   built.
 * - The saved snapshot is owned by main. Progress is member data, so it goes to Dexie and E2EE
 *   sync. start receives the snapshot and every commit is sent back to main. This worker does not
 *   know the storage layer (no Dexie, no SDK).
 * - The worker is not isolation. Creator code runs inside the QuickJS/WASM VM within this worker.
 *   The worker keeps the main thread responsive; infinite loops are stopped by the VM execution
 *   budget, not by the worker.
 * - Artifacts are not trusted. The server validated it, but session creation validates again
 *   (validateRuntimeArtifact on the host). The value crosses network and cache, and stale tabs,
 *   service workers, or cached chunks can pair an old runtime with a new artifact. That mismatch
 *   must fail as a rejection, not as an execution error.
 */

interface Current {
	generation: PlayerGeneration;
	session: RuntimeVmSession;
}

interface PendingGeneration {
	generation: PlayerGeneration;
	settle: (result: PlayerGenerationResult) => void;
}

const post = (message: PlayerWorkerMessage): void => {
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

let current: Current | null = null;
let chain: Promise<void> = Promise.resolve();
const pendingGenerations = new Map<number, PendingGeneration>();
let nextGenerationRequestId = 1;

function rejectPendingGenerations(message: string): void {
	const open = [...pendingGenerations.values()];
	pendingGenerations.clear();
	for (const entry of open)
		entry.settle({ ok: false, reason: "cancelled", message });
}

/**
 * Worker-side generation port. One round trip is all it does.
 *
 * It has the same shape as the preview port, on purpose. SDK clients, BYO credentials, and the
 * payment cache all live in the main realm. Moving them here would make this worker a second copy
 * of the trusted generation stack. That is why this file has no fetch, except one line that fetches
 * the WASM asset, which is part of our bundle.
 */
function playerGenerationPort(generation: PlayerGeneration) {
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
				const finish = (result: PlayerGenerationResult): void => {
					pendingGenerations.delete(requestId);
					context.signal.removeEventListener("abort", onAbort);
					if (result.ok) resolve(result.text);
					else
						reject(new RuntimeGenerationError(result.reason, result.message));
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
 * Host file paths and worker stacks end here. Only sentences, code, and the component chain reach
 * the screen.
 */
function toErrorInfo(error: RuntimeExecutionError | unknown): PlayerErrorInfo {
	if (error instanceof CreatorExecutionError)
		return {
			kind: "creator",
			name: error.creatorName,
			message: error.message,
			code: error.runtimeCode,
			componentStack: [...error.componentStack],
			/**
			 * The playback surface has no editor, so it does not carry frames that could not be opened.
			 */
			frames: [],
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

/**
 * Whether the failure is a compatibility failure, meaning this app cannot run the artifact.
 *
 * This split decides the on-screen sentence (§95). A version mismatch is neither the creator's code
 * problem nor a bug in the runtime; the app on this device is outdated, so the user's action
 * differs.
 */
const isArtifactFailure = (error: unknown): error is RuntimeHostError =>
	error instanceof RuntimeHostError &&
	(error.code === RUNTIME_HOST_ERROR_CODE.artifactInvalid ||
		error.code === RUNTIME_HOST_ERROR_CODE.sandboxIncompatible);

async function stopCurrent(): Promise<void> {
	rejectPendingGenerations("player stopped");
	if (current === null) return;
	const { generation, session } = current;
	current = null;
	if (session.state === "ready" || session.state === "running") {
		await session.unmountRoot();
		await session.settle();
	}
	await session.dispose();
	post({ type: "stopped", generation });
}

/**
 * After a fatal failure the session is discarded and the fact is reported. True means the session
 * is dead.
 */
async function failIfDead(
	generation: PlayerGeneration,
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
	generation: PlayerGeneration,
	request: Extract<PlayerWorkerRequest, { type: "start" }>,
): Promise<void> {
	await stopCurrent();
	post({ type: "status", generation, stage: "starting" });

	let session: RuntimeVmSession;
	try {
		session = await createRuntimeVmSession({
			engine: engineFor(),
			/**
			 * Validation happens inside this call (validateRuntimeArtifact). It is not repeated here because
			 * the check needs the built-in list that boot planning produces. Reassembling that list in the
			 * worker would create a place where the two verdicts could diverge.
			 */
			artifact: request.artifact,
			onConsole: (level, args) =>
				post({ type: "console", generation, level, args: [...args] }),
			scheduling: { clock: workerSchedulerClock() },
			storyState: request.storyState,
			persistentState: request.persistentState,
			/**
			 * A capability that is not enabled is left out of the table entirely. For an unapproved session,
			 * generate() must report that no such capability exists, not that permission was denied (§116).
			 * Creator code treats those as different reasons.
			 */
			...(request.generationEnabled
				? { generation: { port: playerGenerationPort(generation) } }
				: {}),
			onStoryStateCommit: (snapshot) =>
				post({ type: "story-state", generation, snapshot }),
			onPersistentStateCommit: (snapshot) =>
				post({ type: "persistent-state", generation, snapshot }),
		});
	} catch (error) {
		if (isArtifactFailure(error)) {
			post({
				type: "failed",
				generation,
				failure: {
					stage: "artifact",
					message: error.message,
					code: error.code,
				},
			});
			return;
		}
		post({
			type: "failed",
			generation,
			failure: { stage: "start", error: toErrorInfo(error) },
		});
		return;
	}
	current = { generation, session };

	/**
	 * Report the hydration result before mounting. If migration bumped the version, this is the
	 * current state, and main persists it to the product store (§59, §84). Deferring until after mount
	 * could let the first commit arrive first, so the saved value would be the first render's result
	 * instead of the migration's.
	 */
	post({
		type: "hydrated",
		generation,
		storyState: session.storyStateSnapshot(),
		persistentState: session.persistentStateSnapshot(),
	});

	/**
	 * The authorized list goes before mount. The first commit is drawn with this list
	 * (`remote-assets`).
	 */
	post({
		type: "remote-assets",
		generation,
		remoteAssets: [...session.remoteAssets],
	});

	const mounted = await session.mountRoot({
		onCommit: (batch) => post({ type: "commit", generation, batch }),
		/**
		 * Commands arrive after the commit. That ordering is the §12 guarantee, and this line carries it
		 * unchanged.
		 */
		onCommands: (batch) => post({ type: "commands", generation, batch }),
		/**
		 * Runtime diagnostics are not drawn on the product screen. Duplicate-key and hook warnings matter
		 * to the creator and are noise to players, so they are only logged to the console, where the
		 * creator can see them in browser devtools.
		 */
		onDiagnostic: (diagnostic) =>
			post({
				type: "console",
				generation,
				level: "warn",
				args: [diagnostic.code],
			}),
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
	post({ type: "started", generation });
}

async function event(
	generation: PlayerGeneration,
	handlerId: number,
	payload: string | null,
	source: RuntimeEventSource,
): Promise<void> {
	if (current === null || current.generation !== generation) return;
	const { session } = current;
	const outcome = await session.dispatchEvent(handlerId, payload, source);
	if (outcome.ok) return;
	if (await failIfDead(generation, session, outcome.error)) return;
	post({
		type: "root-error",
		generation,
		error: toErrorInfo(outcome.error),
		work: "event",
	});
}

self.addEventListener(
	"message",
	(message: MessageEvent<PlayerWorkerRequest>) => {
		const request = message.data;
		if (request === null || typeof request !== "object") return;
		switch (request.type) {
			case "start":
				chain = chain
					.then(() => start(request.generation, request))
					.catch((error: unknown) =>
						post({
							type: "failed",
							generation: request.generation,
							failure: { stage: "start", error: toErrorInfo(error) },
						}),
					);
				return;
			case "stop":
				chain = chain
					.then(async () => {
						if (current?.generation === request.generation) await stopCurrent();
						else post({ type: "stopped", generation: request.generation });
					})
					.catch(() =>
						post({ type: "stopped", generation: request.generation }),
					);
				return;
			case "event":
				/** Events do not wait on the chain. The session's scheduler owns ordering. */
				void event(
					request.generation,
					request.handlerId,
					request.payload ?? null,
					request.source === "media" ? "media" : "interaction",
				);
				return;
			case "generation-result": {
				const pending = pendingGenerations.get(request.requestId);
				/**
				 * Drop answers from an older generation. That promise has already been settled as cancelled.
				 */
				if (pending === undefined || pending.generation !== request.generation)
					return;
				pending.settle(request.result);
				return;
			}
		}
	},
);
