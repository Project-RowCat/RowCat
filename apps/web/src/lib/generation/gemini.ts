import {
	CONTINUATION_FALLBACK_NUDGE,
	chatToolJsonSchema,
	readChatToolCall,
	trimContinuationPrefill,
} from "@rowcat/chat";
import type {
	ChatGenerationMessage,
	ChatGenerationMode,
	ChatStreamEvent,
	ChatToolCall,
	ChatToolDeclaration,
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
 * Direct Google Gemini adapter. It has the same contract as the Anthropic adapter, with a different
 * mapping.
 *
 * The two files sitting side by side are the quality test of this slice. Adding a provider should
 * take one file, one catalog line and one settings connection row. Conversation lifecycle, room
 * settings, storage and the sync protocol must not change.
 *
 * The official SDK is not used, for the same reason as in anthropic.ts. This needs one endpoint and
 * four fields.
 *
 * Caching uses Google's implicit cache. The cachedContents lifecycle (creating cache objects,
 * storing names, managing TTL, deleting them) is deliberately not built. It brings expiry, orphaned
 * caches and per-device cache ids, which the product does not need. The adapter still sends only
 * systemInstruction, contents and generationConfig, and no network request happens before
 * generation. Implicit caching needs a stable prefix, which the prompt assembler already keeps.
 *
 * Context order is not changed to improve cache hits. The current order (safety, lore, rules,
 * memory, trailing guard) carries product and safety meaning, and that outranks cache hit rate.
 *
 * The key is not put in the URL. The API also accepts ?key=, but query strings end up in browser
 * history, referrers, proxy logs and server access logs, some outside our control. The header
 * x-goog-api-key avoids that path. The preflight accepting this header was confirmed against a real
 * response on 2026-08-19.
 */

const API_ORIGIN = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";

const headersFor = (secret: string): HeadersInit => ({
	"content-type": "application/json",
	"x-goog-api-key": secret,
});

const roleOf = (role: ChatGenerationMessage["role"]): "user" | "model" =>
	/**
	 * Tool results are sent as `user`. This API has no tool role. Results are parts inside a user
	 * turn, so this one-line ternary absorbs that fact. It looks quiet, but it matters. The place that
	 * builds the part is split by partsOf. If the role is right but the part is text, the request
	 * becomes an unpaired call and returns 400.
	 */
	role === "assistant" ? "model" : "user";

type GeminiPart =
	| { text: string }
	| {
			functionCall: {
				name: string;
				/**
				 * Arguments that could not be read never reach this type. partsOf substitutes an empty object.
				 */
				args: NonNullable<ChatToolCall["arguments"]>;
			};
			/**
			 * The signature this provider attaches to a call. It is a sibling of the part, not inside the
			 * call. We do not create it and do not read it. It is returned unchanged, and that is the
			 * condition for the API to accept its own calls again.
			 */
			thoughtSignature?: string;
	  }
	| { functionResponse: { name: string; response: { result: string } } };

/**
 * This provider gives calls no identifier, so the function name is the matching key. The stream
 * carries the name as the call id unchanged, and when a result is sent back, callId is used again
 * as the name. The contract's narrowing of that opaque value is what makes this round trip work
 * (see the 'the adapter creates it and strips it again' note in the ChatToolCallId header). No
 * identifier from another provider reaches here. Tool round trips finish inside one turn and are
 * not stored in the conversation, so every request in a loop goes through the same adapter.
 */
function partsOf(message: ChatGenerationMessage): GeminiPart[] {
	if (message.role === "tool")
		return [
			{
				functionResponse: {
					name: message.callId,
					/**
					 * The result is wrapped in an object because this API requires one. The key name belongs to
					 * this adapter; the model reads only the sentence inside. The tool layer has already put the
					 * finished text, including the boundary sentence, into content.
					 */
					response: { result: message.content },
				},
			},
		];

	if (message.role === "assistant" && message.toolCall)
		return [
			...(message.content ? [{ text: message.content }] : []),
			{
				functionCall: {
					name: message.toolCall.name,
					/**
					 * Arguments that cannot be restored are not reconstructed. An empty object is better than
					 * inventing the original. The round trip only has to pair the calls and return the one
					 * sentence that explains the failure (chatToolFailureText).
					 */
					args: message.toolCall.arguments ?? {},
				},
				/**
				 * Warning: without the signature this request returns 400. Gemini 3 requires the thought
				 * signature it attached to the turn's first functionCall to come back unchanged. Lowering or
				 * disabling thinking does not exempt it (Google's 'Thought signatures' docs, checked
				 * 2026-09-13). The failure arrives after the body has already streamed. When there is no
				 * signature the key is absent. 2.5 models do not require the value, so their requests keep the
				 * shape they had before this field existed. An invented value would be a wrong signature and
				 * would cause the same 400.
				 */
				...(message.toolCall.providerState
					? { thoughtSignature: message.toolCall.providerState }
					: {}),
			},
		];

	return [{ text: message.content }];
}

