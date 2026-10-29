import {
	type ModelPromptPackDto,
	type ModelReasoningDto,
	ROWCAT_MANAGED_MODELS,
	type RowCatManagedModel,
} from "@rowcat/contracts";

/**
 * Managed-model registry: the only source of upstream routing. One question lives here: which
 * OpenRouter model does a public identity go to.
 *
 * ```text
 * public identity (contract)   claude-sonnet-5
 *         ↓  resolveManagedModel — this file; never leaves the server
 * upstream slug                anthropic/claude-sonnet-5
 * ```
 *
 * The server owns this because a browser that knew the slug would turn the managed path into an
 * arbitrary-model proxy; re-resolving the chosen model on the server is the whole safety property.
 *
 * Deliberately absent:
 * - Prices, context lengths and routing policy: nothing here reads them, and they would leak into
 *   the catalogue response (they are our cost contract).
 * - Credentials: the managed key is the single `env.OPENROUTER_API_KEY`, not per model.
 * - Fallbacks: an unknown identity is a failure, never a different model.
 *
 * BYO models never come here; that traffic goes from the browser straight to the provider, so only
 * the managed path needs routing even when the same model exists on both.
 *
 * Slugs and capabilities were verified on 2026-08-29 (OpenRouter `/api/v1/models`
 * `supported_parameters` plus each provider's docs). To add or swap a model, add the identity to
 * `ROWCAT_MANAGED_MODELS` in `@rowcat/contracts` and a row here; `managed-models.test.ts` breaks
 * first if the two disagree.
 *
 * A row carries routing and capability together because both are server facts about one model. The
 * catalogue projects only the capabilities; the upstream slug stays in this file.
 */

/** One registry row: public identity, screen label, upstream slug. */
export interface ManagedModelRoute {
	/** The contract's public identity, as carried on requests. */
	id: RowCatManagedModel;
	/**
	 * The real model name, with no branding alias: an alias hides what the user is choosing and, now
	 * that the same model is also selectable via BYO, cannot say whether two entries are the same. The
	 * group name (RowCat vs Anthropic) says which path is used.
	 */
	label: string;
	/**
	 * Name of the company that made the model; it titles the sub-group in the model picker. Not
	 * derived from the upstream namespace: `openai` -> `OpenAI` cannot be produced by a rule, and
	 * deriving it would make routing data the source of a screen string, so a gateway slug change
	 * would rename the vendor users see.
	 */
	vendor: string;
	/**
	 * OpenRouter model slug; never appears in any response. Prompt-caching decisions also use it
	 * (`usesExplicitPromptCaching` in `services/generation/chat.ts`) because the provider namespace
	 * exists only here.
	 */
	upstream: string;
	/**
	 * Whether the user can pick a reasoning effort on this model; `null` if not.
	 *
	 * It sits next to routing because both are server facts about one model; a separate table would
	 * get filled on one side only, and the mismatch is silent (the catalogue offers a level the
	 * request never carries, or an unlisted level goes upstream). A boot-time check covers consistency
	 * (below). This is capability, not translation: how levels become upstream parameters lives in
	 * `services/generation/chat.ts`.
	 *
	 * `null` means "RowCat offers no adjustable reasoning for this target", not "this model does not
	 * reason" (which we cannot know). Some models can only toggle reasoning, and drawing three levels
	 * for them would make users believe their choice has an effect.
	 *
	 * ⚠️ Values must come from each provider's current API docs, not memory; a wrong value shows up as
	 * a 400 only for users of that model, after they send.
	 */
	reasoning: ModelReasoningDto | null;
	/**
	 * Whether a narration pack can be applied to this model; `null` if not. Same placement reason as
	 * `reasoning`. Legacy decided this in the client with `model.includes("haiku")`, which leaves
	 * settings that can be chosen but do nothing.
	 *
	 * Values carry over the legacy gate:
	 *
	 * ```text
	 * OpenAI · Google           standard, two densities   unrestricted
	 * Anthropic (except haiku)  null                      legacy blocked packs
	 * Anthropic Haiku 4.5       standard, one density     legacy allowed only the light one
	 * DeepSeek · Xiaomi · Z.ai  reduced, one density      the reduced pack was made for that family
	 * ```
	 *
	 * ⚠️ Update this from observed behaviour: packs are long instructions that models follow to
	 * different degrees, and the difference shows as prose quality, not as a 400.
	 */
	promptPack: ModelPromptPackDto | null;
	/**
	 * The shape in which `Continue generating` is sent upstream.
	 *
	 * ```text
	 * prefill  end the conversation with the cut-off response (assistant message); upstream continues from that text
	 * nudge    follow that response with a nudge line (user turn); the conversation ends on a user turn
	 * ```
	 *
	 * Per-model server fact, and it varies within a company. Verified 2026-09-23 with real
	 * continuation requests on every Anthropic row: only the 4.5 generation (Haiku 4.5, Sonnet 4.5)
	 * accepts prefill; 4.6 and later return 400 even without reasoning params ("This model does not
	 * support assistant message prefill. The conversation must end with a user message."). While those
	 * rows were sent as prefill, `Continue generating` always failed for users of those models.
	 *
	 * ⚠️ Non-Anthropic rows are not verified values: `prefill` is simply the shape sent before this
	 * axis existed, and whether those upstreams really continue from that text is unmeasured. Do not
	 * write `prefill` from memory for a new row; a wrong `prefill` always fails continuation, while a
	 * wrong `nudge` is only a slightly less accurate continuation.
	 */
	continuation: ManagedContinuationMode;
}

