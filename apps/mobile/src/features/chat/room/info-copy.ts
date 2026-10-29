import type { ChatUsageOutcome } from "@rowcat/chat";

/**
 * Copy for recent usage; says the same as web's pane.
 *
 * This file came out of `generation/labels.ts`. While the table sat at the end of the `Generation settings` pane
 * its label table held these strings; once the table moved to `Conversation info` (`room/info-content.tsx`)
 * that cohabitation lost its basis. That table is shared so several screens (settings, playtest,
 * runtime playback) name model, reasoning and length the same way, while these five are used by one
 * pane only, and leaving them would make the info pane import the generation settings' copy file
 * and imply the panes are linked.
 *
 * They stay in the app for the same reason as other copy: sentences are screen vocabulary and
 * lifting them would tie pure rules to a locale. The counting rule is already single
 * (`chatUsageView`).
 */
export const ROOM_USAGE_TITLE = "Recent usage";

/** A response that named no model; says unknown rather than inventing. */
export const ROOM_USAGE_UNKNOWN_MODEL = "Unknown model";

/**
 * One line that says what was counted. The window size is not written into the sentence (that is
 * the screen's concern; the counted responses are the scope). Unknown responses are named together
 * with the fact that they are left out of the total (unknown is not zero).
 */
export const roomUsageScope = (counted: number, unreported: number): string =>
	unreported > 0
		? `${counted} recent replies. ${unreported} of them reported no usage and weren't counted in the total.`
		: `${counted} recent replies.`;

/** Total lines; an axis that was not reported has no line at all. */
export function usageTotalLines(totals: {
	inputTokens?: number;
	cachedInputTokens?: number;
	outputTokens?: number;
}): string[] {
	const lines: string[] = [];
	if (totals.inputTokens !== undefined)
		lines.push(`Input ${totals.inputTokens.toLocaleString("en-US")}`);
	if (totals.cachedInputTokens !== undefined)
		lines.push(
			`Cached input ${totals.cachedInputTokens.toLocaleString("en-US")}`,
		);
	if (totals.outputTokens !== undefined)
		lines.push(`Output ${totals.outputTokens.toLocaleString("en-US")}`);
	return lines;
}

/**
 * One turn's line. Axes are written with names, since two bare numbers would need counting each
 * time. With no axis it says so: a blank is indistinguishable from 0, and responses that reported
 * no usage are often the reason to open this table (`chatUsageView` header).
 */
export function roomUsageRowLine(row: {
	inputTokens?: number;
	outputTokens?: number;
}): string {
	const parts: string[] = [];
	if (row.inputTokens !== undefined)
		parts.push(`Input ${row.inputTokens.toLocaleString("en-US")}`);
	if (row.outputTokens !== undefined)
		parts.push(`Output ${row.outputTokens.toLocaleString("en-US")}`);
	return parts.length > 0 ? parts.join(" · ") : ROOM_USAGE_UNREPORTED;
}

/** A response that reported no usage at all. */
export const ROOM_USAGE_UNREPORTED = "Usage not reported";

/**
 * How that turn ended. A normal turn says nothing (`null`). Only two words, on purpose: `Cut at the limit`
 * (cut at the limit) is fixed by raising the response length or pressing continue, and `Interrupted`
 * (disconnected) folds stop, disconnect and provider failure into one word. Splitting those would
 * make this table know the failure vocabulary that belongs to the failure ladder. Marking every row
 * would bury the two that matter. The web uses the same two words.
 */
export const roomUsageOutcomeLabel = (
	outcome: ChatUsageOutcome,
): string | null =>
	outcome === "complete"
		? null
		: outcome === "truncated"
			? "Cut at the limit"
			: "Interrupted";
