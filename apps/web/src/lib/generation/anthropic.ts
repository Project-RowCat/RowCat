import {
	CONTINUATION_FALLBACK_NUDGE,
	chatToolJsonSchema,
	readChatToolCall,
	trimContinuationPrefill,
} from "@rowcat/chat";
import type {
	ChatGenerationMessage,
	ChatStreamEvent,
	ChatToolCall,
	ReasoningEffortDto,
} from "@rowcat/contracts";
import {
	logProviderFailure,
	ProviderError,
	providerErrorForStatus,
	providerErrorForThrown,
	readRetryAfterSeconds,
} from "./errors.ts";
import { parseSseData, readSse } from "./sse.ts";
import type {
	ByoAdapter,
	ByoTransportInput,
	CredentialCheck,
} from "./transport.ts";

/**
 * Direct Anthropic adapter: the browser calls the provider directly.
 *
 * Boundary: in, a ChatGenerationRequest from our assembler plus this call's key. Out, a
 * ChatStreamEvent in our contract vocabulary. Not here: prompt assembly, storage, React, credential
 * storage, or vendor error bodies.
 *
 * The official SDK is not used. The adapter calls one endpoint (`/v1/messages`) and reads four
 * event types. An SDK would ship its bytes to managed-only users too, since a dynamic import still
 * lands in the browser bundle. Its own retries, timeouts, and error types would also take control
 * away from the no-retry rule below. Only documented formats are used.
 *
 * Browser direct calls: `anthropic-dangerous-direct-browser-access: true` is the switch. The
 * "dangerous" in the name is a warning to us, and the warning is this slice's premise: the key
 * lives in the browser. That is acceptable only because the key belongs to the user, who knows it
 * (disclosed in the connect dialog). With a platform key this would never be done. The managed path
 * still goes through the server.
 *
 * No automatic retries. This is a product rule. Generation bills the user's provider account, and
 * retrying after streaming has started would bill twice in one turn and produce two replies in
 * different styles. Failures are surfaced, and the user decides whether to retry.
 */

/** Provider endpoint. Users cannot set it; arbitrary endpoints are deferred. */
const API_ORIGIN = "https://api.anthropic.com";

/** The version header defined by the docs. It pins the response format, so it stays a literal. */
const API_VERSION = "2023-06-01";

const headersFor = (secret: string): HeadersInit => ({
	"content-type": "application/json",
	"x-api-key": secret,
	"anthropic-version": API_VERSION,
	/**
	 * Without this header, browser requests are blocked by CORS. This header name is in the
	 * preflight's allowed list, confirmed from a real response on 2026-08-19.
	 */
	"anthropic-dangerous-direct-browser-access": "true",
});

/**
 * Converts our messages to Anthropic messages. Merging same-role neighbors is the reason this
 * function exists.
 *
 * The Messages API requires roles to alternate. Our history can legitimately contain two user
 * messages in a row: a user turn got no reply because generation failed, and the user spoke again.
 * Sent as-is, that conversation would get a 400 forever after one failure.
 *
 * Merging is mapping, not prompt assembly. It adds no content and does not reorder. It joins the
 * two utterances with a blank line only.
 */
type AnthropicBlock =
	| { type: "text"; text: string }
	| {
			type: "tool_use";
			id: string;
			name: string;
			/** Unreadable arguments never reach here. An empty object stands in for them (`blocksOf`). */
			input: NonNullable<ChatToolCall["arguments"]>;
	  }
	| { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
	role: "user" | "assistant";
	content: string | AnthropicBlock[];
};

/**
 * One of our messages becomes this API's role and blocks.
 *
 * The one surprising case is a tool result becoming a `user` message. This API has no tool role;
 * results are blocks inside a user turn. Absorbing that here keeps the assembler from needing the
 * provider's role model.
 *
 * An assistant turn with no body text emits no text block. The API rejects empty text blocks with a
 * 400, and calling a tool with no prose is normal.
 */
function blocksOf(message: ChatGenerationMessage): {
	role: "user" | "assistant";
	blocks: AnthropicBlock[];
} {
	if (message.role === "tool")
		return {
			role: "user",
			blocks: [
				{
					type: "tool_result",
					tool_use_id: message.callId,
					content: message.content,
				},
			],
		};

	if (message.role === "assistant" && message.toolCall)
		return {
			role: "assistant",
			blocks: [
				...(message.content
					? [{ type: "text" as const, text: message.content }]
					: []),
				{
					type: "tool_use",
					id: message.toolCall.id,
					name: message.toolCall.name,
					/**
					 * Unreadable arguments are not reconstructed. An empty object is better than inventing the
					 * original. This round trip only pairs the call and returns one sentence stating the failure
					 * (`chatToolFailureText`).
					 */
					input: message.toolCall.arguments ?? {},
				},
			],
		};

	return {
		role: message.role,
		blocks: [{ type: "text", text: message.content }],
	};
}