/**
 * Messages become `contents`. Consecutive turns with the same role are merged, as on the Anthropic
 * side. When the user speaks again after an unanswered user turn, the same role arrives twice in a
 * row. Gemini usually accepts that, but the docs do not guarantee how the two utterances are
 * handled. Merging makes it visible in code that both providers see the same conversation.
 */
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function toGeminiContents(
	messages: readonly ChatGenerationMessage[],
): GeminiContent[] {
	const folded: GeminiContent[] = [];
	for (const message of messages) {
		const role = roleOf(message.role);
		const parts = partsOf(message);
		const last = folded.at(-1);
		if (!last || last.role !== role) {
			folded.push({ role, parts });
			continue;
		}
		/**
		 * Only text parts are concatenated. This keeps results for conversations without tools
		 * byte-identical to before this feature. Boundaries next to call or result parts stay separate.
		 * Joining two parts into one string would erase the call inside.
		 */
		const tail = last.parts.at(-1);
		const head = parts[0];
		if (tail && "text" in tail && head && "text" in head) {
			tail.text = `${tail.text}\n\n${head.text}`;
			last.parts.push(...parts.slice(1));
			continue;
		}
		last.parts.push(...parts);
	}
	return folded;
}

/**
 * Continuation contents. This provider accepts a conversation ending in a `model` turn, so unlike
 * Anthropic prefill there is no reason to drop thinking. (That constraint belongs to Anthropic's
 * API. Its 4.6+ models do not accept prefill at all and use a nudge instead; see
 * ANTHROPIC_CONTINUATION in anthropic.ts.) Only two things happen here, both driven by our data:
 * - Trailing whitespace: a cut response usually stops mid-sentence, so the last character is
 *   often a space. This API does not reject it, but adapters that send a prefill must send the same
 *   prefill, so that switching providers does not change the continuation.
 * - Missing prefill: when the request does not end in a model turn (the conversation moved on in
 *   between), a nudge is added. The assembler adds none, so without it the model would not know
 *   what it is being asked to do.
 */
function toGeminiContinuationContents(
	messages: readonly ChatGenerationMessage[],
): GeminiContent[] {
	const folded = toGeminiContents(messages);
	const last = folded.at(-1);
	/**
	 * An array ending in a non-text part is not a prefill. Continuations and tool round trips never
	 * share a request (the next round trip turns continuation off). Silently assuming that would let a
	 * non-prefill array go out as one on the day a caller is off by one line, so the check is
	 * explicit.
	 */
	const first = last?.parts[0];
	const part = first && "text" in first ? first : undefined;
	const trimmed = part ? trimContinuationPrefill(part.text) : "";
	if (!last || last.role !== "model" || !part || !trimmed) {
		if (last && last.role === "model" && !trimmed) folded.pop();
		folded.push({
			role: "user",
			parts: [{ text: CONTINUATION_FALLBACK_NUDGE }],
		});
		return folded;
	}
	part.text = trimmed;
	return folded;
}

