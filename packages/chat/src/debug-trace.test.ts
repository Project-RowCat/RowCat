import { describe, expect, it } from "vitest";
import {
	beginConversationTurn,
	type ConversationDebugState,
	type ConversationTurnExecution,
	createConversationDebugStore,
	DEFAULT_DEBUG_TRACE_LIMITS,
	debugTraceTruncated,
	emptyConversationDebugState,
	eventsForTurn,
	latestTurn,
	reduceConversationDebug,
	turnForMessage,
} from "./debug-trace.ts";
import type { ChatPromptTrace, SafeChatRequestDebug } from "./prompt-trace.ts";

/**
 * Rules for the observation log: ordering, limits and honesty. If these are wrong, the screen is
 * wrong in a plausible way: an uncommitted value looks committed, a list cut by the limit looks
 * complete, or the result of a late turn attaches to a new turn. None of these raise an error.
 */

const LIMITS = DEFAULT_DEBUG_TRACE_LIMITS;

const prompt = (blockText = "가드"): ChatPromptTrace => ({
	blocks: [{ id: "absolute-guard", text: blockText }],
	lore: [
		{
			id: "lore:0",
			index: 0,
			keys: ["항구"],
			position: "system_bottom",
			order: 0,
			active: true,
			reason: "key-match",
			matchedKey: "항구",
			contentLength: 4,
			content: "항구다",
			injectedIndex: 0,
		},
		{
			id: "lore:1",
			index: 1,
			keys: ["사막"],
			position: "system_bottom",
			order: 0,
			active: false,
			reason: "no-key-match",
			matchedKey: null,
			contentLength: 4,
			content: null,
			injectedIndex: null,
		},
	],
	loreScanText: "항구",
	personaName: "당신",
	historyLength: 2,
	allAges: true,
});

const request = (system = "가드"): SafeChatRequestDebug => ({
	system,
	messages: [{ role: "user", content: "안녕", toolCallName: null }],
	maxOutputTokens: 1024,
	reasoningEffort: null,
	requestedMode: "all-ages",
	continuation: false,
	toolCount: 0,
	hasRoutingSession: false,
});

const execution: ConversationTurnExecution = {
	target: { provider: "rowcat", model: "claude-sonnet-5" },
	managed: true,
	reasoningEffort: null,
	responseLength: "standard",
	maxOutputTokens: 1024,
	allAges: true,
	narrationApplied: false,
};

/** Time is passed in as a value, because this reducer has no clock. */
const at = (n: number) => ({ at: n, limits: LIMITS });

const start = (
	state: ConversationDebugState,
	turnId: string,
	time = 1,
): ConversationDebugState =>
	beginConversationTurn(state, { turnId, origin: "send" }, at(time));