function toAnthropicMessages(
	messages: readonly ChatGenerationMessage[],
): AnthropicMessage[] {
	const folded: { role: "user" | "assistant"; blocks: AnthropicBlock[] }[] = [];
	for (const message of messages) {
		const next = blocksOf(message);
		const last = folded.at(-1);
		if (!last || last.role !== next.role) {
			folded.push(next);
			continue;
		}
		/**
		 * Only text is joined to text. That keeps conversations without tools byte-for-byte the same as
		 * before this axis existed. Text-only results are folded back to strings below. At a boundary
		 * where a block is involved, the two sides are placed side by side rather than joined. Flattening
		 * two blocks into one string would erase the tool call inside.
		 */
		const tail = last.blocks.at(-1);
		const head = next.blocks[0];
		if (tail?.type === "text" && head?.type === "text") {
			tail.text = `${tail.text}\n\n${head.text}`;
			last.blocks.push(...next.blocks.slice(1));
			continue;
		}
		last.blocks.push(...next.blocks);
	}

	/**
	 * A single text is folded back into a string. This API accepts either form, but without folding,
	 * every conversation without tools would change its body because of this axis.
	 */
	return folded.map(({ role, blocks }) => {
		const only = blocks.length === 1 ? blocks[0] : undefined;
		return {
			role,
			content: only?.type === "text" ? only.text : blocks,
		};
	});
}

/**
 * Which shape `Continue generating` uses for each model. Like thinking, it varies by model. Prefill
 * ends the request with the cut-off reply, so the model continues from that exact point. This is
 * the most accurate. Nudge adds a one-line user turn after the cut-off reply.
 *
 * Prefill is no longer this provider's default. Checked on 2026-09-23 with real continuation
 * requests to twelve models, through OpenRouter. The rejection text is upstream's own. Accept
 * prefill: Opus 4.5, Sonnet 4.5, Haiku 4.5. Reject prefill (400, even without thinking): Fable 5.1,
 * Fable 5, Opus 5.5, Opus 5, Sonnet 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6. The nine rejecting
 * models always failed `Continue generating`, and the failure showed only as `The provider couldn't process the request.`, so the
 * cause was hidden.
 *
 * The nudge matches Anthropic's documented way to continue a cut-off response (stop reason docs,
 * "Ensuring complete responses"). All twelve accepted it that day. It is less exact, since the
 * model may rewrite the cut sentence, so models that accept prefill still use prefill.
 */
type AnthropicContinuationMode = "prefill" | "nudge";

/**
 * Model to continuation shape. Uses the same names as the reasoning table (`ANTHROPIC_REASONING`).
 *
 * Unknown models get the nudge. Saved preferences outlive the catalog, so names not listed here do
 * arrive. The shape sent then is the one every model accepts, since every new model from this
 * provider since 4.6 has rejected prefill. This matches the choice for unknown models' reasoning
 * parameters: do not guess a shape that returns a 400 when wrong.
 */
const ANTHROPIC_CONTINUATION: Readonly<
	Record<string, AnthropicContinuationMode>
> = {
	"claude-fable-5-1": "nudge",
	"claude-fable-5": "nudge",
	"claude-opus-5-5": "nudge",
	"claude-opus-5": "nudge",
	"claude-sonnet-5-5": "nudge",
	"claude-sonnet-5": "nudge",
	"claude-opus-4-8": "nudge",
	"claude-opus-4-7": "nudge",
	"claude-opus-4-6": "nudge",
	"claude-sonnet-4-6": "nudge",
	"claude-opus-4-5": "prefill",
	"claude-sonnet-4-5": "prefill",
	"claude-haiku-4-5": "prefill",
};

const continuationModeFor = (model: string): AnthropicContinuationMode =>
	ANTHROPIC_CONTINUATION[model] ?? "nudge";

/**
 * The system prompt as one text block carrying its own cache breakpoint.
 *
 * The automatic breakpoint sits on the last block, and the history window drops its oldest message
 * once a conversation passes `CHAT_HISTORY_LIMIT`. From then on the previous request's entry is never
 * a prefix of the next one, so without this breakpoint every turn wrote the whole prompt to the cache
 * and read nothing back — the system prompt included, although it had not changed.
 *
 * This is not a breakpoint placed by hand inside the prompt: the adapter already receives the system
 * prompt as one opaque string and marks the end of it, so it still knows nothing about the guards,
 * lore, summary or memory inside. The text is unchanged by a character.
 *
 * An empty string stays a string — the API rejects an empty text block.
 */