/**
 * Maps the reasoning level to this model's thinking parameter, in the same place and for the same
 * reason as the Anthropic adapter. Once, a single thinking-budget table sent thinkingBudget to
 * every Gemini model. That assumption is broken: each generation has its own reasoning API. 3.x
 * uses thinkingLevel (minimal, low, medium, high, with the set of levels varying per model). 2.5
 * uses thinkingBudget as a token count with a per-model range and lower bound. For 3.x a budget is
 * accepted for backward compatibility, but the docs say to move to thinkingLevel, and sending both
 * in one request returns 400. The discriminated union keeps one per request. One table holding both
 * would let that combination be built. The difference that really bites is minimal.
 * gemini-3.8-flash, gemini-3.7-flash and gemini-3.1-pro-preview have no such level. In 2.5, budget
 * 0 is the off position, but some models accept 0 and others reject it because of a lower bound. An
 * unknown model sends nothing, since saved preferences outlive the catalog. Checked against
 * Google's official docs on 2026-08-29 (the per-model level table and 2.5 budget ranges in the
 * thinking docs, and the thinking_level / thinking_budget exclusivity rule in the Gemini 3 docs).
 */
type GeminiReasoningMode =
	/** 3.x: the level name is sent as-is. Four of our effort levels share names with theirs. */
	| {
			kind: "thinking-level";
			levels: Partial<Record<ReasoningEffortDto, string>>;
	  }
	/** 2.5: a token budget. The range, and whether thinking can be turned off, differ per model. */
	| {
			kind: "thinking-budget";
			budgets: Partial<Record<ReasoningEffortDto, number>>;
	  }
	| { kind: "none" };

/** The 3.x model set with all four levels. This is the only place where `minimal` really exists. */
const LEVELS_WITH_MINIMAL: Partial<Record<ReasoningEffortDto, string>> = {
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
};

/** 3.x models without `minimal` (3.7 Flash and 3.1 Pro). That level silently drops out here. */
const LEVELS_THREE: Partial<Record<ReasoningEffortDto, string>> = {
	low: "low",
	medium: "medium",
	high: "high",
};

/**
 * 2.5 Flash. Budget 0 is the value that turns thinking off, so `minimal` has meaning here (range 0
 * to 24,576). On this provider 0 is valid only in this place. Sending 0 to a model with a lower
 * bound (2.5 Pro: 128, 2.5 Flash-Lite: 512) is out of range.
 */
const BUDGETS_WITH_ZERO: Partial<Record<ReasoningEffortDto, number>> = {
	minimal: 0,
	low: 1_024,
	medium: 4_096,
	high: 16_384,
};

/**
 * 2.5 Pro. Range 128 to 32,768, and thinking cannot be turned off. That is why `minimal` is absent.
 */
const BUDGETS_THREE: Partial<Record<ReasoningEffortDto, number>> = {
	low: 1_024,
	medium: 4_096,
	high: 16_384,
};

const LEVEL_ALL: GeminiReasoningMode = {
	kind: "thinking-level",
	levels: LEVELS_WITH_MINIMAL,
};
const LEVEL_THREE: GeminiReasoningMode = {
	kind: "thinking-level",
	levels: LEVELS_THREE,
};

/**
 * Maps model to reasoning mode. Uses the same names as the Gemini list in the catalog.
 * gemini-2.5-flash-lite is intentionally absent. Its thinking is off by default and its budget
 * lower bound is 512, so there is no way to express the off value. Listing it would make a user who
 * picked nothing inherit a Standard level that turns thinking on for that model, with no entry in
 * the list to revert it. The catalog marks it `reasoning: null` for the same reason.
 */
const GEMINI_REASONING: Readonly<Record<string, GeminiReasoningMode>> = {
	"gemini-3.8-flash": LEVEL_THREE,
	"gemini-3.7-flash": LEVEL_THREE,
	"gemini-3.6-flash": LEVEL_ALL,
	"gemini-3.5-flash": LEVEL_ALL,
	"gemini-3.5-flash-lite": LEVEL_ALL,
	"gemini-3.1-pro-preview": LEVEL_THREE,
	"gemini-3.1-flash-lite": LEVEL_ALL,
	"gemini-3-flash-preview": LEVEL_ALL,
	"gemini-2.5-pro": { kind: "thinking-budget", budgets: BUDGETS_THREE },
	"gemini-2.5-flash": { kind: "thinking-budget", budgets: BUDGETS_WITH_ZERO },
};

/**
 * The thinking config for this request. Only one axis goes in; if neither applies, the key is
 * absent. Sending both axes makes this provider return 400. The discriminated union above makes
 * that combination impossible to build, and this function only chooses one. includeThoughts is not
 * turned on. Requested thought summaries would arrive as text parts, and the model's reasoning
 * would stream into the speech bubble. This axis decides how much to think, not whether to show it.
 */
