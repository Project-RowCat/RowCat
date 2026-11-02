import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_WINDOW_MAX } from "./context.ts";
import {
	type ChatHistoryWindowSource,
	chatHistoryWindow,
	loadChatHistoryWindow,
} from "./history-window.ts";
import {
	CHAT_MAINTENANCE_RECENT_KEEP,
	CHAT_MAINTENANCE_TRIGGER,
	selectMaintenanceBatch,
} from "./memory-maintenance.ts";
import type { ChatSummaryFrontier } from "./summary.ts";

/**
 * The window a turn sends verbatim. What it promises, by value: each message is in the window or
 * behind the frontier (never neither), the window never shrinks below the old fixed 40, it never
 * exceeds the cap, and it stays put between summaries (and for ten turns at a time when no summary
 * comes), so the history prefix matches the previous turn's request and the prompt cache can read it
 * back.
 */

const at = (index: number) => ({
	id: `m${String(index).padStart(4, "0")}`,
	createdAt: `2026-11-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
});

const conversation = (length: number) =>
	Array.from({ length }, (_, index) => at(index));

const frontierAt = (index: number): ChatSummaryFrontier => ({
	createdAt: at(index).createdAt,
	messageId: at(index).id,
});

const ids = (messages: readonly { id: string }[]) =>
	messages.map((message) => message.id);

describe("chatHistoryWindow", () => {
	it("sends everything while a conversation is shorter than the cap", () => {
		const messages = conversation(55);
		expect(chatHistoryWindow(messages, null)).toEqual(messages);
	});

	/**
	 * No summary yet (or a work test): past the cap the start jumps twenty at a time from the first
	 * message, so 90 messages send the last 50 rather than the newest 60.
	 */
	it("without a frontier, steps back from the cap instead of growing", () => {
		const messages = conversation(90);
		expect(ids(chatHistoryWindow(messages, null))).toEqual(
			ids(messages.slice(40)),
		);
	});

	it("starts right after the frontier", () => {
		const messages = conversation(50);
		// The frontier sits at index 9: messages 0..9 are summarized.
		expect(ids(chatHistoryWindow(messages, frontierAt(9)))).toEqual(
			ids(messages.slice(10)),
		);
	});

	/**
	 * After a delete-from-here the frontier can sit inside the last 40. The window still sends 40, the
	 * same as before this rule: a turn never sees fewer messages than it used to.
	 */
	it("never sends fewer than the old fixed window", () => {
		const messages = conversation(50);
		expect(chatHistoryWindow(messages, frontierAt(30))).toHaveLength(
			CHAT_HISTORY_LIMIT,
		);
		expect(chatHistoryWindow(messages, frontierAt(49))).toHaveLength(
			CHAT_HISTORY_LIMIT,
		);
	});

	/**
	 * Maintenance lagging: 94 messages after the frontier at index 5 put the start two steps (40)
	 * past it, as if two summaries had run there.
	 */
	it("never sends more than the cap", () => {
		const messages = conversation(100);
		const window = chatHistoryWindow(messages, frontierAt(5));
		expect(ids(window)).toEqual(ids(messages.slice(6 + 40)));
		expect(window.length).toBeLessThanOrEqual(CHAT_HISTORY_WINDOW_MAX);
	});

	/**
	 * The cache regression this rule fixes. A room whose summary never commits used to keep the newest
	 * 60, so from the cap on every turn dropped its oldest message and rewrote the whole history. Now
	 * the start moves once per twenty messages (ten turns), between moves each window is a prefix of
	 * the next, and every window stays inside the band a healthy room uses.
	 */
	it("past the cap, holds its start for ten turns at a time", () => {
		for (const frontier of [null, frontierAt(7)]) {
			let previous = chatHistoryWindow(conversation(60), frontier);
			let moves = 0;
			for (let length = 62; length <= 260; length += 2) {
				const next = chatHistoryWindow(conversation(length), frontier);
				expect(next.length).toBeGreaterThan(CHAT_HISTORY_LIMIT);
				expect(next.length).toBeLessThanOrEqual(CHAT_HISTORY_WINDOW_MAX);
				if (next[0]?.id === previous[0]?.id)
					expect(ids(next.slice(0, previous.length))).toEqual(ids(previous));
				else moves += 1;
				previous = next;
			}
			// 200 messages past the cap, one move per twenty.
			expect(moves).toBe(10);
		}
	});

	/**
	 * The point of the rule. Between summaries a new turn only appends: the previous window is a
	 * prefix of the next one, so the cached history is read back instead of rewritten.
	 */
	it("only appends between summaries", () => {
		const frontier = frontierAt(19);
		let previous = chatHistoryWindow(conversation(60), frontier);
		for (let length = 61; length <= 80; length += 1) {
			const next = chatHistoryWindow(conversation(length), frontier);
			expect(ids(next.slice(0, previous.length))).toEqual(ids(previous));
			previous = next;
		}
	});

	/**
	 * Run the real batch selection alongside the window across a long conversation: every message
	 * is either in the window or at or before the frontier. The old fixed window failed this for up
	 * to `CHAT_MAINTENANCE_TRIGGER - 1` messages at a time.
	 */
	it("leaves no message outside both the window and the summary", () => {
		const all = conversation(400).map((position) => ({
			...position,
			role: "user" as const,
			speaker: "u",
			content: "x",
		}));
		let frontier: ChatSummaryFrontier | null = null;
		for (let length = 1; length <= all.length; length += 1) {
			const live = all.slice(0, length);
			const window = chatHistoryWindow(live, frontier);
			const summarizedThrough =
				frontier === null
					? -1
					: live.findIndex((message) => message.id === frontier?.messageId);
			const windowStart = live.length - window.length;
			expect(windowStart).toBeLessThanOrEqual(summarizedThrough + 1);
			expect(window.length).toBeLessThanOrEqual(CHAT_HISTORY_WINDOW_MAX);

			// What `maintain` does after the response is saved.
			const batch = selectMaintenanceBatch({ messages: live, frontier });
			if (batch) frontier = batch.through;
		}
	});
});

describe("loadChatHistoryWindow", () => {
	/** A store over one conversation that records whether the whole room was read. */
	const source = (
		length: number,
		frontier: ChatSummaryFrontier | null,
	): ChatHistoryWindowSource<ReturnType<typeof at>> & { readAll: boolean } => {
		const messages = conversation(length);
		const state = {
			readAll: false,
			recent: async (limit: number) => messages.slice(-limit),
			all: async () => {
				state.readAll = true;
				return messages;
			},
			frontier: async () => frontier,
		};
		return state;
	};

	it("reads only the newest page while the room is within the cap", async () => {
		const within = source(CHAT_HISTORY_WINDOW_MAX, null);
		expect(await loadChatHistoryWindow(within)).toHaveLength(
			CHAT_HISTORY_WINDOW_MAX,
		);
		expect(within.readAll).toBe(false);

		// Long room, but the frontier sits inside the newest page.
		const summarized = source(300, frontierAt(259));
		expect(ids(await loadChatHistoryWindow(summarized))).toEqual(
			ids(conversation(300).slice(260)),
		);
		expect(summarized.readAll).toBe(false);
	});

	/** The newest page alone cannot say where the step lands; the count after the frontier can. */
	it("reads the whole room past the cap and steps from the frontier", async () => {
		const lagging = source(300, frontierAt(9));
		const window = await loadChatHistoryWindow(lagging);
		expect(lagging.readAll).toBe(true);
		// 290 after the frontier: the start is 240 past it.
		expect(ids(window)).toEqual(ids(conversation(300).slice(10 + 240)));
	});
});

describe("CHAT_MAINTENANCE_TRIGGER", () => {
	/** A run is due exactly when the window is full; set apart, the gap or the overrun comes back. */
	it("is the window's room above the recent keep", () => {
		expect(CHAT_MAINTENANCE_TRIGGER).toBe(
			CHAT_HISTORY_WINDOW_MAX - CHAT_MAINTENANCE_RECENT_KEEP,
		);
		expect(CHAT_MAINTENANCE_RECENT_KEEP).toBe(CHAT_HISTORY_LIMIT);
	});
});