const anthropicSystem = (system: string) =>
	system
		? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
		: system;

/**
 * The continuation message array. The shape (`mode`) decides the ending.
 *
 * - prefill: trims trailing whitespace from the last assistant content. The API rejects it with
 *   "final assistant content cannot end with trailing whitespace", and cut-off replies often end
 *   with a space mid-sentence.
 * - nudge: keeps the cut reply exactly as stored and adds the nudge (a user turn) after it. The
 *   whitespace rule covers only the last assistant content, and the last message here is the nudge.
 *   The space is not trimmed, so the model sees exactly where the cut was. The cut fell between
 *   words, and that fact lives only in the space. Continued text is appended after the stored
 *   original (`extendAssistantRecord`). In the 2026-09-23 check, every nudge continuation began
 *   with the next word, with no leading space.
 *
 * Both shapes share two fallbacks: an array that does not end with an assistant message (the
 * conversation moved on in between), and a whitespace-only reply. Neither has text to continue, so
 * both use the nudge. The assembler did not add a nudge in those cases, so without one the model
 * would not know what to do. The caller filters these states already. If that filter breaks, this
 * code still does not silently start a new turn.
 */
function toAnthropicContinuationMessages(
	messages: readonly ChatGenerationMessage[],
	mode: AnthropicContinuationMode,
): AnthropicMessage[] {
	const folded = toAnthropicMessages(messages);
	const nudged = (): AnthropicMessage[] => {
		folded.push({ role: "user", content: CONTINUATION_FALLBACK_NUDGE });
		return folded;
	};
	const last = folded.at(-1);
	/**
	 * An array ending in a block is not a partial reply to continue. Continuation and a tool round
	 * trip never occur in the same request (the next request of a round trip turns `continuation`
	 * off), so this branch normally never runs. Assuming that silently here would mean that if a
	 * caller line ever shifted, a non-prefill array would go out as prefill.
	 */
	if (!last || last.role !== "assistant" || typeof last.content !== "string")
		return nudged();
	const trimmed = trimContinuationPrefill(last.content);
	/**
	 * After trimming it is empty. This is a request to continue a reply that was only whitespace. This
	 * API also rejects empty assistant messages, so the reply is dropped and the nudge is used.
	 */
	if (!trimmed) {
		folded.pop();
		return nudged();
	}
	if (mode === "nudge") return nudged();
	last.content = trimmed;
	return folded;
}

/**
 * Reasoning level to this model's thinking parameters. It is a scheme per model, not one shared
 * table.
 *
 * Earlier, a single budget table existed, and every Claude model received `thinking: { type:
 * "enabled", budget_tokens }`. That premise is wrong. This provider has a different reasoning API
 * per generation, and the newest generation rejects the old shape with a 400:
 * - Adaptive-only (Fable 5.1, Fable 5, Opus 5.5, Opus 5, Sonnet 5, Opus 4.8, Opus 4.7): rejects
 *   "enabled".
 * - Both (Opus 4.6, Sonnet 4.6): "enabled" is deprecated.
 * - Manual-only (Opus 4.5, Sonnet 4.5, Haiku 4.5): rejects "adaptive".
 *
 * One scheme cannot be sent to every model. Sending the old table to the first seven would be
 * discovered only by users who turned reasoning on, through a provider 400. The error disappears
 * when reasoning is turned off, so its cause stays hidden.
 *
 * The discriminated union is the point. A single table holding both budget and effort would let
 * both parameters appear in one request, which is invalid in every generation.
 *
 * Unknown models send nothing (same result as `none`). Saved preferences outlive the catalog, so
 * unlisted names do arrive. Sending the body from before this axis existed is better than guessing
 * a scheme.
 *
 * Checked against the Anthropic docs on 2026-08-29: the per-model table in
 * thinking-troubleshooting, and the supported models and levels list in effort.
 */
type AnthropicReasoningMode =
	/**
	 * Adaptive thinking: depth is set by an effort level, not tokens. Our vocabulary uses the same
	 * words, so it looks like an identity, but it is a translation. The provider has extra levels
	 * (`xhigh`, `max`), and we have `minimal`. Only the three overlapping levels appear here.
	 */
	| {
			kind: "adaptive-effort";
			efforts: Partial<Record<ReasoningEffortDto, string>>;
	  }
	/**
	 * Manual thinking: the older shape, unchanged. The budget has a floor of 1,024 tokens and cannot
	 * exceed `max_tokens`.
	 */
	| {
			kind: "manual-budget";
			budgets: Partial<Record<ReasoningEffortDto, number>>;
	  }
	/** This model has no reasoning parameter we can translate. */
	| { kind: "none" };

