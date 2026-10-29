import type { GenerationSummaryInput, ReasoningEffort } from "@rowcat/chat";
import { resolveGenerationSummary } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Builds a one-line summary of the conditions this test runs under. It exists because the toolbar
 * hid those conditions once the control set collapsed.
 * - Precedence and availability are not decided here. `resolveEffectiveGeneration` decides what
 *   applies, and `resolveGenerationSummary` from `@rowcat/chat` decides whether the device can use
 *   it. These are the same functions the chat settings home calls. Re-deriving `preference ??
 *   global ?? default` here would create a second precedence rule that could disagree with the
 *   inspector.
 * - Only part labels, the start-scene axis, and the joining copy are local. The copy stays out of
 *   the pure package because it is locale-bound.
 * - The playtest override goes in the resolver's innermost layer, the `room` slot. The name comes
 *   from its only earlier consumer, not from storage.
 */

/** Used when there is no override: the opening the draft designates is used as is. */
export const playtestDefaultSceneLabel = (): string =>
	translator("playtest")("summary.defaultScene");

/**
 * Label for a scene with an empty title. It is not folded into `Default opening`, because that would be
 * false: the user chose a different scene. Folding it would make the summary look like one from
 * someone who chose nothing, and the screen could not show what is being tested.
 */
export const playtestUntitledSceneLabel = (): string =>
	translator("playtest")("summary.untitledScene");

/**
 * One summary part. Only the value is drawn; the label is read by users who are not looking at the
 * screen.
 */
export interface PlaytestSummaryPart {
	label: string;
	value: string;
}

export interface PlaytestConfigurationSummaryInput
	extends GenerationSummaryInput {
	/**
	 * Human-readable name for response length. The table belongs to the control (`responseLengthLabel`
	 * in `features/generation/response-length-field.tsx`). A second copy here would mean renaming a
	 * step has to be edited in two places.
	 */
	responseLengthLabel: string;
	/** Builds the display name for reasoning effort. This is the same table the control uses. */
	reasoningEffortLabel: (effort: ReasoningEffort) => string;
	/**
	 * Title of the start scene picked for playtesting only. null means the draft's default opening.
	 *
	 * Takes no id. Users only see the name: neither `__default__` nor a UUID is part of the screen's
	 * vocabulary, and taking an id would require this function to know the scene list.
	 */
	startSceneTitle: string | null;
}

export interface PlaytestConfigurationSummary {
	/** Parts to draw, in order. Empty until the values have been read; nothing is guessed. */
	parts: PlaytestSummaryPart[];
	/** The values joined into one line, or null until they have been read. */
	text: string | null;
	/**
	 * The applied target cannot be used on this device.
	 *
	 * No reason is included on purpose. The collapsed line only needs to say that the user must open
	 * it. Why, and where to go, is already stated per reason by the inspector's model field
	 * (`ModelTargetField`).
	 */
	blocked: boolean;
}

const sceneLabel = (title: string | null): string => {
	if (title === null) return playtestDefaultSceneLabel();
	const trimmed = title.trim();
	return trimmed === "" ? playtestUntitledSceneLabel() : trimmed;
};

export function playtestConfigurationSummary(
	input: PlaytestConfigurationSummaryInput,
): PlaytestConfigurationSummary {
	const facts = resolveGenerationSummary(input);

	/**
	 * If the model name cannot yet be stated, no parts are drawn.
	 *
	 * The start scene does not depend on the catalog and could be stated now, but a line with one part
	 * would grow sideways as the rest arrive and shake the toolbar. The value users actually come to
	 * check is usually the model. So draw all three together, or draw placeholders.
	 */
	if (facts.modelLabel === null)
		return { parts: [], text: null, blocked: facts.blocked };

	const t = translator("playtest");
	const parts: PlaytestSummaryPart[] = [
		{ label: t("summary.model"), value: facts.modelLabel },
		{ label: t("summary.responseLength"), value: input.responseLengthLabel },
		/**
		 * The reasoning part appears only for models whose effort is adjustable. Its presence or absence
		 * is the point: opening the inspector shows the row or not, and the collapsed summary says the
		 * same thing.
		 */
		...(facts.reasoningEffort === null
			? []
			: [
					{
						label: t("summary.reasoning"),
						value: input.reasoningEffortLabel(facts.reasoningEffort),
					},
				]),
		{
			label: t("summary.startScene"),
			value: sceneLabel(input.startSceneTitle),
		},
	];

	return {
		parts,
		text: parts.map((part) => part.value).join(" · "),
		blocked: facts.blocked,
	};
}
