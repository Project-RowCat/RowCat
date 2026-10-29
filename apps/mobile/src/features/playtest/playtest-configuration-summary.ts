import type { GenerationSummaryInput } from "@rowcat/chat";
import { resolveGenerationSummary } from "@rowcat/chat";
import {
	reasoningEffortLabel,
	responseLengthLabel,
} from "../chat/generation/labels.ts";

/**
 * Builds a one-line summary of the conditions this test is running under.
 *
 * The controls live inside a dialog, so this line is the only signal on the main screen. Keeping
 * the controls always visible would make them the largest element here, while the user's job is to
 * send, read, and occasionally adjust. Hiding them without a summary would leave the user sending
 * messages without knowing the configuration (the conversation settings home makes the same call in
 * `chat/room-generation-summary.ts`).
 *
 * Priority resolution and availability are not computed here. `resolveEffectiveGeneration` decides
 * what applies, and `@rowcat/chat`'s `resolveGenerationSummary` decides whether this device can use
 * the target. The conversation settings home calls the same function. Re-writing `preference ??
 * global ?? default` here would create a second precedence rule, and the two screens would then
 * name different models.
 *
 * What remains is the label for each part, the scene axis that only this screen has, and the
 * joining text. The joining text is not in the pure package because it is locale-specific: tying
 * the shared rule to Korean would force other apps to take our copy in order to use it.
 */

/** No override is set: the draft's pinned opening is used. */
export const PLAYTEST_DEFAULT_SCENE_LABEL = "Default opening";

/**
 * A scene with a blank title.
 *
 * Not folded into `Default opening`: that would be false, since the user explicitly picked a different
 * scene. Folding would make the summary of someone with an override look like someone who picked
 * nothing, and the screen could no longer say what is being tested.
 */
export const PLAYTEST_UNTITLED_SCENE_LABEL = "Untitled opening";

/** One part. The label is read together with the value, since the value alone is unreadable without a screen. */
export interface PlaytestSummaryPart {
	label: string;
	value: string;
}

export interface PlaytestConfigurationSummaryInput
	extends GenerationSummaryInput {
	/**
	 * Title of the start scene picked for this playtest. `null` means the draft's default opening.
	 *
	 * Takes the name, not an id: the user only sees names, and taking an id would force this function
	 * to know the scene list.
	 */
	startSceneTitle: string | null;
}

export interface PlaytestConfigurationSummary {
	/** Parts to draw in order. Empty until the values are read; no guesses are drawn. */
	parts: PlaytestSummaryPart[];
	/** One line for a user who cannot see the screen. `null` until the values are read. */
	text: string | null;
	/**
	 * The active target cannot be used on this device.
	 *
	 * This must stay in the summary: once the controls are inside the dialog, the fact that the target
	 * is unusable would be invisible until the dialog is opened, and the user would send messages
	 * without knowing why the conversation is blocked.
	 */
	blocked: boolean;
}

const sceneLabel = (title: string | null): string => {
	if (title === null) return PLAYTEST_DEFAULT_SCENE_LABEL;
	const trimmed = title.trim();
	return trimmed === "" ? PLAYTEST_UNTITLED_SCENE_LABEL : trimmed;
};

export function playtestConfigurationSummary(
	input: PlaytestConfigurationSummaryInput,
): PlaytestConfigurationSummary {
	const facts = resolveGenerationSummary(input);

	// No parts are drawn until the model name is known. The scene is available without the catalog,
	// but a partial line would grow sideways as the rest arrives and shift the header. The model is
	// also the value the user most often checks.
	if (facts.modelLabel === null || facts.responseLength === null)
		return { parts: [], text: null, blocked: facts.blocked };

	const parts: PlaytestSummaryPart[] = [
		{ label: "Model", value: facts.modelLabel },
		{
			label: "Response length",
			value: responseLengthLabel(facts.responseLength),
		},
		// The reasoning part appears only for models whose reasoning effort is adjustable, matching the
		// web's line. Its presence is the signal itself.
		...(facts.reasoningEffort === null
			? []
			: [
					{
						label: "Reasoning effort",
						value: reasoningEffortLabel(facts.reasoningEffort),
					},
				]),
		{ label: "Opening scenes", value: sceneLabel(input.startSceneTitle) },
	];

	return {
		parts,
		text: parts.map((part) => `${part.label} ${part.value}`).join(" · "),
		blocked: facts.blocked,
	};
}