/**
 * Effort-level table for adaptive models. The three names match. There is no `minimal`. This
 * provider's effort levels start at `low`, because anything below that is an off switch, not a
 * depth. The catalog's Anthropic entry does not set that level either, so the list and this table
 * agree.
 */
const ADAPTIVE_EFFORTS: Partial<Record<ReasoningEffortDto, string>> = {
	low: "low",
	medium: "medium",
	high: "high",
};

/**
 * Budget table for manual models, starting at the documented floor of 1,024. `minimal` is absent
 * for the same reason as for adaptive: in this API, 0 is not an off value but outside the range.
 * The floor is 1,024, so there is no band for thinking minimally.
 */
const MANUAL_BUDGETS: Partial<Record<ReasoningEffortDto, number>> = {
	low: 1_024,
	medium: 4_096,
	high: 8_192,
};

const ADAPTIVE: AnthropicReasoningMode = {
	kind: "adaptive-effort",
	efforts: ADAPTIVE_EFFORTS,
};
const MANUAL: AnthropicReasoningMode = {
	kind: "manual-budget",
	budgets: MANUAL_BUDGETS,
};

/**
 * Model to scheme. Uses the same names as the catalog's Anthropic list, aliases included. A name
 * present here but missing from the catalog, or the reverse, would make that model run silently
 * without reasoning. Tests compare the two lists by value.
 */
const ANTHROPIC_REASONING: Readonly<Record<string, AnthropicReasoningMode>> = {
	"claude-fable-5-1": ADAPTIVE,
	"claude-fable-5": ADAPTIVE,
	"claude-opus-5-5": ADAPTIVE,
	"claude-opus-5": ADAPTIVE,
	"claude-sonnet-5-5": ADAPTIVE,
	"claude-sonnet-5": ADAPTIVE,
	"claude-opus-4-8": ADAPTIVE,
	"claude-opus-4-7": ADAPTIVE,
	"claude-opus-4-6": ADAPTIVE,
	"claude-sonnet-4-6": ADAPTIVE,
	"claude-opus-4-5": MANUAL,
	"claude-sonnet-4-5": MANUAL,
	"claude-haiku-4-5": MANUAL,
};

/**
 * The thinking setting for this request. Only one scheme is sent, and when there is none the key is
 * absent. This function prevents exactly two leaks: `output_config.effort` reaching a manual model,
 * and `thinking.type: "enabled"` reaching an adaptive model. Both are 400s, and both disappear when
 * reasoning is turned off.
 */
interface AnthropicThinking {
	/** Fragment spread into the request body. An empty object when there is nothing to add. */
	body: Record<string, unknown>;
	/**
	 * Thinking budget: manual models only. Adaptive models have no budget we know of, since the model
	 * decides on each request. Inventing a number and adding it to `max_tokens` would raise the
	 * billing cap on the user's account by a value we made up.
	 */
	budget?: number;
}

/** A request without thinking parameters. Its body is the same as before this axis existed. */
const EMPTY_THINKING: AnthropicThinking = { body: {} };

function anthropicThinkingFor(
	model: string,
	effort: ReasoningEffortDto | null,
): AnthropicThinking {
	if (effort === null) return { body: {} };
	const mode = ANTHROPIC_REASONING[model];
	if (mode === undefined || mode.kind === "none") return { body: {} };

	if (mode.kind === "adaptive-effort") {
		const level = mode.efforts[effort];
		if (level === undefined) return { body: {} };
		/**
		 * Both fields go out together. Sending effort alone would leave thinking off for models that
		 * default to off (Opus 4.8, 4.7, 4.6, Sonnet 4.6). The chosen level would then only change
		 * response length, with no visible symptom.
		 */
		return {
			body: {
				thinking: { type: "adaptive" },
				output_config: { effort: level },
			},
		};
	}

	const budget = mode.budgets[effort];
	if (budget === undefined) return { body: {} };
	return {
		body: { thinking: { type: "enabled", budget_tokens: budget } },
		budget,
	};
}

