import { CONTINUATION_FALLBACK_NUDGE } from "@rowcat/chat";
import type {
	ChatGenerationRequest,
	ChatStreamEvent,
	ChatToolDeclaration,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "./anthropic.ts";
import { ProviderError } from "./errors.ts";
import { geminiAdapter } from "./gemini.ts";
import { PROVIDER_CONNECT_ORIGINS } from "./router.ts";
import type { ByoAdapter, ByoTransportInput } from "./transport.ts";

/**
 * Contract tests for the two direct adapters, run without network.
 *
 * Providers are not called. CI cannot hold developer keys, and what is checked here is the mapping
 * and normalization, not provider behavior. How a 401 or a mid-stream cut is handled is our own
 * rule.
 *
 * These tests do not prove that CORS works in a browser. Node's fetch has no same-origin policy, so
 * a pass here can still fail in a real browser. That check belongs to runtime QA. This note keeps a
 * passing test from being read as that evidence.
 */

const request: ChatGenerationRequest = {
	system: "system prompt",
	messages: [
		{ role: "user", content: "first" },
		{ role: "assistant", content: "answer" },
		{ role: "user", content: "second" },
	],
	maxOutputTokens: 1024,
	tools: [],
	/**
	 * The reasoning axis is not part of this file's default request. Its translation is checked by its
	 * own tests.
	 */
	reasoningEffort: null,
	context: { requestedMode: "all-ages", minorCharacterPresent: false },
	/** The default is a plain generation. The continuation path has its own tests. */
	continuation: false,
};

function sseResponse(frames: string[], init?: ResponseInit): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const frame of frames) controller.enqueue(encoder.encode(frame));
			controller.close();
		},
	});
	return new Response(body, { status: 200, ...init });
}

function recorder(response: Response | (() => Response)) {
	const seen: { url: string; init: RequestInit }[] = [];
	const fetchMock = (async (url: unknown, init: unknown) => {
		seen.push({ url: String(url), init: (init ?? {}) as RequestInit });
		return typeof response === "function" ? response() : response;
	}) as unknown as typeof globalThis.fetch;
	return { seen, fetchMock };
}

async function collect(
	adapter: ByoAdapter,
	input: Omit<ByoTransportInput, "request" | "signal"> &
		Partial<Pick<ByoTransportInput, "request" | "signal">>,
): Promise<ChatStreamEvent[]> {
	const events: ChatStreamEvent[] = [];
	for await (const event of adapter.stream({
		request,
		signal: new AbortController().signal,
		...input,
	} as ByoTransportInput))
		events.push(event);
	return events;
}

const body = (seen: { init: RequestInit }): Record<string, unknown> =>
	JSON.parse(String(seen.init.body)) as Record<string, unknown>;

/* ══════════════════════════════════════════════════════════════════════════
 * Anthropic
 * ══════════════════════════════════════════════════════════════════════════ */