interface GeminiThinking {
	config?: Record<string, unknown>;
	/**
	 * Thinking budget, which exists only for 2.5. 3.x levels have no number we know; the model decides
	 * per request. Adding an invented number to the output cap would raise it by an amount the user
	 * did not choose, and those tokens are billed to the user's provider account.
	 */
	budget?: number;
}

function geminiThinkingFor(
	model: string,
	effort: ReasoningEffortDto | null,
): GeminiThinking {
	if (effort === null) return {};
	const mode = GEMINI_REASONING[model];
	if (mode === undefined || mode.kind === "none") return {};

	if (mode.kind === "thinking-level") {
		const level = mode.levels[effort];
		return level === undefined ? {} : { config: { thinkingLevel: level } };
	}

	const budget = mode.budgets[effort];
	return budget === undefined
		? {}
		: { config: { thinkingBudget: budget }, budget };
}

/**
 * In budget mode only, the output cap is raised by the budget. Thinking tokens count against
 * maxOutputTokens here. Without this, a short room (768) with standard thinking (budget 4,096) can
 * use up the whole cap, end with MAX_TOKENS and show an empty reply, with no reason on screen.
 * Level mode (3.x) gets no such increase. There is no known number to add, and extra tokens would
 * be billed to the user. On 3.x, thinking can grow to about 96% of the cap on its own, so no added
 * number guarantees room for the body. The user has to lower reasoning or raise the length. This
 * was observed in googleapis/python-genai#2062 and is not in the official docs. A budget of 0 is
 * not the same as undefined. 0 is the user's choice to turn thinking off, so there is nothing to
 * add.
 */
const maxOutputTokensFor = (
	maxOutputTokens: number,
	budget: number | undefined,
): number =>
	budget === undefined ? maxOutputTokens : maxOutputTokens + budget;

/**
 * Schema dialect for this provider, for each declaration. The JSON Schema paths use a standard that
 * @rowcat/chat builds once.
 * Uppercase types are this provider's own, not a standard, so they stay here. Moving them to the
 * shared layer would make the pure package know this provider's vocabulary.
 */
const GEMINI_TYPE = {
	string: "STRING",
	number: "NUMBER",
	boolean: "BOOLEAN",
} as const;

function toGeminiSchema(
	declaration: ChatToolDeclaration,
): Record<string, unknown> {
	const schema = chatToolJsonSchema(declaration);
	const properties: Record<string, unknown> = {};
	for (const [name, property] of Object.entries(schema.properties))
		properties[name] = {
			type: GEMINI_TYPE[property.type],
			...(property.description ? { description: property.description } : {}),
			...(property.enum ? { enum: property.enum } : {}),
		};
	/**
	 * additionalProperties is not sent. This API's schema vocabulary does not have it, and an unknown
	 * key returns 400. Rejecting unexpected arguments is done later by the tool layer.
	 */
	return { type: "OBJECT", properties, required: schema.required };
}

/**
 * Temporary, development-only diagnostic that logs which branch a turn ended on, in one line.
 * Delete this block and its two call sites once the cause is found. Leaving them keeps non-product
 * code in this file, where the next reader would take it as part of the contract. The one line
 * tells apart: no line at all (stale bundle), threshold BLOCK_ONLY_HIGH (all-ages setting),
 * status=400 (model rejects OFF), finish=SAFETY (account policy), or status=200 with finish=STOP
 * and text>0 (the model refused the prompt). Only static values and closed provider enums may be
 * logged, never prompt, body, key or model text. Logs are permanent copies, so a leak cannot be
 * undone. logAuthFailure states the same rule. Production builds fold this call away through
 * import.meta.env.DEV.
 */
