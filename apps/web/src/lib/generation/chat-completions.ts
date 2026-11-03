import {
	CONTINUATION_FALLBACK_NUDGE,
	chatToolJsonSchema,
	readChatToolCall,
} from "@rowcat/chat";
import {
	CHAT_MAX_TOOL_PROVIDER_STATE_CHARS,
	type ChatGenerationMessage,
	type ChatStreamEvent,
	type ChatToolCall,
	type ReasoningEffortDto,
} from "@rowcat/contracts";
import {
	logProviderFailure,
	ProviderError,
	providerErrorForStatus,
	providerErrorForThrown,
	readRetryAfterSeconds,
} from "./errors.ts";
import { readSse } from "./sse.ts";
import type {
	ByoAdapter,
	ByoTransportInput,
	CredentialCheck,
} from "./transport.ts";

/**
 * The OpenAI chat-completions protocol, once, for every provider that speaks it from the browser.
 *
 * Boundary: in, a ChatGenerationRequest from our assembler plus this call's key. Out, a
 * ChatStreamEvent in our contract vocabulary. Not here: prompt assembly, storage, React, credential
 * storage, or vendor error bodies.
 *
 * Two providers stand on it, each a profile (`openrouter.ts`, `openai-compatible.ts`). The protocol —
 * message mapping, tool calls and their round trip, the stream, usage, the cut-stream rule — is one
 * copy; a profile says only what differs per server: where it is, which non-standard parameters it
 * understands, and what one status code means there. Two copies of the stream reader would be the
 * place a fix lands in one and the other keeps dropping characters.
 *
 * The managed path speaks the same shape from the server (`buildProviderRequestBody` and
 * `translateProviderStream` in apps/api/src/services/generation/chat.ts), and the rules below are
 * that file's rules re-established in the browser. What differs on purpose, because here the account
 * is the user's, not the operator's:
 *
 * - No `provider` routing block. Managed pins the operator's sub-processors and retention; on this
 *   path the relationship is between the user and their server, and adding ours would make models
 *   their account can call fail for reasons they cannot see.
 * - Continuation is always the nudge shape. The device has no per-upstream registry, and the nudge
 *   ends on a user turn, which every chat-completions server accepts.
 *
 * The official SDK is not used: one endpoint, a few chunk fields, and no retries we do not control.
 *
 * No automatic retries. Generation bills the user's account, and a retry after streaming started
 * would bill twice and produce two replies.
 */

/** What differs between servers that speak this protocol. Everything else is the protocol's. */
export interface ChatCompletionsProfile {
	/** The provider name, for diagnostics only. */
	provider: "openrouter-byo" | "openai-compatible-byo";
	/**
	 * The base address requests append `/chat/completions` to. A constant for a fixed server; for the
	 * user-entered one it comes from the stored connection (`ByoTransportInput.endpoint`). `null` means
	 * the connection has no address, which is a connection to fix, not a request to guess.
	 */
	baseUrl(endpoint: string | undefined): string | null;
	/** Path the credential check calls with GET; it must require the key and spend nothing. */
	probePath: string;
	/** Headers beyond auth and content type. Each must be one the server's CORS allows. */
	extraHeaders: Readonly<Record<string, string>>;
	/** Whether this model takes explicit cache breakpoints (an unknown parameter is a 400 on strict servers). */
	explicitPromptCaching(model: string): boolean;
	/** Whether the server understands `session_id` (sticky routing). */
	routingSession: boolean;
	/** Whether the server understands the unified `reasoning: { effort }` parameter. */
	unifiedReasoning: boolean;
	/** HTTP status → our vocabulary; the shared table unless the server gives a code its own meaning. */
	failureForStatus(status: number, retryAfterSeconds?: number): ProviderError;
}

/**
 * Reasoning effort → the unified `reasoning.effort`. The level has already passed the catalogue
 * capability check (`reasoningEffortForRequest`); the table is total so a new vocabulary value breaks
 * compilation here.
 */
const REASONING_EFFORT_PARAM: Record<ReasoningEffortDto, string> = {
	off: "none",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
};

const headersFor = (
	profile: ChatCompletionsProfile,
	secret: string,
): HeadersInit => ({
	"content-type": "application/json",
	authorization: `Bearer ${secret}`,
	...profile.extraHeaders,
});

/**
 * The automatic breakpoint's lifetime: an hour, except on a tool round trip, whose tail only the
 * next round of the same turn reads (the Anthropic adapter's `tailCacheTtl` has the reasoning).
 */
const tailCacheTtl = (messages: readonly ChatGenerationMessage[]) =>
	messages.at(-1)?.role === "tool" ? "5m" : "1h";

