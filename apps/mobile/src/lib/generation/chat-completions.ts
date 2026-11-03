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
import type { ByoAdapter, ByoTransportInput, CredentialCheck } from "./byo.ts";
import {
	ProviderError,
	providerErrorForStatus,
	providerErrorForThrown,
	readRetryAfterSeconds,
} from "./errors.ts";
import { readSse } from "./sse.ts";

/**
 * The chat-completions protocol, once, for every provider that speaks it from the device.
 *
 * ```text
 * in        ChatGenerationRequest (built by our assembler) + this call's key
 * out       ChatStreamEvent (our contract vocabulary)
 * not here  prompt assembly · storage · React · credential storage · vendor error bodies · billing identity
 * ```
 *
 * Two providers stand on it, each a profile (`openrouter.ts`, `openai-compatible.ts`). The protocol —
 * message mapping, tool calls and their round trip, the stream, usage, the cut-stream rule — is one
 * copy; a profile says only what differs per server. The web's `lib/generation/chat-completions.ts`
 * is this file's pair, and the managed path speaks the same shape from the server
 * (`services/generation/chat.ts`). Fix one and the others drift: the symptom is the same model
 * answering differently per app.
 *
 * What differs from the managed body is on purpose, because the account is the user's: no
 * `provider` routing block (the user's own account settings apply), and continuation is always the
 * nudge shape (the device has no per-upstream registry; the nudge ends on a user turn, which every
 * server accepts).
 *
 * The secret's lifetime ends before `startChatCompletions` resolves: the parser below receives only the
 * open body (`ChatCompletionsResponseStream`), never the transport input.
 *
 * No retries. Generation bills the user's account; a retry after the stream started bills twice and
 * produces two replies.
 */

/** What differs between servers that speak this protocol. Everything else is the protocol's. */
export interface ChatCompletionsProfile {
	/**
	 * The address requests append `/chat/completions` to: a constant for a fixed server, the stored
	 * connection's own address for a user-named one. `null` means the connection has none, which is a
	 * connection to fix, not a request to guess.
	 */
	endpointFor(endpoint: string | undefined): string | null;
	/** Path the credential check calls with GET; it must require the key and spend nothing. */
	probePath: string;
	/** Headers beyond auth and content type. */
	extraHeaders: Readonly<Record<string, string>>;
	/** Whether this model takes explicit cache breakpoints (an unknown parameter is a 400 on strict servers). */
	explicitPromptCaching(model: string): boolean;
	/** Whether the server understands `session_id` (sticky routing). */
	routingSession: boolean;
	/** Whether the server understands the unified `reasoning: { effort }` parameter. */
	unifiedReasoning: boolean;
	/** HTTP status → vocabulary; the shared table unless the server gives a code its own meaning. */
	failureForStatus(status: number, retryAfterSeconds?: number): ProviderError;
}

/** Reasoning effort → the unified `reasoning.effort`; total so a new value breaks compilation. */
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
): Record<string, string> => ({
	"content-type": "application/json",
	authorization: `Bearer ${secret}`,
	...profile.extraHeaders,
});

/** One hour, except a tool round trip's tail, which only the next round of the same turn reads. */
const tailCacheTtl = (messages: readonly ChatGenerationMessage[]) =>
	messages.at(-1)?.role === "tool" ? "5m" : "1h";

/** The system message with its own one-hour breakpoint on cached models; the text is unchanged. */
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
 * Our messages → chat-completions messages (tool results and call turns change shape).
 * `reasoning_details` rides back only when the call carried a state, which only OpenRouter produces.
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
				...reasoningDetailsOf(message.toolCall.providerState),
			};
		return { role: message.role, content: message.content };
	});
}

/** Nudge-shaped continuation; nothing unless the conversation still ends on the cut reply. */
function toContinuationMessages(
	messages: readonly ChatGenerationMessage[],
): readonly ChatGenerationMessage[] {
	const last = messages.at(-1);
	if (!last || last.role !== "assistant") return messages;
	return [...messages, { role: "user", content: CONTINUATION_FALLBACK_NUDGE }];
}

function buildRequestBody(
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
		/** Sticky routing: the conversation's opaque key; the parameter name ends in this file. */
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
	error?: { code?: number | string };
}

/** Only encrypted reasoning rides back; readable reasoning is stored nowhere. */
const ENCRYPTED_REASONING_TYPE = "reasoning.encrypted";

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

/**
 * Everything the parser receives **after** the response is open. It has no slot for the key: the
 * parser lives as long as the stream, and the plaintext must not.
 */
