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
import type { ByoAdapter, ByoTransportInput, CredentialCheck } from "./byo.ts";
import {
	ProviderError,
	providerErrorForStatus,
	providerErrorForThrown,
	readRetryAfterSeconds,
} from "./errors.ts";
import { parseSseData, readSse } from "./sse.ts";

/**
 * Direct Google Gemini adapter — **same contract as the Anthropic adapter, different mapping**.
 *
 * Having the two files side by side is this slice's quality test. Adding one more provider should
 * take this one file, one row in the router's table and one connection line on the settings screen.
 * Conversation lifecycle, room settings, storage and the sync protocol must not change by a single
 * character.
 *
 * ## Caching is the provider's implicit cache
 *
 * This file does not manage the `cachedContents` lifecycle (creating, naming, TTL, deleting). The
 * adapter sends only `systemInstruction`, `contents` and `generationConfig`, and **no network
 * request goes out before generation**. Managing those resources would bring in state the product
 * does not need (expiry, orphaned caches, per-device cache ids).
 *
 * ## The key is never put in the URL
 *
 * The API also accepts a `?key=` query parameter. We do not use it: query strings land in proxy
 * logs, server access logs and diagnostic reports, some of which are outside our control. The
 * header (`x-goog-api-key`) has no such path.
 */

const API_ORIGIN = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";

const headersFor = (secret: string): Record<string, string> => ({
	"content-type": "application/json",
	"x-goog-api-key": secret,
});

/**
 * Our role → Gemini role. The assistant is `model`: the same meaning under another name, so this
 * one line is the whole mapping.
 */
const roleOf = (role: ChatGenerationMessage["role"]): "user" | "model" =>
	/**
	 * **Tool results are `user`.** This API has no tool role, and a result is a part inside a user
	 * turn; this one-line ternary absorbs that fact. It looks quiet, but it is not: the place that
	 * builds the part is split off into `partsOf`. If only the role matches and the part is text, the
	 * request becomes an unpaired call and fails with 400.
	 */
	role === "assistant" ? "model" : "user";

/** The parts this API accepts: text, a call, or a result. A part is exactly one of them. */
type GeminiPart =
	| { text: string }
	| {
			functionCall: {
				name: string;
				/** Unreadable arguments never arrive here; an empty object stands in (`partsOf`). */
				args: NonNullable<ChatToolCall["arguments"]>;
			};
			/**
			 * Signature the provider attached to the call. It is a **sibling of the part**, not inside the
			 * call. We neither create nor read it; we return it as received, which is the condition for this
			 * API to accept its own calls back.
			 */
			thoughtSignature?: string;
	  }
	| { functionResponse: { name: string; response: { result: string } } };

/**
 * One of our messages → **this API's parts**.
 *
 * ⚠️ **This provider gives calls no identifier; the function name is what pairs them.** So the
 * stream below carries the name as the call's `id`, and when a result is sent back the `callId` is
 * used again as the name. The contract keeps that value opaque, which is what makes this round trip
 * work (see the `ChatToolCallId` header: "the adapter creates it, carries it, and strips it
 * again").
 *
 * An identifier from another provider never arrives here: tool round trips finish within one turn
 * and are not stored in the conversation, so every request in one loop goes through the same
 * adapter.
 */
function partsOf(message: ChatGenerationMessage): GeminiPart[] {
	if (message.role === "tool")
		return [
			{
				functionResponse: {
					name: message.callId,
					/**
					 * The result is wrapped in one object because this API requires one. The key name belongs to
					 * this adapter; the model reads the sentence inside, which the tool layer has already
					 * finished, boundary sentence included.
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
					 * **Unreadable arguments are not reconstructed.** An empty object is better than inventing the
					 * original; this round trip only pairs the call and returns one sentence recording that fact
					 * (`chatToolFailureText`).
					 */
					args: message.toolCall.arguments ?? {},
				},
				/**
				 * ⚠️ **Without the signature the request is a 400.** Gemini 3 requires the thought signature it
				 * attached to this turn's first `functionCall` to come back unchanged, and **lowering or
				 * disabling the thinking level does not exempt it** (official docs, "Thought signatures",
				 * 2026-09-13). The failure arrives after the body has already streamed.
				 *
				 * If there is no signature, the key is absent entirely. The 2.5 generation does not require the
				 * value, so its requests keep the shape from before this axis existed. Filling in an invented
				 * value is a **wrong signature**, which triggers the same 400.
				 */
				...(message.toolCall.providerState
					? { thoughtSignature: message.toolCall.providerState }
					: {}),
			},
		];

	return [{ text: message.content }];
}