const ANTHROPIC_STREAM = [
	'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":42}}}\n\n',
	'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
	'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n',
	'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
	'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

describe("Anthropic adapter", () => {
	it("maps the request to the Messages API shape", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		const call = seen[0];
		if (!call) throw new Error("no request");
		expect(call.url).toBe("https://api.anthropic.com/v1/messages");
		const sent = body(call);
		expect(sent.model).toBe("claude-sonnet-5");
		expect(sent.max_tokens).toBe(1024);
		// The system prompt is a top-level field. It is not folded into the messages array.
		expect(sent.system).toBe("system prompt");
		expect(sent.messages).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "answer" },
			{ role: "user", content: "second" },
		]);
		expect(sent.stream).toBe(true);
	});

	/**
	 * The switch for automatic prompt caching. If this field is dropped, caching turns off silently.
	 * The only symptom is on the bill, not an error, so nothing but this test would catch it.
	 */
	it("turns on automatic prompt caching — other fields unchanged", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		const call = seen[0];
		if (!call) throw new Error("no request");
		const sent = body(call);
		expect(sent.cache_control).toEqual({ type: "ephemeral" });
		// Turning caching on must not change the prompt. This slice depends on that.
		expect(sent.model).toBe("claude-sonnet-5");
		expect(sent.max_tokens).toBe(1024);
		expect(sent.system).toBe("system prompt");
		expect(sent.messages).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "answer" },
			{ role: "user", content: "second" },
		]);
		expect(sent.stream).toBe(true);
	});

	/** No TTL is set. The default lifetime is this product's choice and is not a config axis. */
	it("does not set a cache TTL", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});
		expect(
			body(seen[0] as { init: RequestInit }).cache_control,
		).not.toHaveProperty("ttl");
	});

	/** Without this header, browser requests are blocked by CORS. */
	it("sends the direct browser access header", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		const headers = seen[0]?.init.headers as Record<string, string>;
		expect(headers["x-api-key"]).toBe("sk-ant");
		expect(headers["anthropic-version"]).toBe("2023-06-01");
		expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
	});

	/**
	 * The key goes only in the header. In a URL it would be kept in browser history and proxy logs.
	 */
	it("does not put the key in the URL", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant-secret",
			fetch: fetchMock,
		});
		expect(seen[0]?.url).not.toContain("sk-ant-secret");
	});

	it("normalizes deltas, usage and done", async () => {
		const { fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		expect(events).toEqual([
			{ type: "delta", text: "hello" },
			{ type: "delta", text: " there" },
			{
				type: "usage",
				model: "claude-sonnet-5",
				inputTokens: 42,
				outputTokens: 7,
			},
			{ type: "done", finishReason: "end_turn" },
		]);
	});

	/**
	 * This provider's `input_tokens` excludes cache. Our total input is therefore the sum of all
	 * three. Missing this makes a cache-heavy conversation record a fraction of its real total input.
	 * The three numbers are deliberately different, so an implementation that drops one cannot pass by
	 * chance.
	 */
	it("total input = uncached + cache write + cache read", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":100,"cache_creation_input_tokens":2000,"cache_read_input_tokens":5000}}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"body"}}\n\n',
				'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":250}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		expect(events.find((event) => event.type === "usage")).toEqual({
			type: "usage",
			model: "claude-sonnet-5",
			inputTokens: 7_100,
			cachedInputTokens: 5_000,
			cacheWriteInputTokens: 2_000,
			outputTokens: 250,
		});
	});

	it("carries a cache-write-only turn as is", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":40,"cache_creation_input_tokens":1200,"cache_read_input_tokens":0}}}\n\n',
				'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		expect(events.find((event) => event.type === "usage")).toEqual({
			type: "usage",
			model: "claude-sonnet-5",
			inputTokens: 1_240,
			cachedInputTokens: 0,
			cacheWriteInputTokens: 1_200,
			outputTokens: 9,
		});
	});

	it("carries a cache-hit turn as is", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":18,"cache_creation_input_tokens":0,"cache_read_input_tokens":1200}}}\n\n',
				'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":11}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		const usage = events.find((event) => event.type === "usage");
		expect(usage).toMatchObject({
			inputTokens: 1_218,
			cachedInputTokens: 1_200,
			cacheWriteInputTokens: 0,
		});
		expect(
			usage?.type === "usage" &&
				(usage.cachedInputTokens ?? 0) <= (usage.inputTokens ?? 0),
		).toBe(true);
	});

	/**
	 * When a response does not report cache fields (the format from before caching existed), leave the
	 * axis out. Filling it with 0 would claim there was no cache, which we cannot know.
	 */
	it("no cache fields means no such axis", async () => {
		const { fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		const usage = events.find((event) => event.type === "usage");
		expect(usage).toEqual({
			type: "usage",
			model: "claude-sonnet-5",
			inputTokens: 42,
			outputTokens: 7,
		});
	});

	/**
	 * Usage must arrive before `done`. The caller finalizes the message on `done`. If the order were
	 * reversed, usage would never attach to that message.
	 */
	it("usage comes before done", async () => {
		const { fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});
		const types = events.map((event) => event.type);
		expect(types.indexOf("usage")).toBeLessThan(types.indexOf("done"));
	});

	/**
	 * Reasoning and tool deltas are not part of this product's conversation. Passing them through
	 * would leak internal reasoning onto the screen.
	 */
	it("non-text deltas are not passed through", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"internal"}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"body"}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});
		expect(events.filter((event) => event.type === "delta")).toEqual([
			{ type: "delta", text: "body" },
		]);
	});

	/**
	 * After a user turn that got no reply, the user may speak again, so two user messages arrive in a
	 * row. Sent as-is, that conversation would get a 400 forever after one failure.
	 */
	it("merges consecutive turns of the same role", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: {
				...request,
				messages: [
					{ role: "user", content: "first part" },
					{ role: "user", content: "and then" },
				],
			},
		});

		const call = seen[0];
		if (!call) throw new Error("no request");
		expect(body(call).messages).toEqual([
			{ role: "user", content: "first part\n\nand then" },
		]);
	});

	it("401 throws a credential error", async () => {
		const { fetchMock } = recorder(() => new Response("{}", { status: 401 }));
		await expect(
			collect(anthropicAdapter, {
				model: "claude-sonnet-5",
				secret: "bad",
				fetch: fetchMock,
			}),
		).rejects.toMatchObject({ code: "invalid_credential" });
	});

	it("429 throws with a retry delay", async () => {
		const { fetchMock } = recorder(
			() =>
				new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
		);
		await expect(
			collect(anthropicAdapter, {
				model: "claude-sonnet-5",
				secret: "sk-ant",
				fetch: fetchMock,
			}),
		).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 30 });
	});

	/**
	 * A failure after the stream has started is not thrown. The caller must save the text it already
	 * received, and throwing would lose that partial response.
	 */
	it("an error mid-stream is emitted as an event", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n',
				'event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		expect(events[0]).toEqual({ type: "delta", text: "partial" });
		expect(events[1]).toMatchObject({ type: "error", code: "rate_limited" });
		expect(events.some((event) => event.type === "done")).toBe(false);
	});

	/**
	 * A stream that ends without a terminal event must not be reported as complete. Otherwise a
	 * cut-off response would be saved as finished.
	 */
	it("cut off without a terminator ends in an error", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"truncated"}}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});

		expect(events[0]).toEqual({ type: "delta", text: "truncated" });
		expect(events.at(-1)).toMatchObject({ type: "error" });
	});

	/** Abort is not a failure. Rethrow it so the caller treats it as the user pressing `Stop`. */
	it("an abort propagates as AbortError", async () => {
		const controller = new AbortController();
		const fetchMock = (async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		}) as unknown as typeof globalThis.fetch;

		await expect(
			collect(anthropicAdapter, {
				model: "claude-sonnet-5",
				secret: "sk-ant",
				fetch: fetchMock,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("validation does not start generation", async () => {
		const { seen, fetchMock } = recorder(() => new Response("{}"));
		const check = await anthropicAdapter.probe({
			secret: "sk-ant",
			signal: new AbortController().signal,
			fetch: fetchMock,
		});
		expect(check.ok).toBe(true);
		expect(seen[0]?.url).toContain("/v1/models");
		expect(seen[0]?.init.method).toBe("GET");
	});

	it("a validation failure returns as a value", async () => {
		const { fetchMock } = recorder(() => new Response("{}", { status: 401 }));
		const check = await anthropicAdapter.probe({
			secret: "bad",
			signal: new AbortController().signal,
			fetch: fetchMock,
		});
		expect(check.ok).toBe(false);
		if (!check.ok) expect(check.error).toBeInstanceOf(ProviderError);
	});
});

/* ══════════════════════════════════════════════════════════════════════════
 * Gemini
 * ══════════════════════════════════════════════════════════════════════════ */

const GEMINI_STREAM = [
	'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}],"modelVersion":"gemini-3.7-flash"}\n\n',
	'data: {"candidates":[{"content":{"parts":[{"text":" there"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":5}}\n\n',
];

/**
 * Sends one request at this level and returns the safetySettings that actually went out. Reading
 * them from the body matters because that is what the provider receives. Calling the function
 * directly would not confirm that its output reached the request.
 */
const sentSafetySettings = (
	requestedMode: "all-ages" | "adult",
): { category: string; threshold: string }[] => {
	const { seen, fetchMock } = recorder(() =>
		sseResponse(['data: {"candidates":[{"finishReason":"STOP"}]}\n\n']),
	);
	void collect(geminiAdapter, {
		model: "gemini-3.7-flash",
		secret: "key",
		request: {
			...request,
			context: { requestedMode, minorCharacterPresent: false },
		},
		fetch: fetchMock,
	});
	return (body(seen[0] as { init: RequestInit }).safetySettings ?? []) as {
		category: string;
		threshold: string;
	}[];
};

describe("Gemini adapter", () => {
	it("maps the request to the generateContent shape", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});

		const call = seen[0];
		if (!call) throw new Error("no request");
		expect(call.url).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse",
		);
		const sent = body(call);
		expect(sent.systemInstruction).toEqual({
			parts: [{ text: "system prompt" }],
		});
		// Gemini names the assistant role `model`. That one mapping is the whole role translation.
		expect(sent.contents).toEqual([
			{ role: "user", parts: [{ text: "first" }] },
			{ role: "model", parts: [{ text: "answer" }] },
			{ role: "user", parts: [{ text: "second" }] },
		]);
		expect(sent.generationConfig).toEqual({ maxOutputTokens: 1024 });
	});

	/**
	 * Google separates stream frames with CRLF, and this path was broken because of it.
	 *
	 * The fixtures above use LF pairs because that is what we wrote, not what this provider sends. The
	 * real frame boundary is CR LF CR LF. It contains no LF LF pair (the sequence is LF CR LF), so a
	 * parser that splits only on LF finds no boundary at all. No deltas or terminal event arrive, the
	 * adapter treats the stream as cut off, and it emits provider_error. In the UI, every Gemini BYO
	 * generation ended in a response error.
	 *
	 * A single-frame fixture would not catch this. The leftover buffer after the stream ends is read
	 * as one last frame, so it passes by chance. That is why there are at least two frames.
	 */
	it("emits the same events over CRLF", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				GEMINI_STREAM.map((frame) => frame.replaceAll("\n\n", "\r\n\r\n")).join(
					"",
				),
			]),
		);
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});

		expect(events).toEqual(
			await collect(geminiAdapter, {
				model: "gemini-3.7-flash",
				secret: "AIza",
				fetch: recorder(() => sseResponse(GEMINI_STREAM)).fetchMock,
			}),
		);
		expect(events[0]).toEqual({ type: "delta", text: "hello" });
		expect(events.at(-1)).toEqual({ type: "done", finishReason: "STOP" });
	});

	/**
	 * Implicit caching is all the caching this path has. No `cachedContents` lifecycle is created. Two
	 * things are checked: the body still has only the original three top-level keys, and no network
	 * call creates a cache before generation. Without the second check, code that creates a cache
	 * object first could slip in silently.
	 */
	it("has not switched to explicit cache management", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});

		expect(seen).toHaveLength(1);
		const call = seen[0];
		if (!call) throw new Error("no request");
		expect(call.url).not.toContain("cachedContents");
		const sent = body(call);
		/*
		 * `safetySettings` appears here but is unrelated to caching. It is a static value derived from
		 * one rating level and creates no request before generation. This list always checks whether the
		 * body has only these keys, so this line breaks first when a fourth key is added.
		 */
		expect(Object.keys(sent).sort()).toEqual([
			"contents",
			"generationConfig",
			"safetySettings",
			"systemInstruction",
		]);
	});

	it("maps cache tokens to the canonical names", async () => {
		/**
		 * This provider's `promptTokenCount` already includes cached tokens, the opposite of Anthropic.
		 * So it is passed through without adding, and the cached share is carried alongside as a subset.
		 * This API does not report cache writes, so there is no `cacheWriteInputTokens`.
		 */
		const { fetchMock } = recorder(() =>
			sseResponse([
				'data: {"candidates":[{"content":{"parts":[{"text":"body"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":6000,"cachedContentTokenCount":4500,"candidatesTokenCount":300},"modelVersion":"gemini-3.7-flash"}\n\n',
			]),
		);
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});

		expect(events.find((event) => event.type === "usage")).toEqual({
			type: "usage",
			model: "gemini-3.7-flash",
			inputTokens: 6_000,
			cachedInputTokens: 4_500,
			outputTokens: 300,
		});
	});

	it("a response without a cache hit lacks that axis", async () => {
		const { fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});
		expect(events.find((event) => event.type === "usage")).toEqual({
			type: "usage",
			model: "gemini-3.7-flash",
			inputTokens: 11,
			outputTokens: 5,
		});
	});

	/**
	 * This API also accepts `?key=`, but it is not used. Query strings end up in history, referrer,
	 * and proxy logs.
	 */
	it("sends the key only as a header", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza-secret",
			fetch: fetchMock,
		});

		const headers = seen[0]?.init.headers as Record<string, string>;
		expect(headers["x-goog-api-key"]).toBe("AIza-secret");
		expect(seen[0]?.url).not.toContain("AIza-secret");
		expect(seen[0]?.url).not.toContain("key=");
	});

	it("normalizes deltas, usage and done", async () => {
		const { fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});

		expect(events).toEqual([
			{ type: "delta", text: "hello" },
			{ type: "delta", text: " there" },
			{
				type: "usage",
				model: "gemini-3.7-flash",
				inputTokens: 11,
				outputTokens: 5,
			},
			{ type: "done", finishReason: "STOP" },
		]);
	});

	it("merges consecutive turns of the same role", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
			request: {
				...request,
				messages: [
					{ role: "user", content: "first part" },
					{ role: "user", content: "and then" },
				],
			},
		});

		const call = seen[0];
		if (!call) throw new Error("no request");
		expect(body(call).contents).toEqual([
			{ role: "user", parts: [{ text: "first part\n\nand then" }] },
		]);
	});

	it("401 throws a credential error", async () => {
		const { fetchMock } = recorder(() => new Response("{}", { status: 401 }));
		await expect(
			collect(geminiAdapter, {
				model: "gemini-3.7-flash",
				secret: "bad",
				fetch: fetchMock,
			}),
		).rejects.toMatchObject({ code: "invalid_credential" });
	});

	it("429 throws with a retry delay", async () => {
		const { fetchMock } = recorder(
			() =>
				new Response("{}", { status: 429, headers: { "retry-after": "12" } }),
		);
		await expect(
			collect(geminiAdapter, {
				model: "gemini-3.7-flash",
				secret: "AIza",
				fetch: fetchMock,
			}),
		).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 12 });
	});

	/** This API has no terminal event. Without a finish reason, the stream was cut off. */
	it("cut off without a finish reason ends in an error", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'data: {"candidates":[{"content":{"parts":[{"text":"truncated"}]}}]}\n\n',
			]),
		);
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});

		expect(events[0]).toEqual({ type: "delta", text: "truncated" });
		expect(events.at(-1)).toMatchObject({ type: "error" });
	});

	it("an abort propagates as AbortError", async () => {
		const controller = new AbortController();
		const fetchMock = (async () => {
			throw new DOMException("aborted", "AbortError");
		}) as unknown as typeof globalThis.fetch;

		await expect(
			collect(geminiAdapter, {
				model: "gemini-3.7-flash",
				secret: "AIza",
				fetch: fetchMock,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("validation uses one model list request", async () => {
		const { seen, fetchMock } = recorder(() => new Response("{}"));
		const check = await geminiAdapter.probe({
			secret: "AIza",
			signal: new AbortController().signal,
			fetch: fetchMock,
		});
		expect(check.ok).toBe(true);
		expect(seen[0]?.url).toContain("/v1beta/models?pageSize=1");
	});

	/**
	 * A key with the wrong format gets a 400. During key validation, that means `check the key` (check the
	 * key).
	 */
	it("400 is also reported as a credential problem", async () => {
		const { fetchMock } = recorder(() => new Response("{}", { status: 400 }));
		const check = await geminiAdapter.probe({
			secret: "not-a-key",
			signal: new AbortController().signal,
			fetch: fetchMock,
		});
		expect(check.ok).toBe(false);
		if (!check.ok) expect(check.error.code).toBe("invalid_credential");
	});

	/**
	 * Warning: this group guards whether a response with mature content arrives. For a while this
	 * adapter sent no `safetySettings`, and the default thresholds blocked responses that the adult
	 * guard allowed. The user saw only an unexplained `Regenerate`. Without the values pinned,
	 * a commit that reverts to that state would pass green.
	 */
	it("an adult turn lowers every adjustable threshold", () => {
		expect(sentSafetySettings("adult")).toEqual([
			{ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
			{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
			{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
			{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
		]);
	});

	/**
	 * At the all-ages level, the thresholds that stay on are pinned with the same weight. That level's
	 * guard bans sexual description at both ends, so keeping a safety net costs nothing. BYO has no
	 * server-side re-check.
	 */
	it("an all-ages turn keeps the net", () => {
		expect(
			sentSafetySettings("all-ages").map((entry) => entry.threshold),
		).toEqual([
			"BLOCK_ONLY_HIGH",
			"BLOCK_ONLY_HIGH",
			"BLOCK_ONLY_HIGH",
			"BLOCK_ONLY_HIGH",
		]);
	});

	/**
	 * Sending a category that no longer exists gets a 400 from that model only. The list of four is
	 * pinned by value.
	 */
	it("retired categories are not sent", () => {
		expect(
			sentSafetySettings("adult").map((entry) => entry.category),
		).not.toContain("HARM_CATEGORY_CIVIC_INTEGRITY");
	});

	it("a response ended by blocking is a named failure", async () => {
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "key",
			fetch: recorder(() =>
				sseResponse([
					'data: {"candidates":[{"content":{"parts":[{"text":"body"}]},"finishReason":"SAFETY"}]}\n\n',
				]),
			).fetchMock,
		});
		/* Text already received keeps streaming. It is not taken back. */
		expect(events[0]).toEqual({ type: "delta", text: "body" });
		expect(events.at(-1)).toMatchObject({
			type: "error",
			code: "content_blocked",
		});
		/*
		 * Ending with `done` would make the caller read it as a normal finish, and an unexplained `Regenerate`
		 * prompt would appear.
		 */
		expect(events.some((event) => event.type === "done")).toBe(false);
	});

	/**
	 * The branch where the prompt is blocked before any candidate is produced. If not read, it gets
	 * the same message as a cut-off stream.
	 */
	it("a blocked prompt is the same failure", async () => {
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "key",
			fetch: recorder(() =>
				sseResponse([
					'data: {"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"}}\n\n',
				]),
			).fetchMock,
		});
		expect(events).toEqual([
			{
				type: "error",
				code: "content_blocked",
				message: expect.stringContaining("content policy"),
			},
		]);
	});

	/**
	 * Warning: a response cut off at the token limit is not a block. Writing the check as !== "STOP"
	 * would catch it here, and `Continue generating` would be replaced by `Change the scene`.
	 */
	it("a response cut by the cap is not reported as blocked", async () => {
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "key",
			fetch: recorder(() =>
				sseResponse([
					'data: {"candidates":[{"content":{"parts":[{"text":"body"}]},"finishReason":"MAX_TOKENS"}]}\n\n',
				]),
			).fetchMock,
		});
		expect(events.at(-1)).toEqual({ type: "done", finishReason: "MAX_TOKENS" });
	});
});

describe("leak boundary", () => {
	/**
	 * Upstream error bodies can contain account, organization, and request IDs. Sometimes they echo
	 * back the prompt we sent. If that reaches an exception, the error reporter collects the user's
	 * conversation.
	 */
	it.each([
		["Anthropic", anthropicAdapter, "claude-sonnet-5"],
		["Gemini", geminiAdapter, "gemini-3.7-flash"],
	] as const)("%s does not throw the vendor error body", async (_label, adapter, model) => {
		const leaked =
			'{"error":{"message":"org_id=abc prompt=a private user story"}}';
		const { fetchMock } = recorder(() => new Response(leaked, { status: 500 }));

		await expect(
			collect(adapter, { model, secret: "k", fetch: fetchMock }),
		).rejects.toSatisfy((thrown: unknown) => {
			expect(thrown).toBeInstanceOf(ProviderError);
			const serialized = JSON.stringify({
				message: (thrown as Error).message,
				...(thrown as object),
			});
			expect(serialized).not.toContain("org_id");
			expect(serialized).not.toContain("a private user story");
			return true;
		});
	});

	/** Neither the prompt nor the messages leak outside the request body. The adapter logs nothing. */
	it.each([
		["Anthropic", anthropicAdapter, "claude-sonnet-5"],
		["Gemini", geminiAdapter, "gemini-3.7-flash"],
	] as const)("%s does not put the key in the URL", async (_label, adapter, model) => {
		const { seen, fetchMock } = recorder(() =>
			sseResponse(
				model.startsWith("claude") ? ANTHROPIC_STREAM : GEMINI_STREAM,
			),
		);
		await collect(adapter, {
			model,
			secret: "super-secret-key-value",
			fetch: fetchMock,
		});
		expect(seen[0]?.url).not.toContain("super-secret-key-value");
	});
});

describe("network surface", () => {
	/**
	 * This slice opens only two origins from the browser. This assertion is the basis for a CSP. The
	 * app sends no CSP today (an audit found it sets no security headers). When one is added, the
	 * `connect-src` list must match `PROVIDER_CONNECT_ORIGINS`. If an adapter starts calling another
	 * host, this test fails first, before a CSP is enabled and the problem shows up in production.
	 *
	 * The test also pins that users cannot set an endpoint. An arbitrary base URL would make the list
	 * open-ended, and only `connect-src *` could express that.
	 */
	it.each([
		["Anthropic", anthropicAdapter, "claude-sonnet-5", ANTHROPIC_STREAM],
		["Gemini", geminiAdapter, "gemini-3.7-flash", GEMINI_STREAM],
	] as const)("%s calls only allowed origins", async (_label, adapter, model, frames) => {
		const { seen, fetchMock } = recorder(() => sseResponse([...frames]));
		await collect(adapter, { model, secret: "k", fetch: fetchMock });
		await adapter.probe({
			secret: "k",
			signal: new AbortController().signal,
			fetch: fetchMock,
		});

		expect(seen.length).toBeGreaterThan(1);
		for (const call of seen)
			expect(
				PROVIDER_CONNECT_ORIGINS.some((origin) =>
					call.url.startsWith(`${origin}/`),
				),
			).toBe(true);
	});

	it("the allowlist has as many entries as implemented providers", () => {
		expect(PROVIDER_CONNECT_ORIGINS).toEqual([
			"https://api.anthropic.com",
			"https://generativelanguage.googleapis.com",
		]);
	});
});

/**
 * The translation table lives inside the adapter and does not leave it. Four things are checked:
 * each model gets parameters from its own generation, parameters from other generations do not leak
 * in, a parameter is omitted entirely for unsupported values, and reasoning content stays out of
 * the conversation. None of these raise an error on their own. The symptoms are a 400, a 400, a
 * changed response, and the model's thoughts appearing in the reply bubble.
 *
 * Do not represent a whole company with one model. This file did that before, and code sending an
 * extended-thinking budget to `claude-sonnet-5` passed green. That model rejects the parameter with
 * a 400.
 */
describe("reasoning effort translation", () => {
	const sentFor = async (
		adapter: ByoAdapter,
		stream: string[],
		model: string,
		reasoningEffort: ChatGenerationRequest["reasoningEffort"],
	) => {
		const { seen, fetchMock } = recorder(() => sseResponse(stream));
		await collect(adapter, {
			model,
			secret: "key",
			fetch: fetchMock,
			request: { ...request, reasoningEffort },
		});
		const call = seen[0];
		if (!call) throw new Error("no request");
		return body(call);
	};

	describe("Anthropic", () => {
		const sent = (
			model: string,
			effort: ChatGenerationRequest["reasoningEffort"],
		) => sentFor(anthropicAdapter, ANTHROPIC_STREAM, model, effort);

		/**
		 * Adaptive-only generation. It rejects `thinking.type: "enabled"` with a 400. Depth is set by
		 * `output_config.effort`, not tokens. Some models (4.8, 4.7, 4.6) default to thinking off, so
		 * `thinking: { type: "adaptive" }` must go out together with the effort.
		 */
		const ADAPTIVE_MODELS = [
			"claude-fable-5-1",
			"claude-fable-5",
			"claude-opus-5-5",
			"claude-opus-5",
			"claude-sonnet-5-5",
			"claude-sonnet-5",
			"claude-opus-4-8",
			"claude-opus-4-7",
			"claude-opus-4-6",
			"claude-sonnet-4-6",
		];
		/** Manual-only generation. It rejects `thinking.type: "adaptive"` with a 400. */
		const MANUAL_MODELS = [
			"claude-opus-4-5",
			"claude-sonnet-4-5",
			"claude-haiku-4-5",
		];

		it.each(
			ADAPTIVE_MODELS,
		)("%s goes out as adaptive + effort level", async (model) => {
			expect(await sent(model, "low")).toMatchObject({
				thinking: { type: "adaptive" },
				output_config: { effort: "low" },
			});
			expect(await sent(model, "high")).toMatchObject({
				thinking: { type: "adaptive" },
				output_config: { effort: "high" },
			});
		});

		/**
		 * Old parameters must not leak in. If they did, the request would get a 400. Turning reasoning
		 * off would make the error disappear, which hides the cause.
		 */
		it.each(ADAPTIVE_MODELS)("%s has no thinking budget", async (model) => {
			const sentBody = await sent(model, "medium");
			expect(JSON.stringify(sentBody)).not.toContain("budget_tokens");
			expect(sentBody.thinking).toEqual({ type: "adaptive" });
		});

		/**
		 * No output-limit arithmetic for adaptive models. That API does not require the relationship, and
		 * there is no budget to add. Picking an arbitrary number would raise the billing cap by an amount
		 * the user never chose.
		 */
		it.each(ADAPTIVE_MODELS)("%s keeps the output cap", async (model) => {
			expect((await sent(model, "high")).max_tokens).toBe(1_024);
		});

		it.each(
			MANUAL_MODELS,
		)("%s goes out as a thinking budget", async (model) => {
			expect(await sent(model, "low")).toMatchObject({
				thinking: { type: "enabled", budget_tokens: 1_024 },
			});
			expect(await sent(model, "high")).toMatchObject({
				thinking: { type: "enabled", budget_tokens: 8_192 },
			});
		});

		/**
		 * New parameters must not leak into older generations, which reject adaptive thinking with a 400.
		 */
		it.each(MANUAL_MODELS)("%s has no adaptive or effort", async (model) => {
			const sentBody = await sent(model, "medium");
			expect(sentBody).not.toHaveProperty("output_config");
			expect(JSON.stringify(sentBody)).not.toContain("adaptive");
		});

		/**
		 * The two axes must be independent. In manual mode, thinking tokens count against `max_tokens`.
		 * Left unchanged, a higher reasoning level would shorten the visible reply. A room set to `Short`
		 * (short) would also have its budget exceed the cap, and the request itself would be rejected.
		 */
		it("only extended thinking raises the output cap by the budget", async () => {
			expect((await sent("claude-haiku-4-5", "medium")).max_tokens).toBe(
				1_024 + 4_096,
			);
			expect((await sent("claude-haiku-4-5", null)).max_tokens).toBe(1_024);
		});

		/**
		 * This provider has no `minimal` level. Effort starts at `low`, and the budget floor is 1,024.
		 * When two places disagree, running without reasoning is better than sending a value that will be
		 * rejected.
		 */
		it.each([
			...ADAPTIVE_MODELS,
			...MANUAL_MODELS,
		])("%s builds no parameter for a level not in the table", async (model) => {
			const sentBody = await sent(model, "minimal");
			expect(sentBody).not.toHaveProperty("thinking");
			expect(sentBody).not.toHaveProperty("output_config");
			expect(sentBody.max_tokens).toBe(1_024);
		});

		/**
		 * Saved preferences outlive the catalog. An unknown model name is never assumed to use one
		 * scheme.
		 */
		it("sends nothing for a model not in the table", async () => {
			const sentBody = await sent("claude-retired-model", "high");
			expect(sentBody).not.toHaveProperty("thinking");
			expect(sentBody).not.toHaveProperty("output_config");
		});

		/**
		 * A request that sends nothing must have a body byte-identical to the one from before this axis
		 * existed.
		 */
		it("absent means the key itself is absent", async () => {
			const sentBody = await sent("claude-sonnet-5", null);
			expect(sentBody).not.toHaveProperty("thinking");
			expect(sentBody).not.toHaveProperty("output_config");
		});

		/** Never send a value that turns thinking off. Some models reject it with a 400. */
		it("does not send a value that disables thinking", async () => {
			for (const effort of [null, "low", "high"] as const)
				expect(
					JSON.stringify(await sent("claude-fable-5", effort)),
				).not.toContain("disabled");
		});

		/**
		 * Thinking deltas do not stream into the reply bubble. This axis decides how much the model
		 * thinks, not whether that thinking is shown. If it leaked, the text would be saved as the
		 * assistant message.
		 */
		it("does not emit thinking deltas as text", async () => {
			const { fetchMock } = recorder(() =>
				sseResponse([
					'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5"}}\n\n',
					'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"thinking inside"}}\n\n',
					'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"visible answer"}}\n\n',
					'event: message_stop\ndata: {"type":"message_stop"}\n\n',
				]),
			);
			const events = await collect(anthropicAdapter, {
				model: "claude-sonnet-5",
				secret: "key",
				fetch: fetchMock,
				request: { ...request, reasoningEffort: "high" },
			});
			const text = events
				.filter((event) => event.type === "delta")
				.map((event) => event.text)
				.join("");
			expect(text).toBe("visible answer");
			expect(text).not.toContain("inside");
		});
	});

	describe("Gemini", () => {
		const STREAM = [
			'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]},"finishReason":"STOP"}],"modelVersion":"gemini-3.5-flash"}\n\n',
		];
		const sent = (
			model: string,
			effort: ChatGenerationRequest["reasoningEffort"],
		) => sentFor(geminiAdapter, STREAM, model, effort);

		const config = async (
			model: string,
			effort: ChatGenerationRequest["reasoningEffort"],
		) =>
			(await sent(model, effort)).generationConfig as Record<string, unknown>;

		/**
		 * Gemini 3.x: depth is set by the level name. The token budget is not used; it is kept only for
		 * backward compatibility.
		 */
		const LEVEL_MODELS = [
			"gemini-3.8-flash",
			"gemini-3.7-flash",
			"gemini-3.6-flash",
			"gemini-3.5-flash",
			"gemini-3.5-flash-lite",
			"gemini-3.1-pro-preview",
			"gemini-3.1-flash-lite",
			"gemini-3-flash-preview",
		];
		/**
		 * Gemini 2.5: token budget. The allowed range and whether thinking can be turned off both vary by
		 * model.
		 */
		const BUDGET_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"];

		it.each(LEVEL_MODELS)("%s goes out as a level name", async (model) => {
			expect(await config(model, "low")).toMatchObject({
				thinkingConfig: { thinkingLevel: "low" },
			});
			expect(await config(model, "high")).toMatchObject({
				thinkingConfig: { thinkingLevel: "high" },
			});
		});

		/**
		 * Sending both in one request gets a 400. Even though 3.x accepts a budget for backward
		 * compatibility, the docs say to move to levels. A mixed request is valid under neither scheme.
		 */
		it.each(LEVEL_MODELS)("%s has no thinking budget", async (model) => {
			expect(JSON.stringify(await config(model, "medium"))).not.toContain(
				"thinkingBudget",
			);
		});

		it.each(
			BUDGET_MODELS,
		)("%s goes out as a thinking budget", async (model) => {
			expect(await config(model, "low")).toMatchObject({
				thinkingConfig: { thinkingBudget: 1_024 },
			});
			expect(await config(model, "high")).toMatchObject({
				thinkingConfig: { thinkingBudget: 16_384 },
			});
		});

		it.each(BUDGET_MODELS)("%s has no level name", async (model) => {
			expect(JSON.stringify(await config(model, "medium"))).not.toContain(
				"thinkingLevel",
			);
		});

		/**
		 * The two axes must be independent, as with Anthropic's manual mode, and for the same reason.
		 * `maxOutputTokens` caps thinking and body together (googleapis/python-genai#2062, checked
		 * 2026-09-02). Left unchanged, a room set to `Short` (768) with `Standard` (budget 4,096) would let
		 * thinking use up the cap. The reply would end with no body text. That is an empty response, not
		 * an error, so the screen shows no reason.
		 */
		it.each(
			BUDGET_MODELS,
		)("%s raises the output cap by the budget", async (model) => {
			expect((await config(model, "low")).maxOutputTokens).toBe(1_024 + 1_024);
			expect((await config(model, "high")).maxOutputTokens).toBe(
				1_024 + 16_384,
			);
		});

		/**
		 * A budget of 0 is distinct from `undefined`. The user chose to turn thinking off, so there is
		 * nothing to add. It is not the same as having no axis.
		 */
		it("a budget of 0 does not raise the cap", async () => {
			expect(
				(await config("gemini-2.5-flash", "minimal")).maxOutputTokens,
			).toBe(1_024);
		});

		/**
		 * No such arithmetic for level-based models. There is no budget to add, and adding an arbitrary
		 * number would raise the billing cap by an amount the user never chose.
		 */
		it.each(LEVEL_MODELS)("%s keeps the output cap", async (model) => {
			expect((await config(model, "high")).maxOutputTokens).toBe(1_024);
		});

		/** Models or levels missing from the table leave the cap alone too. */
		it("no reasoning keeps the cap", async () => {
			expect((await config("gemini-2.5-flash", null)).maxOutputTokens).toBe(
				1_024,
			);
			expect(
				(await config("gemini-retired-model", "high")).maxOutputTokens,
			).toBe(1_024);
		});

		/**
		 * This is where `minimal` actually differs. 3.7 Flash and 3.1 Pro do not have that level. 2.5 Pro
		 * has a budget floor of 128 and does not accept 0.
		 */
		it("only 3.x models with minimal send that level", async () => {
			expect(await config("gemini-3.5-flash", "minimal")).toMatchObject({
				thinkingConfig: { thinkingLevel: "minimal" },
			});
			expect(await config("gemini-3.5-flash-lite", "minimal")).toMatchObject({
				thinkingConfig: { thinkingLevel: "minimal" },
			});
			expect(await config("gemini-3.7-flash", "minimal")).not.toHaveProperty(
				"thinkingConfig",
			);
			expect(
				await config("gemini-3.1-pro-preview", "minimal"),
			).not.toHaveProperty("thinkingConfig");
		});

		/**
		 * Only 2.5 Flash gives budget 0 a meaning (it turns thinking off). 2.5 Pro cannot turn thinking
		 * off.
		 */
		it("on 2.5, minimal is budget 0 for Flash only", async () => {
			expect(await config("gemini-2.5-flash", "minimal")).toMatchObject({
				thinkingConfig: { thinkingBudget: 0 },
			});
			expect(await config("gemini-2.5-pro", "minimal")).not.toHaveProperty(
				"thinkingConfig",
			);
		});

		/**
		 * `gemini-2.5-flash-lite` is not in the table. Thinking is off by default and its budget floor is
		 * 512, so there is no way to express the off value. Setting a level would let the inherited `Standard`
		 * turn its thinking on. The catalog sets `reasoning: null` for the same reason.
		 */
		it("2.5 Flash-Lite gets nothing", async () => {
			for (const effort of ["minimal", "low", "high"] as const)
				expect(
					await config("gemini-2.5-flash-lite", effort),
				).not.toHaveProperty("thinkingConfig");
		});

		it("sends nothing for a model not in the table", async () => {
			expect(await config("gemini-retired-model", "high")).not.toHaveProperty(
				"thinkingConfig",
			);
		});

		/**
		 * Models without thinking support answer this key with a 400. When there is no value, the key
		 * must be absent, and the body must match the pre-axis body.
		 */
		it("absent means the key itself is absent", async () => {
			expect(await config("gemini-3.5-flash", null)).toEqual({
				maxOutputTokens: 1_024,
			});
		});

		/**
		 * Response length is not changed. This provider does not subtract thinking from the output cap.
		 */
		it("keeps the output cap", async () => {
			expect((await config("gemini-3.5-flash", "high")).maxOutputTokens).toBe(
				1_024,
			);
		});

		/**
		 * This provider also sends thought summaries as ordinary parts that carry `text`. They are
		 * distinguished only by `thought`. Streaming them unconditionally would save the model's thinking
		 * as the reply.
		 */
		it("does not emit thought parts as text", async () => {
			const { fetchMock } = recorder(() =>
				sseResponse([
					'data: {"candidates":[{"content":{"parts":[{"text":"thinking inside","thought":true},{"text":"visible answer"}]},"finishReason":"STOP"}]}\n\n',
				]),
			);
			const events = await collect(geminiAdapter, {
				model: "gemini-3.5-flash",
				secret: "key",
				fetch: fetchMock,
				request: { ...request, reasoningEffort: "high" },
			});
			const text = events
				.filter((event) => event.type === "delta")
				.map((event) => event.text)
				.join("");
			expect(text).toBe("visible answer");
		});

		/** Thought summaries are not requested. If they were, they would arrive as text parts. */
		it("does not request thought summaries", async () => {
			expect(
				JSON.stringify(await sent("gemini-3.5-flash", "high")),
			).not.toContain("includeThoughts");
		});
	});
});

/**
 * Does `Continue generating` work on every supported model? The assembler builds only one
 * kind of continuation request: it ends with an assistant message and has no nudge. Nothing
 * guarantees that upstream accepts that shape. The failure reaches the screen only as the single
 * line `The provider couldn't process the request.`. That line is the same
 * for 401, 429, and 5xx, so the continuation cause stays hidden.
 *
 * Anthropic varies by model. Only the 4.5 generation accepts prefill, and not together with
 * thinking or trailing whitespace. 4.6 and later reject prefill with a 400, so they use a nudge and
 * still send thinking. Gemini accepts `contents` ending with the `model` role, and it works with
 * thinking.
 *
 * The pinned values keep these differences inside each adapter. Copying one adapter's handling to
 * the other ("OpenAI-compatible means all the same") would silently drop the reasoning setting the
 * user chose, on providers that have no such constraint.
 */
const continuationRequest: ChatGenerationRequest = {
	...request,
	messages: [
		{ role: "user", content: "go on" },
		{ role: "assistant", content: "the door opened and he  " },
	],
	continuation: true,
};

/**
 * Continuation shape table, checked on 2026-09-23 with real requests to twelve models. Only the
 * three 4.5-generation models accept prefill. The other nine returned a 400 ("This model does not
 * support assistant message prefill...") even for requests without thinking. The whole table is
 * pinned because the mismatch is silent. If one model reverts to `prefill`, continuation fails
 * every time for anyone who picked that model, with an unexplained error line. The name and values
 * must match `ANTHROPIC_CONTINUATION` in this adapter, and its counterpart in the mobile adapter.
 */
const PREFILL_CONTINUATION_MODELS = [
	"claude-opus-4-5",
	"claude-sonnet-4-5",
	"claude-haiku-4-5",
];
const NUDGE_CONTINUATION_MODELS = [
	"claude-fable-5-1",
	"claude-fable-5",
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-sonnet-5-5",
	"claude-sonnet-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
];

describe("continue generating — Anthropic", () => {
	type SentMessages = { role: string; content: string }[];

	const sendContinuation = async (
		overrides: Partial<ChatGenerationRequest> = {},
		model = "claude-haiku-4-5",
	) => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model,
			secret: "key",
			fetch: fetchMock,
			request: { ...continuationRequest, ...overrides },
		});
		return body(seen[0] as { init: RequestInit });
	};

	/**
	 * Prefill is what makes this a continuation. A nudge would make the model start a new turn, so
	 * models that accept prefill still get prefill.
	 *
	 * Trailing whitespace is a 400: "final assistant content cannot end with trailing whitespace". A
	 * cut-off reply often ends in a space mid-sentence, and then `Continue generating` always fails in that room.
	 */
	it.each(
		PREFILL_CONTINUATION_MODELS,
	)("%s keeps the cut reply as prefill and trims trailing whitespace", async (model) => {
		const sent = await sendContinuation({}, model);
		expect((sent.messages as SentMessages).at(-1)).toEqual({
			role: "assistant",
			content: "the door opened and he",
		});
	});

	/**
	 * Warning: models that do not accept prefill end with a nudge. While these lines sent prefill,
	 * continuation for those models always returned a 400. The cut reply stays exactly as stored, in
	 * front of the nudge. The whitespace rule applies only to the last assistant content, and the
	 * preserved space tells the model the cut fell between words. The nudge sentence is the shared
	 * wording from `@rowcat/chat`.
	 */
	it.each(
		NUDGE_CONTINUATION_MODELS,
	)("%s ends with a nudge instead of prefill, and the cut reply stays as stored", async (model) => {
		const messages = (await sendContinuation({}, model))
			.messages as SentMessages;
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
		expect(messages.at(-2)).toEqual({
			role: "assistant",
			content: "the door opened and he  ",
		});
	});

	/**
	 * Unknown models get the nudge. Saved preferences outlive the catalog, and every new model from
	 * this provider since 4.6 has rejected prefill. So the shape that every model accepts is sent.
	 */
	it("a model not in the table uses the nudge", async () => {
		const messages = (await sendContinuation({}, "claude-retired-model"))
			.messages as SentMessages;
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
	});

	/**
	 * Warning: this provider does not accept thinking and prefill together. If one must be dropped,
	 * keep prefill. Dropping prefill turns the request into a new turn rather than a continuation,
	 * which is exactly what the button is not supposed to do. Every prefill model uses manual
	 * thinking, so no budget is added and the output cap stays as requested.
	 */
	it.each(
		PREFILL_CONTINUATION_MODELS,
	)("%s's continuation has no thinking parameter", async (model) => {
		const sent = await sendContinuation({ reasoningEffort: "high" }, model);
		expect(sent.thinking).toBeUndefined();
		expect(sent.output_config).toBeUndefined();
		expect(sent.max_tokens).toBe(1024);
	});

	/**
	 * Nudge models keep thinking in continuation requests too. With no prefill, the constraint does
	 * not apply, and there is no reason to lose the user's setting for one continuation turn.
	 */
	it.each(
		NUDGE_CONTINUATION_MODELS,
	)("%s's continuation keeps thinking", async (model) => {
		const sent = await sendContinuation({ reasoningEffort: "high" }, model);
		expect(sent.thinking).toEqual({ type: "adaptive" });
		expect(sent.output_config).toEqual({ effort: "high" });
	});

	/**
	 * Plain generation is unchanged. The most costly regression from this change would be continuation
	 * logic dropping thinking or adding a nudge to every request.
	 */
	it("outside continuation, thinking and ending are unchanged", async () => {
		const prefillModel = await sendContinuation({
			continuation: false,
			reasoningEffort: "high",
		});
		expect(prefillModel.thinking).toEqual({
			type: "enabled",
			budget_tokens: 8_192,
		});
		const nudgeModel = await sendContinuation(
			{ continuation: false, reasoningEffort: "high" },
			"claude-sonnet-5",
		);
		expect(nudgeModel.thinking).toEqual({ type: "adaptive" });
		expect((nudgeModel.messages as SentMessages).at(-1)).toEqual({
			role: "assistant",
			content: "the door opened and he  ",
		});
	});

	/**
	 * When the array has no partial reply to continue (the conversation moved on in between), both
	 * shapes add a nudge. The assembler did not add one, so without it the model would not know what
	 * to do.
	 */
	it.each([
		"claude-haiku-4-5",
		"claude-sonnet-5",
	])("%s — when the last turn is not the assistant's, adds the continuation nudge", async (model) => {
		const messages = (
			await sendContinuation(
				{ messages: [{ role: "user", content: "hello" }] },
				model,
			)
		).messages as SentMessages;
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
	});

	/**
	 * A reply stored as whitespace only. This API also rejects empty assistant messages, so both
	 * shapes drop it.
	 */
	it.each([
		"claude-haiku-4-5",
		"claude-sonnet-5",
	])("%s — a whitespace-only reply is dropped for the nudge", async (model) => {
		const messages = (
			await sendContinuation(
				{
					messages: [
						{ role: "user", content: "hello" },
						{ role: "assistant", content: "   " },
					],
				},
				model,
			)
		).messages as SentMessages;
		expect(messages.at(-1)?.role).toBe("user");
		expect(messages).toHaveLength(2);
		expect(messages.some((message) => message.role === "assistant")).toBe(
			false,
		);
	});
});

