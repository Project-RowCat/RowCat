import type {
	GenerationModelDto,
	ModelPromptPackDto,
	ModelReasoningDto,
} from "@rowcat/contracts";
import { APP_NAME } from "@rowcat/domain";
import { listManagedModels } from "./managed-models.ts";

/**
 * Generation-target catalogue; the server is the authority. Models change for reasons we do not
 * deploy (providers retire models, new versions land, we adjust the supported list); baking the
 * list into the web bundle would need a frontend deploy each time and show users models that no
 * longer exist between deploys.
 *
 * Deliberately absent:
 * - Upstream slug: a managed entry's `model` is the contract's public identity
 *   (`claude-sonnet-5`); only `services/generation/managed-models.ts` knows which OpenRouter model
 *   it maps to. That value is our gateway contract and routing data.
 * - Upstream price, context length and upstream status: upstream price is between the operator
 *   and the gateway, and managed generation is unmetered so there is no user rate either.
 * - Credentials: this response only says what can be chosen. The server has no BYO keys (no
 *   table) and does not know whether the user holds one; the device decides that.
 * - Reasoning translation table: an entry says which levels can be chosen; how a level becomes an
 *   upstream parameter (effort enum, thinking budget) belongs to each execution boundary
 *   (`services/generation/chat.ts` for managed, the browser adapter for BYO). Budget numbers here
 *   would give the screen code that reads them and turn this response into a provider-parameter
 *   channel.
 *
 * Listing is not an availability check: being listed does not mean this user's key can call the
 * model. Account tier, region limits and quota are judged by the provider at request time and the
 * failure reaches the browser; preview models are especially likely to be rejected per account.
 *
 * The list is static by decision. Merging each provider's model-list API on every settings open
 * would make this endpoint depend on three upstreams (any slow one delays the settings screen), and
 * those lists include models we cannot send prompts to (embeddings, image, speech, TTS), so a
 * filter rule would have to be written here anyway.
 *
 * The static list is every generally available text-generation model of each provider. Picking a
 * few would leave us no answer to "why is this model missing" (all share the Messages/
 * generateContent format, so the adapter is the same) and users could not choose, in our screen
 * only, a model their account can use. Only invite-only/private models (Claude Mythos) and
 * non-text-generation models are left out.
 *
 * Values were verified on 2026-08-19 from each provider's official docs
 * (platform.claude.com/docs/en/about-claude/models/overview, ai.google.dev/gemini-api/docs/models).
 * Re-check the then-current official list when adding or swapping a model; do not write from
 * memory.
 */

/**
 * Catalogue id, `provider:model`: one string for the picker to handle. Using the label as id would
 * make polishing a label break stored preferences, and a client assembling its own rule would
 * diverge (`generationTargetKey` in @rowcat/chat builds the same value; they must match for a
 * stored target to meet its catalogue entry).
 */
const modelId = (provider: string, model: string): string =>
	`${provider}:${model}`;

const ANTHROPIC_LABEL = "Anthropic";
const GEMINI_LABEL = "Google Gemini";

/**
 * Levels a BYO entry says its adapter can actually carry.
 *
 * Unlike managed (where the gateway maps levels to upstream parameters), BYO adapters on the device
 * own the translation table (`lib/generation/*.ts` in `apps/web` and `apps/mobile`), so the levels
 * listed here must be only those with a row there. A level without one reaches the user as a
 * provider 400 after they start generating. The table itself never comes to the server.
 */
const BYO_EFFORT_THREE: ModelReasoningDto = Object.freeze({
	efforts: Object.freeze(["low", "medium", "high"]),
	defaultEffort: "medium",
}) as ModelReasoningDto;

/**
 * `minimal` stands only on models that really have that level.
 *
 * It differs within one company: Gemini 3.x splits into models with and without `minimal` on
 * `thinkingLevel` (3.7 Flash and 3.1 Pro lack it); in the 2.5 family budget 0 is that slot, which
 * some accept (2.5 Flash) and others cannot because of a floor (2.5 Pro's 128). Lumping them would
 * show `Minimal` on models without it and the provider would reject the request.
 *
 * Anthropic has no such level: its effort vocabulary starts at `low` and the extended-thinking
 * budget floor is 1,024.
 */
const BYO_EFFORT_WITH_MINIMAL: ModelReasoningDto = Object.freeze({
	efforts: Object.freeze(["minimal", "low", "medium", "high"]),
	defaultEffort: "medium",
}) as ModelReasoningDto;

