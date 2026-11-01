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
import type { ByoAdapter, ByoTransportInput, CredentialCheck } from "./byo.ts";
import {
	ProviderError,
	providerErrorForStatus,
	providerErrorForThrown,
	readRetryAfterSeconds,
} from "./errors.ts";
import { parseSseData, readSse } from "./sse.ts";

/**
 * Anthropic direct adapter. The request goes from the device straight to the provider.
 *
 * ```text
 * in        ChatGenerationRequest (built by our assembler) + this call's key
 * out       ChatStreamEvent (our contract vocabulary)
 * not here  prompt assembly · storage · React · credential storage · vendor error bodies · billing identity
 * ```
 *
 * No official SDK. The adapter calls one endpoint (`/v1/messages`) and reads four event types. An
 * SDK would bring its own retries, timeouts and error types, and the "no retries" rule below would
 * no longer be under our control.
 *
 * Web-only browser headers are not copied. `anthropic-dangerous-direct-browser-access` lifts the
 * browser's CORS preflight, and this runtime has no origin or preflight. A header that does nothing
 * here would make the next reader assume browser constraints and start diagnosing native failures
 * as CORS. Only the two headers the provider actually requires remain: auth (`x-api-key`) and the
 * API version (`anthropic-version`).
 *
 * No retries. Generation bills the user's provider account, and a retry after the stream has
 * started bills twice and produces two responses with different wording. Failures are raised; the
 * user decides whether to retry.
 */

/** Provider endpoint. Not user-configurable; arbitrary endpoints are deferred. */
const API_ORIGIN = "https://api.anthropic.com";

/** Version header the docs specify. A literal because it pins the response format. */
const API_VERSION = "2023-06-01";

const headersFor = (secret: string): Record<string, string> => ({
	"content-type": "application/json",
	"x-api-key": secret,
	"anthropic-version": API_VERSION,
});

/**
 * Our messages → Anthropic messages. **Merging roles is the reason this function exists.**
 *
 * The Messages API requires alternating roles, but our history can contain consecutive same-role
 * turns in a normal state: after a failed generation leaves a user turn without an answer, a second
 * user message yields `user, user`. Sent as-is, that room would get a 400 forever after the first
 * failure.
 *
 * Merging is mapping, not prompt assembly: no content is added, order is preserved, and two
 * utterances are joined only by a blank line.
 */
type AnthropicBlock =
	| { type: "text"; text: string }
	| {
			type: "tool_use";
			id: string;
			name: string;
			/** Arguments that could not be read never reach here; an empty object stands in (`blocksOf`). */
			input: NonNullable<ChatToolCall["arguments"]>;
	  }
	| { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
	role: "user" | "assistant";
	content: string | AnthropicBlock[];
};

/**
 * One of our messages → **this API's role and blocks**.
 *
 * Tool results becoming `user` is the one surprising spot here. This API has no tool role; results
 * are blocks inside a user turn. If this function did not absorb that, the assembler would have to
 * know the provider's role model.
 *
 * An assistant turn with an empty body produces no text block. The API rejects empty text blocks
 * with a 400, and a model calling a tool directly without prose is normal.
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
					 * **Unreadable arguments are not reconstructed.** An empty object is better than inventing the
					 * original. This round trip only has to pair the call and return one sentence recording the
					 * failure (`chatToolFailureText`).
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
		 * **Only text is joined.** That keeps conversations without tools byte-identical to before this
		 * axis existed (a single text part folds back to a string below). At a boundary where blocks are
		 * mixed, do not join: place them side by side, since flattening two blocks into one string would
		 * drop their tool calls.
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
	 * **A single text part folds to a string.** The API accepts both, but without folding the body of
	 * every conversation that uses no tools would change because of this axis alone.
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
 * The **shape** in which `Continue generating` is sent to this model. **Same table and same reasons as the web
 * adapter.**
 *
 * ```text
 * prefill  end the conversation with the cut response      the model continues from that exact character — most accurate
 * nudge    place a nudge line after the cut response        the conversation ends on a user turn — no model rejects it
 * ```
 *
 * ⚠️ The assumption that this provider accepts prefill was **wrong.** Checked on 2026-09-23 with
 * real requests: from 4.6 onward nine models reject prefill with a 400 ("This model does not
 * support assistant message prefill…"), and the rejection happened even for requests without a
 * thinking block. On those models `Continue generating` always failed. Only the three 4.5-generation models
 * accept prefill; the nudge shape was accepted by all twelve models (the shape Anthropic's docs
 * describe for continuing a cut response). The full reasoning is in the same place in the web
 * adapter.
 */