describe("continue generating — Gemini", () => {
	const sendContinuation = async (
		overrides: Partial<ChatGenerationRequest> = {},
		model = "gemini-3.5-flash",
	) => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model,
			secret: "key",
			fetch: fetchMock,
			request: { ...continuationRequest, ...overrides },
		});
		return body(seen[0] as { init: RequestInit });
	};

	it("keeps the last assistant line as a `model` role prefill", async () => {
		const sent = await sendContinuation();
		const contents = sent.contents as {
			role: string;
			parts: { text: string }[];
		}[];
		expect(contents.at(-1)?.role).toBe("model");
		expect(contents.at(-1)?.parts[0]?.text).toBe("the door opened and he");
	});

	/**
	 * Warning: thinking is not dropped here. That constraint belongs to the Anthropic API. Copying one
	 * adapter's handling to the other would drop the user's setting for no reason on providers without
	 * the constraint.
	 */
	it("thinking parameters stay during continuation", async () => {
		const sent = await sendContinuation({ reasoningEffort: "high" });
		const config = sent.generationConfig as Record<string, unknown>;
		expect(config.thinkingConfig).toBeDefined();
	});

	it("adds the continuation nudge when the last turn is not the model's", async () => {
		const sent = await sendContinuation({
			messages: [{ role: "user", content: "hello" }],
		});
		const contents = sent.contents as {
			role: string;
			parts: { text: string }[];
		}[];
		expect(contents.at(-1)?.role).toBe("user");
		expect(contents.at(-1)?.parts[0]?.text).toBe(CONTINUATION_FALLBACK_NUDGE);
	});

	it("outside continuation the last user turn stays", async () => {
		const sent = await sendContinuation({ continuation: false });
		const contents = sent.contents as { role: string }[];
		expect(contents.at(-1)?.role).toBe("model");
	});
});

