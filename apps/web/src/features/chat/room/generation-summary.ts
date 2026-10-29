import type { GenerationSummaryInput, ReasoningEffort } from "@rowcat/chat";
import { resolveGenerationSummary } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The one line drawn by the settings home's `Generation settings` row. Only the sentence belongs to this app.
 *
 * The row exists because the settings home hides the controls. Moving the controls a level down
 * would also hide which generation this conversation uses, the most common reason to open settings,
 * so the summary keeps that answer on the first screen.
 *
 * The decisions are not here. Which values apply, whether the target is usable and whether anything
 * can be said yet all come from `resolveGenerationSummary` in `@rowcat/chat`, and mobile's matching
 * screen calls the same function. An earlier version kept those rules in this file; a mobile copy
 * then meant a second copy of precedence and availability, and the drift showed up only as two apps
 * naming different models for the same room.
 *
 * What remains is the sentence joining two facts. That sentence is not in the pure package because
 * of locale: if the rules were tied to Korean, a later app would have to take our copy to use them.
 *
 * The response length's display name is passed in too. The table belongs to the control
 * (`responseLengthLabel` in `features/generation/response-length-field.tsx`); a second copy here
 * would turn renaming a step into a two-file edit.
 */

export interface RoomGenerationSummaryInput extends GenerationSummaryInput {
	/** Human-readable name of the response length. The control owns the table. */
	responseLengthLabel: string;
	/**
	 * Builds reasoning-effort names from the same table the control uses
	 * (`features/generation/reasoning-effort-field.tsx`).
	 *
	 * This is a function, unlike the response length. The response length always has a value the
	 * caller can pass ahead of time, but this axis may have nothing to say (a model without an
	 * adjustable setting, or a catalog that has not arrived). The pure resolver decides that, so only
	 * the resulting value is passed through here.
	 */
	reasoningEffortLabel: (effort: ReasoningEffort) => string;
}

export interface RoomGenerationSummary {
	/** The summary line. `null` until it is read: the slot stays empty rather than drawing a guess. */
	text: string | null;
	/**
	 * The target that applies now cannot be used on this device.
	 *
	 * No reason is included on purpose. The home line only has to say that the user must go in; the
	 * detail screen already explains each cause, with its own sentence and destination.
	 */
	blocked: boolean;
}

export function roomGenerationSummary(
	input: RoomGenerationSummaryInput,
): RoomGenerationSummary {
	const facts = resolveGenerationSummary(input);
	if (facts.modelLabel === null) return { text: null, blocked: facts.blocked };

	/**
	 * The reasoning fragment is appended only when there is something to say. Writing `Standard reasoning` beside a
	 * model that cannot be adjusted would invent a fact, and a user who followed the line would find
	 * no control to change it: the line would promise a setting with no screen.
	 */
	const t = translator("chat");
	const parts = [
		t("summary.response", {
			model: facts.modelLabel,
			length: input.responseLengthLabel,
		}),
	];
	if (facts.reasoningEffort !== null)
		parts.push(
			t("summary.reasoning", {
				effort: input.reasoningEffortLabel(facts.reasoningEffort),
			}),
		);

	return { text: parts.join(" · "), blocked: facts.blocked };
}