type AnthropicContinuationMode = "prefill" | "nudge";

/**
 * Model → continuation shape. **Uses the same names as the reasoning table
 * (`ANTHROPIC_REASONING`).**
 *
 * **Unknown models get nudge.** Stored preferences outlive the catalogue, and the safe thing to
 * send is the shape every model accepts. If this table differs from the web by a single line, the
 * same conversation continues on one device and gets a 400 on another.
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
 * **The system prompt as one text block carrying its own cache breakpoint.**
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
 * The message array for a continuation request — **same rules and reasons as the web adapter.**
 *
 * Prefill strips trailing whitespace from the last assistant content: this provider rejects it with
 * a 400, and cut responses end mid-sentence, so it is common. Nudge keeps the cut response
 * **exactly as stored** and appends the nudge after it; the whitespace constraint only applies to
 * the last assistant content, and the nudge tells the model that the cut point was between words.
 * The decision not to send prefill and thinking together is made in `start` below.
 *
 * The source of these rules is `@rowcat/chat`. If the web and this app each wrote them, the same
 * continuation would become a different request on each device, and only a side-by-side comparison
 * would show it.
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
	 * **An array that ends in blocks is not text to continue.** Continuation and tool round trips
	 * never share a request (the next request of a round trip turns `continuation` off), so this
	 * branch normally does not run. Silently assuming that here would let a non-prefill array go out
	 * as prefill the day a caller is off by one line.
	 */
	if (!last || last.role !== "assistant" || typeof last.content !== "string")
		return nudged();
	const trimmed = trimContinuationPrefill(last.content);
	/** The provider also rejects an empty assistant message; discard that response and fall back to nudge. */
	if (!trimmed) {
		folded.pop();
		return nudged();
	}
	if (mode === "nudge") return nudged();
	last.content = trimmed;
	return folded;
}

/**
 * Reasoning level → this **model's** thinking parameters. Not one table: **each model has its own
 * method.**
 *
 * For a while one thinking-budget table sat here, and every Claude model got `thinking: { type:
 * "enabled", budget_tokens }`. That assumption is broken. This provider has a different reasoning
 * API per generation, and **the newest generation rejects the old shape with a 400**:
 *
 * ```text
 * Fable 5.1 · Fable 5 · Opus 5.5 · Opus 5 · Sonnet 5 · Opus 4.8 · Opus 4.7   adaptive only       **rejects** "enabled"
 * Opus 4.6 · Sonnet 4.6                                                     both work          "enabled" is deprecated
 * Opus 4.5 · Sonnet 4.5 · Haiku 4.5                                         manual budget only **rejects** "adaptive"
 * ```
 *
 * So one method cannot be pushed to every model. Sending the old table to the first seven means
 * only the users who pick that model and turn reasoning on find out, from a provider 400. That
 * failure disappears when reasoning is turned off, so nothing reveals that this axis is the cause.
 *
 * Modeled as a discriminated union on purpose. With budget and effort in one table, a state where
 * both parameters ride on the same request becomes representable, and no generation accepts that
 * combination.
 *
 * **Unknown models send nothing** (the same result as `none`). Stored preferences outlive the
 * catalogue, so a name missing here does arrive; sending a guessed method is worse than sending the
 * same body as before this axis existed.
 *
 * Verified against Anthropic's official docs on 2026-08-29 (the per-model table in
 * build-with-claude/thinking-troubleshooting, and the supported models and effort levels in
 * build-with-claude/effort).
 */
