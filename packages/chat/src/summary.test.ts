import { describe, expect, it } from "vitest";
import type { ChatMemory } from "./memory.ts";
import {
	CHAT_SUMMARY_MAX_LENGTH,
	type ChatSummary,
	clampSummary,
	compareMessagePosition,
	nextSummaryEpoch,
	planHistoryRewind,
	rewindChangesAnything,
	summaryIdFor,
} from "./summary.ts";

const REV = { t: 1, c: 0, d: "device" } as const;

const summary = (over: Partial<ChatSummary> = {}): ChatSummary => ({
	id: summaryIdFor("room"),
	roomId: "room",
	summary: "They agreed to meet at the station.",
	frontier: { createdAt: "2026-08-25T00:10:00.000Z", messageId: "m10" },
	epoch: 0,
	createdAt: "2026-08-25T00:00:00.000Z",
	updatedAt: "2026-08-25T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 0,
	rev: REV,
	...over,
});

const memory = (over: Partial<ChatMemory>): ChatMemory => ({
	id: "mem",
	roomId: "room",
	content: "Kai has the key.",
	source: "user",
	originAt: null,
	pinned: false,
	createdAt: "2026-08-25T00:00:00.000Z",
	updatedAt: "2026-08-25T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 0,
	rev: REV,
	...over,
});

describe("historical summary record", () => {
	/** Both devices must compute the same id, and it must not collide with the room's own row. */
	it("identity derives from the room id and differs from it", () => {
		expect(summaryIdFor("room-9")).toBe(summaryIdFor("room-9"));
		expect(summaryIdFor("room-9")).not.toBe("room-9");
	});

	it("the decoder's fold counts code points and never splits an emoji", () => {
		const emoji = "😀".repeat(CHAT_SUMMARY_MAX_LENGTH + 5);
		const clamped = clampSummary(emoji);
		expect([...clamped].length).toBe(CHAT_SUMMARY_MAX_LENGTH);
		expect(clamped.endsWith("😀")).toBe(true);
		expect(clampSummary("  짧은 요약  ")).toBe("짧은 요약");
	});

	it("orders positions by time, then id", () => {
		expect(
			compareMessagePosition(
				{ createdAt: "a", id: "m2" },
				{ createdAt: "b", id: "m1" },
			),
		).toBe(-1);
		expect(
			compareMessagePosition(
				{ createdAt: "b", id: "m2" },
				{ createdAt: "b", id: "m1" },
			),
		).toBe(1);
		expect(
			compareMessagePosition(
				{ createdAt: "b", id: "m1" },
				{ createdAt: "b", id: "m1" },
			),
		).toBe(0);
	});
});

describe("planHistoryRewind", () => {
	it("retires a summary whose frontier reaches the erased stretch (ties retire)", () => {
		const s = summary();
		expect(
			planHistoryRewind({
				summary: s,
				memories: [],
				cutoffCreatedAt: "2026-08-25T00:10:00.000Z",
			}).resetSummary,
		).toBe(true);
		expect(
			planHistoryRewind({
				summary: s,
				memories: [],
				cutoffCreatedAt: "2026-08-25T00:11:00.000Z",
			}).resetSummary,
		).toBe(false);
	});

	it("an already retired or absent summary is not retired again", () => {
		expect(
			planHistoryRewind({
				summary: summary({ frontier: null, summary: "" }),
				memories: [],
				cutoffCreatedAt: "2026-08-25T00:00:00.000Z",
			}).resetSummary,
		).toBe(false);
		expect(
			planHistoryRewind({ summary: null, memories: [], cutoffCreatedAt: "x" })
				.resetSummary,
		).toBe(false);
	});

	it("a summary with text but no frontier covers unknown history and is retired by any rewrite", () => {
		expect(
			planHistoryRewind({
				summary: summary({ frontier: null, summary: "Bori stole the key." }),
				memories: [],
				cutoffCreatedAt: "2026-08-25T00:00:00.000Z",
			}).resetSummary,
		).toBe(true);
	});

	it("deletes auto memories from the erased stretch, never a human-written one", () => {
		const rewind = planHistoryRewind({
			summary: null,
			memories: [
				memory({
					id: "user-late",
					source: "user",
					createdAt: "2026-08-25T00:20:00.000Z",
				}),
				memory({
					id: "auto-early",
					source: "auto",
					originAt: "2026-08-25T00:01:00.000Z",
				}),
				memory({
					id: "auto-late",
					source: "auto",
					originAt: "2026-08-25T00:12:00.000Z",
				}),
				memory({ id: "auto-unknown", source: "auto", originAt: null }),
			],
			cutoffCreatedAt: "2026-08-25T00:10:00.000Z",
		});
		expect(rewind.staleMemoryIds).toEqual(["auto-late", "auto-unknown"]);
		expect(rewindChangesAnything(rewind)).toBe(true);
	});

	it("an ordinary edit in recent history changes nothing (no empty revision)", () => {
		const rewind = planHistoryRewind({
			summary: summary(),
			memories: [memory({ source: "user" })],
			cutoffCreatedAt: "2026-08-26T00:00:00.000Z",
		});
		expect(rewindChangesAnything(rewind)).toBe(false);
	});

	it("the epoch only rises, so a retirement wins the merge", () => {
		expect(nextSummaryEpoch(null)).toBe(1);
		expect(nextSummaryEpoch(summary({ epoch: 4 }))).toBe(5);
	});
});
