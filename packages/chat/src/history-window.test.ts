import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_WINDOW_MAX } from "./context.ts";
import {
	CHAT_HISTORY_WINDOW_STEP,
	chatHistoryWindow,
	historyWindowStart,
	loadChatHistoryWindow,
} from "./history-window.ts";

const room = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("chatHistoryWindow", () => {
	it("a new or short room sends everything", () => {
		expect(chatHistoryWindow(room(0))).toEqual([]);
		expect(chatHistoryWindow(room(50))).toHaveLength(50);
		expect(chatHistoryWindow(room(CHAT_HISTORY_WINDOW_MAX))).toHaveLength(
			CHAT_HISTORY_WINDOW_MAX,
		);
	});

	it.each([
		50, 61, 79, 80, 500, 5_000,
	])("%i messages: bounded between the floor and the cap", (n) => {
		const w = chatHistoryWindow(room(n));
		expect(w.length).toBeLessThanOrEqual(CHAT_HISTORY_WINDOW_MAX);
		expect(w.length).toBeGreaterThanOrEqual(Math.min(n, CHAT_HISTORY_LIMIT));
		// The window always ends at the newest message.
		expect(w[w.length - 1]).toBe(n - 1);
	});

	it("steps twenty at a time and never slides (the prefix holds between steps)", () => {
		const starts = new Set<number>();
		let previous = -1;
		for (let n = 61; n <= 500; n++) {
			const start = historyWindowStart(n);
			expect(start % CHAT_HISTORY_WINDOW_STEP).toBe(0);
			expect(start).toBeGreaterThanOrEqual(previous);
			if (start !== previous) starts.add(n);
			previous = start;
		}
		// After the first step (at 61), it moves exactly once every twenty messages.
		const moves = [...starts].slice(1);
		expect(moves[0]).toBe(80);
		for (let i = 1; i < moves.length; i++)
			expect((moves[i] ?? 0) - (moves[i - 1] ?? 0)).toBe(
				CHAT_HISTORY_WINDOW_STEP,
			);
	});

	it("has no dependence on any summary or memory state (a 5,000-message room is not sent whole)", () => {
		expect(chatHistoryWindow(room(5_000)).length).toBeLessThan(
			CHAT_HISTORY_WINDOW_MAX,
		);
	});
});

describe("loadChatHistoryWindow", () => {
	const source = (n: number) => {
		const all = room(n);
		const reads = { recent: 0 as number, limits: [] as number[] };
		return {
			reads,
			recent: async (limit: number) => {
				reads.recent++;
				reads.limits.push(limit);
				return all.slice(Math.max(0, n - limit));
			},
			count: async () => n,
		};
	};

	it.each([
		0, 3, 60, 61, 99, 100, 5_000,
	])("%i messages: same as the pure rule, one bounded read", async (n) => {
		const s = source(n);
		expect(await loadChatHistoryWindow(s)).toEqual(chatHistoryWindow(room(n)));
		expect(s.reads.limits).toEqual([CHAT_HISTORY_WINDOW_MAX]);
	});

	it("a message appended between the reads leaves a bounded window", async () => {
		const w = await loadChatHistoryWindow({
			recent: async () => room(81).slice(81 - CHAT_HISTORY_WINDOW_MAX),
			count: async () => 80,
		});
		expect(w.length).toBeGreaterThanOrEqual(CHAT_HISTORY_LIMIT);
		expect(w.length).toBeLessThanOrEqual(CHAT_HISTORY_WINDOW_MAX);
	});
});