/**
 * Tool mapping in both adapters. This group guards three things.
 *
 * First, absence symmetry. A request that declares no tools must have a body byte-identical to the
 * one from before this axis existed. That is the whole compatibility of older conversations.
 *
 * Second, complete arguments. Anthropic streams partial JSON as deltas, while Gemini sends complete
 * objects. The adapter absorbs that difference, so the screen and the router do not each assemble
 * fragments.
 *
 * Third, dropping parallel calls. The contract allows one call per stream, so a second call is
 * dropped and the turn ends normally. This was once an error, on the premise that a dropped call
 * would leave the next request with an unmatched call and a 400. That premise did not hold. The
 * next request's assistant turn is built by us (`nextChatToolRequest`) and carries only the one
 * call we chose, so upstream never sees the dropped call. Ending in an error would kill the turn
 * after body text had already streamed.
 */

const DICE: ChatToolDeclaration = {
	name: "dice",
	description: "rolls a die",
	parameters: [
		{
			name: "sides",
			type: "number",
			description: "number of sides",
			required: true,
			choices: [],
		},
		{
			name: "label",
			type: "string",
			description: "",
			required: false,
			choices: ["a", "b"],
		},
	],
};

const TOOL_HISTORY: ChatGenerationRequest["messages"] = [
	{ role: "user", content: "roll it" },
	{
		role: "assistant",
		content: "he picked up the die.",
		toolCall: { id: "toolu_1", name: "dice", arguments: { sides: 20 } },
	},
	{ role: "tool", callId: "toolu_1", content: "17" },
];

