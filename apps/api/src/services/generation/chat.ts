import {
	CONTINUATION_FALLBACK_NUDGE,
	chatToolJsonSchema,
	readChatToolCall,
	trimContinuationPrefill,
} from "@rowcat/chat";
import {
	CHAT_ERROR_CODE,
	CHAT_MAX_TOOL_PROVIDER_STATE_CHARS,
	type ChatStreamEvent,
	type ChatToolCall,
	type ManagedChatGenerationRequest,
	type ModelReasoningDto,
	type ReasoningEffortDto,
} from "@rowcat/contracts";
import { APP_NAME } from "@rowcat/domain";
import {
	chatProviderEnabled,
	env,
	openRouterBaseUrl,
	webOrigin,
} from "../../env.ts";
import { ApiError } from "../../lib/errors.ts";
import { isLoopbackOrigin } from "../../lib/origins.ts";
import {
	DISCLOSED_PROVIDERS,
	type ManagedContinuationMode,
	resolveManagedModel,
} from "./managed-models.ts";

/**
 * Attribution headers for the gateway (routing and rankings only), not a key exposure.
 *
 * The referer is this deployment's canonical web origin (the first `WEB_ORIGIN` entry); a hard-
 * coded operator site once credited every deployment's usage to that operator. Loopback origins are
 * omitted because local `localhost` is not a usage site worth reporting. The title comes from
 * `APP_NAME` in `@rowcat/domain`.
 */
const openRouterAttributionHeaders: Readonly<Record<string, string>> =
	isLoopbackOrigin(webOrigin)
		? { "X-Title": APP_NAME }
		: { "HTTP-Referer": webOrigin, "X-Title": APP_NAME };

/**
 * Generation service: the only place that knows the provider.
 *
 * ```text
 * request carries   public managed identity (claude-sonnet-5)   — the contract narrows the vocabulary
 *         ↓  resolveManagedModel — server-owned allowlist
 * goes upstream     anthropic/claude-sonnet-5
 * ```
 *
 * No request path carries an upstream slug. The contract's enum cannot express one, and only enum
 * identities are looked up in the registry; unknown identities are a 400 and never fall back to
 * another model.
 *
 * OpenRouter's name ends here, so the contract, SDK and web do not know the provider and swapping
 * providers is not a client deploy. A route building the provider body itself would mix
 * auth/validation with provider concerns in one file. No plugin registry with a single provider:
 * one function is enough for the "routes do not know the provider" boundary.
 *
 * This service stores nothing: prompts and responses pass through without reaching tables or logs.
 * The device owns conversation history.
 */

/**
 * What may go in a diagnostic log: identity and state only.
 *
 * Prompt text, user input and model output are never logged at any level. They are the user's
 * private work, and the product's structural promise is that the server processes but does not
 * retain them.
 */
function logProviderFailure(stage: string, detail: string): void {
	console.error(`[chat] provider ${stage}: ${detail}`);
}

/**
 * Axes allowed on a diagnostic line: identity, state and request character only.
 *
 * `continuation` is here because continuation-only failures (the prefill + reasoning 400) were
 * untraceable from a bare `status=400 model=anthropic/…` line, which looks like any ordinary
 * failure. The request's shape is a fact about the request, not the prompt, so it is safe to log.
 *
 * Upstream error bodies are still never read: they carry account/org info and sometimes echo our
 * prompt.
 */
const providerFailureDetail = (input: {
	model: string;
	status?: number;
	continuation: boolean;
	reasoning: boolean;
}): string =>
	[
		input.status === undefined ? null : `status=${input.status}`,
		`model=${input.model}`,
		`continuation=${input.continuation}`,
		`reasoning=${input.reasoning}`,
	]
		.filter((part): part is string => part !== null)
		.join(" ");

