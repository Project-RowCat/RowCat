import type { PreviewGeneration, PreviewWorkerMessage } from "./protocol.ts";

/**
 * The only observation interface the preview lifecycle sees. It is kept apart from the reducer in
 * runtime-preview-debug.ts to fix the dependency direction. The lifecycle needs only these three
 * functions and does not learn how records are folded. That ignorance is half of the guarantee that
 * observation cannot disturb execution. Keep it at exactly these three functions. Adding getState()
 * would let the lifecycle read recorded state and decide things from it, at which point it is no
 * longer observation.
 */
export interface RuntimePreviewDebugSink {
	/** Run was pressed. A new generation also restarts observation from scratch. */
	run(input: {
		generation: PreviewGeneration;
		resetStory: boolean;
		resetPersistent: boolean;
	}): void;
	/** One message from the worker. The generation check has already been applied before this call. */
	message(message: PreviewWorkerMessage): void;
	/**
	 * A generation result from the main thread, handed back to creator code. This is not a worker
	 * message. Provider raw text is never carried. Only one named reason is included, and choosing the
	 * sentence for that reason already lives in runtime-preview-generation-failure.ts.
	 */
	generationResult(input: {
		requestId: number;
		ok: boolean;
		reason: string | null;
	}): void;
}
