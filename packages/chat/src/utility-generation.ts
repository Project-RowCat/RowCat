import type { RowCatManagedModel } from "@rowcat/contracts/chat";
import { DEFAULT_MANAGED_MODEL } from "@rowcat/contracts/chat";
import type { GenerationTarget } from "./generation-preference.ts";

/**
 * Auxiliary (non-roleplay) model requests and where they run.
 *
 * One kind remains: reply suggestions (`reply-suggestion-runner.ts`). Memory V2's rolling summary was
 * the other kind and is gone — long-term memory is afterstate's, on this device, and it calls no model
 * (`conversation-memory.ts`, `docs/chat/MEMORY.md`). A device that stored a "summary model" choice
 * keeps the row; nothing reads it.
 */
export const UTILITY_GENERATION_KINDS = ["suggestion"] as const;
export type UtilityGenerationKind = (typeof UTILITY_GENERATION_KINDS)[number];

/**
 * The managed model each kind of auxiliary request runs on. A product decision, like
 * `DEFAULT_MANAGED_MODEL`, and for the same reason not deployment configuration. A suggestion becomes
 * the person's own line once picked, so it keeps the default's voice.
 *
 * A `Record`, so a new kind does not compile until it states its model.
 */
export const MANAGED_UTILITY_MODELS: Record<
	UtilityGenerationKind,
	RowCatManagedModel
> = {
	suggestion: DEFAULT_MANAGED_MODEL,
};

/**
 * Maps the turn's generation target, and the model this device chose for this kind of auxiliary
 * request, to the target the request uses.
 *
 * - Managed stays managed and BYO stays BYO. A BYO user's request passing through the RowCat server
 *   would send that server a conversation the user chose not to send there, and change who pays.
 * - Managed uses that kind's managed model, never the room's.
 * - BYO uses the chosen model when there is one, else the room's own model. An explicit choice is
 *   never substituted: when it cannot run, execution resolution blocks it like any BYO target.
 */
export function resolveUtilityTarget(
	kind: UtilityGenerationKind,
	target: GenerationTarget,
	chosen: GenerationTarget | null,
): GenerationTarget {
	if (target.provider === "rowcat")
		return { provider: "rowcat", model: MANAGED_UTILITY_MODELS[kind] };
	if (chosen && chosen.provider !== "rowcat") return chosen;
	return target;
}
