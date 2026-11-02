import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_WINDOW_MAX } from "./context.ts";
import { chatHistoryWindow } from "./history-window.ts";
import {
	CHAT_MAINTENANCE_RECENT_KEEP,
	CHAT_MAINTENANCE_TRIGGER,
	selectMaintenanceBatch,
} from "./memory-maintenance.ts";
import type { ChatSummaryFrontier } from "./summary.ts";

/**
 * The window a turn sends verbatim. What it promises, by value: each message is in the window or
 * behind the frontier (never neither), the window never shrinks below the old fixed 40, it never
 * exceeds the cap, and it stays put between summaries, so the history prefix matches the previous
 * turn's request and the prompt cache can read it back.
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

	/** No summary yet (or a work test): slides at the cap rather than growing without bound. */
	it("without a frontier, keeps the newest messages up to the cap", () => {
		const messages = conversation(90);
		expect(ids(chatHistoryWindow(messages, null))).toEqual(
			ids(messages.slice(-CHAT_HISTORY_WINDOW_MAX)),
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

	/** Maintenance lagging: more than the cap after the frontier slides at the cap. */
	it("never sends more than the cap", () => {
		const messages = conversation(100);
		expect(ids(chatHistoryWindow(messages, frontierAt(5)))).toEqual(
			ids(messages.slice(-CHAT_HISTORY_WINDOW_MAX)),
		);
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

describe("CHAT_MAINTENANCE_TRIGGER", () => {
	/** A run is due exactly when the window is full; set apart, the gap or the overrun comes back. */
	it("is the window's room above the recent keep", () => {
		expect(CHAT_MAINTENANCE_TRIGGER).toBe(
			CHAT_HISTORY_WINDOW_MAX - CHAT_MAINTENANCE_RECENT_KEEP,
		);
		expect(CHAT_MAINTENANCE_RECENT_KEEP).toBe(CHAT_HISTORY_LIMIT);
	});
});
