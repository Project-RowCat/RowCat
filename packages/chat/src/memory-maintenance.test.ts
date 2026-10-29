import { describe, expect, it } from "vitest";
import {
	CHAT_AUTO_MEMORY_CONTENT_MAX_LENGTH,
	CHAT_AUTO_MEMORY_MAX_PER_ROOM,
	type ChatMemory,
	type ChatMemorySource,
	createMemoryRecord,
} from "./memory.ts";
import {
	CHAT_MAINTENANCE_BATCH_CHAR_BUDGET,
	CHAT_MAINTENANCE_BATCH_MAX,
	CHAT_MAINTENANCE_MAX_ADDS_PER_RUN,
	CHAT_MAINTENANCE_RECENT_KEEP,
	CHAT_MAINTENANCE_TRIGGER,
	type ChatMaintenanceResult,
	type MaintenanceMessage,
	maintenanceStillApplies,
	nextSummaryEpoch,
	planMaintenanceRewind,
	planMemoryMaintenance,
	rewindChangesAnything,
	selectMaintenanceBatch,
	shouldRunMemoryMaintenance,
} from "./memory-maintenance.ts";
import { CHAT_SUMMARY_MAX_LENGTH, type ChatSummary } from "./summary.ts";

const REV = { t: 1, c: 0, d: "device" } as const;

/** Timestamps must strictly increase. The storage ordering depends on that. */
const message = (
	index: number,
	content = `말 ${index}`,
): MaintenanceMessage => ({
	id: `m${String(index).padStart(4, "0")}`,
	role: index % 2 === 0 ? "user" : "assistant",
	speaker: index % 2 === 0 ? "유나" : "",
	content,
	createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
});

const messages = (count: number): MaintenanceMessage[] =>
	Array.from({ length: count }, (_, index) => message(index + 1));

function memory(
	id: string,
	content: string,
	source: ChatMemorySource = "user",
	originAt: string | null = null,
): ChatMemory {
	return {
		...createMemoryRecord(
			{ roomId: "room", content, source, originAt },
			{ id, now: "2026-08-25T00:00:00.000Z", rev: REV },
		),
	};
}

const summaryRecord = (overrides: Partial<ChatSummary> = {}): ChatSummary => ({
	id: "room",
	roomId: "room",
	summary: "지금까지의 이야기.",
	frontier: null,
	epoch: 0,
	createdAt: "2026-08-25T00:00:00.000Z",
	updatedAt: "2026-08-25T00:00:00.000Z",
	deletedAt: null,
	dirty: 1,
	serverVersion: 0,
	rev: REV,
	...overrides,
});

const result = (
	overrides: Partial<ChatMaintenanceResult> = {},
): ChatMaintenanceResult => ({
	summary: "새 요약.",
	memoryOperations: [],
	...overrides,
});

describe("batch selection", () => {
	it("the recent verbatim span is not summarized", () => {
		/**
		 * This assertion is the whole check that the same content never sits in two blocks. If the
		 * frontier moves into the recent window, that stretch appears both as raw messages and as
		 * summary.
		 */
		const all = messages(
			CHAT_MAINTENANCE_RECENT_KEEP + CHAT_MAINTENANCE_TRIGGER,
		);
		const batch = selectMaintenanceBatch({ messages: all, frontier: null });
		expect(batch).not.toBeNull();
		const last = batch?.messages[batch.messages.length - 1];
		expect(last?.id).toBe(all[CHAT_MAINTENANCE_TRIGGER - 1].id);
	});

	it("does not run before enough accumulates", () => {
		const short = messages(
			CHAT_MAINTENANCE_RECENT_KEEP + CHAT_MAINTENANCE_TRIGGER - 1,
		);
		expect(
			selectMaintenanceBatch({ messages: short, frontier: null }),
		).toBeNull();
		expect(
			shouldRunMemoryMaintenance({ messages: short, frontier: null }),
		).toBe(false);
	});

	it("processes nothing in a short conversation", () => {
		expect(
			selectMaintenanceBatch({ messages: messages(10), frontier: null }),
		).toBeNull();
	});

	it("processes only after the frontier: never sees the same span twice", () => {
		const all = messages(CHAT_MAINTENANCE_RECENT_KEEP + 60);
		const first = selectMaintenanceBatch({ messages: all, frontier: null });
		expect(first).not.toBeNull();
		if (!first) return;

		const second = selectMaintenanceBatch({
			messages: all,
			frontier: first.through,
		});
		expect(second).not.toBeNull();
		const overlap = second?.messages.filter((message) =>
			first.messages.some((seen) => seen.id === message.id),
		);
		expect(overlap).toEqual([]);
	});

	it("a backlogged room catches up by the stride only", () => {
		const all = messages(CHAT_MAINTENANCE_RECENT_KEEP + 500);
		const batch = selectMaintenanceBatch({ messages: all, frontier: null });
		expect(batch?.messages.length).toBe(CHAT_MAINTENANCE_BATCH_MAX);
		expect(batch?.remaining).toBe(500 - CHAT_MAINTENANCE_BATCH_MAX);
	});

	it("over the character budget it trims **from the end**", () => {
		/**
		 * Trimming from the front would leave a gap between the frontier and the batch, and messages in
		 * that gap would never be processed.
		 */
		const fat = "가".repeat(CHAT_MAINTENANCE_BATCH_CHAR_BUDGET / 4);
		const all = [
			...Array.from({ length: CHAT_MAINTENANCE_TRIGGER + 10 }, (_, index) =>
				message(index + 1, fat),
			),
			...Array.from({ length: CHAT_MAINTENANCE_RECENT_KEEP }, (_, index) =>
				message(index + 100),
			),
		];
		const batch = selectMaintenanceBatch({ messages: all, frontier: null });
		expect(batch).not.toBeNull();
		expect(batch?.messages.length).toBeLessThan(CHAT_MAINTENANCE_TRIGGER + 10);
		expect(batch?.messages[0]?.id).toBe(all[0].id);
	});

	it("one huge message does not stall that room's progress", () => {
		const huge = "가".repeat(CHAT_MAINTENANCE_BATCH_CHAR_BUDGET * 3);
		const all = [
			message(1, huge),
			...Array.from({ length: CHAT_MAINTENANCE_TRIGGER - 1 }, (_, index) =>
				message(index + 2),
			),
			...Array.from({ length: CHAT_MAINTENANCE_RECENT_KEEP }, (_, index) =>
				message(index + 100),
			),
		];
		const batch = selectMaintenanceBatch({ messages: all, frontier: null });
		expect(batch?.messages.length).toBe(1);
	});
});