/**
 * Raises the output cap by the budget, manual mode only.
 *
 * In manual mode thinking tokens count against `max_tokens`, and the docs require `max_tokens >
 * budget_tokens`. Left unchanged, both break. A room set to `Short` (768) would have a budget above
 * the cap, and the request would be rejected. A roomy room would see its visible reply shrink,
 * because thinking consumes the budget. Raising the reasoning level would then shorten the reply.
 *
 * Adaptive models get no such arithmetic. That API does not require it, and there is no budget to
 * add. Adding an arbitrary number would raise the cap by an amount the user did not pick. The
 * trade-off is stated plainly: in adaptive mode, long thinking can exhaust `max_tokens` sooner, and
 * then raising the reply length is the user's own action.
 */
const maxTokensFor = (maxOutputTokens: number, budget: number | undefined) =>
	budget === undefined ? maxOutputTokens : maxOutputTokens + budget;

/**
 * Turns collected fragments into the call the contract accepts, or `null`. The argument string
 * comes from the provider and may not be JSON (a cut stream, or constrained decoding gone wrong). A
 * tool with no arguments sends no fragments, so an empty string means `{}`. This function never
 * returns `null` for unreadable arguments. That decision lives in one place (`readChatToolCall`).
 * `null` remains only when the identity or name falls outside the vocabulary.
 */
function parseAnthropicToolCall(pending: {
	id: string;
	name: string;
	json: string;
}): ChatToolCall | null {
	let input: unknown;
	try {
		input = pending.json.trim() ? JSON.parse(pending.json) : {};
	} catch {
		/**
		 * Warning: do not end here. Hitting the output cap ends the stream with argument JSON cut in
		 * half. That is common, not unusual. `null` means "could not be read", and that call still goes
		 * through judgment and gets one sentence back.
		 */
		input = null;
	}
	return readChatToolCall({
		id: pending.id,
		name: pending.name,
		arguments: input,
	});
}

/**
 * Only the fields this adapter reads. Everything else is ignored (reasoning blocks, tool use,
 * signature deltas).
 */