type AnthropicReasoningMode =
	/**
	 * Adaptive thinking: depth is set by an **effort level**, not by a token count.
	 *
	 * Our vocabulary shares words with theirs and looks like an identity, but it is a **translation**.
	 * They have `xhigh` and `max` beyond ours, and we have `minimal`. Only the three overlapping
	 * levels are listed here.
	 */
	| {
			kind: "adaptive-effort";
			efforts: Partial<Record<ReasoningEffortDto, string>>;
	  }
	/** Manual (extended) thinking: the old shape as-is. Floor is 1,024 tokens, and it cannot exceed `max_tokens`. */
	| {
			kind: "manual-budget";
			budgets: Partial<Record<ReasoningEffortDto, number>>;
	  }
	/** This model has no reasoning parameter we can map. */
	| { kind: "none" };

/**
 * Effort table for adaptive models. All three names are the same.
 *
 * There is **no `minimal`.** This provider's effort levels start at `low` (below that, thinking is
 * switched off rather than tuned), so the catalogue's Anthropic entries do not offer that level
 * either. The list and this table state the same fact.
 */
const ADAPTIVE_EFFORTS: Partial<Record<ReasoningEffortDto, string>> = {
	low: "low",
	medium: "medium",
	high: "high",
};

/**
 * Budget table for manual-budget models, starting at the floor the docs require (1,024).
 *
 * `minimal` is absent for the same reason as above: on this API 0 is out of range rather than
 * "off", and there is no band equivalent to "think minimally".
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
 * Model → method. **Uses the same names as the catalogue's Anthropic list** (aliases as-is).
 *
 * If a name here is missing from the catalogue, or the reverse, that model silently runs without
 * reasoning. A test compares the two by value.
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
 * The thinking settings for this request. **Only one method goes out, and if none applies the key
 * is absent.**
 *
 * This function blocks exactly two leaks: `output_config.effort` reaching a manual-budget model,
 * and `thinking.type: "enabled"` reaching an adaptive model. Both are 400s, and both disappear when
 * reasoning is off.
 */
interface AnthropicThinking {
	/** Fragment spread into the request body. An empty object when there is nothing to send. */
	body: Record<string, unknown>;
	/**
	 * Thinking budget, **present only for manual-budget models.**
	 *
	 * Adaptive models have no budget we know of (the model sets its own on each request). Adding an
	 * invented number to `max_tokens` would raise the ceiling billed to the user's account by a value
	 * we made up.
	 */
	budget?: number;
}

/** A request without thinking parameters: the same body as before this axis existed. */
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
		 * Both fields go out **together.** Sending only the effort leaves models that default to
		 * thinking-off (Opus 4.8, 4.7, 4.6, Sonnet 4.6) from starting to think, and the level the user
		 * picked would only shift the response length. The screen shows no symptom.
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
 * **Raises the output cap by the budget, and only for manual-budget models.**
 *
 * In that method, thinking tokens are consumed inside `max_tokens`, and the docs require
 * `max_tokens > budget_tokens`. Left alone, two things break: a room set to `Short` (768) has its
 * budget exceed the cap and the request is rejected, and a roomy room whose thinking uses up the
 * budget gets **a visibly shorter response**. Raising the reasoning level would shorten the answer.
 *
 * **Adaptive models do not get this arithmetic.** That API does not require the relation, and there
 * is no budget to add: picking an arbitrary number and adding it would raise the cap by more than
 * the user chose. The cost is stated honestly: in adaptive mode, long thinking can exhaust
 * `max_tokens` first, and then raising the response length is the user's action.
 */