describe("Anthropic tool calls", () => {
	it("no tools means no key at all", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
		});
		const sent = body(seen[0] ?? { init: {} });
		expect("tools" in sent).toBe(false);
		expect("tool_choice" in sent).toBe(false);
	});

	/**
	 * The contract allows one call per stream, so the provider is asked up front not to send parallel
	 * calls.
	 */
	it("declaring tools also turns off parallel calls", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		const sent = body(seen[0] ?? { init: {} });
		expect(sent.tool_choice).toEqual({
			type: "auto",
			disable_parallel_tool_use: true,
		});
		expect(sent.tools).toEqual([
			{
				name: "dice",
				description: "rolls a die",
				input_schema: {
					type: "object",
					properties: {
						sides: { type: "number", description: "number of sides" },
						label: { type: "string", enum: ["a", "b"] },
					},
					required: ["sides"],
					additionalProperties: false,
				},
			},
		]);
	});

	/** This API has no tool role. Results are blocks inside a user turn. */
	it("maps calls and results to blocks", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: { ...request, messages: TOOL_HISTORY, tools: [DICE] },
		});
		expect(body(seen[0] ?? { init: {} }).messages).toEqual([
			{ role: "user", content: "roll it" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "he picked up the die." },
					{
						type: "tool_use",
						id: "toolu_1",
						name: "dice",
						input: { sides: 20 },
					},
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "toolu_1", content: "17" },
				],
			},
		]);
	});

	/** This API rejects empty text blocks with a 400. Calling a tool without any prose is normal. */
	it("does not create an empty text block for an assistant turn without a body", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(ANTHROPIC_STREAM));
		await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: {
				...request,
				messages: [
					{ role: "user", content: "roll it" },
					{
						role: "assistant",
						content: "",
						toolCall: { id: "toolu_1", name: "dice", arguments: {} },
					},
					{ role: "tool", callId: "toolu_1", content: "17" },
				],
			},
		});
		const messages = body(seen[0] ?? { init: {} }).messages as {
			content: unknown;
		}[];
		expect(messages[1]?.content).toEqual([
			{ type: "tool_use", id: "toolu_1", name: "dice", input: {} },
		]);
	});

	/** Partial JSON ends inside the adapter. What goes out is one complete object. */
	it("collects fragmented arguments and emits them once", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_9","name":"dice"}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"sid"}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"es\\":20}"}}\n\n',
				'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "toolu_9", name: "dice", arguments: { sides: 20 } },
			},
		]);
		/** This is not the terminal frame. `done` arrives separately afterward. */
		expect(events.at(-1)?.type).toBe("done");
	});

	/**
	 * Because `disable_parallel_tool_use` was sent, this branch is a safeguard for the day upstream
	 * ignores that request. The point of this check is that argument deltas from the dropped block
	 * must not mix into the earlier call. If they did, the two JSON strings could join and still
	 * parse, and the arguments sent out would be a value nobody requested.
	 */
	it("parallel calls keep only the first and later blocks' arguments do not mix", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"dice"}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"sides\\":6}"}}\n\n',
				'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"dice"}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"sides\\":20}"}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "toolu_1", name: "dice", arguments: { sides: 6 } },
			},
		]);
		expect(events.at(-1)?.type).toBe("done");
	});

	/**
	 * Warning: broken arguments do not end the turn. Hitting the output cap can end the stream with
	 * argument JSON cut in half. That is common, and the call itself is fine. Sending it as "could not
	 * be read" lets the call go through judgment and return one sentence, so the model can call again.
	 */
	it("broken argument JSON goes out as an unreadable call", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"dice"}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"sides\\":"}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "toolu_1", name: "dice", arguments: null },
			},
		]);
		expect(events.filter((event) => event.type === "error")).toEqual([]);
		expect(events.at(-1)?.type).toBe("done");
	});

	/**
	 * Only cases where no matching reply can be built remain here. If the name is outside the
	 * vocabulary, there is no slot to carry the value. An invented name would keep upstream from
	 * recognizing its own call.
	 */
	it("a name outside the vocabulary ends in an error", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"functions.dice"}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]),
		);
		const events = await collect(anthropicAdapter, {
			model: "claude-sonnet-5",
			secret: "sk-ant",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		expect(events.at(-1)?.type).toBe("error");
	});
});