/** Only the OpenRouter (OpenAI-compatible) stream chunk fields we read; the rest is ignored. */
interface ProviderChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			/**
			 * Tool call; arguments arrive in fragments.
			 *
			 * `index` exists because the spec expresses parallel calls, which our vocabulary excludes (the
			 * contract's `tool_call` is at most one per stream); a second index is dropped in
			 * `translateProviderStream`.
			 */
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
			/**
			 * Reasoning blocks, which the gateway requires back when it receives its own call again.
			 *
			 * Only `type` is read and the rest passes through opaquely. Knowing the shape would make this
			 * file interpret the provider's reasoning vocabulary, which breaks whenever the provider adds a
			 * block kind.
			 */
			reasoning_details?: Array<{ type?: string } & Record<string, unknown>>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		/**
		 * Cache breakdown; present only when the gateway supplies it (absent entirely for some providers
		 * and models).
		 *
		 * Absent is not 0, so the axis is omitted from our event too.
		 */
		prompt_tokens_details?: {
			cached_tokens?: number;
			cache_write_tokens?: number;
		};
	};
	model?: string;
}

/**
 * Whether this model needs explicit cache control.
 *
 * Decided on the resolved upstream slug, not the public identity: the identity (`claude-sonnet-5`)
 * has no provider namespace, so deciding on it would need a second identity list, while the
 * registry already holds that mapping.
 *
 * Matches the provider namespace rather than a model name. A literal comparison silently disables
 * caching on the day the model is bumped, and the symptom is the invoice, not an error.
 *
 * Only Anthropic needs it. Other upstreams cache implicitly given a stable prefix, which the
 * assembler already provides (`@rowcat/chat` puts no timestamp or RNG in the prompt;
 * `context.test.ts` guards it).
 */
export const usesExplicitPromptCaching = (model: string): boolean =>
	model.startsWith("anthropic/");

/**
 * Whether this upstream rejects an assistant prefill combined with reasoning parameters.
 *
 * The gateway accepts one OpenAI-compatible shape, but upstream constraints follow through.
 * Anthropic returns 400 for a thinking-enabled request whose conversation ends on an assistant
 * message.
 *
 * Users see only a generic provider failure that disappears when reasoning is off, so the cause
 * stays hidden, and the combination only arises from `Continue generating`, so that button would always fail for
 * that model. Judged by provider namespace like `usesExplicitPromptCaching`, for the same reason.
 * No "OpenAI-compatible means identical" assumption: only upstreams where this is true lose
 * thinking.
 *
 * This predicate applies to the prefill shape only. As of 2026-09-23 Anthropic 4.6+ models reject
 * prefill itself (even without reasoning) and go through the nudge shape
 * (`ManagedModelRoute.continuation`), which has no prefill and carries reasoning intact. What
 * remains here is the fact about prefill-accepting lines (the 4.5 generation).
 */
export const rejectsPrefillWithReasoning = (model: string): boolean =>
	model.startsWith("anthropic/");

/**
 * Reasoning effort → the gateway's unified reasoning parameter.
 *
 * ```text
 * ReasoningEffort (product vocabulary)  →  reasoning: { effort }
 * ```
 *
 * The gateway maps one tier to each upstream's own shape (effort enum or thinking budget).
 * Computing per-model budgets here would go stale whenever upstream updates a model, and stale
 * budgets surface as the invoice.
 *
 * The words match, but this is a translation: the table is explicit so there is one place to fix
 * when the vocabularies diverge (the gateway's also has `none`, `xhigh` and `max`). Passing the
 * vocabulary through would make adding a `ReasoningEffort` value change the upstream contract.
 *
 * `exclude`, `max_tokens` and `enabled` are not sent: the first controls reasoning summaries we
 * never read (the client draws text only), and the other two are token budgets this product does
 * not expose.
 *
 * Do not rely on the gateway folding an unsupported tier to the nearest one: the listed tier and
 * the running tier would diverge with no error. The registry stays the authority (`reasoning` in
 * `managed-models.ts`) and lists only tiers the model really distinguishes; models for which the
 * gateway exposes no effort parameter (the extended-only Claude 4.5 generation) are `null`.
 *
 * Confirmed against OpenRouter docs (use-cases/reasoning-tokens) on 2026-08-29.
 */
const REASONING_EFFORT_PARAM: Record<ReasoningEffortDto, string> = {
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
};

