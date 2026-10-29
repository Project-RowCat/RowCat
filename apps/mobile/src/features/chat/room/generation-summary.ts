import type { GenerationSummaryInput } from "@rowcat/chat";
import { resolveGenerationSummary } from "@rowcat/chat";
import {
	reasoningEffortLabel,
	responseLengthLabel,
} from "../generation/labels.ts";

/**
 * The line the settings home draws for `Generation settings`; only the sentence is this app's. Decisions (what
 * applies, whether it is usable, whether nothing can be said yet) come from
 * `resolveGenerationSummary` in `@rowcat/chat`, which web's same line also calls
 * (`apps/web/src/features/chat/room/generation-summary.ts`), so the two apps cannot name different
 * models for one room. Copy stays out of the shared package for locale reasons; the shape matches
 * web: `Model · Standard replies`.
 */

export interface RoomGenerationSummary {
	/** `null` while unread; the slot stays empty rather than drawing a guess. */
	text: string | null;
	/** The applied target is unusable on this device; basis for the home warning line. Dropping it from the summary would hide the fact until pressed, leaving users not knowing why the conversation is blocked. */
	blocked: boolean;
}

export function roomGenerationSummary(
	input: GenerationSummaryInput,
): RoomGenerationSummary {
	const facts = resolveGenerationSummary(input);
	if (facts.modelLabel === null || facts.responseLength === null)
		return { text: null, blocked: facts.blocked };

	/** The reasoning part appears only when there is something to say (same as web): `Standard reasoning` beside an unadjustable model would be an invented fact with no control behind it. */
	const parts = [
		`${facts.modelLabel} · ${responseLengthLabel(facts.responseLength)} responses`,
	];
	if (facts.reasoningEffort !== null)
		parts.push(`Reasoning ${reasoningEffortLabel(facts.reasoningEffort)}`);

	return { text: parts.join(" · "), blocked: facts.blocked };
}