function logGeminiSafetyDiagnostic(diagnostic: {
	model: string;
	mode: ChatGenerationMode;
	/**
	 * The threshold actually sent. All four categories use the same value, so only one is recorded.
	 */
	threshold: string;
	status?: number;
	/**
	 * The provider's closed enum for the finish reason (STOP, SAFETY, MAX_TOKENS and so on), not a
	 * sentence.
	 */
	finish?: string;
	/** The prompt-side block reason, if any. Same kind of value as the finish reason. */
	blocked?: string;
	/** Number of body pieces that arrived. Content is never recorded. */
	text?: number;
}): void {
	if (!import.meta.env.DEV) return;
	const parts = [
		`model=${diagnostic.model}`,
		`mode=${diagnostic.mode}`,
		`threshold=${diagnostic.threshold}`,
		diagnostic.status === undefined ? "" : `status=${diagnostic.status}`,
		diagnostic.finish === undefined ? "" : `finish=${diagnostic.finish}`,
		diagnostic.blocked === undefined ? "" : `blocked=${diagnostic.blocked}`,
		diagnostic.text === undefined ? "" : `text=${diagnostic.text}`,
	].filter(Boolean);
	console.warn(`[generation:diag] gemini ${parts.join(" ")}`);
}

/**
 * The four categories this adapter adjusts. HARM_CATEGORY_CIVIC_INTEGRITY is deliberately omitted.
 * It was removed in the latest generation, and sending it makes only those models return 400. The
 * symptom would be that only people who picked those models cannot generate at all.
 */
const SAFETY_CATEGORIES = [
	"HARM_CATEGORY_HARASSMENT",
	"HARM_CATEGORY_HATE_SPEECH",
	"HARM_CATEGORY_SEXUALLY_EXPLICIT",
	"HARM_CATEGORY_DANGEROUS_CONTENT",
] as const;

/**
 * Sets the provider's filter threshold per turn. Earlier this adapter sent no safetySettings, which
 * blocked content our guards explicitly allow (combat in the all-ages guard, direct depiction in
 * the adult guard). All-ages uses BLOCK_ONLY_HIGH. The guard already bans sexual description at
 * both ends, and BYO requests have no server re-check, so keeping the last filter net costs
 * nothing. Adult uses OFF. Our guards are the ceiling, and the provider should not re-judge what
 * they allowed. OFF does not allow everything. Core prohibitions stay on the provider side and the
 * account's terms still apply, so a content_blocked response can still occur. This table is a
 * provider dialect kept in this file. It must be edited together with the mobile copy of the file,
 * or content is blocked in one app only.
 */
const safetySettingsFor = (mode: ChatGenerationMode) =>
	SAFETY_CATEGORIES.map((category) => ({
		category,
		threshold: mode === "adult" ? "OFF" : "BLOCK_ONLY_HIGH",
	}));

/**
 * Finish reasons and prompt block reasons share one vocabulary (SAFETY, PROHIBITED_CONTENT,
 * BLOCKLIST, SPII). A list is used rather than !== 'STOP', because that would also catch
 * MAX_TOKENS. A truncated response would be reported as blocked and show `Change the scene` where `Continue generating`
 * belongs.
 */
const BLOCKED_REASONS: ReadonlySet<string> = new Set([
	"SAFETY",
	"PROHIBITED_CONTENT",
	"BLOCKLIST",
	"SPII",
	"IMAGE_SAFETY",
]);

const isBlockedReason = (reason: string | undefined): boolean =>
	reason !== undefined && BLOCKED_REASONS.has(reason);

interface GeminiChunk {
	candidates?: {
		content?: {
			parts?: {
				text?: string;
				thought?: boolean;
				/**
				 * A tool call. Unlike Anthropic, the arguments arrive as a finished object, so there is nothing
				 * to accumulate. There is no identifier, so the name takes its place.
				 */
				functionCall?: { name?: string; args?: unknown };
				thoughtSignature?: string;
			}[];
		};
		finishReason?: string;
	}[];
	usageMetadata?: {
		/** Total input, including cache. This is the opposite of Anthropic's `input_tokens`. */
		promptTokenCount?: number;
		/**
		 * The part read from the implicit cache. Absent when the cache did not apply, so 0 is not written
		 * then.
		 */
		cachedContentTokenCount?: number;
		candidatesTokenCount?: number;
	};
	modelVersion?: string;
	promptFeedback?: { blockReason?: string };
}

