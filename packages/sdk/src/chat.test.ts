import type {
	ChatStreamEvent,
	ManagedChatGenerationRequest,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { type ChatApi, createChatApi } from "./chat.ts";
import type { RowCatTransport } from "./client.ts";
import { isRowCatApiError } from "./errors.ts";

/**
 * Stream protocol test. It checks state, not framing (framing is covered in ndjson.test.ts).
 *
 * The invariant: a generation stream has exactly one terminal event, `done` or `error`, and it
 * comes last. Without this, `delta delta EOF` passes as a normal end, and the UI finalizes a
 * truncated response locally as if it were complete. Frame-level validation can never catch that.
 *
 * No network. Only the transport (`requestStream`) is swapped, which lets the test control the
 * bytes and build cases that are hard to reproduce for real: EOF without a terminal event, and
 * frames after a terminal event.
 */

const encoder = new TextEncoder();

function ndjsonOf(...lines: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
			controller.close();
		},
	});
}

/**
 * Transport that swaps in only the stream. The other two methods are unused by this resource. They
 * throw when called, so a mistake fails at the call site instead of quietly returning undefined.
 */
const transportOf = (
	open: (signal?: AbortSignal) => ReadableStream<Uint8Array>,
): RowCatTransport => ({
	requestJson: () => Promise.reject(new Error("does not write")),
	requestVoid: () => Promise.reject(new Error("does not write")),
	requestStream: ({ signal }) => Promise.resolve(open(signal)),
});

const REQUEST: ManagedChatGenerationRequest = {
	system: "System",
	messages: [{ role: "user", content: "hello" }],
	tools: [],
	maxOutputTokens: 128,
	reasoningEffort: null,
	context: { requestedMode: "all-ages", minorCharacterPresent: false },
	/** A plain generation. Provider-specific continuation handling is covered by the adapter tests. */
	continuation: false,
	/** Managed requests carry the selected model's public identity, not the upstream slug. */
	model: "claude-sonnet-5",
	/**
	 * The billing identity for this attempt. Only managed requests carry it.
	 *
	 * It is a fixed value because this file tests the protocol (framing and the terminal invariant).
	 * The rule that creates a new value per attempt belongs to the side that creates it, and it is
	 * tested in `apps/web/src/lib/generation/router.test.ts`.
	 */
};

const chatOf = (...lines: string[]) =>
	createChatApi(transportOf(() => ndjsonOf(...lines)));

const collect = async (
	api: ReturnType<typeof createChatApi>,
	options?: { signal?: AbortSignal },
): Promise<ChatStreamEvent[]> => {
	const out: ChatStreamEvent[] = [];
	for await (const event of api.stream(REQUEST, options)) out.push(event);
	return out;
};

const isTerminationError = (error: unknown): boolean =>
	isRowCatApiError(error) && error.code === "invalid_stream_termination";

const DELTA = '{"type":"delta","text":"a"}';
const DONE = '{"type":"done","finishReason":"stop"}';
const STREAM_ERROR =
	'{"type":"error","code":"chat_provider_failed","message":"Generation was cancelled."}';