interface ChatCompletionsResponseStream {
	body: ReadableStream<Uint8Array>;
	/** Fallback model name when no chunk names one; the public catalogue value, not a secret. */
	requestedModel: string;
	/** What a numeric mid-stream code means on this server. */
	failureForStatus: ChatCompletionsProfile["failureForStatus"];
}

async function* readChatCompletionsStream(
	source: ChatCompletionsResponseStream,
): AsyncGenerator<ChatStreamEvent> {
	let model: string | undefined;
	let usage: Extract<ChatStreamEvent, { type: "usage" }> | null = null;
	let finishReason: string | undefined;
	/** `[DONE]` or a finish reason; a body that simply stops is a cut response. */
	let stopped = false;
	let pending: {
		index: number;
		id: string;
		name: string;
		args: string;
	} | null = null;
	const reasoning: unknown[] = [];

	for await (const frame of readSse(source.body)) {
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
			const failure =
				typeof chunk.error.code === "number"
					? source.failureForStatus(chunk.error.code)
					: new ProviderError("provider_error");
			yield { type: "error", code: failure.code, message: failure.message };
			return;
		}

		if (chunk.model) model = chunk.model;
		const choice = chunk.choices?.[0];
		const text = choice?.delta?.content;
		if (typeof text === "string" && text) yield { type: "delta", text };
		for (const detail of choice?.delta?.reasoning_details ?? [])
			if (detail?.type === ENCRYPTED_REASONING_TYPE) reasoning.push(detail);
		for (const part of choice?.delta?.tool_calls ?? []) {
			const index = part.index ?? 0;
			/** A parallel call: keep the first, drop the rest (the next turn carries only the kept one). */
			if (pending && pending.index !== index) continue;
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
			/** `prompt_tokens` already includes cache; cache axes are carried only when reported. */
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

	/** A filter ending the response has its own name; a retry would get the same answer. */
	if (finishReason === "content_filter") {
		const failure = new ProviderError("content_blocked");
		yield { type: "error", code: failure.code, message: failure.message };
		return;
	}

	if (pending) {
		const call = parseToolCall(pending, reasoning);
		if (!call) {
			const failure = new ProviderError("provider_error");
			yield { type: "error", code: failure.code, message: failure.message };
			return;
		}
		yield { type: "tool_call", call };
	}

	if (usage) yield { ...usage, model: model ?? source.requestedModel };

	if (!stopped) {
		const failure = new ProviderError("provider_error");
		yield { type: "error", code: failure.code, message: failure.message };
		return;
	}

	yield {
		type: "done",
		...(finishReason !== undefined ? { finishReason } : {}),
	};
}

/**
 * Sends the request and validates the first response **before** resolving, so the key's lifetime
 * ends inside the credential callback (`byo.ts`). Each profile's `start` is a one-line call to this.
 */
export async function startChatCompletions(
	profile: ChatCompletionsProfile,
	input: ByoTransportInput,
): Promise<AsyncIterable<ChatStreamEvent>> {
	const endpoint = profile.endpointFor(input.endpoint);
	/** A connection with no address is one to reconnect; nothing has been sent. */
	if (endpoint === null) throw new ProviderError("invalid_credential");

	let response: Awaited<ReturnType<ByoTransportInput["fetch"]>>;
	try {
		response = await input.fetch(`${endpoint}/chat/completions`, {
			method: "POST",
			signal: input.signal,
			headers: headersFor(profile, input.secret),
			body: JSON.stringify(
				buildRequestBody(profile, input.request, input.model),
			),
		});
	} catch (thrown) {
		throw providerErrorForThrown(thrown, input.signal);
	}

	/** The body is not read: error bodies carry account data and echo the prompt. */
	if (!response.ok || !response.body)
		throw profile.failureForStatus(
			response.status,
			readRetryAfterSeconds(response.headers),
		);

	return readChatCompletionsStream({
		body: response.body,
		requestedModel: input.model,
		failureForStatus: profile.failureForStatus,
	});
}

/** A credential check without a generation, on the profile's probe path. */
export function probeChatCompletions(
	profile: ChatCompletionsProfile,
): ByoAdapter["probe"] {
	return async ({
		secret,
		endpoint,
		signal,
		fetch,
	}): Promise<CredentialCheck> => {
		const base = profile.endpointFor(endpoint);
		if (base === null)
			return { ok: false, error: new ProviderError("invalid_credential") };
		try {
			const response = await fetch(`${base}${profile.probePath}`, {
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
			return { ok: false, error: providerErrorForThrown(thrown, signal) };
		}
	};
}