const through = { createdAt: "2026-08-25T01:00:00.000Z", messageId: "m0060" };

describe("plan · protecting manual memories", () => {
	it("refuses a remove pointing at a manual memory", () => {
		const manual = memory("manual-1", "카이는 왼손잡이다.");
		const plan = planMemoryMaintenance({
			memories: [manual],
			summary: null,
			result: result({
				memoryOperations: [{ type: "remove", memoryId: "manual-1" }],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});

	it("refuses a replace pointing at a manual memory", () => {
		const manual = memory("manual-1", "카이는 왼손잡이다.");
		const plan = planMemoryMaintenance({
			memories: [manual],
			summary: null,
			result: result({
				memoryOperations: [
					{
						type: "replace",
						memoryId: "manual-1",
						content: "카이는 오른손잡이다.",
					},
				],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});

	it("does not recreate the same fact as an automatic memory", () => {
		const manual = memory("manual-1", "카이는 왼손잡이다.");
		const plan = planMemoryMaintenance({
			memories: [manual],
			summary: null,
			result: result({
				memoryOperations: [{ type: "add", content: "카이는 왼손잡이다" }],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});

	it("one operation cannot replace, delete or duplicate a manual memory", () => {
		const manual = memory("manual-1", "카이는 왼손잡이다.");
		const plan = planMemoryMaintenance({
			memories: [manual],
			summary: null,
			result: result({
				memoryOperations: [
					{ type: "remove", memoryId: "manual-1" },
					{ type: "replace", memoryId: "manual-1", content: "바뀐 사실" },
					{ type: "add", content: "카이는 왼손잡이다." },
				],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});
});

describe("plan · maintaining automatic memories", () => {
	it("replaces a stale automatic fact", () => {
		const auto = memory(
			"auto-1",
			"카이는 창고 열쇠를 가지고 있다.",
			"auto",
			"2026-08-24T00:00:00.000Z",
		);
		const plan = planMemoryMaintenance({
			memories: [auto],
			summary: null,
			result: result({
				memoryOperations: [
					{
						type: "replace",
						memoryId: "auto-1",
						content: "카이는 열쇠를 유나에게 건넸다.",
					},
				],
			}),
			through,
		});
		expect(plan.operations).toEqual([
			{
				type: "replace",
				memoryId: "auto-1",
				content: "카이는 열쇠를 유나에게 건넸다.",
			},
		]);
	});

	it("a rewording replacement is not blocked as a duplicate of itself", () => {
		const auto = memory("auto-1", "카이는 열쇠를 가지고 있다", "auto", "x");
		const plan = planMemoryMaintenance({
			memories: [auto],
			summary: null,
			result: result({
				memoryOperations: [
					{
						type: "replace",
						memoryId: "auto-1",
						content: "카이는 열쇠를 가지고 있다.",
					},
				],
			}),
			through,
		});
		expect(plan.operations).toHaveLength(1);
	});

	it("deletes automatic memories", () => {
		const auto = memory("auto-1", "지나간 사실", "auto", "x");
		const plan = planMemoryMaintenance({
			memories: [auto],
			summary: null,
			result: result({
				memoryOperations: [{ type: "remove", memoryId: "auto-1" }],
			}),
			through,
		});
		expect(plan.operations).toEqual([{ type: "remove", memoryId: "auto-1" }]);
	});

	it("drops operations pointing at missing ids", () => {
		const plan = planMemoryMaintenance({
			memories: [],
			summary: null,
			result: result({
				memoryOperations: [
					{ type: "remove", memoryId: "지어낸-id" },
					{ type: "replace", memoryId: "없는-id", content: "무엇" },
				],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});

	it("pointing at the same memory twice keeps only the first", () => {
		const auto = memory("auto-1", "원래 사실", "auto", "x");
		const plan = planMemoryMaintenance({
			memories: [auto],
			summary: null,
			result: result({
				memoryOperations: [
					{ type: "replace", memoryId: "auto-1", content: "첫 번째" },
					{ type: "replace", memoryId: "auto-1", content: "두 번째" },
					{ type: "remove", memoryId: "auto-1" },
				],
			}),
			through,
		});
		expect(plan.operations).toEqual([
			{ type: "replace", memoryId: "auto-1", content: "첫 번째" },
		]);
	});
});

describe("plan · duplicates", () => {
	it("folds duplicate candidates within one batch", () => {
		const plan = planMemoryMaintenance({
			memories: [],
			summary: null,
			result: result({
				memoryOperations: [
					{ type: "add", content: "카이는 왼손잡이다." },
					{ type: "add", content: "카이는  왼손잡이다" },
					{ type: "add", content: "카이는 왼손잡이다!" },
				],
			}),
			through,
		});
		expect(plan.operations).toHaveLength(1);
	});

	it("facts differing only in case and whitespace are the same fact", () => {
		const existing = memory("auto-1", "Kai has the key", "auto", "x");
		const plan = planMemoryMaintenance({
			memories: [existing],
			summary: null,
			result: result({
				memoryOperations: [{ type: "add", content: "kai   has the key." }],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});
});

describe("plan · caps", () => {
	it("adds at most six at a time", () => {
		const plan = planMemoryMaintenance({
			memories: [],
			summary: null,
			result: result({
				memoryOperations: Array.from({ length: 12 }, (_, index) => ({
					type: "add" as const,
					content: `사실 ${index}`,
				})),
			}),
			through,
		});
		expect(plan.operations).toHaveLength(CHAT_MAINTENANCE_MAX_ADDS_PER_RUN);
	});

	it("refuses long content rather than truncating", () => {
		const plan = planMemoryMaintenance({
			memories: [],
			summary: null,
			result: result({
				memoryOperations: [
					{
						type: "add",
						content: "가".repeat(CHAT_AUTO_MEMORY_CONTENT_MAX_LENGTH + 1),
					},
				],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});

	it("takes no new candidates when automatic memories are full; manual memories stay", () => {
		const full = Array.from({ length: CHAT_AUTO_MEMORY_MAX_PER_ROOM }, (_, i) =>
			memory(`auto-${i}`, `자동 사실 ${i}`, "auto", "x"),
		);
		const manual = memory("manual-1", "사람이 쓴 것");
		const plan = planMemoryMaintenance({
			memories: [...full, manual],
			summary: null,
			result: result({
				memoryOperations: [{ type: "add", content: "새 사실" }],
			}),
			through,
		});
		expect(plan.operations).toEqual([]);
	});

	it("a removal that frees a slot allows that many additions", () => {
		const full = Array.from({ length: CHAT_AUTO_MEMORY_MAX_PER_ROOM }, (_, i) =>
			memory(`auto-${i}`, `자동 사실 ${i}`, "auto", "x"),
		);
		const plan = planMemoryMaintenance({
			memories: full,
			summary: null,
			result: result({
				memoryOperations: [
					{ type: "remove", memoryId: "auto-0" },
					{ type: "add", content: "새 사실" },
				],
			}),
			through,
		});
		expect(plan.operations).toHaveLength(2);
	});

	it("the summary folds within the cap", () => {
		const plan = planMemoryMaintenance({
			memories: [],
			summary: null,
			result: result({ summary: "가".repeat(CHAT_SUMMARY_MAX_LENGTH + 500) }),
			through,
		});
		expect([...plan.summary].length).toBe(CHAT_SUMMARY_MAX_LENGTH);
	});
});

describe("plan · summary", () => {
	it("continues the previous summary; the frontier moves to the batch's end", () => {
		const plan = planMemoryMaintenance({
			memories: [],
			summary: summaryRecord({
				summary: "S1",
				frontier: { createdAt: "2026-08-25T00:30:00.000Z", messageId: "m0010" },
			}),
			result: result({ summary: "S2" }),
			through,
		});
		expect(plan.summary).toBe("S2");
		expect(plan.through).toEqual(through);
		expect(plan.expect.frontier?.messageId).toBe("m0010");
	});

	it("an empty summary does not erase the stored summary", () => {
		const plan = planMemoryMaintenance({
			memories: [],
			summary: summaryRecord({ summary: "지켜야 하는 맥락." }),
			result: result({ summary: "   " }),
			through,
		});
		expect(plan.summary).toBe("지켜야 하는 맥락.");
	});
});

describe("commit conditions", () => {
	const plan = () =>
		planMemoryMaintenance({
			memories: [],
			summary: summaryRecord({
				epoch: 2,
				frontier: { createdAt: "a", messageId: "m1" },
			}),
			result: result(),
			through,
		});

	it("commits when unchanged since the start", () => {
		expect(
			maintenanceStillApplies(
				plan(),
				summaryRecord({
					epoch: 2,
					frontier: { createdAt: "a", messageId: "m1" },
				}),
			),
		).toBe(true);
	});

	it("does not commit if a rewind happened in between", () => {
		expect(
			maintenanceStillApplies(
				plan(),
				summaryRecord({ epoch: 3, frontier: null }),
			),
		).toBe(false);
	});

	it("does not commit if another maintenance run advanced first", () => {
		expect(
			maintenanceStillApplies(
				plan(),
				summaryRecord({
					epoch: 2,
					frontier: { createdAt: "b", messageId: "m9" },
				}),
			),
		).toBe(false);
	});

	it("does not commit if a summary appeared meanwhile in a room that had none", () => {
		const fresh = planMemoryMaintenance({
			memories: [],
			summary: null,
			result: result(),
			through,
		});
		expect(maintenanceStillApplies(fresh, null)).toBe(true);
		expect(
			maintenanceStillApplies(
				fresh,
				summaryRecord({ frontier: { createdAt: "a", messageId: "m1" } }),
			),
		).toBe(false);
	});
});

describe("rewind", () => {
	const cutoff = "2026-08-25T12:00:00.000Z";
	const before = "2026-08-25T11:00:00.000Z";
	const after = "2026-08-25T13:00:00.000Z";

	it("does nothing when the frontier falls short of the cut span", () => {
		/**
		 * Ordinary edits and regenerations land here. Those actions happen in the recent raw window,
		 * which by definition is not yet processed.
		 */
		const rewind = planMaintenanceRewind({
			summary: summaryRecord({
				frontier: { createdAt: before, messageId: "m1" },
			}),
			memories: [memory("auto-1", "옛 사실", "auto", before)],
			cutoffCreatedAt: cutoff,
		});
		expect(rewind).toEqual({ resetSummary: false, staleMemoryIds: [] });
		expect(rewindChangesAnything(rewind)).toBe(false);
	});

	it("discards the summary when the frontier reaches the cut span", () => {
		const rewind = planMaintenanceRewind({
			summary: summaryRecord({
				frontier: { createdAt: after, messageId: "m9" },
			}),
			memories: [],
			cutoffCreatedAt: cutoff,
		});
		expect(rewind.resetSummary).toBe(true);
	});

	it("deletes only automatic memories drawn from the vanished span", () => {
		const rewind = planMaintenanceRewind({
			summary: summaryRecord({
				frontier: { createdAt: after, messageId: "m9" },
			}),
			memories: [
				memory("auto-old", "살아남는 대화에서 나온 사실", "auto", before),
				memory("auto-new", "지워질 구간에서 나온 사실", "auto", after),
				memory("manual", "사람이 쓴 것"),
			],
			cutoffCreatedAt: cutoff,
		});
		expect(rewind.staleMemoryIds).toEqual(["auto-new"]);
	});

	it("human-written memories survive any rewrite", () => {
		const rewind = planMaintenanceRewind({
			summary: summaryRecord({
				frontier: { createdAt: after, messageId: "m9" },
			}),
			memories: [
				memory("manual-1", "하나"),
				memory("manual-2", "둘"),
				memory("manual-3", "셋"),
			],
			cutoffCreatedAt: "1970-01-01T00:00:00.000Z",
		});
		expect(rewind.staleMemoryIds).toEqual([]);
	});

	it("deletes automatic memories that cannot state their origin", () => {
		const rewind = planMaintenanceRewind({
			summary: null,
			memories: [memory("auto-1", "어디서 왔는지 모르는 사실", "auto", null)],
			cutoffCreatedAt: cutoff,
		});
		expect(rewind.staleMemoryIds).toEqual(["auto-1"]);
	});

	it("a rewind always raises the epoch", () => {
		expect(nextSummaryEpoch(null)).toBe(1);
		expect(nextSummaryEpoch(summaryRecord({ epoch: 7 }))).toBe(8);
	});
});
