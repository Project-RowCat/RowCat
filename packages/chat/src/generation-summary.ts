import type { GenerationModelDto } from "@rowcat/contracts/chat";
import { resolveGenerationExecution } from "./generation-availability.ts";
import type {
	EffectiveGeneration,
	GenerationProvider,
	ResponseLength,
} from "./generation-preference.ts";
import { generationTargetKey } from "./generation-preference.ts";
import type { ReasoningEffort } from "./reasoning.ts";
import { resolveExecutableReasoning } from "./reasoning.ts";

/**
 * Module for the settings-home line `Generation settings`. It states four facts: which model generates this room,
 * how much it reasons, whether this device can run that target, and whether nothing can be said
 * yet. The rule lives only here so web and mobile cannot disagree about the same room.
 *
 * This module returns labels, enums, and booleans only. Each app builds the sentence (for example
 * `Claude Sonnet 5 · Standard length · High reasoning`), because locale text in this pure package would tie the rules
 * to Korean.
 *
 * Priority is not resolved here; the input is already the result of resolveEffectiveGeneration.
 * Availability calls resolveGenerationExecution, the same function the generation hook and model
 * picker use, so the warning here and the detail screen agree. The block reason is omitted on
 * purpose; the detail screen explains it.
 */

export interface GenerationSummaryInput {
	/**
	 * Some of the saved preference, catalog, or connection data has not arrived yet. This is different
	 * from 'not chosen'. If the product default were drawn before the values arrive, a user with a
	 * room override would see someone else's model name and could not tell which value is actually
	 * stored.
	 */
	loading: boolean;
	/**
	 * The value that actually applies to this room. It is the priority resolver's result, used as-is.
	 */
	effective: EffectiveGeneration;
	models: readonly GenerationModelDto[];
	/**
	 * Whether the catalog was actually received. When the fetch fails, models is an empty array, and
	 * judging then would mark every chosen model as missing. A network blip must not be read as 'this
	 * model no longer exists'.
	 */
	catalogLoaded: boolean;
	/** Providers that have credentials on this device. */
	connected: readonly GenerationProvider[];
	/** Whether this account may use BYO. False for users under 14. */
	byoAllowed: boolean;
}

export interface GenerationSummaryFacts {
	/**
	 * Name of the model in effect, or null while it is unread; the slot is left empty. Names are never
	 * invented. If the catalog is missing or the target is absent from it, the stored model string is
	 * used as-is, since no known label exists. A plausible made-up name would be read by the user as a
	 * model they never chose.
	 */
	modelLabel: string | null;
	/** Response length in effect, or null while unread. The label is added by the app. */
	responseLength: ResponseLength | null;
	/**
	 * Reasoning effort in effect. null when the target has no such axis, and the summary must drop
	 * that piece: showing `Standard reasoning` beside a model the user cannot adjust would be a fabricated fact.
	 * Also null when the catalog is not loaded. Only the stored step is known then, and what it
	 * actually runs as on this model is unknown.
	 */
	reasoningEffort: ReasoningEffort | null;
	/**
	 * The target cannot run on this device.
	 *
	 * The reason is deliberately omitted. The home line only needs to say that the user must open the
	 * detail screen. The detail screen already explains each reason in its own sentence; repeating
	 * reasons here would create a second copy that goes stale.
	 */
	blocked: boolean;
}

export function resolveGenerationSummary(
	input: GenerationSummaryInput,
): GenerationSummaryFacts {
	if (input.loading)
		return {
			modelLabel: null,
			responseLength: null,
			reasoningEffort: null,
			blocked: false,
		};

	const target = input.effective.target;
	const entry = input.catalogLoaded
		? input.models.find((model) => model.id === generationTargetKey(target))
		: undefined;

	const execution = resolveGenerationExecution({
		target,
		connectedProviders: input.connected,
		byoAllowed: input.byoAllowed,
		catalog: input.catalogLoaded
			? input.models.map((model) => ({
					provider: model.provider,
					model: model.model,
				}))
			: undefined,
	});

	return {
		modelLabel: entry?.label ?? target.model,
		responseLength: input.effective.responseLength,
		/**
		 * Built from the capabilities the catalog reports, not from the stored step. Copying the stored
		 * step would promise things the model does not do. An unsupported step folds to the model's
		 * default, which is what execution actually runs. For models without an adjustable reasoning
		 * axis, the piece is dropped entirely.
		 */
		reasoningEffort: entry
			? resolveExecutableReasoning(
					entry.reasoning,
					input.effective.reasoningEffort,
				)
			: null,
		blocked: execution.status === "blocked",
	};
}