async function* stream(
	input: ByoTransportInput,
): AsyncGenerator<ChatStreamEvent> {
	const doFetch = input.fetch ?? globalThis.fetch;
	const { request } = input;

	/**
	 * The model name goes into the path. encodeURIComponent is needed because the value, though it
	 * comes from the catalog, is ultimately a string from saved preferences. A corrupted row must not
	 * be able to create a request that leaves the path.
	 */
	const url = `${API_ORIGIN}/${API_VERSION}/models/${encodeURIComponent(
		input.model,
	)}:streamGenerateContent?alt=sse`;

	/**
	 * The request arrives already past the capability check (reasoningEffortForRequest). Even so, a
	 * model or level missing from this table is dropped silently here. When the two disagree, running
	 * without reasoning is better than sending a parameter the model rejects.
	 */
	const thinking = geminiThinkingFor(input.model, request.reasoningEffort);

	/**
	 * The axes that can identify this request. The prompt and key are not included (see errors.ts).
	 * Thinking is not dropped on continuations. That constraint belongs to the Anthropic API. This
	 * provider accepts a conversation ending in a model turn as-is. Keeping provider constraints
	 * inside the provider boundary makes such differences explicit values.
	 */
	const diagnostics = {
		provider: "gemini-byo",
		model: input.model,
		continuation: request.continuation,
		reasoning: thinking.config !== undefined,
	} as const;

	/**
	 * Built once so the diagnostic reads the same value that is sent. If each place called it
	 * separately, one could log something other than what was actually sent, which would be noise
	 * rather than diagnosis.
	 */
	const sentSafety = safetySettingsFor(request.context.requestedMode);

	let response: Response;
	try {
		response = await doFetch(url, {
			method: "POST",
			signal: input.signal,
			headers: headersFor(input.secret),
			body: JSON.stringify({
				/**
				 * The system prompt goes in systemInstruction, not folded into history as the first utterance.
				 * Folding it in would give it the treatment of the history window and make the reason our
				 * assembler keeps system and history apart meaningless.
				 */
				systemInstruction: { parts: [{ text: request.system }] },
				/**
				 * Continuations pass through a different assembler (prefill normalization, plus a nudge when no
				 * prefill exists). The normal generation path is unchanged.
				 */
				contents: request.continuation
					? toGeminiContinuationContents(request.messages)
					: toGeminiContents(request.messages),
				/**
				 * The tools key is absent when no tools were declared. Clients that do not know this axis send
				 * a body byte-identical to before, and the stream carries no tool_call frames. Warning: this
				 * provider has no switch to disable parallel calls. The Anthropic path and the gateway do carry
				 * that setting, but here nothing can block it. The stream below therefore ends in an error when
				 * it meets a second call. That is the only place this adapter enforces the rule.
				 */
				...(request.tools.length > 0
					? {
							tools: [
								{
									functionDeclarations: request.tools.map((tool) => ({
										name: tool.name,
										description: tool.description,
										parameters: toGeminiSchema(tool),
									})),
								},
							],
							toolConfig: { functionCallingConfig: { mode: "AUTO" } },
						}
					: {}),
				generationConfig: {
					maxOutputTokens: maxOutputTokensFor(
						request.maxOutputTokens,
						thinking.budget,
					),
					/**
					 * Absent when there is no config. A model that does not support thinking answers this key with
					 * 400, so the catalog does not assign levels to such models. If those two facts drift apart,
					 * only users who selected that entry find out after generation starts. The axis inside is
					 * chosen by the model (3.x uses thinkingLevel, 2.5 uses thinkingBudget). Both together return
					 * 400, and the function above cannot produce that combination.
					 */
					...(thinking.config === undefined
						? {}
						: { thinkingConfig: thinking.config }),
				},
				/**
				 * The threshold is the only axis here (see safetySettingsFor). The request already carries the
				 * value (context.requestedMode), so this adapter does not check room, member or settings again.
				 * The assembler has already decided. Deciding again would open a gap where the prompt's mode
				 * and the filter's mode disagree.
				 */
				safetySettings: sentSafety,
			}),
		});
	} catch (thrown) {
		const failure = providerErrorForThrown(thrown);
		logProviderFailure({ ...diagnostics, code: failure.code });
		throw failure;
	}

	if (!response.ok || !response.body) {
		// The body is not read, for the same reason as in anthropic.ts. See errors.ts for why vendor
		// bodies are never kept.
		const failure = providerErrorForStatus(
			response.status,
			readRetryAfterSeconds(response.headers),
		);
		logProviderFailure({
			...diagnostics,
			code: failure.code,
			status: response.status,
		});
		logGeminiSafetyDiagnostic({
			model: input.model,
			mode: request.context.requestedMode,
			threshold: sentSafety[0]?.threshold ?? "(none)",
			status: response.status,
		});
		throw failure;
	}

	let model: string | undefined;
	let inputTokens: number | undefined;
	let cachedInputTokens: number | undefined;
	let outputTokens: number | undefined;
	let finishReason: string | undefined;
	let textParts = 0;
	/**
	 * This API has no end event: the stream simply ends. Whether a finish reason was received plays
	 * that role instead. The finishReason on the last chunk is the signal.
	 */
	let finished = false;
	let call: ChatToolCall | null = null;

	for await (const frame of readSse(response.body)) {
		const chunk = parseSseData<GeminiChunk>(frame.data);
		if (!chunk) continue;

		const candidate = chunk.candidates?.[0];
		/**
		 * Thought parts are filtered out. This provider sends thought summaries as ordinary text parts,
		 * marked only by thought: true. Without the filter, the model's reasoning would show in the
		 * speech bubble and be saved as the assistant message. includeThoughts is not enabled, so these
		 * parts do not arrive today. The filter stays because that option is one line in the request
		 * body. If someone enables it, the symptom is reasoning mixed into the conversation, not an
		 * error.
		 */
		for (const part of candidate?.content?.parts ?? []) {
			if (part.functionCall) {
				if (call) {
					/**
					 * The contract allows one call per stream, so the first call is kept and later calls are
					 * dropped. This used to be an error, on the premise that a dropped call would go unanswered
					 * and make the next request 400. That premise does not hold in this repo. The next assistant
					 * turn is rebuilt by us (nextChatToolRequest) and carries only the single call we chose, so a
					 * dropped call is never seen upstream. An error would be worse. It would end the turn after
					 * the body had already streamed, leaving a response cut mid-sentence, and this provider cannot
					 * disable parallel calls to prevent that. If the lookup is still needed, the model calls again
					 * in the next round trip.
					 */
					logProviderFailure({
						...diagnostics,
						code: "provider_error",
						vendorCode: "tool_parallel",
					});
					continue;
				}
				/**
				 * The name is the identifier. This provider gives calls no id and matches results by name, so
				 * the name is carried unchanged. A generated random id would break the round trip in partsOf.
				 * Even when the arguments fall outside the vocabulary, the call is usually fine. It is then
				 * passed as unreadable, the model gets a sentence back, and the turn goes on. Ending the turn
				 * here was the failure this repo actually hit (readChatToolCall).
				 */
				const parsed = readChatToolCall({
					id: part.functionCall.name ?? "",
					name: part.functionCall.name ?? "",
					arguments: part.functionCall.args,
					/**
					 * Passed through exactly as received. The next request's assistant turn is reassembled on the
					 * device, and without this value the provider will not accept its own call again (see the
					 * warning in partsOf).
					 */
					...(part.thoughtSignature
						? { providerState: part.thoughtSignature }
						: {}),
				});
				if (!parsed) {
					const failure = new ProviderError("provider_error");
					logProviderFailure({
						...diagnostics,
						code: failure.code,
						vendorCode: "tool_unusable",
					});
					yield { type: "error", code: failure.code, message: failure.message };
					return;
				}
				call = parsed;
				continue;
			}
			if (part.text && part.thought !== true) {
				textParts += 1;
				yield { type: "delta", text: part.text };
			}
		}

		/**
		 * Blocked before any candidate was produced, which means the prompt side was blocked. This is not
		 * a completion reason, so it arrives here. If this branch were not read, the response would fall
		 * through to the 'stream ended without a finish reason' path and get the same sentence as a
		 * dropped connection.
		 */
		if (isBlockedReason(chunk.promptFeedback?.blockReason)) {
			logGeminiSafetyDiagnostic({
				model: input.model,
				mode: request.context.requestedMode,
				threshold: sentSafety[0]?.threshold ?? "(none)",
				status: 200,
				blocked: chunk.promptFeedback?.blockReason,
				text: textParts,
			});
			const failure = new ProviderError("content_blocked");
			logProviderFailure({
				...diagnostics,
				code: failure.code,
				/*
				 * A fixed vocabulary value, not user content. It is recorded in diagnostics because the reason
				 * is worth keeping.
				 */
				vendorCode: chunk.promptFeedback?.blockReason,
			});
			yield { type: "error", code: failure.code, message: failure.message };
			return;
		}

		if (candidate?.finishReason) {
			finishReason = candidate.finishReason;
			finished = true;
		}

		/**
		 * Cumulative values, so each chunk overwrites the last. The final chunk's values are the final
		 * numbers.
		 */
		if (chunk.usageMetadata) {
			inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
			cachedInputTokens =
				chunk.usageMetadata.cachedContentTokenCount ?? cachedInputTokens;
			outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
		}
		model = chunk.modelVersion ?? model;
	}

	/**
	 * The tool_call is yielded before usage. By the time the client receives usage, the turn's kind
	 * must already be decided. Otherwise the caller would save based on the body alone and the call
	 * would arrive afterward. The decision is complete in the loop above. Calls rejected by the
	 * contract never reach this point.
	 */
	if (call) yield { type: "tool_call", call };

	if (
		model !== undefined ||
		inputTokens !== undefined ||
		outputTokens !== undefined
	)
		yield {
			type: "usage",
			...(model !== undefined ? { model } : {}),
			...(inputTokens !== undefined ? { inputTokens } : {}),
			...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
			...(outputTokens !== undefined ? { outputTokens } : {}),
		};

	/**
	 * If the stream ends without a finish reason, it was cut off. Text may already have streamed, so
	 * this is not thrown. An error event is emitted instead, and the caller saves what it received as
	 * incomplete.
	 */
	/**
	 * Records normal, blocked and truncated streams in one place, so no ending branch can be missed.
	 * Recording each branch separately would let one branch go silent if forgotten, which is exactly
	 * what this diagnostic is meant to reveal.
	 */
	logGeminiSafetyDiagnostic({
		model: input.model,
		mode: request.context.requestedMode,
		threshold: sentSafety[0]?.threshold ?? "(none)",
		status: 200,
		finish: finishReason ?? "(none)",
		text: textParts,
	});

	if (!finished) {
		const failure = new ProviderError("provider_error");
		logProviderFailure({
			...diagnostics,
			code: failure.code,
			vendorCode: "stream_truncated",
		});
		yield { type: "error", code: failure.code, message: failure.message };
		return;
	}

	/**
	 * A response blocked by content policy is not a completion. If it were emitted as done, the caller
	 * would read a normal end with an empty body. The turn would count as having no answer, and the
	 * screen would offer only `Regenerate`, which gets the same answer again. Naming it here lets the
	 * ladder tell the user what they can do. Text already streamed is not taken back. A truncated
	 * response keeps what arrived, marked incomplete (the same rule as stream_truncated above), and
	 * this frame adds the reason after it.
	 */
	if (isBlockedReason(finishReason)) {
		const failure = new ProviderError("content_blocked");
		logProviderFailure({
			...diagnostics,
			code: failure.code,
			vendorCode: finishReason,
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
 * Validates the credential with one model-list request and never starts generation, as in
 * anthropic.ts.
 */
const probe: ByoAdapter["probe"] = async ({
	secret,
	signal,
	fetch: injected,
}): Promise<CredentialCheck> => {
	const doFetch = injected ?? globalThis.fetch;
	try {
		const response = await doFetch(
			`${API_ORIGIN}/${API_VERSION}/models?pageSize=1`,
			{ method: "GET", signal, headers: headersFor(secret) },
		);
		if (response.ok) return { ok: true };
		/**
		 * This API sometimes answers an invalid key with 400 (when the format is wrong entirely). The
		 * status table would fold that into provider_error, which is wrong at verification time. Here the
		 * only action the user can take is to re-enter the key.
		 */
		if (response.status === 400)
			return { ok: false, error: new ProviderError("invalid_credential") };
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

export const geminiAdapter: ByoAdapter = { stream, probe };