describe("chat.stream terminal invariants", () => {
	it("ending with done is normal", async () => {
		const events = await collect(chatOf(DELTA, DONE));
		expect(events.map((event) => event.type)).toEqual(["delta", "done"]);
	});

	it("usage may come before done", async () => {
		const events = await collect(
			chatOf(DELTA, '{"type":"usage","outputTokens":3}', DONE),
		);
		expect(events.map((event) => event.type)).toEqual([
			"delta",
			"usage",
			"done",
		]);
	});

	it("error is a valid terminal too; the wire protocol held", async () => {
		/**
		 * The generation failed, but the stream itself ended to spec. These two cases must stay separate:
		 * - Provider failure: keep the partial response already received and show a notice.
		 * - Stream cut: a protocol bug. Mixing them would leave the UI unable to tell which one
		 *   happened.
		 */
		const events = await collect(chatOf(DELTA, STREAM_ERROR));
		expect(events.at(-1)).toMatchObject({
			type: "error",
			code: "chat_provider_failed",
		});
	});

	it("EOF without a terminal fails", async () => {
		/**
		 * This is the reason for the file. Every frame matches the contract and the JSON is valid, but
		 * the stream just stopped. Frame validation alone cannot tell this apart from a normal end.
		 */
		await expect(collect(chatOf(DELTA, DELTA))).rejects.toSatisfy(
			isTerminationError,
		);
	});

	it("cutting off without a single delta fails too", async () => {
		await expect(collect(chatOf())).rejects.toSatisfy(isTerminationError);
	});

	it("two terminals fail", async () => {
		await expect(collect(chatOf(DONE, DONE))).rejects.toSatisfy(
			isTerminationError,
		);
	});

	it("done after error fails too", async () => {
		await expect(collect(chatOf(STREAM_ERROR, DONE))).rejects.toSatisfy(
			isTerminationError,
		);
	});

	it("a delta after the terminal fails", async () => {
		await expect(collect(chatOf(DONE, DELTA))).rejects.toSatisfy(
			isTerminationError,
		);
	});

	it("frames after the terminal do not leak to the caller", async () => {
		/**
		 * Throwing must happen before anything is yielded. If the stream yielded first, the UI would
		 * receive a delta that arrives after `done` and append it to the response before the error
		 * arrives. That corrupts the saved text.
		 */
		const api = chatOf(DONE, DELTA);
		const seen: ChatStreamEvent[] = [];
		await expect(
			(async () => {
				for await (const event of api.stream(REQUEST)) seen.push(event);
			})(),
		).rejects.toSatisfy(isTerminationError);
		expect(seen.map((event) => event.type)).toEqual(["done"]);
	});

	it("a frame that breaks the contract is an event error, not a terminal error", async () => {
		await expect(collect(chatOf('{"type":"delta"}'))).rejects.toSatisfy(
			(error: unknown) =>
				isRowCatApiError(error) && error.code === "invalid_stream_event",
		);
	});
});

describe("chat.stream cancellation", () => {
	it("the caller stopping first is not mistaken for a truncated EOF", async () => {
		/**
		 * When the user presses stop, `for await` breaks, and a missing terminal event is expected in
		 * that case. Running the terminal check here would turn every stop into an error screen.
		 */
		const api = chatOf(DELTA, DELTA, DONE);
		const seen: ChatStreamEvent[] = [];
		for await (const event of api.stream(REQUEST)) {
			seen.push(event);
			break;
		}
		expect(seen).toHaveLength(1);
	});

	it("break releases the upstream reader too", async () => {
		let cancelled = false;
		const api = createChatApi(
			transportOf(
				() =>
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(encoder.encode(`${DELTA}\n${DELTA}\n`));
						},
						cancel() {
							cancelled = true;
						},
					}),
			),
		);

		for await (const _ of api.stream(REQUEST)) break;
		expect(cancelled).toBe(true);
	});

	it("cutting by signal surfaces the abort error as is", async () => {
		/**
		 * Unmounting a component or switching accounts takes this path. Converting it into a terminal
		 * error would make the caller's `signal.aborted` branch meaningless and record an intended stop
		 * as a failure.
		 */
		const controller = new AbortController();
		const api = createChatApi(
			transportOf(
				(signal) =>
					new ReadableStream<Uint8Array>({
						start(streamController) {
							streamController.enqueue(encoder.encode(`${DELTA}\n`));
							signal?.addEventListener("abort", () =>
								streamController.error(
									new DOMException("Aborted", "AbortError"),
								),
							);
						},
					}),
			),
		);

		await expect(
			(async () => {
				for await (const _ of api.stream(REQUEST, {
					signal: controller.signal,
				}))
					controller.abort();
			})(),
		).rejects.toSatisfy(
			(error: unknown) => error instanceof Error && error.name === "AbortError",
		);
	});
});

/**
 * The usage event contract, checked by the same schema the resource uses.
 *
 * The test runs a real stream instead of parsing the schema directly, because the stream is where
 * the contract is actually enforced. A contract-only test would keep passing if the SDK ever
 * dropped `safeParse`, and then unverified JSON would reach the screen.
 */
