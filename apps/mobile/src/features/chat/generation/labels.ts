import type {
	GenerationProvider,
	ReasoningEffort,
	ResponseLength,
} from "@rowcat/chat";
import { APP_NAME } from "@rowcat/domain";

/**
 * Korean wording for the generation settings screen; no decisions here.
 *
 * What applies and whether it is usable are answered by pure functions in `@rowcat/chat`
 * (`resolveEffectiveGeneration`, `resolveGenerationExecution`, `resolveGenerationSummary`,
 * `buildReasoningOptions`); this file only translates results into words. Web's
 * `features/generation/response-length-field.tsx` and `lib/generation/availability.ts` are the
 * counterparts and use the same words. Rules and wording stay apart so rules are not tied to
 * Korean.
 */

/**
 * Human names for response length; the same three words as web. Token counts are not exposed: they
 * are not the user's vocabulary, and the same number is a different amount per provider.
 */
const RESPONSE_LENGTH_LABEL: Record<ResponseLength, string> = {
	short: "Short",
	standard: "Standard",
	long: "Long",
};

export const responseLengthLabel = (length: ResponseLength): string =>
	RESPONSE_LENGTH_LABEL[length];

/**
 * Human names for reasoning effort; the same four words as web
 * (`apps/web/src/features/generation/reasoning-effort-field.tsx`). `medium` is not called `Medium`: it
 * is the product default rather than a midpoint, and `Medium` reads as "so-so" and gives no reason to
 * pick it.
 */
const REASONING_EFFORT_LABEL: Record<ReasoningEffort, string> = {
	minimal: "Minimal",
	low: "Low",
	medium: "Standard",
	high: "High",
};

export const reasoningEffortLabel = (effort: ReasoningEffort): string =>
	REASONING_EFFORT_LABEL[effort];

/**
 * Provider names that work without the catalog. The catalog has `providerLabel` too, but this
 * wording is needed exactly when generation is blocked, when the catalog may be unreadable. Web
 * keeps the same copy for the same reason.
 */
const PROVIDER_LABEL: Record<GenerationProvider, string> = {
	rowcat: APP_NAME,
	"anthropic-byo": "Anthropic",
	"gemini-byo": "Google Gemini",
};

export const providerLabel = (provider: GenerationProvider): string =>
	PROVIDER_LABEL[provider];

/**
 * `Use default (Standard)`: the parenthesis holds the value currently inherited. Leaving it empty would say
 * nothing; the user needs to know what happens if they choose nothing, and the priority resolver
 * already has that answer (`resolveEffectiveGeneration({ global })`).
 */
export const inheritLabel = (inherited: string): string =>
	`Use default (${inherited})`;

/**
 * Inheritance footnote, the last paragraph of the generation settings pane. It says two things:
 * unset axes follow the default settings, and values chosen here apply to this device only (the
 * latter matters for someone opening the same conversation on another device).
 *
 * Web links to `default AI settings` here; this app states the sentence only. Not because the screen is
 * missing (`/settings/ai` exists) but because this is a footnote, not a section, and this app draws
 * a route to that screen only when something is actually blocked (`generationRecovery` in
 * `error.ts` draws `Open AI settings`). Inheritance is not a blocked state. Adding the link is now a
 * product decision, and this paragraph changes when it is made.
 */
export const GENERATION_INHERITANCE_TITLE = "Default settings";

export const GENERATION_INHERITANCE_BODY =
	"Anything this conversation doesn't set separately follows your default AI settings. Values chosen here apply only on this device.";

/** Label and description of the two controls; the same sentences as web. */
export const RESPONSE_LENGTH_FIELD = {
	label: "Response length",
	description: "How long the replies in this conversation are.",
} as const;

/**
 * What is chosen is a target, not a single model: provider and model form one value
 * (`GenerationTarget`). The label was once `Generation model`, but that put the same word as the `Model` field
 * right below it on two levels of hierarchy and made the accessible names read `Generation model provider`. Web's
 * `features/generation/model-target-field.tsx` uses the same words.
 */
export const MODEL_TARGET_FIELD = {
	label: "Generation target",
	description: "The model that generates this conversation.",
} as const;

/**
 * Label and description of the third axis; the same sentences as web. Unlike the other two this row
 * is sometimes absent: for models whose effort cannot be adjusted it is not drawn, and no disabled
 * `Not supported` control stands in. That wording reads as "supported someday", and a row that can never
 * be pressed takes space without being read (the same rule as not drawing absent operations as
 * disabled).
 */
export const REASONING_EFFORT_FIELD = {
	label: "Reasoning effort",
	description: "Sets how deeply the model thinks before answering.",
} as const;

/**
 * Saving failed; stands next to the control. SQLite's original message is not shown: it tells the
 * user nothing actionable and carries internal structure. Same sentence as web.
 */
export const GENERATION_SAVE_FAILURE_MESSAGE =
	"Couldn't save the settings. Please try again.";

/**
 * The catalog failed to load. It does not say "no models": a brief network wobble and a model
 * having disappeared are different facts, and the user would read the former as their setting being
 * erased. The stored value is intact, so the row is still drawn.
 */
export const MODEL_CATALOG_FAILURE_MESSAGE =
	"Couldn't load the model list. The current settings stay as they are.";