/**
 * The two shapes of `Continue generating`; meaning is in `ManagedModelRoute.continuation`, body assembly in
 * `buildProviderRequestBody` (`services/generation/chat.ts`).
 */
export type ManagedContinuationMode = "prefill" | "nudge";

/**
 * Minimal, low, standard, high: models that actually have `minimal`.
 *
 * Currently only some Gemini 3.x models (those whose `thinkingLevel` includes `minimal`); not
 * grouped by company because even within Gemini 3.7 Flash lacks it.
 *
 * Not OpenAI: this constant once covered the three GPT-5.6 models, but their effort vocabulary is
 * `none`·`low`·`medium`·`high`·`xhigh`·`max` with no `minimal`. GPT-6 Sol and Luna share it and
 * GPT-6 Astra starts at `low`. Even if the gateway folds to the nearest level, a listed level that
 * differs from the one that runs is the same problem.
 */
const EFFORT_WITH_MINIMAL: ModelReasoningDto = Object.freeze({
	efforts: Object.freeze(["minimal", "low", "medium", "high"]),
	defaultEffort: "medium",
}) as ModelReasoningDto;

/**
 * Low, medium, high: models without `minimal`, which is most of them today.
 *
 * The reasons differ per family (Anthropic's vocabulary starts at `low`; GPT-5.6 and GPT-6 Sol/Luna
 * go `none` then `low`, GPT-6 Astra starts at `low`; Gemini 3.7 Flash and 2.5 Pro lack it). The
 * outcome is the same so one constant is shared. If one family gains the level, move only that
 * model to the constant above.
 */
const EFFORT_THREE: ModelReasoningDto = Object.freeze({
	efforts: Object.freeze(["low", "medium", "high"]),
	defaultEffort: "medium",
}) as ModelReasoningDto;

/**
 * List order is the catalogue order; the screen does not re-sort (a client sort rule would make the
 * list differ per deployment).
 *
 * Keep companies adjacent: the model picker folds this order into per-company sub-groups, so
 * interleaving shows the same company twice.
 */