describe("usage contract: cache axes", () => {
	const usageOf = async (json: string) => {
		const events = await collect(chatOf(json, DONE));
		return events.find((event) => event.type === "usage");
	};

	it("accepts usage with cache axes", async () => {
		expect(
			await usageOf(
				'{"type":"usage","model":"m","inputTokens":10000,"cachedInputTokens":8000,"cacheWriteInputTokens":0,"outputTokens":500}',
			),
		).toEqual({
			type: "usage",
			model: "m",
			inputTokens: 10_000,
			cachedInputTokens: 8_000,
			cacheWriteInputTokens: 0,
			outputTokens: 500,
		});
	});

	/**
	 * The old usage format without cache fields must still pass. Adding optional fields must not break
	 * compatibility.
	 */
	it("accepts old usage without cache axes too", async () => {
		expect(
			await usageOf('{"type":"usage","inputTokens":10,"outputTokens":2}'),
		).toEqual({ type: "usage", inputTokens: 10, outputTokens: 2 });
	});

	it("negative cache tokens reject the whole frame", async () => {
		/**
		 * Does not silently coerce to 0. A negative token count is a bug, either upstream or in our
		 * translation. Storing it would remove the basis for explaining that conversation's billing.
		 */
		await expect(
			collect(chatOf('{"type":"usage","cachedInputTokens":-1}', DONE)),
		).rejects.toSatisfy(
			(error: unknown) =>
				isRowCatApiError(error) && error.code === "invalid_stream_event",
		);
	});

	it("fractional cache tokens are refused too", async () => {
		await expect(
			collect(chatOf('{"type":"usage","cacheWriteInputTokens":1.5}', DONE)),
		).rejects.toSatisfy(
			(error: unknown) =>
				isRowCatApiError(error) && error.code === "invalid_stream_event",
		);
	});
});

/**
 * Managed models are sent in the request body.
 *
 * Without this section, nothing checks whether the router attached the model or whether the SDK
 * forwarded it. The symptom is a 400 (the contract requires the field), which users see only as
 * "the conversation doesn't work."
 */
describe("passing the managed model", () => {
	const sent = (): { body: () => unknown; api: ChatApi } => {
		let captured: unknown = null;
		const api = createChatApi({
			requestJson: () => Promise.reject(new Error("does not write")),
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: ({ body }) => {
				captured = body;
				return Promise.resolve(ndjsonOf(DONE));
			},
		});
		return { body: () => captured, api };
	};

	it("the chosen model rides in the body as is", async () => {
		const h = sent();
		for await (const _ of h.api.stream(REQUEST)) break;
		expect(h.body()).toMatchObject({ model: "claude-sonnet-5" });
	});

	it("changing the model changes the body", async () => {
		const h = sent();
		for await (const _ of h.api.stream({
			...REQUEST,
			model: "deepseek-v4-pro",
		}))
			break;
		expect(h.body()).toMatchObject({ model: "deepseek-v4-pro" });
	});

	/**
	 * The contract narrows the vocabulary, so both upstream slugs and the old literal fail before the
	 * request is sent. Failing here is much clearer about the cause than a 400 from the server.
	 */
	it.each([
		["upstream slug", "anthropic/claude-sonnet-5"],
		["old single-model literal", "default"],
		["a model only in the BYO catalogue", "claude-opus-4-5"],
	])("%s never even reaches the transport", async (_label, model) => {
		const h = sent();
		await expect(
			(async () => {
				for await (const _ of h.api.stream({
					...REQUEST,
					model,
				} as unknown as ManagedChatGenerationRequest))
					break;
			})(),
		).rejects.toThrow();
		expect(h.body()).toBeNull();
	});
});

/**
 * Generation for a protected copy of a story. The path names the work, and the body has no prompt
 * field.
 *
 * The path rule lives in this SDK alone. If apps began writing the URL by hand, the `/v2` prefix
 * would appear in two places.
 */
describe("protected story generation", () => {
	const sent = (): {
		call: () => { path: string; body: unknown } | null;
		api: ChatApi;
	} => {
		let captured: { path: string; body: unknown } | null = null;
		const api = createChatApi({
			requestJson: () => Promise.reject(new Error("does not write")),
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: ({ path, body }) => {
				captured = { path, body };
				return Promise.resolve(ndjsonOf(DONE));
			},
		});
		return { call: () => captured, api };
	};

	const STORY_REQUEST = {
		messages: [{ role: "user" as const, speaker: "", content: "hello" }],
		model: "claude-sonnet-5" as const,
	};

	it("the story id rides in the path and the body passes the contract", async () => {
		const h = sent();
		for await (const _ of h.api.streamStory("story-1", STORY_REQUEST)) break;
		expect(h.call()?.path).toBe("/chat/stories/story-1/generate");
		expect(h.call()?.body).toMatchObject({
			model: "claude-sonnet-5",
			requestedMode: "all-ages",
		});
	});

	it("trying to carry a prompt never reaches the transport", async () => {
		const h = sent();
		await expect(
			(async () => {
				for await (const _ of h.api.streamStory("story-1", {
					...STORY_REQUEST,
					system: "A hand-written prompt",
				} as never))
					break;
			})(),
		).rejects.toThrow();
		expect(h.call()).toBeNull();
	});
});
