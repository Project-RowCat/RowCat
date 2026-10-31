import type {
	PreviewGeneration,
	PreviewGenerationResult,
	PreviewSourceFile,
	PreviewWorkerMessage,
	PreviewWorkerRequest,
} from "./protocol.ts";

/**
 * The main-thread handle for the worker. It only sends and receives messages and does nothing else.
 * State lives in the hook's reducer, not here. This file is the only place the worker is created.
 * The goal is to keep the VM host off the main thread, not to run creator code there. The `?worker`
 * import makes the worker a bundle asset (as Monaco's wiring does).
 *
 * The worker code arrives only when needed: the hook that lazily imports this module is the
 * boundary. The compiler and WASM load only for people who run a preview.
 */
export interface RuntimePreviewClient {
	start(request: {
		generation: PreviewGeneration;
		entry: string;
		files: PreviewSourceFile[];
		resetStory?: boolean;
		resetPersistent?: boolean;
		generationEnabled?: boolean;
	}): void;
	stop(generation: PreviewGeneration): void;
	resetStory(generation: PreviewGeneration): void;
	resetPersistent(generation: PreviewGeneration): void;
	dispatchEvent(
		generation: PreviewGeneration,
		handlerId: number,
		payload?: string | null,
		source?: "interaction" | "media",
	): void;
	generationResult(
		generation: PreviewGeneration,
		requestId: number,
		result: PreviewGenerationResult,
	): void;
	/** Main has handled the commits up to `revision` (backpressure; see protocol.ts). */
	acknowledge(generation: PreviewGeneration, revision: number): void;
	/** Asks the worker whether it is between turns (liveness; see protocol.ts). */
	ping(generation: PreviewGeneration, seq: number): void;
	/** Kills the worker immediately. This is the last resort when cleanup does not finish. */
	terminate(): void;
}

export async function createRuntimePreviewClient(handlers: {
	onMessage: (message: PreviewWorkerMessage) => void;
	/** The worker itself died: it failed to load, or it threw an unhandled exception. */
	onCrash: (message: string) => void;
}): Promise<RuntimePreviewClient> {
	const { default: PreviewWorker } = await import(
		"./runtime-preview.worker.ts?worker"
	);
	const worker = new PreviewWorker();
	worker.addEventListener(
		"message",
		(event: MessageEvent<PreviewWorkerMessage>) => {
			handlers.onMessage(event.data);
		},
	);
	worker.addEventListener("error", (event) => {
		handlers.onCrash(event.message || "worker error");
	});
	const send = (request: PreviewWorkerRequest): void =>
		worker.postMessage(request);
	return {
		start: (request) => send({ type: "start", ...request }),
		stop: (generation) => send({ type: "stop", generation }),
		resetStory: (generation) => send({ type: "reset-story", generation }),
		resetPersistent: (generation) =>
			send({ type: "reset-persistent", generation }),
		dispatchEvent: (generation, handlerId, payload, source) =>
			send({
				type: "event",
				generation,
				handlerId,
				...(payload === undefined ? {} : { payload }),
				...(source === "media" ? { source } : {}),
			}),
		generationResult: (generation, requestId, result) =>
			send({ type: "generation-result", generation, requestId, result }),
		acknowledge: (generation, revision) =>
			send({ type: "ack", generation, revision }),
		ping: (generation, seq) => send({ type: "ping", generation, seq }),
		terminate: () => worker.terminate(),
	};
}