const MANAGED_MODELS: readonly ManagedModelRoute[] = [
	/**
	 * First because it is OpenAI's top current-generation model, the same rule that puts the Anthropic
	 * 5 generation ahead of 4.x: whoever picks nothing should meet the current generation first.
	 *
	 * The gateway reports efforts `max`·`xhigh`·`high`·`medium`·`low` with `reasoning.mandatory` true
	 * (2026-09-05, OpenRouter `/api/v1/models`). Three overlap with our vocabulary and each is a
	 * distinct run, hence `EFFORT_THREE` (unlike DeepSeek V4, where one overlap makes the list fold to
	 * a single upstream value).
	 *
	 * `mandatory: true` changes nothing here: it means reasoning cannot be turned off, but the product
	 * vocabulary has no off value (`REASONING_EFFORTS` has no `none` in @rowcat/contracts). With no
	 * level chosen the parameter is omitted and upstream reasons at its default (`medium`).
	 */
	{
		id: "gpt-6-astra",
		label: "GPT-6 Astra",
		vendor: "OpenAI",
		upstream: "openai/gpt-6-astra",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	/**
	 * GPT-6.1 Sol is a newer version of the same tier, so it precedes GPT-6 Sol (same direction as
	 * Fable 5.1 -> 5 and Opus 5.5 -> 5).
	 *
	 * Its reasoning vocabulary differs from GPT-6 Sol: the gateway answers `max`·`xhigh`·`high`·
	 * `medium`·`low` with no `none` and `mandatory` true (2026-10-03, OpenRouter `/api/v1/models`),
	 * the Astra class rather than Sol. `EFFORT_THREE` for the same reason as Astra: no off value in
	 * our vocabulary, and the three overlapping levels are distinct runs.
	 */
	{
		id: "gpt-6.1-sol",
		label: "GPT-6.1 Sol",
		vendor: "OpenAI",
		upstream: "openai/gpt-6.1-sol",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	/**
	 * The rest of GPT-6 follows Astra and 6.1 Sol, higher tier first (Sol -> Luna), the same rule that
	 * puts Astra first and orders Fable -> Opus -> Sonnet.
	 *
	 * The basis differs from Astra: the gateway answers `max`·`xhigh`·`high`·`medium`·`low`·`none`
	 * with `mandatory` false (2026-09-23, OpenRouter `/api/v1/models`), the same vocabulary as the
	 * three GPT-5.6 models. It is still `EFFORT_THREE` because `low`·`medium`·`high` are distinct runs
	 * here too.
	 */
	{
		id: "gpt-6-sol",
		label: "GPT-6 Sol",
		vendor: "OpenAI",
		upstream: "openai/gpt-6-sol",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gpt-6-luna",
		label: "GPT-6 Luna",
		vendor: "OpenAI",
		upstream: "openai/gpt-6-luna",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gpt-5.6-luna",
		label: "GPT-5.6 Luna",
		vendor: "OpenAI",
		upstream: "openai/gpt-5.6-luna",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gpt-5.6-terra",
		label: "GPT-5.6 Terra",
		vendor: "OpenAI",
		upstream: "openai/gpt-5.6-terra",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gpt-5.6-sol",
		label: "GPT-5.6 Sol",
		vendor: "OpenAI",
		upstream: "openai/gpt-5.6-sol",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	/**
	 * The dot in the slug (`5.1`) follows the 4.x rule; the hyphenated name does not exist on the
	 * gateway (Haiku 4.5 really failed that way). The gateway's `supported_parameters` has
	 * `reasoning_effort` and lacks `tool_choice` (2026-09-03); this product sends no tools, so the
	 * latter changes nothing here.
	 */
	{
		id: "claude-fable-5-1",
		label: "Claude Fable 5.1",
		vendor: "Anthropic",
		upstream: "anthropic/claude-fable-5.1",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	{
		id: "claude-fable-5",
		label: "Claude Fable 5",
		vendor: "Anthropic",
		upstream: "anthropic/claude-fable-5",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	/**
	 * Same class as Fable 5.1: Anthropic publishes thinking as always on (`thinking.type`
	 * `disabled`/`enabled` are 400) and the gateway answers `mandatory: true` (2026-09-23). The effort
	 * vocabulary `max`·`xhigh`·`high`·`medium`·`low` overlaps ours in three distinct runs, hence
	 * `EFFORT_THREE`; "cannot be turned off" changes nothing for the same reason as GPT-6 Astra (no
	 * off value in our vocabulary).
	 *
	 * The slug dot (`5.5`) follows Fable 5.1. Tier is the list's first axis, so this sits before Opus
	 * 5 and after the two Fable versions.
	 */
	{
		id: "claude-opus-5-5",
		label: "Claude Opus 5.5",
		vendor: "Anthropic",
		upstream: "anthropic/claude-opus-5.5",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	{
		id: "claude-opus-5",
		label: "Claude Opus 5",
		vendor: "Anthropic",
		upstream: "anthropic/claude-opus-5",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	/**
	 * Same class as Opus 5.5: Anthropic publishes `thinking.type: "disabled"` as 400 (the only off
	 * path is `between_tools`, which does not apply because this product sends no tools) and the
	 * gateway answers `mandatory: true` (2026-10-03). The vocabulary is `max`·`xhigh`·`high`·
	 * `medium`·`low`, so `EFFORT_THREE`. Prefill is 400 as on every generation from 4.6, so
	 * continuation is a nudge.
	 */
	{
		id: "claude-sonnet-5-5",
		label: "Claude Sonnet 5.5",
		vendor: "Anthropic",
		upstream: "anthropic/claude-sonnet-5.5",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	{
		id: "claude-sonnet-5",
		label: "Claude Sonnet 5",
		vendor: "Anthropic",
		upstream: "anthropic/claude-sonnet-5",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	/**
	 * One of two models with no reasoning on managed only; BYO shows all three levels.
	 *
	 * The 4.5 generation is extended-thinking only, so the concept of effort levels does not exist (a
	 * thinking budget sets depth) and the gateway exposes no effort parameter for it. The only thing
	 * our managed path can send is `reasoning: { effort }`; if that were silently ignored, users would
	 * use a list with no effect.
	 *
	 * So it is `null` on managed. BYO adapters send the budget themselves, so the same model's
	 * capability legitimately differs per path (`chat-models.ts` Anthropic list).
	 *
	 * The dot in the upstream slug is intentional, as in the 4.x group below; this row alone was a
	 * hyphen for a while (`anthropic/claude-haiku-4-5`), a name the gateway does not have, so managed
	 * generation for this model failed outright.
	 */
	{
		id: "claude-haiku-4-5",
		label: "Claude Haiku 4.5",
		vendor: "Anthropic",
		upstream: "anthropic/claude-haiku-4.5",
		reasoning: null,
		promptPack: { lineage: "standard", densities: ["light"] },
		continuation: "prefill",
	},
	/**
	 * The 4.x generation follows 5 because list order is catalogue order and whoever picks nothing
	 * should meet the current generation first. The BYO Anthropic list in `chat-models.ts` holds the
	 * same five in the same order; the same model in both groups is normal (only the path differs),
	 * and diverging orders would make users look for one model in different places.
	 *
	 * The slug dot is not a typo: the public identity uses the official Anthropic API alias form
	 * (`claude-opus-4-8`) while OpenRouter slugs use a dot (`anthropic/claude-opus-4.8`). Two
	 * namespaces with their own notation is why this registry exists.
	 */
	{
		id: "claude-opus-4-8",
		label: "Claude Opus 4.8",
		vendor: "Anthropic",
		upstream: "anthropic/claude-opus-4.8",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	{
		id: "claude-opus-4-7",
		label: "Claude Opus 4.7",
		vendor: "Anthropic",
		upstream: "anthropic/claude-opus-4.7",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	{
		id: "claude-opus-4-6",
		label: "Claude Opus 4.6",
		vendor: "Anthropic",
		upstream: "anthropic/claude-opus-4.6",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	{
		id: "claude-sonnet-4-6",
		label: "Claude Sonnet 4.6",
		vendor: "Anthropic",
		upstream: "anthropic/claude-sonnet-4.6",
		reasoning: EFFORT_THREE,
		promptPack: null,
		continuation: "nudge",
	},
	/** Extended-only, so no reasoning on managed; same reason as Haiku 4.5 above. */
	{
		id: "claude-sonnet-4-5",
		label: "Claude Sonnet 4.5",
		vendor: "Anthropic",
		upstream: "anthropic/claude-sonnet-4.5",
		reasoning: null,
		promptPack: null,
		continuation: "prefill",
	},
	/** Same level table as 3.7 Flash: no `minimal` (Google's per-model table, 2026-09-03). */
	{
		id: "gemini-3.8-flash",
		label: "Gemini 3.8 Flash",
		vendor: "Google",
		upstream: "google/gemini-3.8-flash",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gemini-3.7-flash",
		label: "Gemini 3.7 Flash",
		vendor: "Google",
		upstream: "google/gemini-3.7-flash",
		reasoning: EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gemini-3.6-flash",
		label: "Gemini 3.6 Flash",
		vendor: "Google",
		upstream: "google/gemini-3.6-flash",
		reasoning: EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gemini-3.5-flash",
		label: "Gemini 3.5 Flash",
		vendor: "Google",
		upstream: "google/gemini-3.5-flash",
		reasoning: EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	{
		id: "gemini-3.5-flash-lite",
		label: "Gemini 3.5 Flash-Lite",
		vendor: "Google",
		upstream: "google/gemini-3.5-flash-lite",
		reasoning: EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
		continuation: "prefill",
	},
	/**
	 * Both V4 models have no reasoning on managed: upstream has only one level overlapping our
	 * vocabulary.
	 *
	 * Verified 2026-08-29 on OpenRouter `/api/v1/models`, identical for both:
	 *
	 * ```text
	 * supported_efforts: ["xhigh", "high"]   default_effort: "high"   mandatory: false
	 * ```
	 *
	 * Only `high` overlaps our vocabulary (`minimal`·`low`·`medium`·`high`), and the gateway does not
	 * reject unsupported levels but folds to the nearest. Writing `EFFORT_THREE` here would give:
	 *
	 * ```text
	 * screen    low · standard · high     users read this as three choices
	 * upstream  high · high · high        three levels fold into one run, no error
	 * ```
	 *
	 * Pro really did that for a while. No request is rejected, so the mismatch appears in no log. The
	 * question for this registry is not whether upstream accepts the request but whether the chosen
	 * level becomes a different run; with one true level there is no basis for a control (a picker
	 * with one choice is not an operation).
	 *
	 * Do not add `xhigh` to our vocabulary to make two: that widens the product vocabulary for one
	 * upstream enum and bends the meaning of the three levels to upstream names. A translation table
	 * such as `medium -> high`, `high -> xhigh` is out for the same reason: standard would no longer
	 * mean standard.
	 *
	 * `null` means "RowCat offers no adjustable reasoning for this target", not "this model does not
	 * reason". Both are `mandatory: false` with `default_effort: "high"`, so without our parameter
	 * upstream reasons at its default. GLM 5.2 below has the same `["xhigh","high"]` and is `null` for
	 * the same reason.
	 *
	 * ⚠️ `deepseek-v4-pro` is the product default (`DEFAULT_MANAGED_MODEL`), so this row sits on the
	 * path of someone who never opened AI settings. The "default target" group in `managed-models.test.ts` pins
	 * that the product default effort (`PRODUCT_REASONING_EFFORT` = `medium`) is not forced onto this
	 * target.
	 */
	{
		id: "deepseek-v4-pro",
		label: "DeepSeek V4 Pro",
		vendor: "DeepSeek",
		upstream: "deepseek/deepseek-v4-pro",
		reasoning: null,
		promptPack: { lineage: "reduced", densities: ["light"] },
		continuation: "prefill",
	},
	/**
	 * V4.1 Flash is the next version of V4 Flash so it precedes it. V4 Flash stays because of rates:
	 * same tier, but this one is 2x input and 4x output, so users of the old version are not moved
	 * silently to a pricier model.
	 *
	 * `null` for the same reason as GLM 5.3, not the V4 pair: the gateway answers
	 * `["max","high","low"]` (2026-10-03) and only `low` and `high` overlap our vocabulary, so we
	 * cannot say which way `standard` would fold.
	 */
	{
		id: "deepseek-v4.1-flash",
		label: "DeepSeek V4.1 Flash",
		vendor: "DeepSeek",
		upstream: "deepseek/deepseek-v4.1-flash",
		reasoning: null,
		promptPack: { lineage: "reduced", densities: ["light"] },
		continuation: "prefill",
	},
	{
		id: "deepseek-v4-flash",
		label: "DeepSeek V4 Flash",
		vendor: "DeepSeek",
		upstream: "deepseek/deepseek-v4-flash",
		reasoning: null,
		promptPack: { lineage: "reduced", densities: ["light"] },
		continuation: "prefill",
	},
	/**
	 * Replaces MiMo v2.5. v2.5 had no endpoint left inside `DISCLOSED_PROVIDERS` (2026-10-03,
	 * OpenRouter `/api/v1/models/…/endpoints`; every serving host is outside the US), so picking it
	 * always gave 502. v2.6 Flash is served by DeepInfra at the same list price.
	 *
	 * Device preferences that stored the old model are dropped at the read boundary
	 * (`isRowCatManagedModel`), so an unknown name never reaches a request and produces a 400.
	 */
	{
		id: "mimo-v2.6-flash",
		label: "MiMo v2.6 Flash",
		vendor: "Xiaomi",
		upstream: "xiaomi/mimo-v2.6-flash",
		reasoning: null,
		promptPack: { lineage: "reduced", densities: ["light"] },
		continuation: "prefill",
	},
	{
		id: "glm-5.3",
		label: "GLM 5.3",
		vendor: "Z.ai",
		upstream: "z-ai/glm-5.3",
		reasoning: null,
		promptPack: { lineage: "reduced", densities: ["light"] },
		continuation: "prefill",
	},
	{
		id: "glm-5.3-flash",
		label: "GLM 5.3 Flash",
		vendor: "Z.ai",
		upstream: "z-ai/glm-5.3-flash",
		reasoning: null,
		promptPack: { lineage: "reduced", densities: ["light"] },
		continuation: "prefill",
	},
	{
		id: "glm-5.2",
		label: "GLM 5.2",
		vendor: "Z.ai",
		upstream: "z-ai/glm-5.2",
		reasoning: null,
		promptPack: { lineage: "reduced", densities: ["light"] },
		continuation: "prefill",
	},
];

/**
 * OpenRouter providers a managed request may run on; all are US-based operators.
 *
 * The privacy policy's overseas-transfer disclosure names OpenRouter, Inc. (US) as recipient and says
 * OpenRouter re-delegates model execution to US operators. For "US" to stay true, every request
 * must carry this allow-list so the gateway's dynamic routing cannot pick hosts in other countries
 * (Alibaba, Baidu, SiliconFlow, Z.ai and so on; `buildProviderRequestBody` in
 * `services/generation/chat.ts`). The list enforces that promise, and adding a row here is the same
 * commit as verifying that slug's legal entity is in the US; the policy sentence names one country
 * and does not change.
 *
 * Per-model vendor pinning (`only: [maker]`) is not used because it strands models with no
 * first-party endpoint (the DeepSeek V4 family). For the same reason a model served only by hosts
 * missing here surfaces as a 502 instead of silently routing elsewhere (fail-closed). `zdr`,
 * `order` and `allow_fallbacks` are still not sent; they are availability decisions, not a
 * disclosure matter.
 *
 * Values are the slugs from OpenRouter `/api/v1/providers`; region variants (`azure/us`,
 * `google-vertex/global`) match the same slug.
 */
export const DISCLOSED_PROVIDERS: readonly string[] = [
	"openai",
	"anthropic",
	"google-ai-studio",
	"google-vertex",
	"azure",
	"amazon-bedrock",
	"fireworks",
	"together",
	"deepinfra",
	"baseten",
	"coreweave",
	"parasail",
	"cloudflare",
	"digitalocean",
];

const ROUTES: ReadonlyMap<string, ManagedModelRoute> = new Map(
	MANAGED_MODELS.map((route) => [route.id, route]),
);

/**
 * Requested managed identity -> upstream route, or `null` if unknown.
 *
 * The contract enum already narrows the vocabulary but this does not lean on it: a deployment that
 * added an identity and forgot the row here is possible, and failing beats silently falling to
 * another model. There is no way to express a fallback; the result is a route or `null`.
 */
export const resolveManagedModel = (id: string): ManagedModelRoute | null =>
	ROUTES.get(id) ?? null;

/**
 * The list the catalogue reads, as a copy. If a route or the catalogue sorted or filtered the
 * received value in place, the mutation would persist for the life of the process.
 */
export const listManagedModels = (): ManagedModelRoute[] => [...MANAGED_MODELS];

/**
 * Vocabulary and registry agree: checked once at boot. A mismatched deployment fails silently ("400
 * after send, only for users of that model"), so breaking here is better.
 */
const missing = ROWCAT_MANAGED_MODELS.filter((id) => !ROUTES.has(id));
if (missing.length > 0)
	throw new Error(
		`[managed-models] managed models with no upstream path: ${missing.join(", ")}`,
	);

/**
 * The capability table is self-consistent: checked once at boot.
 *
 * A default effort outside the list makes normalization fall to an unsupported level every time
 * (`resolveExecutableReasoning` folds unlisted values to the default); upstream rejects that
 * request, silently, for users of that model only.
 *
 * The contract schema (`ModelReasoningDto`) has the same rule but only applies to parsed values;
 * these are TypeScript literals and bypass it.
 */
const inconsistent = MANAGED_MODELS.filter(
	(route) =>
		route.reasoning !== null &&
		!route.reasoning.efforts.includes(route.reasoning.defaultEffort),
);
if (inconsistent.length > 0)
	throw new Error(
		`[managed-models] models whose default reasoning effort is outside the supported list: ${inconsistent
			.map((route) => route.id)
			.join(", ")}`,
	);