describe("turn records", () => {
	it("a turn's normal path ends in commit", () => {
		let state = start(emptyConversationDebugState(), "t1");
		state = reduceConversationDebug(
			state,
			{ kind: "input-accepted", turnId: "t1", data: { characters: 3 } },
			at(2),
		);
		state = reduceConversationDebug(
			state,
			{
				kind: "prompt-assembled",
				turnId: "t1",
				data: { prompt: prompt(), request: request() },
			},
			at(3),
		);
		state = reduceConversationDebug(
			state,
			{ kind: "provider-request", turnId: "t1", data: execution },
			at(4),
		);
		state = reduceConversationDebug(
			state,
			{
				kind: "provider-response",
				turnId: "t1",
				data: {
					end: "completed",
					outputCharacters: 120,
					usage: { inputTokens: 900, outputTokens: 40 },
					finishReason: "stop",
				},
			},
			at(5),
		);
		state = reduceConversationDebug(
			state,
			{ kind: "turn-committed", turnId: "t1", data: { messageId: "m-1" } },
			at(6),
		);

		const turn = latestTurn(state);
		expect(turn).toMatchObject({
			turnId: "t1",
			index: 1,
			status: "committed",
			end: "completed",
			messageId: "m-1",
			inputCharacters: 3,
			outputCharacters: 120,
			endedAt: 6,
		});
		expect(turn?.execution).toEqual(execution);
		expect(turn?.usage).toEqual({ inputTokens: 900, outputTokens: 40 });
		expect(turnForMessage(state, "m-1")?.turnId).toBe("t1");
	});

	it("null rather than 0 when the provider reports no usage", () => {
		let state = start(emptyConversationDebugState(), "t1");
		state = reduceConversationDebug(
			state,
			{
				kind: "provider-response",
				turnId: "t1",
				data: {
					end: "completed",
					outputCharacters: 10,
					usage: null,
					finishReason: null,
				},
			},
			at(2),
		);
		expect(latestTurn(state)?.usage).toBeNull();
		expect(latestTurn(state)?.outputCharacters).toBe(10);
	});

	it("a turn that lost ownership does not read as committed", () => {
		let state = start(emptyConversationDebugState(), "t1");
		state = reduceConversationDebug(
			state,
			{
				kind: "provider-response",
				turnId: "t1",
				data: {
					end: "completed",
					outputCharacters: 50,
					usage: null,
					finishReason: null,
				},
			},
			at(2),
		);
		state = reduceConversationDebug(
			state,
			{ kind: "turn-discarded", turnId: "t1", data: { reason: "ownership" } },
			at(3),
		);
		const turn = latestTurn(state);
		expect(turn?.status).toBe("discarded");
		expect(turn?.discardReason).toBe("ownership");
		expect(turn?.messageId).toBeNull();
	});

	it("stopping is not a failure", () => {
		let state = start(emptyConversationDebugState(), "t1");
		state = reduceConversationDebug(
			state,
			{
				kind: "provider-response",
				turnId: "t1",
				data: {
					end: "stopped",
					outputCharacters: 12,
					usage: null,
					finishReason: null,
				},
			},
			at(2),
		);
		state = reduceConversationDebug(
			state,
			{ kind: "turn-discarded", turnId: "t1", data: { reason: "empty" } },
			at(3),
		);
		expect(latestTurn(state)?.status).toBe("stopped");
	});

	it("several turns keep their own prompts", () => {
		let state = start(emptyConversationDebugState(), "t1", 1);
		state = reduceConversationDebug(
			state,
			{
				kind: "prompt-assembled",
				turnId: "t1",
				data: { prompt: prompt("첫 번째"), request: request("첫 번째") },
			},
			at(2),
		);
		state = beginConversationTurn(
			state,
			{ turnId: "t2", origin: "regenerate" },
			at(3),
		);
		state = reduceConversationDebug(
			state,
			{
				kind: "prompt-assembled",
				turnId: "t2",
				data: { prompt: prompt("두 번째"), request: request("두 번째") },
			},
			at(4),
		);
		expect(state.turns.map((turn) => turn.request?.system)).toEqual([
			"첫 번째",
			"두 번째",
		]);
		expect(state.turns.map((turn) => turn.index)).toEqual([1, 2]);
	});

	it("a late signal from a turn pushed past the cap makes no new turn", () => {
		const limits = { ...LIMITS, maxTurns: 2 };
		let state = emptyConversationDebugState();
		for (const id of ["t1", "t2", "t3"])
			state = beginConversationTurn(
				state,
				{ turnId: id, origin: "send" },
				{ at: 1, limits },
			);
		expect(state.turns.map((turn) => turn.turnId)).toEqual(["t2", "t3"]);
		expect(state.droppedTurns).toBe(1);

		state = reduceConversationDebug(
			state,
			{ kind: "turn-committed", turnId: "t1", data: { messageId: "m-old" } },
			{ at: 2, limits },
		);
		expect(state.turns.map((turn) => turn.turnId)).toEqual(["t2", "t3"]);
		expect(turnForMessage(state, "m-old")).toBeNull();
	});
});