/**
 * Requested tier → the tier this model will actually run, or `null`.
 *
 * Re-decided on the server because clients are not trusted: the browser may lack the catalogue or
 * hold an old one, and non-web clients can call this endpoint.
 *
 * Same three rules as the pure layer (`resolveExecutableReasoning` in `@rowcat/chat`): drop the
 * parameter for a non-adjustable model, fold an unsupported tier to the model's default, never
 * switch models. It does not reject with 400 because the failure is not the user's fault (one old
 * global choice would block a room's conversation).
 *
 * Not imported from `@rowcat/chat` because its input (`ManagedModelRoute.reasoning`) is server-only
 * and the rules are three lines; tests compare the two by value.
 */
export function resolveUpstreamReasoning(
	capability: ModelReasoningDto | null,
	requested: ReasoningEffortDto | null,
): ReasoningEffortDto | null {
	if (capability === null) return null;
	if (requested === null) return null;
	return capability.efforts.includes(requested)
		? requested
		: capability.defaultEffort;
}

/**
 * Routing constraint that keeps upstream from retaining prompts.
 *
 * Without `provider`, OpenRouter picks among the providers serving a model by price, and
 * `data_collection` defaults to `"allow"`, so providers that may store data are candidates. That
 * contradicts the published privacy policy, whose overseas-transfer table gives the retention
 * period as "the period needed to generate the response". This line makes that promise true rather
 * than adding a product decision, and always favors the user.
 *
 * The provider allowlist (`only`) is `DISCLOSED_PROVIDERS` in `managed-models.ts`. The overseas-
 * transfer disclosure names the United States as the sub-processor country, so it is one US provider set sent with
 * every request regardless of model. That constant carries the no-retention axis only.
 *
 * Deliberately absent:
 * - `order`: priority inside the allowlist is price/availability, not disclosure.
 * - `zdr: true`: restricting to zero-retention endpoints cuts availability across 14 models, a
 *   product decision made without checking which models are not served under it, and it would show
 *   up as unexplained generation failures.
 * - `allow_fallbacks: false`: `only` already limits fallbacks to that company's set; blocking
 *   within it is an availability decision, not a privacy one.
 */
const NO_STORAGE_ROUTING = { data_collection: "deny" } as const;

/**
 * Upstream request body; pure so tests can inspect cache control and routing constraints directly.
 *
 * `cache_control` is the gateway's automatic-caching switch (a top-level field): the gateway moves
 * the breakpoint to the last cacheable block, so the cache boundary follows a growing conversation.
 * Computing positions here would tie prompt assembly to provider details and break `@rowcat/chat`'s
 * provider neutrality.
 *
 * This is not response caching: no `X-OpenRouter-Cache*` headers are sent, since reusing a whole
 * probabilistic response is a different product behavior. Only the input (prompt) cache is enabled.
 */
/**
 * Prefill-shaped continuation: trims only the prefill's trailing whitespace.
 *
 * Does nothing unless the last message is from the assistant. In that state the continuation
 * premise already broke (the conversation moved on), the caller does not build such a request, and
 * inventing a nudge would create a turn the user never pressed.
 */
function continuationMessages(
	messages: ManagedChatGenerationRequest["messages"],
): ManagedChatGenerationRequest["messages"] {
	const last = messages.at(-1);
	if (!last || last.role !== "assistant") return messages;
	const trimmed = trimContinuationPrefill(last.content);
	if (trimmed === last.content) return messages;
	return [...messages.slice(0, -1), { ...last, content: trimmed }];
}

/**
 * Nudge-shaped continuation: leaves the cut response as stored and appends one nudge line after it.
 *
 * The wording lives in `@rowcat/chat` (`CONTINUATION_FALLBACK_NUDGE`) so both BYO adapters use the
 * same sentence; per-path copies would give the same continuation different instructions.
 *
 * Whitespace is not trimmed, for the same reason as there: the whitespace constraint applies only
 * to the last assistant content (here the nudge is last), and trailing whitespace tells the model
 * the cut fell between words. Continued text is appended to the stored original on the device
 * (`extendAssistantRecord`).
 *
 * Does nothing unless the last message is from the assistant, as with the prefill shape.
 */
