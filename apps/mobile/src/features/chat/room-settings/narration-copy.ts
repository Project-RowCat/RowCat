import type {
	ChatNarrationSettings,
	NarrationBlockedReason,
	NarrationScope,
	PromptPackDensity,
} from "@rowcat/chat";

/**
 * Copy for the narration pane; the rules live in `narration.ts` of `@rowcat/chat`.
 *
 * The wording must match the web file
 * (`apps/web/src/features/chat/room-settings/narration-copy.ts`). Korean stays out of the pure
 * package so its rules are not tied to a locale; the tables are `Record`s so growing the vocabulary
 * breaks compilation in both apps. Only wording can drift, and that shows only with the two screens
 * side by side.
 */

/**
 * The four scopes form one dial: `NARRATION_SCOPES` order is screen order, and the first writes my
 * character least. The wording must keep that continuity (how much the AI writes for me grows in
 * one direction), or the control degrades into unrelated options.
 */
export const NARRATION_SCOPE_LABEL: Record<NarrationScope, string> = {
	strict: "Only I write my character",
	reactive: "default",
	assisted: "AI assists",
	auto: "Autoplay",
};

export const NARRATION_SCOPE_DESCRIPTION: Record<NarrationScope, string> = {
	strict:
		"The AI never writes my character for me. It continues from the last action I wrote.",
	reactive: "Characters react to everything I wrote.",
	assisted: "The AI also continues my character's actions and lines.",
	auto: "The AI writes even my thoughts and feelings. You read along as if watching.",
};

/** No pack; stands as the first value of the dial. */
export const NARRATION_OFF_LABEL = "Off";
export const NARRATION_OFF_DESCRIPTION =
	"No narration instructions are added. Same as now.";

/**
 * The copy must mention cost: this axis changes prompt length, hence tokens per request (and the
 * bill of a BYO provider account). Unsaid, users see costs rise with no visible cause. Same
 * sentence as web.
 */
export const NARRATION_DENSITY_LABEL: Record<PromptPackDensity, string> = {
	light: "Concise",
	rich: "Rich",
};

export const NARRATION_DENSITY_DESCRIPTION: Record<PromptPackDensity, string> =
	{
		light: "Lightly polishes the style.",
		rich: "Writes dense description. The prompt gets longer, so each request uses more tokens.",
	};

/**
 * Says the other two axes exist while the pack is off. Without this line the default `Off` shows
 * a single dial and no evidence of density or cast cards; an invisible control is worse than a
 * disabled one. Controls stay undrawn; only the silence became one line of fact.
 */
export const NARRATION_LOCKED_HINT =
	"Turn it on to choose description density and character cards here.";

/**
 * States that this model has a single density. The default model is a reduced one, so for most
 * users the density axis never appeared and the pane only half-said what it decides.
 *
 * Distinct from `NARRATION_DENSITY_FOLDED_NOTICE`: that one says a chosen value was folded and only
 * means something to someone who chose; this one tells everyone what currently applies.
 */
export const narrationSingleDensityNotice = (label: string): string =>
	`This model has only one density: «${label}».`;

export const NARRATION_CAST_LABEL = "Character cards";
export const NARRATION_CAST_DESCRIPTION =
	"Attaches a card summarizing the characters' state below each reply. It helps stories with many characters; the prompt gets longer, so each request uses more tokens.";

/**
 * States that this model takes no pack. It does not tell the user to switch models: that decision
 * belongs to another pane and they chose the model for a reason. The other half of the sentence is
 * that the stored setting is kept, so they know it survives a return to a supporting model.
 */
export const NARRATION_UNSUPPORTED_NOTICE =
	"The model this conversation uses doesn't apply narration instructions. Your choice is kept and is used again if you switch to a model that applies them.";

/** Catalogue unread: makes no claim either way. */
export const NARRATION_CATALOG_UNKNOWN_NOTICE =
	"The model list couldn't be loaded, so it's unclear whether this applies right now.";

/** The stored density is absent on this model and was folded. */
export const NARRATION_DENSITY_FOLDED_NOTICE =
	"This model has only one density, so that one is applied.";

export const NARRATION_SAVE_FAILURE_MESSAGE =
	"Couldn't save the narration. Please try again.";

/**
 * Attribution notice; must not be removed. The pack bodies are the original work (the Hedgehog project),
 * and the port relies on the author's license grant. Legacy kept the same text in the same place;
 * dropping it would carry the feature over and leave its license condition behind.
 *
 * It stands with the bodies. The public release ships none, so the pane that draws this is not reachable
 * (`PROMPT_PACKS_AVAILABLE`). The lines describe the grant RowCat held for its hosted service; a build
 * that carries bodies under a grant of its own rewrites them to that grant, here and in the web copy.
 */
export const NARRATION_CREDIT = {
	heading: "Attribution and license notice",
	lines: [
		"Original author: Jakho (CHZZK streamer)",
		"Provided as: with the original author's permission and license",
		"Scope of use: RowCat's story progression and conversation generation features",
	],
	body: "The components based on the 'Goseumdochi' (Hedgehog) project included in RowCat were ported under a license formally granted by the original author, Jakho. The rights to these components belong to the original author, and RowCat uses them within the scope of the granted license.",
	thanks: "Our deep thanks to Jakho for sharing this valuable work.",
} as const;

/**
 * Settings-home row summary; states the value currently in effect. A scope name alone cannot tell
 * the chosen value from the applied one: on a model that takes no pack, `Autoplay` would state
 * something untrue. Same reason as the persona row.
 */
export function narrationRowSummary(
	settings: ChatNarrationSettings | null | undefined,
	blocked: NarrationBlockedReason | null,
): string {
	if (!settings) return NARRATION_OFF_LABEL;
	const label = NARRATION_SCOPE_LABEL[settings.scope];
	if (blocked === "model-unsupported")
		return `${label} · not applied on this model`;
	return settings.castTracking ? `${label} · ${NARRATION_CAST_LABEL}` : label;
}
