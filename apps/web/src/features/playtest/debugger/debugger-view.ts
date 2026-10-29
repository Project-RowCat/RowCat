import { PLAYTEST_DEBUG_TABS, type PlaytestDebugTab } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Web-only debugger rules: the lanes, and the reason a pane is absent from a lane. The rest is
 * shared (@rowcat/chat's debug-view.ts). The runtime lane exists only on the web: mobile has no
 * studio, and its playtest never builds a conversation from a draft with the runtime on.
 */

/**
 * Which lane a test belongs to: the two screens test different things. The conversation lane has no
 * runtime state; the runtime lane has no assembled prompt. Absence is not shown by hiding the pane.
 * A hidden pane would make the creator read it as 'not built yet' and ask for it. What is here is
 * what was decided not to build.
 */
export type PlaytestDebugLane = "conversation" | "runtime";

/**
 * Whether this pane has something to answer in this lane. False means the pane still stands but
 * says why it is empty (playtestDebugTabUnavailable).
 */
export const debugTabApplies = (
	tab: PlaytestDebugTab,
	lane: PlaytestDebugLane,
): boolean =>
	tab === "timeline" ||
	(lane === "runtime" ? tab === "state" : tab !== "state");

/**
 * Why a pane is absent from a lane: not 'not yet', but what causes the absence. A sentence alone
 * would make the creator think they did something wrong, and nothing on screen could clear that up
 * (the studio's empty state follows the same rule).
 */
const UNAVAILABLE_TABS: {
	[Lane in PlaytestDebugLane]: Partial<
		Record<PlaytestDebugTab, UnavailableKey>
	>;
} = {
	conversation: { state: "conversation.state" },
	runtime: {
		prompt: "runtime.prompt",
		lore: "runtime.lore",
		generation: "runtime.generation",
	},
};

type UnavailableKey =
	| "conversation.state"
	| "runtime.prompt"
	| "runtime.lore"
	| "runtime.generation";

/**
 * Why a pane is empty for this lane, or `undefined` when the lane answers it. Which panes are
 * unavailable is fixed by the table above; the words come from the dictionary.
 */
export function playtestDebugTabUnavailable(
	lane: PlaytestDebugLane,
	tab: PlaytestDebugTab,
): { title: string; body: string } | undefined {
	const key = UNAVAILABLE_TABS[lane][tab];
	if (!key) return undefined;
	const t = translator("playtest");
	return {
		title: t(`unavailable.${key}.title`),
		body: t(`unavailable.${key}.body`),
	};
}

/** Only the panes this lane can answer. The screen uses it to choose the default pane. */
export const applicableDebugTabs = (
	lane: PlaytestDebugLane,
): PlaytestDebugTab[] =>
	PLAYTEST_DEBUG_TABS.filter((tab) => debugTabApplies(tab, lane));
