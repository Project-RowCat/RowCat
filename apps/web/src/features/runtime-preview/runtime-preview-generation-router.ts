import type { PreviewGeneration, PreviewGenerationResult } from "./protocol.ts";
import type { RuntimePreviewGenerationAdapter } from "./runtime-preview-generation.ts";
import { previewGenerationFailure } from "./runtime-preview-generation-failure.ts";

/**
 * The single place connecting the worker's generation requests to the adapter, and the owner of
 * cancellation. Flow: the worker sends generation-request with generation, requestId and request.
 * The router checks the generation, creates one AbortController, and calls the adapter. It returns
 * a result or a named reason, and the worker receives generation-result only if the generation
 * still matches.
 * - Why outside a React hook: all four concerns are races (restart cancels a running request;
 *   late answers never reach a new session; stop and leave do not leave a paid request running;
 *   several requests each answer their own promise). Checking those inside a hook needs a renderer,
 *   and this app's tests have no DOM (vitest.config.ts).
 * - Generation checks do not replace cancellation. Discarding old answers still lets paid
 *   requests run to completion for nothing, so the signal is raised on a generation change and
 *   passed through the adapter to the transport. Cancellation alone is also insufficient: it can
 *   arrive late, or the transport may already have finished. Both are needed.
 * - Never leave a request unanswered. Even with no adapter (the window when the screen is
 *   unmounted) the request gets an answer, or the VM's promise never settles and creator code stays
 *   stuck at `await`.
 */
export interface PreviewGenerationRequestMessage {
	readonly generation: PreviewGeneration;
	readonly requestId: number;
	readonly request: Parameters<RuntimePreviewGenerationAdapter>[0];
}

export interface PreviewGenerationRouterOptions {
	/** The current adapter. Without one, AI is unavailable in this preview. */
	adapter(): RuntimePreviewGenerationAdapter | null;
	/** The current generation. A reply for a request from a different generation goes nowhere. */
	currentGeneration(): PreviewGeneration;
	send(
		generation: PreviewGeneration,
		requestId: number,
		result: PreviewGenerationResult,
	): void;
}

export interface PreviewGenerationRouter {
	handle(message: PreviewGenerationRequestMessage): void;
	/**
	 * Cancels all running requests. Called by restart, stop and leave. Does nothing for finished
	 * requests, and calling it repeatedly is harmless.
	 */
	abort(): void;
	/** Number of requests currently running. For instrumentation only. */
	pending(): number;
}

/**
 * Reply when there is no adapter. It is a named reason, so creator code receives a stable runtime
 * code.
 */
const UNAVAILABLE: PreviewGenerationResult =
	previewGenerationFailure("unavailable");

/**
 * Reply when the adapter ended by rejecting rather than returning a result. This is the second leak
 * path. The adapter folds in its own catch, but this function can still throw (an adapter swapped
 * in by a consumer, an error in a finally block, a programming error). If error.message were
 * carried here, that sentence would reach the VM under a named reason.
 */
const REJECTED: PreviewGenerationResult = previewGenerationFailure("failed");

export function createPreviewGenerationRouter(
	options: PreviewGenerationRouterOptions,
): PreviewGenerationRouter {
	/**
	 * Keyed by request id. The host currently allows one request per session, but that number is the
	 * host's policy. With a single handle, a policy change would leave an earlier request that cannot
	 * be cancelled.
	 */
	const open = new Map<number, AbortController>();

	const settle = (
		message: PreviewGenerationRequestMessage,
		result: PreviewGenerationResult,
	): void => {
		if (open.delete(message.requestId) === false) return;
		/**
		 * Answers from a past generation are not sent, because that worker's promise has already been
		 * cancelled.
		 */
		if (options.currentGeneration() !== message.generation) return;
		options.send(message.generation, message.requestId, result);
	};

	return {
		handle(message) {
			/**
			 * A request from a generation that has already passed. The worker has already rejected that
			 * promise, so the adapter is not called; calling it would start a paid request nobody reads.
			 */
			if (options.currentGeneration() !== message.generation) return;
			const adapter = options.adapter();
			if (adapter === null) {
				options.send(message.generation, message.requestId, UNAVAILABLE);
				return;
			}
			const controller = new AbortController();
			open.set(message.requestId, controller);
			void adapter(message.request, { signal: controller.signal })
				.then((result) => settle(message, result))
				.catch(() => settle(message, REJECTED));
		},
		abort() {
			const controllers = [...open.values()];
			open.clear();
			for (const controller of controllers) controller.abort();
		},
		pending: () => open.size,
	};
}
