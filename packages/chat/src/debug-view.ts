import type {
	ConversationDebugState,
	ConversationTurnRecord,
} from "./debug-trace.ts";
import type { ChatGenerationUsage } from "./generation.ts";

/**
 * Values the inspector draws. Both apps call the same functions.
 *
 * The rules live here rather than in components for two reasons. This repo's web and mobile tests
 * do not render React, so rules inside components could only be checked by hand. And when these
 * rules break, the screen still looks plausible:
 * - a selected turn disappears and a different turn is drawn silently
 * - an estimated token count is written as if the provider reported it
 * - 12,400 and 12,449 are both shortened to 12.4K
 *
 * None of these raises an error. Separate copies per app would make such a mistake on one side
 * only, visible only when the two screens are compared side by side.
 *
 * Not here: per-branch screen copy (runtime branches exist only on web), colors, components.
 */

/**
 * The five tabs are ordered as the sequence of questions: Prompt (what was sent), Lore (why it was
 * included), State (the state in between), Generation (what ran it), Timeline (what happened and
 * when).
 *
 * The names are English because the creator already knows these words from the studio's floor
 * panel, not because of developer-tool convention.
 */
export const PLAYTEST_DEBUG_TABS = [
	"prompt",
	"lore",
	"state",
	"generation",
	"timeline",
] as const;
export type PlaytestDebugTab = (typeof PLAYTEST_DEBUG_TABS)[number];

/**
 * Tab labels typed as `Record<PlaytestDebugTab, string>`, so adding a tab without a label fails to
 * compile.
 */
export const PLAYTEST_DEBUG_TAB_LABEL: Record<PlaytestDebugTab, string> = {
	prompt: "Prompt",
	lore: "Lore",
	state: "State",
	generation: "Generation",
	timeline: "Timeline",
};

/** A list row carrying only what the picker needs to choose a turn. */
export interface DebugTurnOption {
	turnId: string;
	index: number;
	label: string;
	status: ConversationTurnRecord["status"];
}

export const TURN_ORIGIN_LABEL: Record<
	ConversationTurnRecord["origin"],
	string
> = {
	send: "Sent",
	regenerate: "Regenerate",
	continue: "Continue",
};

/** Newest first. In this list people usually look for what just happened. */
export const debugTurnOptions = (
	state: ConversationDebugState,
): DebugTurnOption[] =>
	[...state.turns].reverse().map((turn) => ({
		turnId: turn.turnId,
		index: turn.index,
		label: `#${turn.index} ${TURN_ORIGIN_LABEL[turn.origin]}`,
		status: turn.status,
	}));

/**
 * Resolves the turn to draw. If the selected turn no longer exists (pushed out of the cap), fall
 * back to the latest.
 *
 * Keeping a selection that no longer exists would draw an empty panel while the list highlights
 * another row. The fallback is correct, and the screen states it (`fellBack`).
 *
 * With no selection, the latest turn is used, including one still in progress. Restricting the
 * choice to finished turns would show the previous turn's answer while a response streams in, for a
 * prompt that was just sent.
 */
export function resolveSelectedTurn(
	state: ConversationDebugState,
	selectedTurnId: string | null,
): { turn: ConversationTurnRecord | null; fellBack: boolean } {
	if (selectedTurnId !== null) {
		const found = state.turns.find((turn) => turn.turnId === selectedTurnId);
		if (found) return { turn: found, fellBack: false };
	}
	const latest = state.turns[state.turns.length - 1] ?? null;
	return { turn: latest, fellBack: selectedTurnId !== null && latest !== null };
}

/**
 * Where a token count came from. The screen picks its badge from this, so a provider-reported count
 * and an estimate never look identical.
 *
 * The billing layer already settles the same question: an unknown value and zero are different.
 */
export type TokenSource = "provider" | "estimate";

export interface TokenReading {
	source: TokenSource;
	value: number;
}

/**
 * Token estimate from the character count. The estimate is named and labelled as one, never
 * presented as exact.
 *
 * The repo has no tokenizer, and adding one is out of scope here: it would ship a model-specific
 * vocabulary in both apps' bundles. Showing nothing, however, means the author learns the prompt is
 * growing only after a response is cut off.
 *
 * The ratio is a rough figure for mixed Korean and English manuscripts; only a tokenizer would make
 * it exact. A source always appears next to the value, and turns where the provider reported usage
 * do not draw this estimate at all.
 */