describe("event list", () => {
	it("one assembly leaves **two**: lore decision and prompt assembly", () => {
		let state = start(emptyConversationDebugState(), "t1");
		state = reduceConversationDebug(
			state,
			{
				kind: "prompt-assembled",
				turnId: "t1",
				data: { prompt: prompt(), request: request() },
			},
			at(2),
		);
		expect(state.log.entries.map((event) => event.kind)).toEqual([
			"turn-started",
			"lore-selected",
			"prompt-assembled",
		]);
		const lore = state.log.entries[1];
		expect(lore?.kind === "lore-selected" && lore.data).toEqual({
			evaluated: 2,
			active: 1,
		});
	});

	it("ids increase monotonically, and that order is the sort axis", () => {
		let state = start(emptyConversationDebugState(), "t1", 100);
		state = reduceConversationDebug(
			state,
			{ kind: "input-accepted", turnId: "t1", data: { characters: 1 } },
			at(1),
		);
		expect(state.log.entries.map((event) => event.id)).toEqual([1, 2]);
	});

	it("past the cap it drops the front and counts them", () => {
		const limits = { ...LIMITS, maxEvents: 3 };
		let state = beginConversationTurn(
			emptyConversationDebugState(),
			{ turnId: "t1", origin: "send" },
			{ at: 1, limits },
		);
		for (let n = 0; n < 5; n += 1)
			state = reduceConversationDebug(
				state,
				{ kind: "input-accepted", turnId: "t1", data: { characters: n } },
				{ at: 2, limits },
			);
		expect(state.log.entries).toHaveLength(3);
		expect(state.log.dropped).toBe(3);
		expect(debugTraceTruncated(state)).toBe(true);
		expect(
			state.log.entries.map((event) =>
				event.kind === "input-accepted" ? event.data.characters : null,
			),
		).toEqual([2, 3, 4]);
	});

	it("events can be selected per turn", () => {
		let state = start(emptyConversationDebugState(), "t1");
		state = beginConversationTurn(
			state,
			{ turnId: "t2", origin: "send" },
			at(2),
		);
		state = reduceConversationDebug(
			state,
			{ kind: "input-accepted", turnId: "t2", data: { characters: 5 } },
			at(3),
		);
		expect(eventsForTurn(state, "t1").map((event) => event.kind)).toEqual([
			"turn-started",
		]);
		expect(eventsForTurn(state, "t2").map((event) => event.kind)).toEqual([
			"turn-started",
			"input-accepted",
		]);
	});

	it("session operations are not tied to a turn", () => {
		const state = reduceConversationDebug(
			emptyConversationDebugState(),
			{
				kind: "session-reset",
				data: {
					sessionId: "s-2",
					startSceneId: null,
					loreCount: 0,
					startSceneCount: 0,
				},
			},
			at(1),
		);
		expect(state.log.entries[0]?.turnId).toBeNull();
	});
});

describe("long values", () => {
	it("text over the cap is truncated, and the truncation remains as a value", () => {
		const limits = { ...LIMITS, maxTextLength: 10 };
		let state = beginConversationTurn(
			emptyConversationDebugState(),
			{ turnId: "t1", origin: "send" },
			{ at: 1, limits },
		);
		state = reduceConversationDebug(
			state,
			{
				kind: "prompt-assembled",
				turnId: "t1",
				data: {
					prompt: prompt("가".repeat(50)),
					request: request("가".repeat(50)),
				},
			},
			{ at: 2, limits },
		);
		const turn = latestTurn(state);
		expect(turn?.truncated).toBe(true);
		expect(turn?.prompt?.blocks[0]?.text).toHaveLength(10);
		expect(turn?.request?.system).toHaveLength(10);
		expect(debugTraceTruncated(state)).toBe(true);
	});

	it("text within the cap is untouched", () => {
		let state = start(emptyConversationDebugState(), "t1");
		state = reduceConversationDebug(
			state,
			{
				kind: "prompt-assembled",
				turnId: "t1",
				data: { prompt: prompt("짧다"), request: request("짧다") },
			},
			at(2),
		);
		expect(latestTurn(state)?.truncated).toBe(false);
		expect(debugTraceTruncated(state)).toBe(false);
	});
});

describe("store", () => {
	it("identity and time come from outside, and every change is announced", () => {
		let clock = 10;
		let issued = 0;
		const store = createConversationDebugStore({
			now: () => clock,
			newTurnId: () => {
				issued += 1;
				return `turn-${issued}`;
			},
		});
		let notified = 0;
		const unsubscribe = store.subscribe(() => {
			notified += 1;
		});

		const turnId = store.beginTurn("send");
		expect(turnId).toBe("turn-1");
		clock = 20;
		store.emit({ kind: "input-accepted", turnId, data: { characters: 4 } });
		expect(notified).toBe(2);
		expect(store.getState().log.entries.map((event) => event.at)).toEqual([
			10, 20,
		]);

		unsubscribe();
		store.emit({ kind: "input-accepted", turnId, data: { characters: 4 } });
		expect(notified).toBe(2);
	});

	it("two stores cannot see each other's events: a new session gets a new store", () => {
		const make = () =>
			createConversationDebugStore({ now: () => 1, newTurnId: () => "t" });
		const previous = make();
		const next = make();
		previous.beginTurn("send");
		expect(next.getState().turns).toHaveLength(0);
		expect(previous.getState().turns).toHaveLength(1);
	});
});
