import type { GenerationModelDto } from "@rowcat/contracts/chat";
import {
	isReasoningEffort as isReasoningEffortDto,
	type ModelReasoningDto,
	REASONING_EFFORTS as REASONING_EFFORT_VALUES,
	type ReasoningEffortDto,
} from "@rowcat/contracts/chat";
import type { GenerationTarget } from "./generation-preference.ts";
import { generationTargetKey, isByoProvider } from "./generation-preference.ts";

/**
 * Reasoning effort is a third generation axis above the other two, and it differs in one respect:
 * whether it can be picked at all depends on the model. The rules therefore split three ways. What
 * the user wants is answered by the priority resolver (`resolveEffectiveGeneration`), which walks
 * its layers independently for this axis too. Whether the value works for the current model is
 * answered here. Which parameters are actually sent is answered by each execution boundary.
 *
 * Not here, and why:
 * - Provider parameters (`reasoning_effort`, `thinking.budget_tokens`, `thinkingBudget`). Naming
 *   them here would tie these pure rules to one provider's vocabulary. Translation lives on the
 *   server for managed and in each adapter for BYO.
 * - A capability table. The server answers which models support which levels
 *   (`GenerationModelDto.reasoning`). A local copy goes stale whenever a model is added, and stale
 *   copies draw levels that cannot run.
 * - Labels and copy. These belong to the app; pure rules tied to a locale would block later apps
 *   from using them. `generation-options.ts` made the same call.
 * - Reasoning content. This axis controls how much the model thinks, not whether that thinking is
 *   shown. No path in this slice stores or streams reasoning text; adapters still pass only text
 *   deltas.
 */

/**
 * Reasoning effort. Its vocabulary comes from the contract, since the value crosses the wire and
 * both sides must see the same list.
 */
export type ReasoningEffort = ReasoningEffortDto;

export const REASONING_EFFORTS = REASONING_EFFORT_VALUES;

/**
 * Whether a stored value still belongs to the current vocabulary. Use this only at the read
 * boundary. A device may hold a preference from an older version. An unknown level passed through
 * would be sent with the request, and the server (managed) or provider (BYO) would reject it, so
 * one stale setting would block the conversation. Returning `null` here lets the upper layers take
 * over, so the worst case becomes 'same as before'.
 */
export const isReasoningEffort = isReasoningEffortDto;

/**
 * Uses the contract's DTO directly, without a copy. Rewriting the shape here would make this layer
 * silently drop any axis the server adds later.
 */
export type ModelReasoningCapability = ModelReasoningDto;

/**
 * The product default is not here. `PRODUCT_REASONING_EFFORT` lives in the inheritance layer, next
 * to `PRODUCT_RESPONSE_LENGTH` in `generation-preference.ts`. That value answers 'what does the
 * user want when they have not chosen?' This file answers 'can the current model do that value?'
 * Putting both in one file would let adding a model shift the product default, and the reverse too.
 * The model's own default (`ModelReasoningCapability.defaultEffort`) is a third thing: it only
 * answers what to execute when the inherited level is unsupported by this model.
 */

/**
 * The three results of a capability lookup. `null` and `undefined` are different facts: an object:
 * this target can accept these levels `null`: this target has no adjustable reasoning, as the
 * catalog stated `undefined`: unknown, because the catalog was not loaded or the entry is absent.
 * No claim is made. Folding the last two together would make a network blip read as 'no reasoning
 * settings', and the screen would look as if it had silently erased the user's chosen value.
 * `catalogLoaded` in several pure modules is the same axis.
 */
export type ReasoningCapabilityLookup =
	| ModelReasoningCapability
	| null
	| undefined;

export interface ReasoningCapabilityInput {
	models: readonly GenerationModelDto[];
	/**
	 * Whether the catalog was actually received. On failure `models` is an empty array; judging
	 * against that would make every target 'no reasoning', which is something we cannot know.
	 */
	catalogLoaded: boolean;
	target: GenerationTarget;
}

/**
 * The key that ties a target to a catalog entry is `generationTargetKey` alone. Comparing provider
 * and model separately here would create the rule in two places, and the model selector and this
 * lookup could then pick different entries.
 */
export function reasoningCapabilityFor(
	input: ReasoningCapabilityInput,
): ReasoningCapabilityLookup {
	if (!input.catalogLoaded) return undefined;
	const key = generationTargetKey(input.target);
	const entry = input.models.find((model) => model.id === key);
	/**
	 * A target missing from the catalog, such as a discontinued model, makes no claim: `undefined`.
	 */
	if (!entry) return undefined;
	return entry.reasoning;
}