export const CHARACTERS_PER_TOKEN = 3.4;

export const estimateTokensFromCharacters = (characters: number): number =>
	Math.ceil(characters / CHARACTERS_PER_TOKEN);

/**
 * The input tokens of this turn: the provider's figure if it gave one, otherwise the estimate.
 *
 * Which one it is travels with the value. The badge rests on this single field, so an estimate
 * cannot be dressed up as exact.
 */
export function inputTokenReading(
	turn: ConversationTurnRecord,
): TokenReading | null {
	const reported = turn.usage?.inputTokens;
	if (reported !== undefined) return { source: "provider", value: reported };
	if (turn.request === null) return null;
	const characters =
		turn.request.system.length +
		turn.request.messages.reduce(
			(total, message) => total + message.content.length,
			0,
		);
	return {
		source: "estimate",
		value: estimateTokensFromCharacters(characters),
	};
}

export function outputTokenReading(
	turn: ConversationTurnRecord,
): TokenReading | null {
	const reported = turn.usage?.outputTokens;
	if (reported !== undefined) return { source: "provider", value: reported };
	if (turn.outputCharacters === null) return null;
	return {
		source: "estimate",
		value: estimateTokensFromCharacters(turn.outputCharacters),
	};
}

/**
 * Cache metrics are never estimated. A cache value the provider did not report cannot be derived
 * from character counts, and zero would conflate 'no cache hit' with 'not reported'. The cache
 * observation layer already decided this.
 */
export interface CacheReading {
	kind: "read" | "write";
	value: number;
}

export const cacheReadings = (
	usage: ChatGenerationUsage | null,
): CacheReading[] =>
	usage === null
		? []
		: [
				...(usage.cachedInputTokens !== undefined
					? [{ kind: "read" as const, value: usage.cachedInputTokens }]
					: []),
				...(usage.cacheWriteInputTokens !== undefined
					? [{ kind: "write" as const, value: usage.cacheWriteInputTokens }]
					: []),
			];

/**
 * Elapsed time; an unfinished turn yields `null`.
 *
 * A running count is not shown because it changes every frame. The status word already says the
 * turn is still running.
 */
export const turnDurationMs = (turn: ConversationTurnRecord): number | null =>
	turn.endedAt === null ? null : turn.endedAt - turn.startedAt;

export const formatDuration = (ms: number): string =>
	ms < 1_000 ? `${ms}ms` : `${(ms / 1_000).toFixed(2)}s`;

/**
 * Formats a count with thousands separators, without abbreviating. Shortening to `12.4K` would make
 * 12,400 and 12,449 identical.
 *
 * The locale is fixed to ko-KR rather than passed in, because accepting a parameter would give the
 * two apps a place to pick different separators.
 */
export const formatCount = (value: number): string =>
	value.toLocaleString("ko-KR");

export const TURN_STATUS_LABEL: Record<
	ConversationTurnRecord["status"],
	string
> = {
	running: "In progress",
	committed: "Saved",
	discarded: "Not saved",
	failed: "Failed",
	stopped: "Stopped",
};

/**
 * Human-readable reason a turn was not saved. The three reasons are distinct facts; merging them
 * would leave the inspector unable to say why there is no reply on screen.
 */
export const DISCARD_REASON_LABEL: Record<
	NonNullable<ConversationTurnRecord["discardReason"]>,
	string
> = {
	ownership:
		"This conversation was no longer active (reset, scene change, latest draft or account switch).",
	empty:
		"There was no body to save (an empty response, or only tracking blocks remained).",
	precondition:
		"The continuation's precondition broke (the conversation moved on in the meantime).",
};

export const DEBUG_NO_PROMPT_COPY = {
	title: "This turn assembled no prompt",
	body: "The input was not saved, or the target was blocked and the turn ended before the request. The Timeline tab records where it stopped.",
} as const;

export const DEBUG_NO_TURN_COPY = {
	title: "No turns generated yet",
	body: "Send a message and that turn's prompt, lore decisions and execution details appear here. This record lives only in memory and disappears when you leave the screen.",
} as const;

export const DEBUG_NO_EVENT_COPY = {
	title: "No events recorded yet",
	body: "Start a test and input, assembly, request, response and commit are recorded here in order.",
} as const;