/**
 * BYO model names must be the provider's canonical id. Unlike managed (the server resolves the
 * name), the browser puts this string verbatim into the provider request body, so a typo here is a
 * provider 400 only for users of that entry, after they start generating.
 *
 * Aliases are used instead of dated snapshots (`claude-haiku-4-5`, not `claude-haiku-4-5-20251001`)
 * because stored preferences live long on user devices: a snapshot id would make users of that
 * target "missing" the day the version retires, and room overrides already stored would keep
 * pointing at the old string. The provider keeps an alias pointing at the next version, so no
 * migration is needed. A model with no alias uses the docs' API id.
 *
 * All twelve entries share the same three levels but send them in two ways, so the constant must
 * not be reused casually: the two generations reject each other's parameters with a 400.
 *
 * ```text
 * Fable 5.1 · 5 · Opus 5.5 · 5 · Sonnet 5 · Opus 4.8 · 4.7 · 4.6 · Sonnet 4.6   adaptive + output_config.effort
 * Opus 4.5 · Sonnet 4.5 · Haiku 4.5                                              extended + thinking.budget_tokens
 * ```
 *
 * The adapter owns that split (`ANTHROPIC_REASONING` in `lib/generation/anthropic.ts`). The
 * catalogue looks like one because both methods can express the same three levels; if either gains
 * or loses a level this list must split too, and the test compares the pair. `minimal` is absent
 * from every entry as a common fact of both methods (effort starts at `low`, budget floor 1,024).
 */
const ANTHROPIC_MODELS: readonly {
	model: string;
	label: string;
	reasoning: ModelReasoningDto | null;
	/**
	 * Whether a narration pack applies to this model; same rule as the managed registry. Not derived
	 * from the provider name, for the same reason as reasoning: the value varies inside Anthropic
	 * (only Haiku allowed), and expressing that exception as a conditional means revisiting it for
	 * every added model; a missed spot shows a setting with no effect.
	 */
	promptPack: ModelPromptPackDto | null;
}[] = [
	{
		model: "claude-fable-5-1",
		label: "Claude Fable 5.1",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-fable-5",
		label: "Claude Fable 5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-opus-5-5",
		label: "Claude Opus 5.5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-opus-5",
		label: "Claude Opus 5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-sonnet-5-5",
		label: "Claude Sonnet 5.5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-sonnet-5",
		label: "Claude Sonnet 5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-haiku-4-5",
		label: "Claude Haiku 4.5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light"] },
	},
	{
		model: "claude-opus-4-8",
		label: "Claude Opus 4.8",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-opus-4-7",
		label: "Claude Opus 4.7",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-opus-4-6",
		label: "Claude Opus 4.6",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-sonnet-4-6",
		label: "Claude Sonnet 4.6",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-sonnet-4-5",
		label: "Claude Sonnet 4.5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
	{
		model: "claude-opus-4-5",
		label: "Claude Opus 4.5",
		reasoning: BYO_EFFORT_THREE,
		promptPack: null,
	},
];

/**
 * Gemini stable ids do not point at a version (the dated ones are previews), so using them as-is
 * gets the same property as the alias rule above.
 *
 * Preview models are included with the label saying so: omitting them leaves "why is it missing"
 * unanswerable, and including them silently makes entries that some accounts reject
 * indistinguishable from stable ones.
 *
 * Capability really differs here, unlike the Anthropic list: 3.x models each have different
 * `thinkingLevel` levels (3.7 Flash and 3.1 Pro lack `minimal`) and 2.5 has different budget ranges
 * (2.5 Pro has a floor of 128 so it cannot be turned off; 2.5 Flash accepts 0). Lumping by company
 * would list absent levels and the request would be rejected after the user sends.
 *
 * Only `gemini-2.5-flash-lite` is `null`: thinking is off by default and the budget floor is 512,
 * so there is no way to express "off". Offering levels would let the inherited `Standard` turn that
 * model's thinking on (raising cost) with nothing in the list to go back to; as is, its requests
 * match what they were before this axis existed.
 *
 * Verified against Google's official docs on 2026-08-29
 * (gemini-api/docs/generate-content/thinking).
 */
