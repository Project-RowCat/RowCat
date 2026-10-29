import { describe, expect, it } from "vitest";
import {
	CHAT_SUMMARY_MAX_LENGTH,
	clampSummary,
	compareMessagePosition,
	createSummaryRecord,
	isAfterFrontier,
	summaryIdFor,
} from "./summary.ts";

const REV = { t: 1, c: 0, d: "device" } as const;

describe("summary record", () => {
	/**
	 * A random id would let two devices that each summarize the same room create two records with
	 * different identities. Sync cannot merge them, so both would survive.
	 */
	it("identity derives from the room id", () => {
		const record = createSummaryRecord(
			{ roomId: "room-9", summary: "S", frontier: null },
			{ now: "2026-08-25T00:00:00.000Z", rev: REV },
		);
		expect(record.id).toBe(summaryIdFor("room-9"));
		expect(record.roomId).toBe("room-9");
	});

	/**
	 * The server's primary key is (owner, id) and does not include the type. Using the room id as-is
	 * would make two records contend for the same server row. Push would fail its `baseVersion` check
	 * forever, stalling sync for that room.
	 */
	it("differs from the room id", () => {
		expect(summaryIdFor("room-9")).not.toBe("room-9");
		/** Both devices must compute the same value. That is why the id is derived. */
		expect(summaryIdFor("room-9")).toBe(summaryIdFor("room-9"));
	});

	it("a new record's epoch is 0", () => {
		const record = createSummaryRecord(
			{ roomId: "room", summary: "S", frontier: null },
			{ now: "2026-08-25T00:00:00.000Z", rev: REV },
		);
		expect(record.epoch).toBe(0);
	});

	it("folds within the cap at save time", () => {
		const record = createSummaryRecord(
			{ roomId: "room", summary: "가".repeat(9_000), frontier: null },
			{ now: "2026-08-25T00:00:00.000Z", rev: REV },
		);
		expect([...record.summary].length).toBe(CHAT_SUMMARY_MAX_LENGTH);
	});
});

describe("folding", () => {
	/**
	 * A plain `slice` cuts UTF-16 code units and can split a surrogate pair, leaving a broken
	 * character. That character becomes input to the next summary request.
	 */
	it("counts code points: does not cut an emoji in half", () => {
		const emoji = "🎈".repeat(CHAT_SUMMARY_MAX_LENGTH + 10);
		const clamped = clampSummary(emoji);
		expect([...clamped].length).toBeLessThanOrEqual(CHAT_SUMMARY_MAX_LENGTH);
		expect(clamped).not.toContain("�");
		expect([...clamped].every((point) => point === "🎈")).toBe(true);
	});

	it("leaves values within the cap untouched", () => {
		expect(clampSummary("  짧은 요약  ")).toBe("짧은 요약");
	});
});

describe("frontier order", () => {
	/**
	 * The order must match the storage sort. If it diverges, already-processed messages get summarized
	 * again (duplicate memories), or unprocessed ones are skipped and never summarized.
	 */
	it("time first, then id on ties", () => {
		expect(
			compareMessagePosition(
				{ createdAt: "a", id: "z" },
				{ createdAt: "b", id: "a" },
			),
		).toBeLessThan(0);
		expect(
			compareMessagePosition(
				{ createdAt: "a", id: "a" },
				{ createdAt: "a", id: "b" },
			),
		).toBeLessThan(0);
		expect(
			compareMessagePosition(
				{ createdAt: "a", id: "a" },
				{ createdAt: "a", id: "a" },
			),
		).toBe(0);
	});

	it("without a frontier every message is unprocessed", () => {
		expect(isAfterFrontier({ createdAt: "a", id: "a" }, null)).toBe(true);
	});

	it("the frontier itself is already processed", () => {
		const frontier = { createdAt: "b", messageId: "m5" };
		expect(isAfterFrontier({ createdAt: "b", id: "m5" }, frontier)).toBe(false);
		expect(isAfterFrontier({ createdAt: "b", id: "m6" }, frontier)).toBe(true);
		expect(isAfterFrontier({ createdAt: "a", id: "m9" }, frontier)).toBe(false);
	});
});