/**
 * The system message, carrying its own one-hour breakpoint on cached models. Only the end of the
 * opaque string is marked; the text is unchanged by a character. An empty string stays a string.
 */
function systemMessage(system: string, cached: boolean) {
	return {
		role: "system",
		content:
			cached && system
				? [
						{
							type: "text",
							text: system,
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					]
				: system,
	};
}

/** A call's returned state → this spec's `reasoning_details` key, or nothing. */
function reasoningDetailsOf(state: string | undefined): {
	reasoning_details?: unknown[];
} {
	if (!state) return {};
	try {
		const parsed: unknown = JSON.parse(state);
		return Array.isArray(parsed) && parsed.length > 0
			? { reasoning_details: parsed }
			: {};
	} catch {
		return {};
	}
}

/**
 * Our messages → chat-completions messages. Tool results need `tool_call_id`, and an assistant turn
 * carrying a call needs a `tool_calls` array with stringified arguments; our key names are unknown
 * upstream, which would read them as an unpaired call and answer 400.
 *
 * `reasoning_details` rides back only when the call carried a state, and only OpenRouter produces one;
 * a plain server never sees the key.
 */
function toChatMessages(
	messages: readonly ChatGenerationMessage[],
): Record<string, unknown>[] {
	return messages.map((message) => {
		if (message.role === "tool")
			return {
				role: "tool",
				tool_call_id: message.callId,
				content: message.content,
			};
		if (message.role === "assistant" && message.toolCall)
			return {
				role: "assistant",
				content: message.content,
				tool_calls: [
					{
						id: message.toolCall.id,
						type: "function",
						function: {
							name: message.toolCall.name,
							arguments: JSON.stringify(message.toolCall.arguments ?? {}),
						},
					},
				],
				/** Returned unchanged; the Gemini family rejects a call turn missing its signature. */
				...reasoningDetailsOf(message.toolCall.providerState),
			};
		return { role: message.role, content: message.content };
	});
}

/**
 * Nudge-shaped continuation: the cut reply stays as stored and one nudge line follows it. Does
 * nothing unless the last message is from the assistant (the conversation moved on, and inventing a
 * nudge would create a turn the user never pressed). The wording is `@rowcat/chat`'s, shared with
 * every other path.
 */
function toContinuationMessages(
	messages: readonly ChatGenerationMessage[],
): readonly ChatGenerationMessage[] {
	const last = messages.at(-1);
	if (!last || last.role !== "assistant") return messages;
	return [...messages, { role: "user", content: CONTINUATION_FALLBACK_NUDGE }];
}

/**
 * The request body. Exported for one reason, testing: the cache, reasoning and routing keys are only
 * checkable by value here.
 */
export function buildChatCompletionsBody(
	profile: ChatCompletionsProfile,
	request: ByoTransportInput["request"],
	model: string,
): Record<string, unknown> {
	const messages = request.continuation
		? toContinuationMessages(request.messages)
		: request.messages;
	const cached = profile.explicitPromptCaching(model);
	return {
		model,
		/**
		 * Sticky routing: the conversation's opaque routing key, so the next turn returns to the endpoint
		 * holding its cache. The name `session_id` ends in this file. Absent means the key is absent.
		 */
		...(profile.routingSession && request.routingSessionId
			? { session_id: request.routingSessionId }
			: {}),
		...(cached
			? { cache_control: { type: "ephemeral", ttl: tailCacheTtl(messages) } }
			: {}),
		messages: [
			systemMessage(request.system, cached),
			...toChatMessages(messages),
		],
		/**
		 * No tools declared means no key at all. `parallel_tool_calls: false` asks for the one call per
		 * stream the contract allows; the stream below keeps the first if two arrive anyway.
		 */
		...(request.tools.length > 0
			? {
					tools: request.tools.map((tool) => ({
						type: "function",
						function: {
							name: tool.name,
							description: tool.description,
							parameters: chatToolJsonSchema(tool),
						},
					})),
					parallel_tool_calls: false,
				}
			: {}),
		max_tokens: request.maxOutputTokens,
		/** Omitted when absent, so models without selectable reasoning get no reasoning key. */
		...(profile.unifiedReasoning && request.reasoningEffort !== null
			? {
					reasoning: {
						effort: REASONING_EFFORT_PARAM[request.reasoningEffort],
					},
				}
			: {}),
		stream: true,
		stream_options: { include_usage: true },
	};
}

/** Only the chunk fields we read; the rest is ignored. */
interface ChatCompletionsChunk {
	model?: string;
	choices?: Array<{
		delta?: {
			content?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
			reasoning_details?: Array<{ type?: string } & Record<string, unknown>>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		prompt_tokens_details?: {
			cached_tokens?: number;
			cache_write_tokens?: number;
		};
	};
	/** A failure after the stream started; gateways send it as a chunk. */
	error?: { code?: number | string };
}

/**
 * Only encrypted reasoning blocks are kept for the round trip. Readable reasoning text would flow to
 * the device and into the next request, breaking the rule that thinking content is stored nowhere.
 */
const ENCRYPTED_REASONING_TYPE = "reasoning.encrypted";

/**
 * Collected fragments → the call the contract accepts, or `null`. Unreadable arguments do not end
 * the turn (`readChatToolCall` marks them); `null` remains only when the id or name falls outside
 * the vocabulary. A reasoning state over the cap is dropped rather than truncated (broken bytes are
 * a guaranteed 400).
 */
function parseToolCall(
	pending: { id: string; name: string; args: string },
	reasoning: readonly unknown[],
): ChatToolCall | null {
	let args: unknown;
	try {
		args = pending.args.trim() ? JSON.parse(pending.args) : {};
	} catch {
		args = null;
	}
	const state = reasoning.length > 0 ? JSON.stringify(reasoning) : "";
	return readChatToolCall({
		id: pending.id,
		name: pending.name,
		arguments: args,
		...(state && state.length <= CHAT_MAX_TOOL_PROVIDER_STATE_CHARS
			? { providerState: state }
			: {}),
	});
}

async function* stream(
	profile: ChatCompletionsProfile,
	input: ByoTransportInput,
): AsyncGenerator<ChatStreamEvent> {
	const doFetch = input.fetch ?? globalThis.fetch;
	const { request } = input;

	/** What is needed to trace this request later. Neither the prompt, the key nor the address. */
	const diagnostics = {
		provider: profile.provider,
		model: input.model,
		continuation: request.continuation,
		reasoning: profile.unifiedReasoning && request.reasoningEffort !== null,
	} as const;

	const base = profile.baseUrl(input.endpoint);
	if (base === null) {
		/** A connection with no address is one to reconnect; nothing has been sent. */
		const failure = new ProviderError("invalid_credential");
		logProviderFailure({ ...diagnostics, code: failure.code });
		throw failure;
	}

	let response: Response;
	try {
		response = await doFetch(`${base}/chat/completions`, {
			method: "POST",
			signal: input.signal,
			headers: headersFor(profile, input.secret),
			body: JSON.stringify(
				buildChatCompletionsBody(profile, request, input.model),
			),
		});
	} catch (thrown) {
		const failure = providerErrorForThrown(thrown);
		logProviderFailure({ ...diagnostics, code: failure.code });
		throw failure;
	}

	if (!response.ok || !response.body) {
		/** The body is not read: error bodies can carry account data and echo the prompt. */
		const failure = profile.failureForStatus(
			response.status,
			readRetryAfterSeconds(response.headers),
		);
		logProviderFailure({
			...diagnostics,
			code: failure.code,
			status: response.status,
		});
		throw failure;
	}

	let model: string | undefined;
	let usage: Extract<ChatStreamEvent, { type: "usage" }> | null = null;
	let finishReason: string | undefined;
	/**
	 * Whether the stream really ended (`[DONE]` or a finish reason). A byte stream that simply stops
	 * is a cut response, and reporting it as finished would store a truncated reply as complete.
	 */
	let stopped = false;
	let pending: {
		index: number;
		id: string;
		name: string;
		args: string;
	} | null = null;
	/** Encrypted reasoning blocks, in arrival order (upstream requires the original order). */
	const reasoning: unknown[] = [];

	for await (const frame of readSse(response.body)) {
		if (frame.data === "[DONE]") {
			stopped = true;
			continue;
		}
		let chunk: ChatCompletionsChunk;
		try {
			chunk = JSON.parse(frame.data) as ChatCompletionsChunk;
		} catch {
			continue;
		}

		if (chunk.error) {
			/**
			 * Emitted, not thrown: text already received must be saved by the caller. Numeric codes are
			 * HTTP statuses; anything else is generic.
			 */
			const failure =
				typeof chunk.error.code === "number"
					? profile.failureForStatus(chunk.error.code)
					: new ProviderError("provider_error");
			logProviderFailure({
				...diagnostics,
				code: failure.code,
				vendorCode:
					typeof chunk.error.code === "string" ? chunk.error.code : undefined,
			});
			yield { type: "error", code: failure.code, message: failure.message };
			return;
		}

		if (chunk.model) model = chunk.model;
		const choice = chunk.choices?.[0];
		const text = choice?.delta?.content;
		/** Only content passes; reasoning text (`delta.reasoning`, `reasoning_content`) is not read. */
		if (typeof text === "string" && text) yield { type: "delta", text };
		for (const detail of choice?.delta?.reasoning_details ?? [])
			if (detail?.type === ENCRYPTED_REASONING_TYPE) reasoning.push(detail);
		for (const part of choice?.delta?.tool_calls ?? []) {
			const index = part.index ?? 0;
			if (pending && pending.index !== index) {
				/**
				 * Parallel call: keep the first, drop the rest. The next request's assistant turn is built on
				 * the device and carries only the kept call, so the dropped one is never seen upstream again.
				 */
				logProviderFailure({
					...diagnostics,
					code: "provider_error",
					vendorCode: "tool_parallel",
				});
				continue;
			}
			pending ??= { index, id: "", name: "", args: "" };
			if (part.id) pending.id = part.id;
			if (part.function?.name) pending.name = part.function.name;
			pending.args += part.function?.arguments ?? "";
		}
		if (choice?.finish_reason) {
			finishReason = choice.finish_reason;
			stopped = true;
		}
		if (chunk.usage) {
			/**
			 * `prompt_tokens` is total input including cache, so it goes to `inputTokens` as is. Cache
			 * axes are carried only when reported: absent is not 0.
			 */
			const details = chunk.usage.prompt_tokens_details;
			usage = {
				type: "usage",
				...(chunk.usage.prompt_tokens !== undefined
					? { inputTokens: chunk.usage.prompt_tokens }
					: {}),
				...(details?.cached_tokens !== undefined
					? { cachedInputTokens: details.cached_tokens }
					: {}),
				...(details?.cache_write_tokens !== undefined
					? { cacheWriteInputTokens: details.cache_write_tokens }
					: {}),
				...(chunk.usage.completion_tokens !== undefined
					? { outputTokens: chunk.usage.completion_tokens }
					: {}),
			};
		}
	}

	/**
	 * A content filter ending the response is the server's policy, not a cut stream; it has its own
	 * name so the screen does not offer a retry that gets the same answer.
	 */
	if (finishReason === "content_filter") {
		const failure = new ProviderError("content_blocked");
		logProviderFailure({
			...diagnostics,
			code: failure.code,
			vendorCode: finishReason,
		});
		yield { type: "error", code: failure.code, message: failure.message };
		return;
	}

	/** The call goes before usage, so the turn's character is settled before the client saves. */
	if (pending) {
		const call = parseToolCall(pending, reasoning);
		if (!call) {
			const failure = new ProviderError("provider_error");
			logProviderFailure({
				...diagnostics,
				code: failure.code,
				vendorCode: "tool_unusable",
			});
			yield { type: "error", code: failure.code, message: failure.message };
			return;
		}
		yield { type: "tool_call", call };
	}

	/** Usage before `done`: the caller saves on `done`, and the reverse order would lose usage. */
	if (usage) yield { ...usage, model: model ?? input.model };

	if (!stopped) {
		const failure = new ProviderError("provider_error");
		logProviderFailure({
			...diagnostics,
			code: failure.code,
			vendorCode: "stream_truncated",
		});
		yield { type: "error", code: failure.code, message: failure.message };
		return;
	}

	yield {
		type: "done",
		...(finishReason !== undefined ? { finishReason } : {}),
	};
}

/** A credential check without a generation, on the profile's probe path. */
function probe(profile: ChatCompletionsProfile): ByoAdapter["probe"] {
	return async ({
		secret,
		endpoint,
		signal,
		fetch: injected,
	}): Promise<CredentialCheck> => {
		const doFetch = injected ?? globalThis.fetch;
		const base = profile.baseUrl(endpoint);
		if (base === null)
			return { ok: false, error: new ProviderError("invalid_credential") };
		try {
			const response = await doFetch(`${base}${profile.probePath}`, {
				method: "GET",
				signal,
				headers: headersFor(profile, secret),
			});
			if (response.ok) return { ok: true };
			return {
				ok: false,
				error: providerErrorForStatus(
					response.status,
					readRetryAfterSeconds(response.headers),
				),
			};
		} catch (thrown) {
			return { ok: false, error: providerErrorForThrown(thrown) };
		}
	};
}

/** One adapter for one profile. The two providers are two calls to this. */
export const chatCompletionsAdapter = (
	profile: ChatCompletionsProfile,
): ByoAdapter => ({
	stream: (input) => stream(profile, input),
	probe: probe(profile),
});