function nudgedContinuationMessages(
	messages: ManagedChatGenerationRequest["messages"],
): ManagedChatGenerationRequest["messages"] {
	const last = messages.at(-1);
	if (!last || last.role !== "assistant") return messages;
	return [...messages, { role: "user", content: CONTINUATION_FALLBACK_NUDGE }];
}

/**
 * Shape → message assembly. A `Record` so that adding a shape breaks compilation here; a ternary
 * would silently route a new shape to one branch.
 */
const CONTINUATION_MESSAGES: Record<
	ManagedContinuationMode,
	(
		messages: ManagedChatGenerationRequest["messages"],
	) => ManagedChatGenerationRequest["messages"]
> = {
	prefill: continuationMessages,
	nudge: nudgedContinuationMessages,
};

/**
 * A call's returned state → this spec's `reasoning_details` key, or nothing.
 *
 * The value originates upstream (`translateProviderStream`); this only puts it back where it came
 * from.
 */
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
 * Our messages → OpenAI-compatible messages.
 *
 * Passing the array through only worked while both shapes happened to match (`{ role, content }`).
 * With the tool role they diverge: tool results need `tool_call_id` and an assistant turn carrying
 * a call needs a `tool_calls` array. Our key names are unknown upstream, which reads them as an
 * unpaired call and answers 400.
 *
 * Arguments are serialized to a string because the spec's `function.arguments` is a JSON string;
 * that provider vocabulary stays in this file.
 */
function toOpenAiMessages(
	messages: ManagedChatGenerationRequest["messages"],
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
							/**
							 * Unreadable arguments are not reconstructed: an empty object beats inventing the original,
							 * and this round trip only pairs the call and returns a sentence saying so.
							 */
							arguments: JSON.stringify(message.toolCall.arguments ?? {}),
						},
					},
				],
				/**
				 * Return what was received unchanged. The device reassembles this turn's assistant message, so
				 * the upstream's reasoning blocks arrive missing, and the Gemini 3 family rejects that with a
				 * 400 (the call's signature lives in this array).
				 *
				 * Only the shape is checked, not the contents. If it is not an array or is unreadable the key
				 * is omitted, which equals a request from before this axis existed and beats sending an
				 * invented value.
				 */
				...reasoningDetailsOf(message.toolCall.providerState),
			};

		return { role: message.role, content: message.content };
	});
}