export const supportsReasoningEffort = (
	capability: ModelReasoningCapability | null,
	effort: ReasoningEffort,
): boolean => capability?.efforts.includes(effort) === true;

/**
 * Maps the requested level to a level this model can execute. Returns `null` when no reasoning
 * parameter should be sent. Three rules, and their order matters:
 * - no capability: `null`, and no reasoning parameter is built at all
 * - level supported: passed through unchanged
 * - level not supported: the model's default level. This never switches to another model. The
 *   last rule is the point. The alternatives for an unsupported level are running the model default
 *   or rejecting the request. Rejecting blocks the conversation, and the user has no way to learn
 *   that an old global choice caused it, so this runs instead. Explicit overrides are cleaned up
 *   earlier (`reconcileReasoningOverride`). Falling back to another target is absent by design: it
 *   is the same kind of silent change as provider substitution, which this repository has
 *   repeatedly blocked.
 */
export function resolveExecutableReasoning(
	capability: ModelReasoningCapability | null,
	requested: ReasoningEffort,
): ReasoningEffort | null {
	if (capability === null) return null;
	return capability.efforts.includes(requested)
		? requested
		: capability.defaultEffort;
}

export interface ReasoningRequestInput {
	target: GenerationTarget;
	/**
	 * The level chosen by priority resolution. It has not yet been checked against the model's
	 * capability.
	 */
	effort: ReasoningEffort;
	/** The capability the catalog reported. `undefined` means it could not be confirmed. */
	capability: ReasoningCapabilityLookup;
}

/**
 * The value to put in the request. What to do when the target could not be confirmed differs by
 * path, and it depends on who makes the final judgment:
 * - managed: the server re-checks with its own registry, so an unconfirmed value is sent as-is
 * - BYO: this browser is the last check, so an unconfirmed value is not sent Sending is safe for
 *   managed because the server does not trust the value. If the model cannot adjust, it strips the
 *   field; if the level is unsupported, it folds to the model default. Deleting the value here
 *   instead would permanently lose the level a user chose, for any user whose catalog failed to
 *   load. BYO has no second check. Sending an unverified level gets it rejected with a 400, and
 *   that failure blocks the conversation. Not sending it makes the worst case 'same as before the
 *   feature existed'.
 */
export function reasoningEffortForRequest(
	input: ReasoningRequestInput,
): ReasoningEffort | null {
	if (input.capability === undefined)
		return isByoProvider(input.target.provider) ? null : input.effort;
	return resolveExecutableReasoning(input.capability, input.effort);
}

export interface ReasoningOverrideInput {
	/**
	 * This layer's explicit override. `null` means it follows the upstream layer, so there is nothing
	 * to clean up.
	 */
	reasoningEffort: ReasoningEffort | null;
	/** The effective target after the change: this layer's override, or the inherited target. */
	target: GenerationTarget;
	models: readonly GenerationModelDto[];
	catalogLoaded: boolean;
}

/**
 * The target changed, so remove only the override that can no longer be achieved. This function
 * exists because the two axes are independent but one axis sets the scope of the other. A room that
 * stores `high` and then switches to a model without `high` would keep a setting that no request
 * can express. The screen would draw a level the user never chose, and execution would run another.
 * It does not move the value to another level. Changing `high` to `standard` would save a value the
 * user never picked as an explicit choice. Removing the override returns the axis to inheritance.
 * If the inherited value is unusable on the current model, it folds to that model's default at
 * execution (`resolveExecutableReasoning`). Either way, a stored value is always one the user
 * actually chose. If the catalog is not loaded, do not remove. Removing on a failed load would turn
 * a network blip into lost settings. Other axes are not touched. This returns only the reasoning
 * axis; response length and target are passed through by the caller.
 */
export function reconcileReasoningOverride(
	input: ReasoningOverrideInput,
): ReasoningEffort | null {
	const { reasoningEffort } = input;
	if (reasoningEffort === null) return null;
	const capability = reasoningCapabilityFor({
		models: input.models,
		catalogLoaded: input.catalogLoaded,
		target: input.target,
	});
	if (capability === undefined) return reasoningEffort;
	return supportsReasoningEffort(capability, reasoningEffort)
		? reasoningEffort
		: null;
}