describe("Gemini tool calls", () => {
	it("no tools means no key at all", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
		});
		const sent = body(seen[0] ?? { init: {} });
		expect("tools" in sent).toBe(false);
		expect("toolConfig" in sent).toBe(false);
	});

	/** Uppercase type names are this provider's dialect, not part of the spec. */
	it("maps declarations to this provider's schema dialect", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		const sent = body(seen[0] ?? { init: {} });
		expect(sent.tools).toEqual([
			{
				functionDeclarations: [
					{
						name: "dice",
						description: "rolls a die",
						parameters: {
							type: "OBJECT",
							properties: {
								sides: { type: "NUMBER", description: "number of sides" },
								label: { type: "STRING", enum: ["a", "b"] },
							},
							required: ["sides"],
						},
					},
				],
			},
		]);
		/** Keys outside this API's schema vocabulary are not sent. Unknown keys get a 400. */
		const parameters = (
			sent.tools as { functionDeclarations: { parameters: object }[] }[]
		)[0]?.functionDeclarations[0]?.parameters;
		expect(parameters && "additionalProperties" in parameters).toBe(false);
	});

	/**
	 * Warning: this provider gives calls no ID. The name is the value that pairs a call with its
	 * result. The adapter puts the name in the ID slot and uses it again when returning the result.
	 */
	it("sends the name as the identifier and returns the result under that name", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"dice","args":{"sides":20}}}]},"finishReason":"STOP"}]}\n\n',
			]),
		);
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "dice", name: "dice", arguments: { sides: 20 } },
			},
		]);

		const { seen, fetchMock: second } = recorder(() =>
			sseResponse(GEMINI_STREAM),
		);
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: second,
			request: {
				...request,
				messages: [
					{ role: "user", content: "roll it" },
					{
						role: "assistant",
						content: "he picked up the die.",
						toolCall: { id: "dice", name: "dice", arguments: { sides: 20 } },
					},
					{ role: "tool", callId: "dice", content: "17" },
				],
			},
		});
		expect(body(seen[0] ?? { init: {} }).contents).toEqual([
			{ role: "user", parts: [{ text: "roll it" }] },
			{
				role: "model",
				parts: [
					{ text: "he picked up the die." },
					{ functionCall: { name: "dice", args: { sides: 20 } } },
				],
			},
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "dice", response: { result: "17" } } },
				],
			},
		]);
	});

	/**
	 * Warning: a request without the signature gets a 400. Gemini 3 requires the thought signature
	 * attached to this turn's first `functionCall` to come back unchanged. Lowering or disabling
	 * thinking does not exempt it. The next request's assistant turn is reassembled on the device, so
	 * unless the value is kept on the call, tools never work on these models.
	 */
	it("keeps the call's signature and returns it in place", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"dice","args":{"sides":20}},"thoughtSignature":"Cg8KDQoLc2ln"}]},"finishReason":"STOP"}]}\n\n',
			]),
		);
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: {
					id: "dice",
					name: "dice",
					arguments: { sides: 20 },
					providerState: "Cg8KDQoLc2ln",
				},
			},
		]);

		const { seen, fetchMock: second } = recorder(() =>
			sseResponse(GEMINI_STREAM),
		);
		await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: second,
			request: {
				...request,
				messages: [
					{ role: "user", content: "roll it" },
					{
						role: "assistant",
						content: "",
						toolCall: {
							id: "dice",
							name: "dice",
							arguments: { sides: 20 },
							providerState: "Cg8KDQoLc2ln",
						},
					},
					{ role: "tool", callId: "dice", content: "17" },
				],
			},
		});
		expect(body(seen[0] ?? { init: {} }).contents).toEqual([
			{ role: "user", parts: [{ text: "roll it" }] },
			{
				role: "model",
				parts: [
					{
						functionCall: { name: "dice", args: { sides: 20 } },
						thoughtSignature: "Cg8KDQoLc2ln",
					},
				],
			},
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "dice", response: { result: "17" } } },
				],
			},
		]);
	});

	/**
	 * The 2.5 generation does not require this value. When it is missing, the key must be absent. An
	 * invented value would be an invalid signature and trigger the same 400.
	 */
	it("no signature means no key", async () => {
		const { seen, fetchMock } = recorder(() => sseResponse(GEMINI_STREAM));
		await collect(geminiAdapter, {
			model: "gemini-2.5-flash",
			secret: "AIza",
			fetch: fetchMock,
			request: {
				...request,
				messages: [
					{ role: "user", content: "roll it" },
					{
						role: "assistant",
						content: "",
						toolCall: { id: "dice", name: "dice", arguments: { sides: 20 } },
					},
					{ role: "tool", callId: "dice", content: "17" },
				],
			},
		});
		const parts = (
			body(seen[0] ?? { init: {} }).contents as { parts: object[] }[]
		)[1]?.parts;
		expect(parts?.[0] && "thoughtSignature" in parts[0]).toBe(false);
	});

	/**
	 * This provider has no switch to turn off parallel calls, so this state comes from an ordinary
	 * single response. Ending in an error would kill that turn, so the first call is kept and the rest
	 * are discarded.
	 */
	it("parallel calls keep only the first and the turn survives", async () => {
		const { fetchMock } = recorder(() =>
			sseResponse([
				'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"dice","args":{"sides":6}}},{"functionCall":{"name":"dice","args":{"sides":20}}}]},"finishReason":"STOP"}]}\n\n',
			]),
		);
		const events = await collect(geminiAdapter, {
			model: "gemini-3.7-flash",
			secret: "AIza",
			fetch: fetchMock,
			request: { ...request, tools: [DICE] },
		});
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "dice", name: "dice", arguments: { sides: 6 } },
			},
		]);
		expect(events.at(-1)?.type).toBe("done");
	});
});