export function buildProviderRequestBody(
	request: ManagedChatGenerationRequest,
	model: string,
	/**
	 * This model's reasoning capability, as stated by the registry.
	 *
	 * Passed as an argument so the function stays pure (tests inspect the body). Defaults to `null`
	 * because unknown capability should produce no reasoning parameter, which equals a request from
	 * before this axis existed.
	 */
	capability: ModelReasoningDto | null = null,
	/**
	 * This model's continuation shape from the registry (`ManagedModelRoute.continuation`).
	 *
	 * Defaults to `nudge` because that is the shape of an ordinary generation request (the
	 * conversation ends on a user turn), which every upstream accepts each turn. Prefill is used only
	 * for lines confirmed to take it; sending it blindly could make that model's `Continue generating` always fail.
	 * Ordinary generation is unaffected by this value.
	 */
	continuation: ManagedContinuationMode = "nudge",
): Record<string, unknown> {
	/**
	 * Normalization comes before body assembly: passing the requested tier through would send a value
	 * this model lacks, and the failure would arrive only after the user sent the conversation.
	 */
	const effort = resolveUpstreamReasoning(capability, request.reasoningEffort);
	/** This request's continuation shape; `null` for ordinary generation. */
	const shape = request.continuation ? continuation : null;
	/**
	 * Reasoning parameters are dropped for prefill continuation only, and only where upstream rejects
	 * that combination.
	 *
	 * If one must go, keep the prefill: continuation means "resume from the exact cut character", and
	 * dropping the prefill turns the request into a new turn, the very thing the pressed button
	 * promises not to do. Losing one turn of thinking is only a quality cost on the continued text and
	 * reverts next turn.
	 *
	 * Conditioning on upstream is the point: disabling reasoning on every continuation would strip the
	 * user's chosen setting from upstreams without this constraint (Google, OpenAI families).
	 *
	 * The nudge shape keeps reasoning because it has no prefill, so the constraint does not apply (on
	 * 2026-09-23 nine Anthropic lines routed through nudge accepted reasoning-bearing nudge requests
	 * without any 400).
	 */
	const upstreamEffort =
		shape === "prefill" && rejectsPrefillWithReasoning(model) ? null : effort;
	/**
	 * The shape decides how a continuation ends: prefill is sent with trailing whitespace trimmed,
	 * nudge leaves the cut response as is and appends the nudge after it.
	 *
	 * Why prefill whitespace is trimmed: the gateway forwards the value unchanged and Anthropic
	 * rejects a final assistant content ending in whitespace ("final assistant content cannot end with
	 * trailing whitespace"). Cut responses often end mid-sentence on a space, so without trimming that
	 * room's `Continue generating` would always fail.
	 *
	 * Only this request's copy is trimmed; the stored text stays on the device, and continued text is
	 * appended to the stored original (`extendAssistantRecord`), so the trimmed space is not lost. The
	 * rule lives once in `@rowcat/chat`, shared with both BYO adapters.
	 */
	const messages =
		shape === null
			? request.messages
			: CONTINUATION_MESSAGES[shape](request.messages);
	return {
		model,
		/**
		 * The routing constraint rides on every managed request unconditionally; no model or setting
		 * branch exists that could make the privacy policy false.
		 */
		provider: { ...NO_STORAGE_ROUTING, only: [...DISCLOSED_PROVIDERS] },
		/**
		 * Sticky routing: send a conversation's next turn to the same provider endpoint as the previous
		 * one.
		 *
		 * It pairs with `cache_control` below rather than replacing it; they answer different questions:
		 *
		 * ```text
		 * cache_control   may this prefix be cached
		 * session_id      does the next turn return to the endpoint holding that cache
		 * ```
		 *
		 * Caches live per provider endpoint, so routing to a different endpoint each turn makes hits
		 * accidental, and for roleplay's large stable prefix resent every turn that shows up on the
		 * invoice.
		 *
		 * No cache or mapping is built on the RowCat side: the gateway does the pinning (no hand-written
		 * `provider.order`) and we only supply one stable conversation key.
		 *
		 * The value is a device-issued opaque random value, not a room, story or member id; the contract
		 * narrows its shape (`RoutingSessionId`). When absent the key is omitted, because sending `null`
		 * would change the body for clients that do not know this axis.
		 */
		...(request.routingSessionId
			? { session_id: request.routingSessionId }
			: {}),
		...(usesExplicitPromptCaching(model)
			? { cache_control: { type: "ephemeral" } }
			: {}),
		messages: [
			{ role: "system", content: request.system },
			...toOpenAiMessages(messages),
		],
		/**
		 * No tools declared means no key at all, the same rule as `reasoningEffort: null`: clients
		 * unaware of this axis get a body byte-identical to before the feature, and their streams carry
		 * no `tool_call` frame.
		 *
		 * `parallel_tool_calls: false` is the paired half. The contract allows one call per stream, so we
		 * first ask upstream not to send parallel calls, and the translation side handles the case where
		 * two arrive anyway. Not asking would make that case the normal path.
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
		/**
		 * Omitted when absent. `null` or a default is not sent because upstreams that do not support this
		 * axis answer unknown keys with a 400, and above all the body for models without selectable
		 * reasoning must stay byte-identical to before this feature.
		 */
		...(upstreamEffort === null
			? {}
			: { reasoning: { effort: REASONING_EFFORT_PARAM[upstreamEffort] } }),
		stream: true,
		// Request usage on the last chunk; it is the only authoritative token count.
		stream_options: { include_usage: true },
	};
}

/**
 * Reads provider SSE line by line.
 *
 * Chunk boundaries and event boundaries are unrelated, as with the client-side NDJSON reader, so
 * parsing runs only on complete lines. `[DONE]` is the OpenAI-compatible gateway's end marker and
 * not JSON.
 */
