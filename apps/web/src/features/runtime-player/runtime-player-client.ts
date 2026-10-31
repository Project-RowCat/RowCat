import type {
	PlayerGeneration,
	PlayerGenerationResult,
	PlayerWorkerMessage,
	PlayerWorkerRequest,
} from "./protocol.ts";
import type {
	RuntimePersistentStateSnapshot,
	RuntimeStoryStateSnapshot,
} from "./snapshots.ts";

/**
 * Main-thread handle for the playback worker. It only sends and receives messages and holds no
 * state (the hook owns state). This file is the only place a worker is created, and the worker
 * exists to keep the VM host off the main thread. The worker's code is fetched only when needed:
 * the lazily importing hook is the boundary, so QuickJS WASM downloads only for people who actually
 * open a work.
 */
export interface RuntimePlayerClient {
	start(request: {
		generation: PlayerGeneration;
		artifact: unknown;
		storyState: RuntimeStoryStateSnapshot;
		persistentState: RuntimePersistentStateSnapshot;
		generationEnabled: boolean;
	}): void;
	stop(generation: PlayerGeneration): void;
	dispatchEvent(
		generation: PlayerGeneration,
		handlerId: number,
		payload?: string | null,
		source?: "interaction" | "media",
	): void;
	generationResult(
		generation: PlayerGeneration,
		requestId: number,
		result: PlayerGenerationResult,
	): void;
	/** Main has handled the commits up to `revision` (backpressure; see protocol.ts). */
	acknowledge(generation: PlayerGeneration, revision: number): void;
	/** Asks the worker whether it is between turns (liveness; see protocol.ts). */
	ping(generation: PlayerGeneration, seq: number): void;
	/** Kills the worker immediately. A last resort, used when cleanup cannot finish. */
	terminate(): void;
}

export async function createRuntimePlayerClient(handlers: {
	onMessage: (message: PlayerWorkerMessage) => void;
	/** The worker itself died: it failed to load, or an unhandled exception was thrown. */
	onCrash: (message: string) => void;
}): Promise<RuntimePlayerClient> {
	const { default: PlayerWorker } = await import(
		"./runtime-player.worker.ts?worker"
	);
	const worker = new PlayerWorker();
	worker.addEventListener(
		"message",
		(event: MessageEvent<PlayerWorkerMessage>) => {
			handlers.onMessage(event.data);
		},
	);
	worker.addEventListener("error", (event: ErrorEvent) => {
		handlers.onCrash(event.message || "runtime worker error");
	});
	worker.addEventListener("messageerror", () => {
		handlers.onCrash("runtime worker message error");
	});

	const send = (request: PlayerWorkerRequest): void => {
		worker.postMessage(request);
	};

	return {
		start: (request) => send({ type: "start", ...request }),
		stop: (generation) => send({ type: "stop", generation }),
		dispatchEvent: (generation, handlerId, payload, source) =>
			send({
				type: "event",
				generation,
				handlerId,
				payload: payload ?? null,
				...(source === "media" ? { source } : {}),
			}),
		generationResult: (generation, requestId, result) =>
			send({ type: "generation-result", generation, requestId, result }),
		acknowledge: (generation, revision) =>
			send({ type: "ack", generation, revision }),
		ping: (generation, seq) => send({ type: "ping", generation, seq }),
		terminate: () => {
			worker.terminate();
		},
	};
}