/**
 * Whether the stored override can no longer be achieved on the current target. The rule is the same
 * as the function above, but it is separate because the target can change in two ways:
 * - this layer changes the model: cleanup runs at selection, and the screen calls reconcile then
 * - an upper layer changes the model: this layer's selector was never pressed, so nothing runs.
 *   This is the case that actually happens. A room inheriting its target sees its effective target
 *   change when the global target changes, while its override is untouched. The value stays stored
 *   and drawn, and execution uses the new model's default. An explicit stored preference then means
 *   something other than what the screen says. This is the one place in this slice where that
 *   property breaks. The cost is that inheritance does not know model capabilities
 *   (`resolveEffectiveGeneration` still does not). So the layer that knows capabilities must be
 *   able to ask. This function is that question. When it returns true, the caller removes the
 *   override rather than moving it to another level. Unverified means false. If the catalog is not
 *   loaded or the target is not in it, the function above returns the value unchanged, and this
 *   returns not stale. A network blip must not delete the user's setting. Without an override it is
 *   always false. There is nothing to remove, so no path returns true forever. That is why remove
 *   then re-check stops after one step, with no save loop.
 */
export const reasoningOverrideStale = (
	input: ReasoningOverrideInput,
): boolean =>
	input.reasoningEffort !== null && reconcileReasoningOverride(input) === null;

export interface ReasoningOptionsInput {
	models: readonly GenerationModelDto[];
	catalogLoaded: boolean;
	target: GenerationTarget;
	/** The level this layer chose. `null` means it follows the upstream layer. */
	value: ReasoningEffort | null;
	inherited: ReasoningEffort;
}

export interface ReasoningOptions {
	/**
	 * Whether to draw this row. A target that cannot be chosen from has no row at all. There is no
	 * 'not supported' text on a disabled control. The settings screen should show what the user can
	 * act on; a permanently disabled control reads as noise and still takes space. The mobile app
	 * states the same rule. Also false when capability could not be confirmed. There is no honest list
	 * to draw then. The stored value remains, and the catalog failure is already shown by the model
	 * field.
	 */
	available: boolean;
	efforts: readonly ReasoningEffort[];
	/**
	 * The value in the control; `null` while inheriting. If the stored value cannot be achieved on
	 * this target, this is also `null` (see `stale`). The list used to insert that value and draw it,
	 * so the screen showed `high` while execution ran a different level, permanently.
	 */
	value: ReasoningEffort | null;
	/**
	 * The stored override can no longer be achieved on this target, so the caller must remove it. This
	 * axis exists because the target can change outside this layer. When a room inherits its model and
	 * the global model changes, the room's override is untouched yet unusable
	 * (`reasoningOverrideStale`). When true, `value` is already `null`. That previews the value about
	 * to be saved. Between the two, the screen leads by one frame; after removal they match. Drawing
	 * an unusable value as-is would make the user believe it runs.
	 */
	stale: boolean;
	/**
	 * The value shown inside `Use default (…)`, folded to fit this target. The inherited value is not
	 * copied as-is because that can be false. If the global level is `minimal` and the current model
	 * does not have it, a room whose override was removed actually runs on the model's default level.
	 * A parenthesis reading `minimal` would promise something other than what executes.
	 */
	inheritedEffort: ReasoningEffort;
}

/**
 * Catalog, current target and stored value in; what the reasoning row draws out. Filters the list
 * by capability: a level the model cannot run must not be drawn, or a user who selects it believes
 * the choice is saved while execution runs a different level. No exceptions: a stored value is not
 * inserted into the list either. There was one (`buildModelOptions` still does this for vanished
 * models), and its reason was an empty trigger. That does not hold here because the control always
 * has an inherited item. Instead an unusable value is marked `stale` and `value` folds to `null`.
 * When the caller removes the override, the screen and execution reach the same value.
 */
export function buildReasoningOptions(
	input: ReasoningOptionsInput,
): ReasoningOptions {
	const capability = reasoningCapabilityFor({
		models: input.models,
		catalogLoaded: input.catalogLoaded,
		target: input.target,
	});

	if (capability === undefined || capability === null)
		return {
			available: false,
			efforts: [],
			value: input.value,
			/**
			 * An unconfirmed state is never called stale. Returning true here would make a screen with a
			 * failed catalog delete the user's override.
			 */
			stale: false,
			inheritedEffort: input.inherited,
		};

	const stale =
		input.value !== null && !capability.efforts.includes(input.value);

	return {
		available: true,
		efforts: capability.efforts,
		value: stale ? null : input.value,
		stale,
		inheritedEffort:
			resolveExecutableReasoning(capability, input.inherited) ??
			capability.defaultEffort,
	};
}