async function* readProviderSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<ProviderChunk> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const consume = function* (line: string): Generator<ProviderChunk> {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) return;
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === "[DONE]") return;
		try {
			yield JSON.parse(payload) as ProviderChunk;
		} catch {
			/**
			 * Broken lines from the provider are skipped. The policy differs from the client-side parser
			 * because trust differs: frames our own server emits are ours, so a broken one is a bug, while
			 * keepalive and comment lines from the gateway are outside our control, and throwing would cut a
			 * healthy generation for someone else's reasons.
			 */
		}
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				yield* consume(line);
			}
		}
		buffer += decoder.decode();
		yield* consume(buffer);
	} finally {
		// Release the upstream socket even when we cut first (client disconnect); otherwise the model
		// keeps generating and we pay for the tokens.
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

/**
 * Wall-clock cap for a managed stream; the route applies it via `AbortSignal.timeout`.
 *
 * Managed generation runs on the operator's key and is not metered, so time is what bounds a never-
 * ending stream. A normal long generation (8,192 tokens) always finishes inside it. An over-limit
 * stream closes the same way as a client abort.
 */
export const MANAGED_GENERATION_WALL_CLOCK_MS = 14 * 60 * 1000;

/**
 * Starts generation, up to the part that can fail before response headers go out.
 *
 * The two-phase split is the point. Provider misconfiguration, auth failure and upstream 4xx/5xx
 * show up before we send 200, so they must use the shared error envelope (JSON), which requires the
 * route to know before opening the stream. Hence the fetch is awaited here and only body iteration
 * is returned as a generator.
 *
 * Failures after the stream starts cannot use the envelope (200 and headers are already out) and
 * are reported as an `error` event inside the frame.
 */
export async function startChatGeneration(
	request: ManagedChatGenerationRequest,
	signal: AbortSignal,
): Promise<AsyncGenerator<ChatStreamEvent>> {
	if (!chatProviderEnabled)
		throw new ApiError(
			503,
			CHAT_ERROR_CODE.providerUnconfigured,
			"Conversation generation isn't configured.",
		);

	/**
	 * The server re-resolves the chosen model: the browser sends only a public identity, and the
	 * upstream slug comes only from this allowlist.
	 *
	 * A failure stays a failure with no fallback to the default model; substituting would make the
	 * user believe they got the model they picked, and the difference would only surface as a strange
	 * conversation.
	 */
	const route = resolveManagedModel(request.model);
	if (!route)
		throw new ApiError(
			400,
			CHAT_ERROR_CODE.managedModelUnavailable,
			"The selected model isn't available.",
		);

	const model = route.upstream;
	const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
		method: "POST",
		signal,
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			...openRouterAttributionHeaders,
		},
		body: JSON.stringify(
			buildProviderRequestBody(
				request,
				model,
				route.reasoning,
				route.continuation,
			),
		),
	}).catch((error: unknown) => {
		// Network-level failure. A user abort never reaches here (the route filters it).
		logProviderFailure(
			"fetch",
			error instanceof Error ? error.name : "unknown",
		);
		throw new ApiError(
			502,
			CHAT_ERROR_CODE.providerFailed,
			"Couldn't reach the generation provider.",
		);
	});

	if (!response.ok || !response.body) {
		/**
		 * The upstream body is not passed to the user: gateway errors can mix in account, key and routing
		 * info that is internal to our infrastructure. Logs keep the status code only, since the body
		 * sometimes echoes the prompt.
		 */
		logProviderFailure(
			"http",
			providerFailureDetail({
				model,
				status: response.status,
				continuation: request.continuation,
				reasoning: request.reasoningEffort !== null,
			}),
		);
		throw new ApiError(
			502,
			CHAT_ERROR_CODE.providerFailed,
			"Generation failed.",
		);
	}

	return translateProviderStream(response.body, request.model, model);
}

/**
 * Provider chunk → RowCat event.
 *
 * Translation is selection: only content deltas, usage and finish reason pass; reasoning tokens,
 * routing metadata and cost are dropped. Cost never leaves because it reflects our rate contract,
 * and `cache_discount` (which accompanies cached usage) is dropped for the same reason: it is a
 * contract between us and the gateway, not a fact of this conversation. Only three token counts go
 * out (total input, cache read, cache write).
 *
 * Model identity is selected too. The upstream-reported `model` (a routing value like
 * `anthropic/claude-sonnet-5`) was once passed through, leaking the upstream slug through one usage
 * frame. What goes out is the user-chosen public identity; where the gateway actually routed stays
 * in server logs only.
 */
