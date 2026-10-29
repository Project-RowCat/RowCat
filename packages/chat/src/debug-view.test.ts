import { describe, expect, it } from "vitest";
import {
	beginConversationTurn,
	type ConversationDebugState,
	type ConversationTurnRecord,
	createConversationDebugStore,
	emptyConversationDebugState,
} from "./debug-trace.ts";
import {
	debugTurnOptions,
	estimateTokensFromCharacters,
	formatCount,
	formatDuration,
	inputTokenReading,
	outputTokenReading,
	PLAYTEST_DEBUG_TAB_LABEL,
	PLAYTEST_DEBUG_TABS,
	resolveSelectedTurn,
	turnDurationMs,
} from "./debug-view.ts";

/**
 * Rules for the values the inspector draws. Both apps must see the same answers.
 *
 * If these rules break, the screen still looks plausible while showing wrong data: a prompt from a
 * different turn than the selected one, an estimated token count shown as provider-reported, or a
 * hidden column that makes an unbuilt feature look missing.
 */

const at = (n: number) => ({ at: n });

const withTurns = (count: number): ConversationDebugState => {
	let state = emptyConversationDebugState();
	for (let n = 1; n <= count; n += 1)
		state = beginConversationTurn(
			state,
			{ turnId: `t${n}`, origin: "send" },
			at(n),
		);
	return state;
};

const turnWith = (
	patch: Partial<ConversationTurnRecord>,
): ConversationTurnRecord => ({
	turnId: "t1",
	index: 1,
	origin: "send",
	startedAt: 0,
	endedAt: null,
	status: "running",
	prompt: null,
	request: null,
	execution: null,
	end: null,
	finishReason: null,
	usage: null,
	inputCharacters: null,
	outputCharacters: null,
	failure: null,
	discardReason: null,
	messageId: null,
	truncated: false,
	...patch,
});

describe("tabs", () => {
	it("vocabulary and labels fully cover each other", () => {
		for (const tab of PLAYTEST_DEBUG_TABS)
			expect(PLAYTEST_DEBUG_TAB_LABEL[tab]).toBeTruthy();
	});
});

describe("choosing a turn", () => {
	it("newest first", () => {
		expect(debugTurnOptions(withTurns(3)).map((row) => row.index)).toEqual([
			3, 2, 1,
		]);
	});

	it("draws the newest turn when nothing is chosen, even while in progress", () => {
		const state = withTurns(2);
		const resolved = resolveSelectedTurn(state, null);
		expect(resolved.turn?.turnId).toBe("t2");
		expect(resolved.turn?.status).toBe("running");
		expect(resolved.fellBack).toBe(false);
	});

	it("draws the chosen turn as is", () => {
		const resolved = resolveSelectedTurn(withTurns(3), "t1");
		expect(resolved.turn?.turnId).toBe("t1");
		expect(resolved.fellBack).toBe(false);
	});

	it("falls back to the newest when the chosen turn vanished, and **that fact remains as a value**", () => {
		const resolved = resolveSelectedTurn(withTurns(2), "사라진-턴");
		expect(resolved.turn?.turnId).toBe("t2");
		expect(resolved.fellBack).toBe(true);
	});

	it("nothing to draw when there are no turns", () => {
		expect(resolveSelectedTurn(emptyConversationDebugState(), null)).toEqual({
			turn: null,
			fellBack: false,
		});
	});
});

describe("tokens: exact and estimated", () => {
	it("the provider's value with the provider as source when reported", () => {
		const turn = turnWith({
			usage: { inputTokens: 1_204, outputTokens: 88 },
			outputCharacters: 300,
			request: {
				system: "가",
				messages: [],
				maxOutputTokens: 1024,
				reasoningEffort: null,
				requestedMode: "all-ages",
				continuation: false,
				toolCount: 0,
				hasRoutingSession: false,
			},
		});
		expect(inputTokenReading(turn)).toEqual({
			source: "provider",
			value: 1_204,
		});
		expect(outputTokenReading(turn)).toEqual({ source: "provider", value: 88 });
	});

	it("estimated when unreported, with **the fact that it is an estimate carried on the value**", () => {
		const turn = turnWith({
			usage: null,
			outputCharacters: 340,
			request: {
				system: "가".repeat(340),
				messages: [
					{ role: "user", content: "나".repeat(340), toolCallName: null },
				],
				maxOutputTokens: 1024,
				reasoningEffort: null,
				requestedMode: "all-ages",
				continuation: false,
				toolCount: 0,
				hasRoutingSession: false,
			},
		});
		expect(inputTokenReading(turn)).toEqual({
			source: "estimate",
			value: estimateTokensFromCharacters(680),
		});
		expect(outputTokenReading(turn)).toEqual({
			source: "estimate",
			value: estimateTokensFromCharacters(340),
		});
	});

	it("does not estimate when there is nothing to measure: null, not 0", () => {
		const turn = turnWith({});
		expect(inputTokenReading(turn)).toBeNull();
		expect(outputTokenReading(turn)).toBeNull();
	});

	it("reporting 0 tokens and not reporting are different values", () => {
		const reported = turnWith({
			usage: { outputTokens: 0 },
			outputCharacters: 0,
		});
		expect(outputTokenReading(reported)).toEqual({
			source: "provider",
			value: 0,
		});
		const silent = turnWith({ usage: null, outputCharacters: 0 });
		expect(outputTokenReading(silent)?.source).toBe("estimate");
	});
});

describe("display", () => {
	it("an unfinished turn's duration is null", () => {
		expect(turnDurationMs(turnWith({ startedAt: 10 }))).toBeNull();
		expect(turnDurationMs(turnWith({ startedAt: 10, endedAt: 1_260 }))).toBe(
			1_250,
		);
	});

	it("under a second is written in milliseconds", () => {
		expect(formatDuration(940)).toBe("940ms");
		expect(formatDuration(1_250)).toBe("1.25s");
	});

	it("does not abbreviate numbers: 12,400 and 12,449 are different numbers", () => {
		expect(formatCount(12_400)).toBe("12,400");
		expect(formatCount(12_449)).toBe("12,449");
	});
});

describe("the store fills without a screen", () => {
	it("subscribers learn of a signal at once, and the value reads immediately", () => {
		const store = createConversationDebugStore({
			now: () => 1,
			newTurnId: () => "t1",
		});
		const turnId = store.beginTurn("send");
		store.emit({ kind: "input-accepted", turnId, data: { characters: 3 } });
		const resolved = resolveSelectedTurn(store.getState(), null);
		expect(resolved.turn?.inputCharacters).toBe(3);
	});

	it("a late turn's signal goes to **the old store**", () => {
		const previous = createConversationDebugStore({
			now: () => 1,
			newTurnId: () => "old-turn",
		});
		const turnId = previous.beginTurn("send");
		const next = createConversationDebugStore({
			now: () => 2,
			newTurnId: () => "new-turn",
		});
		next.beginTurn("send");

		/**
		 * A generation still in progress keeps a closure over the old sink, so its late events land in
		 * the previous store.
		 */
		previous.emit({
			kind: "turn-committed",
			turnId,
			data: { messageId: "m-late" },
		});

		expect(
			resolveSelectedTurn(next.getState(), null)?.turn?.messageId,
		).toBeNull();
		expect(next.getState().turns).toHaveLength(1);
		/** The record stays in the old store; only the route from that store to the screen is lost. */
		expect(previous.getState().turns[0]?.messageId).toBe("m-late");
	});
});