const maxTokensFor = (maxOutputTokens: number, budget: number | undefined) =>
	budget === undefined ? maxOutputTokens : maxOutputTokens + budget;

/**
 * Assembled fragments → a call the contract accepts, or `null`.
 *
 * The argument string comes from the provider and **may not be JSON** (a cut stream, or constrained
 * decoding that wobbled). A tool with no arguments sends no fragments at all, so an empty string
 * means `{}`.
 *
 * This function does not return `null` for unreadable arguments; that judgment lives in one place
 * (`readChatToolCall`). `null` remains only when the identity or name falls outside the vocabulary.
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
		 * ⚠️ **Do not stop here.** Hitting the output cap ends the stream with the argument JSON cut in
		 * half. That is common, not an anomaly. `null` means "could not read", and that call still goes
		 * through judgment and gets a sentence back.
		 */
		input = null;
	}
	return readChatToolCall({
		id: pending.id,
		name: pending.name,
		arguments: input,
	});
}

/** Only the fields this adapter reads. Everything else is ignored (reasoning blocks, tool use, signature deltas). */
interface AnthropicEvent {
	type?: string;
	message?: {
		model?: string;
		usage?: {
			/**
			 * Tokens **excluding** the cache. Only this provider reports them this way; that is why
			 * `totalInputOf` exists below.
			 */
			input_tokens?: number;
			/** Tokens this request **wrote** to the cache. */
			cache_creation_input_tokens?: number;
			/** Tokens **read** from the cache. */
			cache_read_input_tokens?: number;
		};
	};
	/** Carried by `content_block_start`. For a tool block, the identity and name arrive here. */
	content_block?: { type?: string; id?: string; name?: string };
	delta?: {
		type?: string;
		text?: string;
		stop_reason?: string | null;
		/**
		 * A **fragment** of the tool argument. Only this provider streams partial JSON as deltas, and
		 * that is the entire reason accumulation exists below. The contract only carries complete
		 * arguments.
		 */
		partial_json?: string;
	};
	usage?: { output_tokens?: number };
	error?: { type?: string };
}

/** The three input axes this provider reports. Any of them may be absent. */
interface AnthropicInputUsage {
	uncached?: number;
	cacheWrite?: number;
	cacheRead?: number;
}

/**
 * The provider's three axes → our **total input**.
 *
 * ```text
 * inputTokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 * ```
 *
 * Adding is all this function does, and it is the easiest place in this adapter to get wrong.
 * Anthropic's `input_tokens` counts **only the part not stored in the cache**, the opposite of
 * Gemini's `promptTokenCount`, which is the total including cache. Without adding, a long
 * conversation where the cache hit well is recorded as a fraction of its real input, and the stored
 * figures are quietly wrong.
 *
 * **Unknown values are not invented.** If none of the three arrived the result is `undefined`, and
 * our usage event then has no `inputTokens` slot at all. 0 would be a different claim: that there
 * was no cache and no input.
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
 * Maps an error event that arrives mid-stream into the vocabulary.
 *
 * Vendor type names do not reach the screen. `overloaded_error` tells the user nothing, and each
 * new name would make the screen branch per name.
 */
const codeForStreamError = (type: string | undefined): ProviderError =>
	type === "overloaded_error"
		? new ProviderError("rate_limited")
		: new ProviderError("provider_error");

/**
 * Everything the parser receives **after** the response is open.
 *
 * `ByoTransportInput` is deliberately not passed through: it contains `secret`, and the parser
 * lives until the response ends. Passing it would make the plaintext credential's lifetime the
 * stream's lifetime, which undoes the reason `ProviderCredentialAccess` takes a callback. Passing
 * the transport input by mistake fails to compile, since this type requires `body`, which that one
 * lacks.
 */