const GEMINI_MODELS: readonly {
	model: string;
	label: string;
	reasoning: ModelReasoningDto | null;
	/** Whether a narration pack applies to this model; same rule as the managed registry (see the Anthropic list). */
	promptPack: ModelPromptPackDto | null;
}[] = [
	{
		model: "gemini-3.8-flash",
		label: "Gemini 3.8 Flash",
		reasoning: BYO_EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-3.7-flash",
		label: "Gemini 3.7 Flash",
		reasoning: BYO_EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-3.6-flash",
		label: "Gemini 3.6 Flash",
		reasoning: BYO_EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-3.5-flash",
		label: "Gemini 3.5 Flash",
		reasoning: BYO_EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-3.5-flash-lite",
		label: "Gemini 3.5 Flash-Lite",
		reasoning: BYO_EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-3.1-pro-preview",
		label: "Gemini 3.1 Pro (preview)",
		reasoning: BYO_EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-3.1-flash-lite",
		label: "Gemini 3.1 Flash-Lite",
		reasoning: BYO_EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-3-flash-preview",
		label: "Gemini 3 Flash (preview)",
		reasoning: BYO_EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-2.5-pro",
		label: "Gemini 2.5 Pro",
		reasoning: BYO_EFFORT_THREE,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-2.5-flash",
		label: "Gemini 2.5 Flash",
		reasoning: BYO_EFFORT_WITH_MINIMAL,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
	{
		model: "gemini-2.5-flash-lite",
		label: "Gemini 2.5 Flash-Lite",
		reasoning: null,
		promptPack: { lineage: "standard", densities: ["light", "rich"] },
	},
];

const byo = (
	provider: "anthropic-byo" | "gemini-byo",
	providerLabel: string,
	entries: readonly {
		model: string;
		label: string;
		reasoning: ModelReasoningDto | null;
		promptPack: ModelPromptPackDto | null;
	}[],
): GenerationModelDto[] =>
	entries.map(({ model, label, reasoning, promptPack }) => ({
		id: modelId(provider, model),
		provider,
		providerLabel,
		/**
		 * For BYO the provider is the company. Carrying the same value looks redundant, but leaving it
		 * empty makes the field optional and the screen would have to decide how to draw a missing one;
		 * whether to title a sub-group in a one-company list should depend on how many companies there
		 * are, not on whether a value exists.
		 */
		vendorLabel: providerLabel,
		label,
		model,
		requiresConnection: true,
		/**
		 * This value differs within a company, so it is written per model; deriving it from the provider
		 * name would show `Minimal` on models with a floor and the request would be rejected after the user
		 * sends.
		 */
		reasoning,
		/** Written per entry, as above. */
		promptPack,
	}));

/**
 * Managed entries: a projection of the registry. List, order and label belong to
 * `services/generation/managed-models.ts`; this drops `upstream`. That one line is the whole
 * boundary of this catalogue: the projection picks fields, so new routing axes added to the
 * registry do not leak into the response.
 *
 * Always listed, even on a deployment with no provider key: the product default target of a user
 * who configured nothing is in here (`PRODUCT_GENERATION_TARGET` in @rowcat/chat), and removing it
 * from the catalogue would judge that preference "points at a missing model". A deployment with no
 * key fails with a 503 at generation time, which is the accurate place.
 *
 * Labels are the real model names with no branding alias; the same model can also be in the BYO
 * group (Claude Sonnet 5) and the group name says which path it is. Splitting the names would make
 * users read them as different models.
 */
const managed = (): GenerationModelDto[] =>
	listManagedModels().map(({ id, label, vendor, reasoning, promptPack }) => ({
		id: modelId("rowcat", id),
		provider: "rowcat",
		providerLabel: APP_NAME,
		/**
		 * The company that made the model; a separate axis from the provider (RowCat). One managed
		 * provider holds models from several companies, and the screen folds the list by this.
		 */
		vendorLabel: vendor,
		label,
		model: id,
		requiresConnection: false,
		/**
		 * Exactly the registry's capability. Writing it again here would make a copy that only one side
		 * gets updated when models change; the symptom is a level on screen that the server drops in
		 * normalization.
		 */
		reasoning,
		/** Exactly the registry's value, for the same reason (no copy). */
		promptPack,
	}));

const CATALOG: readonly GenerationModelDto[] = [
	...managed(),
	...byo("anthropic-byo", ANTHROPIC_LABEL, ANTHROPIC_MODELS),
	...byo("gemini-byo", GEMINI_LABEL, GEMINI_MODELS),
];

/**
 * Every generation target that can be chosen now, as a copy: if a route sorted or filtered the
 * received array in place, the mutation would persist for the life of the process.
 */
export const listGenerationModels = (): GenerationModelDto[] => [...CATALOG];