/** One tool call arriving in fragments; arguments are still a string and the name may be empty. */
interface PendingToolCall {
	index: number;
	id: string;
	name: string;
	args: string;
}

/**
 * Selects the reasoning blocks to return: only those we cannot open.
 *
 * This one line is the whole narrowing. Upstream reasoning arrives in two shapes; passing human-
 * readable text or summaries (`reasoning.text`, `reasoning.summary`) would send that prose to the
 * device and into the next request, breaking this repository's rule that thinking content is stored
 * nowhere, on the managed path only. Encrypted blocks are just bytes to us, and that is where
 * Gemini's signature lives.
 *
 * So loosening this filter changes the storage rule.
 */
const ENCRYPTED_REASONING_TYPE = "reasoning.encrypted";

/**
 * Collected fragments → the call the contract accepts, or `null`.
 *
 * The argument string comes from upstream and may not be JSON (truncated stream, shaky constrained
 * decoding). The call is usually fine, so it is sent with the arguments marked "unreadable"; the
 * two-attempt rule lives in one place (`readChatToolCall`). `null` remains only when the id or name
 * falls outside the vocabulary, since then no pairing can be returned and the round trip cannot
 * hold.
 */
function parseToolCall(
	pending: PendingToolCall,
	/**
	 * Encrypted reasoning blocks from this response. Empty means the field is absent, the same frame
	 * as before this axis; those models do not require it.
	 */
	reasoning: readonly unknown[],
): ChatToolCall | null {
	let args: unknown;
	try {
		args = pending.args.trim() ? JSON.parse(pending.args) : {};
	} catch {
		/**
		 * Do not end the turn here. Hitting the output cap leaves the argument JSON cut in half, which is
		 * common rather than an accident. `null` means "unreadable", and the call still reaches the
		 * device's ruling and gets a sentence back.
		 */
		args = null;
	}
	/**
	 * Not sent over the cap: truncating would yield broken bytes instead of the return state, upstream
	 * would give the same 400, and nothing would show what went wrong.
	 */
	const state = reasoning.length > 0 ? JSON.stringify(reasoning) : "";
	/**
	 * Log when dropping. Without this line the next round trip's 400 looks like an unexplained
	 * provider failure that only appears on responses with unusually long reasoning blocks and never
	 * reproduces.
	 */
	if (state.length > CHAT_MAX_TOOL_PROVIDER_STATE_CHARS)
		logProviderFailure(
			"tool",
			`reasoning state too large chars=${state.length}`,
		);
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
 * Upstream SSE → our frames. Exported for one reason: testing.
 *
 * It is the third function exported for that reason (with `resolveUpstreamReasoning` and
 * `buildProviderRequestBody`). The rule that drops parallel calls can only be locked by value here;
 * reaching it otherwise means running all of `startChatGeneration`, and then these few lines are
 * not what is actually checked.
 *
 * The caller is still just one (`startChatGeneration`); do not build a second stream path under
 * this name.
 */
export async function* translateProviderStream(
	body: ReadableStream<Uint8Array>,
	/** The managed identity the user chose; the only model name carried on the usage frame. */
	publicModel: string,
	/** Upstream slug; used for logging only. */
	upstreamModel: string,
): AsyncGenerator<ChatStreamEvent> {
	let usage: Extract<ChatStreamEvent, { type: "usage" }> | null = null;
	let finishReason: string | undefined;
	/**
	 * Slot collecting the one call that arrives in fragments; emitted once at the end with complete
	 * arguments.
	 */
	let pending: PendingToolCall | null = null;
	/**
	 * Encrypted reasoning blocks from this response, collected in arrival order.
	 *
	 * Order is the rule because upstream requires the original order; sorting or merging would make
	 * the array something the model never produced, and the request would be rejected.
	 */
	const reasoning: unknown[] = [];

	for await (const chunk of readProviderSse(body)) {
		const choice = chunk.choices?.[0];
		const text = choice?.delta?.content;
		// Empty-string deltas only add frames (the provider sends them to declare the role).
		if (typeof text === "string" && text) yield { type: "delta", text };
		for (const detail of choice?.delta?.reasoning_details ?? [])
			if (detail?.type === ENCRYPTED_REASONING_TYPE) reasoning.push(detail);
		for (const part of choice?.delta?.tool_calls ?? []) {
			const index = part.index ?? 0;
			if (pending && pending.index !== index) {
				/**
				 * Parallel call. The contract allows one per stream, so keep the first and drop the rest.
				 *
				 * This was once an error, on the premise that dropping leaves a call without an answer and
				 * makes the conversation's next request a 400. That premise does not hold here: the next
				 * request's assistant turn is built on the device (`nextChatToolRequest`) and carries only the
				 * chosen call, so the dropped one is never seen upstream again and an unpaired call is not
				 * representable.
				 *
				 * Erroring was far more expensive: the turn would die after body text already streamed, leaving
				 * a response stopped mid-sentence. Since `parallel_tool_calls: false` is sent, this branch is
				 * insurance for a day the gateway fails to uphold that request upstream, and insurance should
				 * not kill the turn.
				 */
				logProviderFailure("tool", `parallel index=${index}`);
				continue;
			}
			/**
			 * The first fragment creates the slot and later fragments fill it.
			 *
			 * Name and id appear only on the first fragment, so empty values do not overwrite them, while
			 * arguments are appended. Not creating a new object each time is deliberate: rebuilding by
			 * accumulation would put three reads of the previous value in the code and hide that all three
			 * must see the same one.
			 */
			pending ??= { index, id: "", name: "", args: "" };
			if (part.id) pending.id = part.id;
			if (part.function?.name) pending.name = part.function.name;
			pending.args += part.function?.arguments ?? "";
		}
		if (choice?.finish_reason) finishReason = choice.finish_reason;
		if (chunk.usage) {
			/**
			 * `prompt_tokens` is total input including cache (OpenAI-compatible counting), so it goes to
			 * `inputTokens` as is without subtracting cache reads; subtracting would make the same name mean
			 * "billable tokens" on this path only.
			 *
			 * Cache breakdown is carried only when the gateway reported it: writing 0 when absent would
			 * conflate "nothing hit the cache" with "unknown".
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
				/**
				 * Always the public identity; the gateway routing to another upstream is internal telemetry,
				 * not this conversation's model name.
				 */
				model: publicModel,
			};
			if (chunk.model && chunk.model !== upstreamModel)
				logProviderFailure(
					"route",
					`requested=${upstreamModel} answered=${chunk.model}`,
				);
		}
	}

	/**
	 * The call goes before usage. It is not a terminal frame, so order seems free, but the turn's
	 * character must be settled by the time the client receives `usage`; emitting it later would let
	 * the client decide to save from the body alone before the call arrives.
	 *
	 * The contract judges the arguments (`ChatToolCall`); no hand-written shape check here, because a
	 * copy would let different paths accept different values.
	 *
	 * That rejection does not end the turn, though: nested objects and truncated JSON only make the
	 * arguments "unreadable", and the call still round-trips and gets a sentence back
	 * (`readChatToolCall`). An error ends the turn only when no pairing can be returned, i.e. the id
	 * or name falls outside the vocabulary.
	 */
	if (pending) {
		const parsed = parseToolCall(pending, reasoning);
		if (!parsed) {
			logProviderFailure("tool", `unusable name=${pending.name.slice(0, 40)}`);
			yield {
				type: "error",
				code: CHAT_ERROR_CODE.providerFailed,
				message: "Couldn't process the tool call.",
			};
			return;
		}
		yield { type: "tool_call", call: parsed };
	}

	/**
	 * Usage goes before `done`: the client saves the message on `done`, so the reverse order would
	 * deliver usage after the save and it would never attach to that message.
	 */
	if (usage) yield usage;
	yield {
		type: "done",
		...(finishReason !== undefined ? { finishReason } : {}),
	};
}