interface AnthropicResponseStream {
	/** The already-open response body. The parser does not know which request produced it. */
	body: ReadableStream<Uint8Array>;
	/**
	 * Fallback for when `message_start` does not name the model: the name we **requested**.
	 *
	 * Not a secret. It is the public identity that passed through the catalogue, and the only
	 * request-side value the parser is allowed to hold.
	 */
	requestedModel: string;
}

/**
 * Open response body → normalized events. **Does not know the credential.**
 *
 * This is the half split from `start()`, and the split is about lifetime (see the `byo.ts` header).
 * There is no auth header or request assembly here, so this function's closure has nowhere to keep
 * a secret.
 */
async function* readAnthropicStream(
	source: AnthropicResponseStream,
): AsyncGenerator<ChatStreamEvent> {
	let model: string | undefined;
	/** Usage as the provider reported it, on three axes. Normalization runs once, after the stream ends. */
	let inputUsage: AnthropicInputUsage = {};
	let outputTokens: number | undefined;
	let finishReason: string | undefined;
	/** Whether a terminal event was actually received. The only basis for emitting `done`. */
	let stopped = false;
	/** Collects a tool call that arrives in fragments; it is emitted once, complete, at the end. */
	let pending: { id: string; name: string; json: string } | null = null;
	/**
	 * Whether a second tool block has arrived. **This is the flag that filters out the argument deltas
	 * of a dropped block.**
	 *
	 * Once set it never clears. The call used for this stream is already fixed, and any tool block
	 * that follows is dropped for the same reason, however many there are.
	 */
	let droppedExtraToolBlock = false;

	for await (const frame of readSse(source.body)) {
		const event = parseSseData<AnthropicEvent>(frame.data);
		if (!event) continue;

		switch (event.type) {
			case "message_start": {
				// Prefer the model the response names; it can differ from the requested name (alias
				// resolution).
				model = event.message?.model ?? source.requestedModel;
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
				 * A tool block opened. Its identity and name arrive **only here**; the arguments follow as
				 * delta fragments.
				 */
				if (event.content_block?.type === "tool_use") {
					if (pending) {
						/**
						 * A parallel call. The contract allows one call per stream, so **keep the first and drop the
						 * rest.**
						 *
						 * ⚠️ This used to be an error, on the grounds that dropping a call leaves the model's call
						 * unanswered and the next request returns a 400. **That premise does not hold here:** the
						 * next request's assistant turn is built by us (`nextChatToolRequest`), and only the one call
						 * we chose goes into it, so the dropped call is never seen upstream again.
						 *
						 * The opposite direction cost far more. Erroring out kills the turn **after body text has
						 * already been shown**, and the user gets a response that stops mid-sentence.
						 * `disable_parallel_tool_use` was sent, so this branch is insurance for the day upstream
						 * ignores that request, and insurance has no reason to kill the turn.
						 *
						 * **The argument deltas that follow are dropped too.** This provider streams blocks in order,
						 * so those fragments belong to the dropped block. Appending them to the earlier call's JSON
						 * would produce a string mixing two calls' arguments, and that string might even parse.
						 */
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
				 * Argument fragments are **only accumulated.** Emitting partial JSON as events would make the
				 * screen and the router each carry their own reassembly code, and the two would eventually
				 * diverge.
				 */
				if (event.delta?.type === "input_json_delta" && pending) {
					/** A fragment of a dropped block is not an argument of the earlier call (see "parallel call" above). */
					if (!droppedExtraToolBlock)
						pending.json += event.delta.partial_json ?? "";
					break;
				}
				/**
				 * Only text deltas pass through. **Thinking deltas (`thinking_delta`) end here.** Enabling a
				 * reasoning level does not stream its content into the bubble. This axis decides how much the
				 * model thinks, not whether that thinking is shown, and thinking content is never stored (the
				 * caller commits only the text this generator emits).
				 */
				if (event.delta?.type === "text_delta" && event.delta.text)
					yield { type: "delta", text: event.delta.text };
				break;

			case "message_delta":
				/** Cumulative values, so overwrite. Adding would double them on the final event. */
				outputTokens = event.usage?.output_tokens ?? outputTokens;
				finishReason = event.delta?.stop_reason ?? finishReason;
				break;

			case "message_stop":
				stopped = true;
				break;

			case "error": {
				/**
				 * A failure after the stream has started. **Not thrown**; it is emitted as an event. Text
				 * already received must be saved by the caller, and a throw would lose the partial response on
				 * that path.
				 */
				const failure = codeForStreamError(event.error?.type);
				yield { type: "error", code: failure.code, message: failure.message };
				return;
			}
		}
	}

	/**
	 * The call goes **before** usage. By the time a client receives `usage`, the nature of this turn
	 * must already be settled. Emitting it afterwards means the call arrives after the message was
	 * judged from its body and saved.
	 *
	 * **The contract judges the arguments.** The shape is not checked by hand here because that rule
	 * already lives in one place (`ChatToolCall`); a copy would let different paths pass different
	 * values.
	 *
	 * **That rejection does not end the turn, however.** Nested objects and truncated JSON only make
	 * the argument "unreadable", and that call still goes through the round trip and gets a sentence
	 * back (`readChatToolCall`). Only the case where no pairing can be made (an identity or name
	 * outside the vocabulary) ends here with an error.
	 */
	if (pending) {
		const call = parseAnthropicToolCall(pending);
		if (!call) {
			const failure = new ProviderError("provider_error");
			yield { type: "error", code: failure.code, message: failure.message };
			return;
		}
		yield { type: "tool_call", call };
	}

	/**
	 * Usage is emitted **before** `done`. The caller finalizes the message on `done`, so if the order
	 * were reversed, usage would arrive after saving and never attach to that message.
	 *
	 * Values the provider did not report are **not sent.** Estimating a count it did not state would
	 * store a number indistinguishable from an exact one.
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
	 * The byte stream ended without a terminal event: **a cut stream.** Reporting normal completion
	 * would finalize a truncated response as complete. Text may already have been emitted, so this
	 * does not throw; it emits an error event.
	 */
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
 * Sends the request and returns an iterator that reads the open response. This is the
 * implementation of `ByoAdapter.start`.
 *
 * Four things finish before this resolves: resolving the thinking settings, building the auth
 * header, the provider `fetch`, and validating the first response. **It is deliberately not an
 * `async function*`.** As a generator function, this body would not run a line until the caller
 * began iterating, and in the meantime `input` (= `secret`) would live in the generator's closure
 * and leave the credential callback.
 *
 * The iterator's closure holds only `source`, with no secret and no header.
 */
async function start(
	input: ByoTransportInput,
): Promise<AsyncIterable<ChatStreamEvent>> {
	const { request } = input;

	/** Continuation shape. `null` for an ordinary generation. Chosen by the model (`ANTHROPIC_CONTINUATION`). */
	const continuation = request.continuation
		? continuationModeFor(input.model)
		: null;

	/**
	 * The effort the request carries has already passed capability checks
	 * (`reasoningEffortForRequest`). Even so, a model or level missing from this table drops out
	 * silently here. When the two sides disagree, running without reasoning is better than sending a
	 * parameter that model rejects.
	 */
	/**
	 * ## ⚠️ Continuing with prefill does not send thinking. **This provider rejects that combination.**
	 *
	 * Sending assistant prefill with thinking enabled is a 400, and the failure reaches the screen
	 * only as the single line `The provider couldn't process the request.` **It disappears when reasoning is turned off**,
	 * so the cause never surfaces.
	 *
	 * If one of the two must go, **keep prefill.** Dropping prefill turns the request into a new turn
	 * rather than a continuation, which is exactly what the user's button is defined not to do. The
	 * stored preference does not change at all (the web adapter made the same call).
	 *
	 * **Nudge continuations keep thinking as-is.** With no prefill, this constraint does not apply.
	 */
	const thinking =
		continuation === "prefill"
			? EMPTY_THINKING
			: anthropicThinkingFor(input.model, request.reasoningEffort);

	let response: Awaited<ReturnType<ByoTransportInput["fetch"]>>;
	try {
		response = await input.fetch(`${API_ORIGIN}/v1/messages`, {
			method: "POST",
			signal: input.signal,
			headers: headersFor(input.secret),
			body: JSON.stringify({
				model: input.model,
				max_tokens: maxTokensFor(request.maxOutputTokens, thinking.budget),
				/**
				 * The system prompt is a **top-level field**, not a message in the array. The string our
				 * assembler built is sent as-is; nothing is trimmed or appended here — only wrapped
				 * (`anthropicSystem`).
				 */
				system: anthropicSystem(request.system),
				/**
				 * Only continuation goes through a different assembler: it closes the tail in the model's
				 * shape. The ordinary generation path is unchanged.
				 */
				messages:
					continuation === null
						? toAnthropicMessages(request.messages)
						: toAnthropicContinuationMessages(request.messages, continuation),
				/**
				 * **Without declared tools the key is absent entirely.** A body from a client that does not
				 * know this axis stays byte-identical to before, and that stream has no `tool_call` frames.
				 *
				 * `disable_parallel_tool_use` is paired on purpose. The contract narrows a stream to one call,
				 * so we **first ask the provider not to produce more**. If two still arrive, the stream below
				 * ends with an error. Without the request, that error would become the normal path.
				 *
				 * The schema is built by `@rowcat/chat`. JSON Schema is a standard, not this provider's
				 * vocabulary, and the gateway's `function.parameters` takes the same object.
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
				 * **Absent when there is nothing to send.** Thinking-off values (`{ type: "disabled" }`) are
				 * not sent, for two reasons: the body would differ from the one before this axis existed, and
				 * **some models reject that value with a 400** (the Fable 5 family cannot disable thinking).
				 *
				 * The model decides what goes here: adaptive gets `thinking.type: "adaptive"` plus
				 * `output_config.effort`; manual gets `thinking.type: "enabled"` plus `budget_tokens`.
				 */
				...thinking.body,
				/**
				 * **The switch for automatic prompt caching** (a top-level field). Breakpoints are not placed
				 * by hand on each content block: that would require this adapter to know the boundaries of
				 * guards, seed, lore, memory and history, a structure that belongs to `@rowcat/chat` and is
				 * provider-neutral. This automatic breakpoint is one of two; the other sits on the system
				 * block (`anthropicSystem`).
				 */
				cache_control: { type: "ephemeral" },
				stream: true,
			}),
		});
	} catch (thrown) {
		throw providerErrorForThrown(thrown, input.signal);
	}

	if (!response.ok || !response.body) {
		/**
		 * **The body is not read.** Upstream error bodies carry account and org information mixed in, and
		 * sometimes echo the prompt we sent. That is why the error vocabulary is built from the status
		 * code alone (`errors.ts`).
		 */
		throw providerErrorForStatus(
			response.status,
			readRetryAfterSeconds(response.headers),
		);
	}

	return readAnthropicStream({
		body: response.body,
		requestedModel: input.model,
	});
}

/**
 * Credential check. **Does not start generation.**
 *
 * The model list endpoint is used because it requires authentication yet consumes no tokens.
 * Verifying with a short completion would charge the user on every key save, and since it needs a
 * model choice, "an account that cannot use that model" would be indistinguishable from "a wrong
 * key".
 */
const probe: ByoAdapter["probe"] = async ({
	secret,
	signal,
	fetch,
}): Promise<CredentialCheck> => {
	try {
		const response = await fetch(`${API_ORIGIN}/v1/models?limit=1`, {
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
		return { ok: false, error: providerErrorForThrown(thrown, signal) };
	}
};

export const anthropicAdapter: ByoAdapter = { start, probe };