/**
 * Our messages → `contents`. **Same-role turns are merged, for the same reason as on the Anthropic
 * side.**
 *
 * If the user speaks again after an unanswered user turn, the same role arrives twice in a row.
 * Gemini usually accepts that, but the docs do not guarantee how the two utterances are handled.
 * Merging them here means both providers see the **same conversation**, and that fact is recorded
 * in code.
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
		 * **Only text parts are joined.** That keeps conversations without tools byte-identical to before
		 * this axis existed. A boundary involving a call or result part keeps both parts side by side:
		 * collapsing them into one string would make the call disappear.
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
 * `contents` for a continuation request — **same rule as the web adapter**.
 *
 * This provider accepts a conversation ending in the `model` role, so there is no reason to drop
 * thinking (Anthropic's post-4.6 models reject prefill and use a nudge instead; see
 * `ANTHROPIC_CONTINUATION` in `anthropic.ts`). What happens here is trimming trailing whitespace
 * from the prefill — adapters that send a prefill must send **the same prefill**, so that switching
 * providers does not change the continuation result — and placing a nudge where the array cannot
 * support a prefill.
 */
function toGeminiContinuationContents(
	messages: readonly ChatGenerationMessage[],
): GeminiContent[] {
	const folded = toGeminiContents(messages);
	const last = folded.at(-1);
	/**
	 * **An array ending in a non-text part is not a prefill.** Continuation and tool round trips never
	 * share a request (the next request of a round trip turns `continuation` off), but assuming that
	 * silently means a caller change that breaks it would send a non-prefill array as a prefill.
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
 * Reasoning effort → this **model's** thinking parameter. Same place and same reason as the
 * Anthropic adapter.
 *
 * This slot once held a single thinking-budget table, and every Gemini model received
 * `thinkingConfig.thinkingBudget`. That assumption is broken: this provider also has a different
 * reasoning API per generation:
 *
 * ```text
 * 3.x   thinkingLevel    minimal|low|medium|high — **the levels differ per model**
 * 2.5   thinkingBudget   a token count. the range differs per model, and some have a floor
 * ```
 *
 * On 3.x the budget is accepted for backward compatibility, but the docs say to move to
 * `thinkingLevel`, and above all **sending both in one request is a 400.** So a request carries
 * exactly one, and that fact is expressed as a discriminated union: a single table holding both
 * would allow that combination.
 *
 * Where the levels really differ is `minimal`. `gemini-3.8-flash`, `gemini-3.7-flash` and
 * `gemini-3.1-pro-preview` **lack** that level, and on the 2.5 family a budget of 0 stands in for
 * it, but some models accept 0 while others with a floor reject it.
 *
 * **Unknown models get nothing.** Stored preferences outlive the catalogue.
 *
 * Verified against Google's official docs on 2026-08-29 (gemini-api/docs/generate-content/thinking:
 * the per-model level table and the 2.5 budget ranges; gemini-api/docs/generate-content/gemini-3:
 * the `thinking_level` / `thinking_budget` mutual-exclusion rule).
 */
type GeminiReasoningMode =
	/** 3.x — carries the level name as is. Four of our vocabulary terms overlap with theirs. */
	| {
			kind: "thinking-level";
			levels: Partial<Record<ReasoningEffortDto, string>>;
	  }
	/** 2.5 — token budget. The range and whether thinking can be turned off differ per model. */
	| {
			kind: "thinking-budget";
			budgets: Partial<Record<ReasoningEffortDto, number>>;
	  }
	/** This model has no reasoning parameter we can map. */
	| { kind: "none" };

/** 3.x model with all four levels. `minimal` really exists only here. */
const LEVELS_WITH_MINIMAL: Partial<Record<ReasoningEffortDto, string>> = {
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
};

/** 3.x model without `minimal` (3.7 Flash, 3.1 Pro). That level is silently omitted here. */
const LEVELS_THREE: Partial<Record<ReasoningEffortDto, string>> = {
	low: "low",
	medium: "medium",
	high: "high",
};

/**
 * 2.5 Flash — **a budget of 0 is the value that turns thinking off**, so `minimal` has meaning here
 * (range 0–24,576).
 *
 * This is the only place where 0 is valid for this provider: sending 0 to a model with a floor (2.5
 * Pro's 128, 2.5 Flash-Lite's 512) is out of range.
 */
const BUDGETS_WITH_ZERO: Partial<Record<ReasoningEffortDto, number>> = {
	minimal: 0,
	low: 1_024,
	medium: 4_096,
	high: 16_384,
};

/** 2.5 Pro — range 128–32,768, and thinking **cannot be turned off**, so there is no `minimal`. */
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
 * Model → mode. **Uses the same names as the Gemini list in the catalogue.**
 *
 * `gemini-2.5-flash-lite` is deliberately absent: thinking is off by default there and the budget
 * floor is 512, so **there is no way to express the off value.** If a row were added, a user who
 * chose nothing would inherit `Standard`, which turns that model's thinking on, and there would be no
 * item in the list to revert it. The catalogue sets that item to `reasoning: null` for the same
 * reason.
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
 * Thinking setting for this request. **Only one axis goes in**, and if neither applies the key is
 * absent.
 *
 * Sending both axes together is rejected by this provider with a 400. The union above makes that
 * combination unbuildable; this function only picks one.
 *
 * `includeThoughts` is not enabled. If thought summaries were requested they would arrive as text
 * parts, and the model's reasoning would stream into the speech bubble. This axis decides how much
 * the model thinks, not whether that is shown.
 */
interface GeminiThinking {
	/** Fragment carried in `generationConfig.thinkingConfig`. If there is nothing, the key is absent. */
	config?: Record<string, unknown>;
	/**
	 * Thinking budget — **exists only on the 2.5 family.**
	 *
	 * A 3.x level has no number we know (the model decides for itself on each request). Adding an
	 * invented number to the output cap would raise the cap by an amount the user never chose, and
	 * those tokens are billed to the user's provider account.
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
 * **Raise the output cap by the budget only in budget mode** — same place, same reason as in
 * `anthropic.ts`.
 *
 * On this provider thinking tokens are output tokens and are consumed **within** `maxOutputTokens`.
 * Left alone, the two axes the user picked eat each other: in a room set to `Short` (768), a `Standard`
 * budget (4,096) lets thinking exhaust the cap, so the body never appears and the response ends as
 * `MAX_TOKENS`; and even in a generous room, raising reasoning shrinks the visible response. It is
 * not an error but an empty response, so nothing on screen says why.
 *
 * **The level mode (3.x) does not get this arithmetic.** It has no budget to add, and choosing an
 * arbitrary number to add would raise the cap by an amount the user never chose — those tokens are
 * billed to the user's provider account.
 *
 * **⚠︎ The cost is especially high on this provider, and we have no way to reduce it.** The
 * reported 3.x behaviour is that thinking grows on its own to roughly 96% of `maxOutputTokens`
 * (raising the cap makes thinking grow too), so no added number guarantees room for the body. We
 * cannot answer that on this axis. What the user can do now is lower reasoning effort or raise
 * response length. If upstream fixes that behaviour, this spot is fine to leave as it is.
 *
 * Both facts were confirmed on 2026-09-02 (googleapis/python-genai#2062 — the official docs do
 * **not** state this relationship; the observation, not memory, is the basis).
 *
 * **`minimal`'s budget of 0 is distinct from `undefined`.** 0 means "the user chose to turn
 * thinking off", so there is nothing to add; it is not the same value as the absent axis.
 */
const maxOutputTokensFor = (
	maxOutputTokens: number,
	budget: number | undefined,
): number =>
	budget === undefined ? maxOutputTokens : maxOutputTokens + budget;

/**
 * One declaration → **this provider's schema dialect**.
 *
 * This is where it diverges from the two paths that use JSON Schema. Those share a spec, so
 * `@rowcat/chat` builds it once; upper-case types are not part of any spec but **this provider's**,
 * so they stay here. Moving them into the shared layer would make the pure package learn a
 * provider's vocabulary, and reasoning parameters would follow.
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
	 * `additionalProperties` is not sent: it is not in this API's schema vocabulary, and an unknown
	 * key gets a 400. Rejecting arguments that do not exist is done again later by the tool layer.
	 */
	return { type: "OBJECT", properties, required: schema.required };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Content filters — **this provider's dialect, so it stays in this file**
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The four categories this adapter adjusts.
 *
 * `HARM_CATEGORY_CIVIC_INTEGRITY` is left out: it was removed in the latest generation, and sending
 * it makes only that model answer 400. The symptom is that only people who picked that model cannot
 * generate.
 */
const SAFETY_CATEGORIES = [
	"HARM_CATEGORY_HARASSMENT",
	"HARM_CATEGORY_HATE_SPEECH",
	"HARM_CATEGORY_SEXUALLY_EXPLICIT",
	"HARM_CATEGORY_DANGEROUS_CONTENT",
] as const;

/**
 * How far the provider's content filter is lowered for this turn — **the rating is the single
 * axis.**
 *
 * ⚠️ For a long time this adapter **sent no `safetySettings`**, and the comment said that was "the
 * provider's policy, not ours to tune". That sentence is not true for this product: the default
 * thresholds are tuned for a general-purpose assistant, so they block **even what our own guards
 * explicitly allow**. The all-ages guard says conflict, combat, crime and death may be handled
 * freely, yet the default cut those battle scenes; the adult guard permits direct description, yet
 * that response never arrived at all. The user saw one `Regenerate` with no visible cause.
 *
 * ```text
 * all-ages   BLOCK_ONLY_HIGH   looser than the default, but **a net remains**
 * adult      OFF               our guards are the ceiling; the filter does not re-judge them
 * ```
 *
 * **Not turning it off for all-ages is half of this table.** That rating's guards forbid sexual
 * content at both ends of the prompt, so on the normal path the filter has nothing to fire on, and
 * keeping it costs nothing. **BYO has no server-side re-check**, so there is no reason to discard a
 * free last net.
 *
 * **Turning it off for adult is not bypassing a filter; it keeps one owner for the decision.** What
 * may be written is settled by the absolute guard, the rating guard, the minor guard and the
 * intensity block, at both ends of the prompt. If a general-purpose threshold re-decides the same
 * thing on top, **what we forbid stays forbidden while only what we allow disappears.**
 *
 * ⚠️ **Off does not mean anything goes.** The core prohibitions do not come down with this setting,
 * and the key is the user's own, so **that account's own terms with the provider still stand**. The
 * stream below may therefore still meet a blocked response; then it ends with a failure of its own
 * name (`content_blocked`).
 *
 * This table stays here because it is the provider's **dialect** (the same rule
 * `chatToolJsonSchema` follows: the spec-shaped part is shared, and the upper-case types stay in
 * this adapter). It is a **pair** with the same file on the web: change only one of the two tables
 * and only that app's content gets blocked.
 */
const safetySettingsFor = (mode: ChatGenerationMode) =>
	SAFETY_CATEGORIES.map((category) => ({
		category,
		threshold: mode === "adult" ? "OFF" : "BLOCK_ONLY_HIGH",
	}));

/**
 * Whether the provider ended the response on a content policy.
 *
 * Completion reasons and prompt-block reasons **share one vocabulary** (`SAFETY`,
 * `PROHIBITED_CONTENT`, `BLOCKLIST`, `SPII`). It is kept as a list because writing `!== "STOP"`
 * would also catch `MAX_TOKENS`: **a truncated response would be reported as blocked**, and `Change the
 * scene` would appear where `Continue generating` belongs.
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

/** Only the fields this adapter reads. */
interface GeminiChunk {
	candidates?: {
		content?: {
			/** A part with `thought` true is a **thought summary**, not conversation body. */
			parts?: {
				text?: string;
				thought?: boolean;
				/**
				 * Tool call. This is where it diverges from Anthropic: the arguments arrive as **a complete
				 * object**, so there is nothing to accumulate. There is no identifier, so the name takes its
				 * place.
				 */
				functionCall?: { name?: string; args?: unknown };
				/** Signature attached to the call. We do not open this value until it is sent back. */
				thoughtSignature?: string;
			}[];
		};
		finishReason?: string;
	}[];
	usageMetadata?: {
		/** **Total input including cache** (the opposite of Anthropic's `input_tokens`). */
		promptTokenCount?: number;
		/**
		 * The portion read from the implicit cache. Requests where no cache applied have no such key at
		 * all; 0 is not written in that case.
		 */
		cachedContentTokenCount?: number;
		candidatesTokenCount?: number;
	};
	modelVersion?: string;
	/**
	 * Reason when blocked **with no candidate at all** — meaning the prompt side was blocked.
	 *
	 * If this branch were not read, the response would fall through as "a stream that ended without a
	 * completion reason" and receive the same sentence as a dropped connection.
	 */
	promptFeedback?: { blockReason?: string };
}

/**
 * Everything the parser receives **after** the response opens — same type and same reason as the
 * Anthropic adapter.
 *
 * The reason this type exists is that `ByoTransportInput` is not passed directly. That value holds
 * `secret`, and the parser lives until the response finishes; passing it would make the plaintext
 * credential's lifetime equal the stream's. Having `body` here and no `body` in that type is what
 * blocks that mistake **at compile time**.
 *
 * This is where it diverges from the Anthropic side: not even the requested model name is here.
 * This provider sends `modelVersion` on every chunk, so no fallback is needed.
 */
interface GeminiResponseStream {
	/** The already-open response body. The parser does not know which request produced it. */
	body: ReadableStream<Uint8Array>;
}

/**
 * Open response body → normalized events. **Knows nothing about credentials.**
 *
 * It is the half split off from `start()`; the reason for the split is lifetime (see the `byo.ts`
 * header).
 */
async function* readGeminiStream(
	source: GeminiResponseStream,
): AsyncGenerator<ChatStreamEvent> {
	let model: string | undefined;
	let inputTokens: number | undefined;
	let cachedInputTokens: number | undefined;
	let outputTokens: number | undefined;
	let finishReason: string | undefined;
	/**
	 * This API has no terminal event — the stream simply ends. Instead, **whether a completion reason
	 * was received** plays that role: the last chunk's `finishReason` is where it shows.
	 */
	let finished = false;
	/** The call this stream made. This provider gives complete objects, so there is nothing to collect. */
	let call: ChatToolCall | null = null;

	for await (const frame of readSse(source.body)) {
		const chunk = parseSseData<GeminiChunk>(frame.data);
		if (!chunk) continue;

		const candidate = chunk.candidates?.[0];
		/**
		 * **Filter out thought parts.** This provider sends thought summaries as ordinary parts with
		 * `text`, distinguished only by `thought: true`. Forwarding them unconditionally would show the
		 * model's thinking in the speech bubble, and that text would be saved as the assistant message.
		 *
		 * `includeThoughts` is not enabled, so these parts do not arrive today. The check stays anyway,
		 * because that option is one line in the request body: on the day someone enables it, without
		 * this line the symptom is not an error but **reasoning mixed into the conversation**.
		 */
		for (const part of candidate?.content?.parts ?? []) {
			if (part.functionCall) {
				if (call) {
					/**
					 * Parallel call. The contract allows one call per stream, so **the first is kept and the rest
					 * are dropped.**
					 *
					 * ⚠️ This was once an error, on the grounds that dropping a call would leave the model's call
					 * unanswered and make the next request a 400. **That premise does not hold in this
					 * repository**: the next request's assistant turn is built by us (`nextChatToolRequest`), and
					 * only the one call we chose is carried in it, so a dropped call is never seen upstream again.
					 * An unpaired call cannot be expressed.
					 *
					 * The opposite direction was much more expensive. Ending with an error would **kill the turn
					 * after body text had already streamed**, leaving the user with a response stopped
					 * mid-sentence. This provider has no switch to disable parallel calls, so that state would
					 * become an ordinary response. Dropping the call gives the model one result, and if that
					 * lookup is still needed it is called again in the next round trip.
					 */
					continue;
				}
				/**
				 * **The name is the identifier.** This provider gives calls no id and pairs them by name, so
				 * the value must be carried as-is; when a result is returned (`partsOf`) it becomes the name
				 * again. Inventing a random id would break that round trip.
				 *
				 * Even when arguments fall outside the vocabulary **the call is usually fine.** In that case it
				 * is carried as "unreadable" and goes to judgement, and the model gets back one sentence.
				 * Ending the turn here was a failure this repository actually hit (`readChatToolCall`).
				 */
				const parsed = readChatToolCall({
					id: part.functionCall.name ?? "",
					name: part.functionCall.name ?? "",
					arguments: part.functionCall.args,
					/**
					 * **Carried exactly as received.** The next request's assistant turn is reassembled on the
					 * device; without this value there, this provider will not accept the call it made (see the
					 * warning in `partsOf`).
					 */
					...(part.thoughtSignature
						? { providerState: part.thoughtSignature }
						: {}),
				});
				if (!parsed) {
					const failure = new ProviderError("provider_error");
					yield { type: "error", code: failure.code, message: failure.message };
					return;
				}
				call = parsed;
				continue;
			}
			if (part.text && part.thought !== true)
				yield { type: "delta", text: part.text };
		}

		/**
		 * **Blocked before any candidate existed.** Since the prompt side was blocked, this is not a
		 * completion reason and arrives here. If not read, it falls through to "a stream that ended
		 * without a completion reason" below and receives the same sentence as a dropped connection.
		 */
		if (isBlockedReason(chunk.promptFeedback?.blockReason)) {
			/* No diagnostic logging in this app: the product path has no `console` call at all, by rule. */
			const failure = new ProviderError("content_blocked");
			yield { type: "error", code: failure.code, message: failure.message };
			return;
		}

		if (candidate?.finishReason) {
			finishReason = candidate.finishReason;
			finished = true;
		}

		/** Cumulative values, so they overwrite (the last chunk's value is final). */
		if (chunk.usageMetadata) {
			inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
			cachedInputTokens =
				chunk.usageMetadata.cachedContentTokenCount ?? cachedInputTokens;
			outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
		}
		model = chunk.modelVersion ?? model;
	}

	/**
	 * The call comes **before** usage. By the time the client receives `usage`, the character of this
	 * turn must already be settled. Emitting it later would mean the save decision is made from the
	 * body alone and the call arrives afterwards. The judgement was already made in the loop above (a
	 * call the contract rejected never gets here).
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
	 * Ending without a completion reason means a truncated stream. Text may already have gone out, so
	 * it is emitted as an error event instead of thrown; the caller saves what was received as
	 * incomplete.
	 */
	if (!finished) {
		const failure = new ProviderError("provider_error");
		yield { type: "error", code: failure.code, message: failure.message };
		return;
	}

	/**
	 * **A response ended by a block is not a completion.**
	 *
	 * Emitting it as `done` would make the caller read a normal end. With an empty body the turn would
	 * become "a turn with no answer" and the screen would offer only `Regenerate` — which returns the same
	 * answer. Naming it here lets the recovery ladder say **what the user can do**.
	 *
	 * **Text already streamed is not taken back.** A response cut midway is saved as incomplete with
	 * what was received (the same rule as `stream_truncated` above); this frame attaches the reason
	 * after it.
	 */
	if (isBlockedReason(finishReason)) {
		const failure = new ProviderError("content_blocked");
		yield { type: "error", code: failure.code, message: failure.message };
		return;
	}

	yield {
		type: "done",
		...(finishReason !== undefined ? { finishReason } : {}),
	};
}

/**
 * **Sends** the request and returns an iterator that reads the open response — the implementation
 * of `ByoAdapter.start`.
 *
 * Four things finish before this resolves: building the URL, creating the auth header, the provider
 * `fetch`, and checking the first response. **Not being an `async function*` is the point**: as a
 * generator, this body ran no line until the caller started iterating, and in the meantime `input`
 * (= `secret`) lived in the generator closure and escaped the credential callback.
 *
 * The returned iterator's closure holds only `source`, with no secret and no header.
 */
async function start(
	input: ByoTransportInput,
): Promise<AsyncIterable<ChatStreamEvent>> {
	const { request } = input;

	/**
	 * The model name goes into the path. `encodeURIComponent` is needed because although the value
	 * comes through the catalogue, it ultimately originates from stored preferences — a single
	 * corrupted row must not leave room for a request that escapes the path.
	 */
	const url = `${API_ORIGIN}/${API_VERSION}/models/${encodeURIComponent(
		input.model,
	)}:streamGenerateContent?alt=sse`;

	/**
	 * The effort the request carries has already passed the capability check
	 * (`reasoningEffortForRequest`). Even so, a model or level missing from this table is silently
	 * omitted here: if the two places disagree, running without reasoning is better than sending a
	 * parameter the model rejects.
	 */
	const thinking = geminiThinkingFor(input.model, request.reasoningEffort);

	let response: Awaited<ReturnType<ByoTransportInput["fetch"]>>;
	try {
		response = await input.fetch(url, {
			method: "POST",
			signal: input.signal,
			headers: headersFor(input.secret),
			body: JSON.stringify({
				/**
				 * The system prompt is `systemInstruction`, not folded into the first history turn. Folding it
				 * in would give that block the same treatment as the history window, and would make the reason
				 * our assembler keeps system and history apart meaningless.
				 */
				systemInstruction: { parts: [{ text: request.system }] },
				/**
				 * Only continuations pass through a different assembler. **Thinking is not dropped here**: that
				 * constraint belongs to the Anthropic API, and this provider accepts a conversation ending in
				 * the `model` role as-is.
				 */
				contents: request.continuation
					? toGeminiContinuationContents(request.messages)
					: toGeminiContents(request.messages),
				/**
				 * **If no tools are declared the key is absent entirely** — a body from a client that does not
				 * know this axis stays byte-identical to before, and that stream has no `tool_call` frame.
				 *
				 * ⚠️ **This provider has no switch to disable parallel calls.** Anthropic and the gateway
				 * receive that request flag, but here nothing can block it, so the stream below ends with an
				 * error when it meets a second call. That is the only place in this adapter where the one-call
				 * rule holds.
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
					/**
					 * Thinking tokens are consumed **within** this cap, so in budget mode the cap is raised by
					 * that amount. Otherwise reasoning effort would eat the response length.
					 */
					maxOutputTokens: maxOutputTokensFor(
						request.maxOutputTokens,
						thinking.budget,
					),
					/**
					 * **If absent, the key is absent.** A model that does not support thinking answers 400 to this
					 * key, which is why the catalogue never assigns levels to such models.
					 *
					 * The axis inside is **chosen by the model** (3.x takes `thinkingLevel`, 2.5 takes
					 * `thinkingBudget`). Sending both is a 400, so the function above cannot construct that
					 * combination.
					 */
					...(thinking.config === undefined
						? {}
						: { thinkingConfig: thinking.config }),
				},
				/**
				 * **The rating is the only axis for this value** (`safetySettingsFor`). The request already
				 * carries it (`context.requestedMode`), so this adapter never needs to look at the room, member
				 * or settings again. The assembler has already decided; deciding again here would create a
				 * place where the prompt's rating and the filter's rating could diverge.
				 */
				safetySettings: safetySettingsFor(request.context.requestedMode),
			}),
		});
	} catch (thrown) {
		throw providerErrorForThrown(thrown, input.signal);
	}

	if (!response.ok || !response.body)
		// Body is not read here, for the same reason as in `anthropic.ts`.
		throw providerErrorForStatus(
			response.status,
			readRetryAfterSeconds(response.headers),
		);

	return readGeminiStream({ body: response.body });
}

/**
 * Credential check — one model-list request. It does not start a generation (for the same reason as
 * `anthropic.ts`).
 */
const probe: ByoAdapter["probe"] = async ({
	secret,
	signal,
	fetch,
}): Promise<CredentialCheck> => {
	try {
		const response = await fetch(
			`${API_ORIGIN}/${API_VERSION}/models?pageSize=1`,
			{ method: "GET", signal, headers: headersFor(secret) },
		);
		if (response.ok) return { ok: true };
		/**
		 * This API sometimes answers a wrong key with **400** (when the format is not a key at all). The
		 * status-code table folds that into `provider_error`, which is the wrong guidance at this check:
		 * the only thing the user can do here is enter the key again.
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
		return { ok: false, error: providerErrorForThrown(thrown, signal) };
	}
};

export const geminiAdapter: ByoAdapter = { start, probe };
