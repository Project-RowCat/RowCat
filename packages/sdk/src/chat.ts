import {
	CHAT_STREAM_CONTENT_TYPE,
	ChatStreamEvent,
	type GenerationModelDto,
	GenerationModelListDto,
	ManagedChatGenerationRequest,
	StoryChatGenerationRequest,
	type StoryChatGenerationRequestInput,
} from "@rowcat/contracts";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidStreamEvent, invalidStreamTermination } from "./errors.ts";
import { readNdjson } from "./ndjson.ts";

/**
 * The generation stream: the only surface feature code sees.
 *
 * Screens use `for await (const event of client.chat.stream(request, { signal }))`. The endpoint
 * path, the NDJSON wire format, and the fact that the provider is OpenRouter all end here, so if
 * any of them change, screens do not change. If a component started using `TextDecoder`, a framing
 * bug would be stuck in screen code, and Expo could not reuse that code.
 *
 * Two layers:
 * - `readNdjson`: bytes to JSON values. It knows framing only.
 * - `createChatApi.stream`: event shapes and stream state (the terminal invariant).
 *
 * `readNdjson` does not know `ChatStreamEvent`, so other endpoints using the same framing can reuse
 * it. Whether an event is terminal is decided by this protocol, not by the framing.
 */
/**
 * A catalog row: the contract type re-exported under a new name. No identity mapper and no domain
 * model (the package header rule).
 *
 * The re-export exists because of layering. @rowcat/query depends only on `domain` and `sdk`, not
 * on `contracts`. Exporting it here lets query use the response type without crossing that
 * boundary, and leaves a place to absorb a future divergence between wire and product shapes.
 */
export type { GenerationModelDto as GenerationModel } from "@rowcat/contracts";

export interface ChatApi {
	/**
	 * Sends a generation request and yields normalized events in order.
	 *
	 * - The request is always **managed**. This client calls only the RowCat server, which routes
	 *   only managed models. BYO generation calls the provider directly from the browser, so it never
	 *   passes this path. The model parameter therefore accepts only the enumerated managed public
	 *   identities: neither provider names nor upstream slugs can be expressed.
	 * - The return type is `AsyncIterable`, not `Promise<AsyncIterable>`, on purpose. The caller
	 *   starts with one `for await`, and the request goes out on the first iteration. A stream that is
	 *   created and never used does not touch the network.
	 * - Cancel with `options.signal`. The fetch is aborted and the reader is cleaned up (the finally
	 *   in `readNdjson`). Events already received belong to the caller, so the caller decides whether
	 *   to keep a partial response.
	 */
	stream(
		request: ManagedChatGenerationRequest,
		options?: RequestOptions,
	): AsyncIterable<ChatStreamEvent>;
	/**
	 * The list of generation targets the user can pick. The server is the authority.
	 *
	 * The contract type is returned directly. The fields match the product model one-to-one, so no
	 * identity mapper is needed; adding one would only add places to edit whenever a field is added.
	 *
	 * BYO credentials have nothing to do with this path. The catalog says what can be chosen. The
	 * user's key is neither sent with this request nor returned in its response.
	 */
	models(options?: RequestOptions): Promise<GenerationModelDto[]>;
	/**
	 * Generation for a protected copy. The server assembles the prompt.
	 *
	 * Framing and termination rules are exactly those of `stream`. The only difference is what is
	 * sent: the part of the assembly input that the device holds, not a system prompt (the contract
	 * has no `system` field). The work is named by the path, and the rule that builds the path lives
	 * in this file.
	 */
	streamStory(
		storyId: string,
		request: StoryChatGenerationRequestInput,
		options?: RequestOptions,
	): AsyncIterable<ChatStreamEvent>;
}

/**
 * The event that ends a stream. Exactly one, always last.
 *
 * This check is a single constant so that new event types cannot be missed. Whether a new event
 * kind is terminal is decided here, once.
 */
const isTerminal = (event: ChatStreamEvent): boolean =>
	event.type === "done" || event.type === "error";

export function createChatApi({
	requestJson,
	requestStream,
}: RowCatTransport): ChatApi {
	async function* stream(
		request: ManagedChatGenerationRequest,
		options?: RequestOptions,
	): AsyncGenerator<ChatStreamEvent> {
		/**
		 * Validate against the contract before sending. The server validates too, but failing here shows
		 * at once that the assembly (`@rowcat/chat`) is at fault, which is much cheaper than tracing a
		 * 400 back. The defaults (maxOutputTokens) are also filled in at this step.
		 */
		yield* events(
			"/chat/generate",
			ManagedChatGenerationRequest.parse(request),
			options,
		);
	}

	async function* streamStory(
		storyId: string,
		request: StoryChatGenerationRequestInput,
		options?: RequestOptions,
	): AsyncGenerator<ChatStreamEvent> {
		yield* events(
			`/chat/stories/${encodeURIComponent(storyId)}/generate`,
			StoryChatGenerationRequest.parse(request),
			options,
		);
	}

	/**
	 * Both generation paths pass the same frame rules, so the termination invariant lives in one copy.
	 */
	async function* events(
		path: string,
		body: unknown,
		options?: RequestOptions,
	): AsyncGenerator<ChatStreamEvent> {
		const stream = await requestStream({
			method: "POST",
			path,
			body,
			signal: options?.signal,
			accept: CHAT_STREAM_CONTENT_TYPE,
		});

		/**
		 * Termination invariant: a valid stream is `delta* usage? (done|error)` and nothing else.
		 *
		 * Checking each frame against the contract alone would accept `delta delta EOF` as a normal end.
		 * The caller then cannot tell "finished" from "cut off," and a truncated response is finalized
		 * locally as complete. Frame validation cannot catch this class of failure.
		 */
		let terminalSeen = false;

		for await (const frame of readNdjson(stream)) {
			/**
			 * No casting. This value is JSON from the network. If a malformed shape passed through, a delta
			 * with an undefined `text` would print "undefined" on screen. Stopping at the bad frame is much
			 * easier to diagnose.
			 */
			const parsed = ChatStreamEvent.safeParse(frame);
			if (!parsed.success) throw invalidStreamEvent();

			// A frame after the terminal event is itself a protocol violation: `done done`, `error done`, or
			// `done delta`.
			if (terminalSeen) throw invalidStreamTermination();

			yield parsed.data;
			if (isTerminal(parsed.data)) terminalSeen = true;
		}

		/**
		 * Reaching this line means the byte stream reached EOF naturally.
		 *
		 * It does not run when the caller `break`s or cancels with the signal. The first case calls the
		 * generator's `return()` at the `yield`. In the second, the reader's rejection exits the loop
		 * above. Treating an intended cancel as a truncated stream would make every user stop an error.
		 */
		if (!terminalSeen) throw invalidStreamTermination();
	}

	// Generator functions are returned as-is. Calling them does nothing; the request goes out on the
	// first iteration.
	return {
		stream,
		streamStory,
		models: async (options) =>
			GenerationModelListDto.parse(
				await requestJson({
					method: "GET",
					path: "/chat/models",
					signal: options?.signal,
				}),
			).models,
	};
}