interface AnthropicEvent {
	type?: string;
	message?: {
		model?: string;
		usage?: {
			/**
			 * This is the count excluding cache. Only this provider reports it that way, and that is the
			 * entire reason `totalInputOf` below exists. Putting this value straight into our `inputTokens`
			 * would make totals look smaller the better the cache performs.
			 */
			input_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
	/** What `content_block_start` carries. For a tool block, the ID and name arrive here. */
	content_block?: { type?: string; id?: string; name?: string };
	delta?: {
		type?: string;
		text?: string;
		stop_reason?: string | null;
		/**
		 * A fragment of tool arguments. Only this provider streams partial JSON as deltas, and that is
		 * the entire reason for the accumulation below. The contract carries only complete arguments.
		 */
		partial_json?: string;
	};
	usage?: { output_tokens?: number };
	error?: { type?: string };
}

/** The three input counters this provider reports. Any of them may be missing. */
interface AnthropicInputUsage {
	uncached?: number;
	cacheWrite?: number;
	cacheRead?: number;
}

/**
 * Converts the provider's three counters into our total input.
 *
 * inputTokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *
 * This addition is the easiest place to get this adapter wrong. Anthropic's `input_tokens` counts
 * only the uncached part. The other providers' `prompt_tokens` and `promptTokenCount` include
 * cache, which is the opposite. Missing this makes long, cache-heavy conversations record a
 * fraction of their real input, so the stored basis for the conversation is silently wrong. Tests
 * guard it with three distinct numbers.
 *
 * BYO is not billed by RowCat, but the axis must mean the same thing as on the managed path. One
 * name must not carry a different value per path.
 *
 * Unknown stays unknown. If all three are missing, this is `undefined`, and the usage event omits
 * `inputTokens`. Zero would claim there was no cache and no input.
 */
const totalInputOf = (usage: AnthropicInputUsage): number | undefined => {
	const { uncached, cacheWrite, cacheRead } = usage;
	if (
		uncached === undefined &&
		cacheWrite === undefined &&
		cacheRead === undefined
	)
		return undefined;
	return (uncached ?? 0) + (cacheWrite ?? 0) + (cacheRead ?? 0);
};

/**
 * Maps a mid-stream error event into our vocabulary. Vendor type names are not shown on screen.
 * `overloaded_error` tells the user nothing, and each new string would make the screen branch per
 * name.
 */
const codeForStreamError = (type: string | undefined): ProviderError =>
	type === "overloaded_error"
		? new ProviderError("rate_limited")
		: new ProviderError("provider_error");

async function* stream(
	input: ByoTransportInput,
): AsyncGenerator<ChatStreamEvent> {
	const doFetch = input.fetch ?? globalThis.fetch;
	const { request } = input;

	/**
	 * The continuation shape: `null` for a plain generation. The model decides it
	 * (`ANTHROPIC_CONTINUATION`).
	 */
	const continuation = request.continuation
		? continuationModeFor(input.model)
		: null;

	/**
	 * Thinking for this request. The requested level has already passed the capability check
	 * (`reasoningEffortForRequest`). Even so, a model or level missing from the table is dropped
	 * silently here. When two places disagree, running without reasoning is safer than sending a
	 * parameter the model rejects.
	 *
	 * Warning: when continuing with prefill, thinking is not sent. This provider rejects prefill
	 * combined with thinking, and that failure shows the same single error line. Turning reasoning off
	 * would remove it, so the cause would stay hidden. If one must be dropped, keep prefill.
	 * Continuation means continuing from the exact cut character. Dropping prefill would turn the
	 * request into a new turn, which the button is not supposed to do. Dropping thinking affects only
	 * this turn's continued text quality. The next turn returns to normal, and the saved preference is
	 * unchanged.
	 *
	 * Nudge models keep thinking in continuation. With no prefill the constraint does not apply: all
	 * nine models that reject prefill accepted nudge plus thinking on 2026-09-23. Models that cannot
	 * turn thinking off (the Fable 5 family and Opus 5.5) have no way to drop it anyway, since
	 * removing the parameter still leaves them thinking.
	 */
	const thinking =
		continuation === "prefill"
			? EMPTY_THINKING
			: anthropicThinkingFor(input.model, request.reasoningEffort);

	/**
	 * The fields needed to trace this request later. Neither the prompt nor the key is included (see
	 * `errors.ts`).
	 */
	const diagnostics = {
		provider: "anthropic-byo",
		model: input.model,
		continuation: request.continuation,
		reasoning: Object.keys(thinking.body).length > 0,
	} as const;

	let response: Response;
	try {
		response = await doFetch(`${API_ORIGIN}/v1/messages`, {
			method: "POST",
			signal: input.signal,
			headers: headersFor(input.secret),
			body: JSON.stringify({
				model: input.model,
				max_tokens: maxTokensFor(request.maxOutputTokens, thinking.budget),
				/**
				 * The system prompt is a top-level field, not a message. The string our assembler built goes
				 * out as-is. It is not trimmed or extended here — only wrapped (`anthropicSystem`).
				 */
				system: anthropicSystem(request.system),
				/**
				 * Continuation goes through a different assembler. It shapes the ending per model: trims
				 * trailing whitespace for prefill, or adds a nudge. The plain-generation path is unchanged.
				 */
				messages:
					continuation === null
						? toAnthropicMessages(request.messages)
						: toAnthropicContinuationMessages(request.messages, continuation),
				/**
				 * When no tools are declared, the key is absent. A client that does not know this axis gets a
				 * body byte-identical to before, and its stream has no `tool_call` frames.
				 * `disable_parallel_tool_use` is the paired setting. The contract allows one call per stream,
				 * so the provider is asked first not to send parallel calls. If two still arrive anyway, the
				 * stream below is expected to fail with an error. (The parallel-call note there describes the
				 * current handling: it keeps the first call and drops the rest.) The schema is built by
				 * `@rowcat/chat`. JSON Schema is a spec, not this provider's vocabulary, and the gateway's
				 * `function.parameters` takes the same object.
				 */
				...(request.tools.length > 0
					? {
							tools: request.tools.map((tool) => ({
								name: tool.name,
								description: tool.description,
								input_schema: chatToolJsonSchema(tool),
							})),
							tool_choice: {
								type: "auto",
								disable_parallel_tool_use: true,
							},
						}
					: {}),
				/**
				 * When there is no value, the key is absent. There are two reasons not to send a thinking-off
				 * value (`{ type: "disabled" }`). First, it would differ from the pre-axis request. Second,
				 * some models reject it with a 400, such as the Fable 5 family, which cannot turn thinking off.
				 * What goes out is up to the model. Adaptive models get `thinking.type: "adaptive"` plus
				 * `output_config.effort`. Manual models get `thinking.type: "enabled"` plus `budget_tokens`.
				 * The function above cannot produce a mix of the two.
				 */
				...thinking.body,
				/**
				 * Switch for automatic prompt caching (a top-level field). The provider places a breakpoint at
				 * the last cacheable block, so as history grows, the cache boundary moves forward too.
				 *
				 * Breakpoints are not set by hand per content block. That would require this adapter to know
				 * the boundaries of guards, seeds, lore, memory, and history. That structure belongs to
				 * `@rowcat/chat` and is provider-neutral. Pushing cache mechanics into it would tie prompt
				 * assembly to provider details. Provider mechanics stay inside the adapter.
				 *
				 * No TTL is set (no `ttl: "1h"`). The default lifetime is sufficient. Cache lifetime is a
				 * transport optimization users have no reason to understand, so it is not a config option.
				 *
				 * This automatic breakpoint is one of two; the other sits on the system block
				 * (`anthropicSystem`).
				 */
				cache_control: { type: "ephemeral" },
				stream: true,
			}),
		});
	} catch (thrown) {
		const failure = providerErrorForThrown(thrown);
		logProviderFailure({ ...diagnostics, code: failure.code });
		throw failure;
	}

	if (!response.ok || !response.body) {
		/**
		 * The body is not read. Upstream error bodies can mix in account and organization information,
		 * and sometimes echo back our prompt. That is why the error vocabulary lets guidance be chosen
		 * from the status code alone (`errors.ts`).
		 */
		const failure = providerErrorForStatus(
			response.status,
			readRetryAfterSeconds(response.headers),
		);
		/**
		 * Diagnostics go only as far as the status code and the kind of request. To trace a 400 that
		 * happens only during continuation, both must be present together. The body is still not read.
		 */
		logProviderFailure({
			...diagnostics,
			code: failure.code,
			status: response.status,
		});
		throw failure;
	}

	let model: string | undefined;
	/**
	 * The three counters exactly as the provider reported them. Normalization happens once, after the
	 * stream ends.
	 */
	let inputUsage: AnthropicInputUsage = {};
	let outputTokens: number | undefined;
	let finishReason: string | undefined;
	/** Whether a terminal event was actually received. This is the only basis for emitting `done`. */
	let stopped = false;
	/**
	 * Holds one call that arrives in fragments. Emitted once, as complete arguments, when the stream
	 * ends.
	 */
	let pending: { id: string; name: string; json: string } | null = null;
	/**
	 * Whether a second tool block has arrived. It marks which argument deltas belong to a dropped
	 * block. Once set, it stays set. The call we keep is already fixed for this stream, and any later
	 * tool blocks are dropped for the same reason.
	 */
	let droppedExtraToolBlock = false;

	for await (const frame of readSse(response.body)) {
		const event = parseSseData<AnthropicEvent>(frame.data);
		if (!event) continue;

		switch (event.type) {
			case "message_start": {
				// The model named in the response wins. It can differ from the requested name because of alias
				// resolution.
				model = event.message?.model ?? input.model;
				const usage = event.message?.usage;
				inputUsage = {
					...(usage?.input_tokens !== undefined
						? { uncached: usage.input_tokens }
						: {}),
					...(usage?.cache_creation_input_tokens !== undefined
						? { cacheWrite: usage.cache_creation_input_tokens }
						: {}),
					...(usage?.cache_read_input_tokens !== undefined
						? { cacheRead: usage.cache_read_input_tokens }
						: {}),
				};
				break;
			}

			case "content_block_start":
				/**
				 * A tool block opened. Its ID and name arrive only here. Arguments follow as fragmented deltas.
				 */
				if (event.content_block?.type === "tool_use") {
					if (pending) {
						/**
						 * Parallel call. The contract allows one call per stream, so only the first is kept and the
						 * rest are dropped.
						 *
						 * Warning: this was once an error, on the premise that a dropped call leaves the model's call
						 * unanswered and makes the next request a 400. That premise does not hold here. The next
						 * request's assistant turn is built by us (`nextChatToolRequest`) and carries only the one
						 * call we chose, so upstream never sees the dropped call.
						 *
						 * Erroring out was the more expensive option. It would end the turn after body text had
						 * already streamed, and the user would get a reply cut off mid-sentence.
						 * `disable_parallel_tool_use` was sent, so this branch is a safeguard for the day upstream
						 * ignores it. A safeguard should not kill the turn.
						 *
						 * Argument deltas that follow are dropped too. This provider streams blocks in order, so
						 * those fragments belong to the dropped block. Appending them to the earlier call's JSON
						 * would merge two calls' arguments into one string, which could even parse.
						 */
						logProviderFailure({
							...diagnostics,
							code: "provider_error",
							vendorCode: "tool_parallel",
						});
						droppedExtraToolBlock = true;
						break;
					}
					pending = {
						id: event.content_block.id ?? "",
						name: event.content_block.name ?? "",
						json: "",
					};
				}
				break;

			case "content_block_delta":
				/**
				 * Argument fragments are only accumulated. Streaming partial JSON as events would make the
				 * screen and the router each need code to reassemble it, and the two would eventually diverge.
				 */
				if (event.delta?.type === "input_json_delta" && pending) {
					/**
					 * A fragment from a dropped block is not an argument of the earlier call (see the
					 * parallel-call note above).
					 */
					if (!droppedExtraToolBlock)
						pending.json += event.delta.partial_json ?? "";
					break;
				}
				/**
				 * Only text deltas pass through. Thinking deltas (`thinking_delta`) stop here. Turning on
				 * reasoning does not make its content flow into the reply bubble. This axis controls how much
				 * the model thinks, not whether that thinking is shown. Thinking content is also never stored:
				 * the caller finalizes only the text this generator yields.
				 */
				if (event.delta?.type === "text_delta" && event.delta.text)
					yield { type: "delta", text: event.delta.text };
				break;

			case "message_delta":
				/**
				 * These are cumulative values, so they overwrite. Adding them would double the count at the
				 * last event.
				 */
				outputTokens = event.usage?.output_tokens ?? outputTokens;
				finishReason = event.delta?.stop_reason ?? finishReason;
				break;

			case "message_stop":
				stopped = true;
				break;

			case "error": {
				/**
				 * A failure after the stream has started. It is emitted as an event, not thrown. Text already
				 * received must be saved by the caller, and throwing would lose the partial reply.
				 */
				const failure = codeForStreamError(event.error?.type);
				/**
				 * The vendor type arrives only in this event (HTTP failure bodies are not read). It is an
				 * enumerated value, which makes it useful for diagnostics, and a shape check blocks free-form
				 * sentences.
				 */
				logProviderFailure({
					...diagnostics,
					code: failure.code,
					vendorCode: event.error?.type,
				});
				yield { type: "error", code: failure.code, message: failure.message };
				return;
			}
		}
	}

	/**
	 * Emit the call before usage. By the time the client receives usage, the nature of this turn must
	 * already be decided. Emitting the call afterward would mean storage is decided from the body
	 * alone, and the call would arrive too late.
	 *
	 * Arguments are judged by the contract. There is no hand-written shape check here because the rule
	 * lives in one place (`ChatToolCall`). A copy would let different paths accept different values.
	 *
	 * That rejection does not end the turn. Nested objects and cut-off JSON make the arguments
	 * unreadable. That call still goes through the round trip and gets one sentence back
	 * (`readChatToolCall`). An error here applies only when no matching reply can be built, meaning
	 * the identity or name is outside the vocabulary.
	 */
	if (pending) {
		const call = parseAnthropicToolCall(pending);
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

	/**
	 * Usage is emitted before `done`. The caller finalizes the message on `done`, so if the order were
	 * reversed, usage would arrive after the save and never attach to that message. Our server keeps
	 * the same order. Missing values are not sent. Estimating a token count the provider did not
	 * report would store a number indistinguishable from a real one.
	 */
	const inputTokens = totalInputOf(inputUsage);
	if (
		model !== undefined ||
		inputTokens !== undefined ||
		outputTokens !== undefined
	)
		yield {
			type: "usage",
			...(model !== undefined ? { model } : {}),
			...(inputTokens !== undefined ? { inputTokens } : {}),
			...(inputUsage.cacheRead !== undefined
				? { cachedInputTokens: inputUsage.cacheRead }
				: {}),
			...(inputUsage.cacheWrite !== undefined
				? { cacheWriteInputTokens: inputUsage.cacheWrite }
				: {}),
			...(outputTokens !== undefined ? { outputTokens } : {}),
		};

	/**
	 * The byte stream ended without a terminal event, so this is a cut-off stream. Reporting it as a
	 * normal finish would finalize a truncated reply locally as complete. The SDK enforces the same
	 * invariant on the managed path. Text may already have been emitted, so this is sent as an error
	 * event, not thrown.
	 */
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

/**
 * Credential check. It does not start a generation. Listing models is used because it requires auth
 * yet spends no tokens. Verifying with a short completion would charge the user on each key save.
 * It also requires choosing a model, so an account that cannot use that model could not be told
 * apart from a wrong key.
 */
const probe: ByoAdapter["probe"] = async ({
	secret,
	signal,
	fetch: injected,
}): Promise<CredentialCheck> => {
	const doFetch = injected ?? globalThis.fetch;
	try {
		const response = await doFetch(`${API_ORIGIN}/v1/models?limit=1`, {
			method: "GET",
			signal,
			headers: headersFor(secret),
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

export const anthropicAdapter: ByoAdapter = { stream, probe };
