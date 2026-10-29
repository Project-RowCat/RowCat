import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./model.ts";
import { chatUsageView } from "./usage-view.ts";

/**
 * Usage table rule: unknown is not zero. Treating an unreported response as `?? 0` counts it as
 * using no tokens, so the total always comes out below the real figure, without any error.
 */

let seq = 0;
const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => {
	seq += 1;
	return {
		id: `m${seq}`,
		roomId: "r1",
		role: "assistant",
		speaker: "",
		content: "답",
		createdAt: `2026-09-12T00:00:${String(seq).padStart(2, "0")}.000Z`,
		updatedAt: "2026-09-12T00:00:00.000Z",
		deletedAt: null,
		dirty: 0,
		serverVersion: 0,
		rev: { t: 1, c: 0, d: "device" },
		...overrides,
	};
};

describe("chatUsageView", () => {
	it("only responses stand in the table, newest first", () => {
		const view = chatUsageView([
			message({ inputTokens: 10, outputTokens: 2 }),
			message({ role: "user" }),
			message({ inputTokens: 30, outputTokens: 4 }),
		]);
		expect(view.rows.map((row) => row.inputTokens)).toEqual([30, 10]);
	});

	/** This check prevents the `?? 0` mistake. */
	it("an axis nobody reported has no key in the total either", () => {
		const view = chatUsageView([
			message({ inputTokens: 10, outputTokens: 2 }),
			message({ inputTokens: 20, outputTokens: 3 }),
		]);
		expect(view.totals).toEqual({ inputTokens: 30, outputTokens: 5 });
		expect("cachedInputTokens" in view.totals).toBe(false);
	});

	it("an axis reported by one side sums only what was reported", () => {
		const view = chatUsageView([
			message({ inputTokens: 10, cachedInputTokens: 4 }),
			message({ inputTokens: 20 }),
		]);
		expect(view.totals).toEqual({ inputTokens: 30, cachedInputTokens: 4 });
	});

	/** States what the total did not count, so the number can be read correctly. */
	it("counts responses with unknown usage", () => {
		const view = chatUsageView([
			message({ inputTokens: 10 }),
			message(),
			message(),
		]);
		expect(view.unreported).toBe(2);
	});

	/**
	 * Responses that did not report usage still get a row. Interrupted turns are the most likely to
	 * lack a usage frame, so dropping those rows would hide exactly the turns this table is opened to
	 * find.
	 */
	it("responses that reported no usage still get a row", () => {
		const view = chatUsageView([
			message({ inputTokens: 10 }),
			message({ incomplete: true }),
		]);
		expect(view.rows).toHaveLength(2);
		expect(view.rows[0]?.outcome).toBe("incomplete");
		expect("inputTokens" in (view.rows[0] ?? {})).toBe(false);
	});

	/** Folds the two stored flags into one word, so the screen does not re-read the record. */
	it("reads how each ended as is", () => {
		const view = chatUsageView([
			message({ inputTokens: 1 }),
			message({ inputTokens: 1, incomplete: true }),
			message({ inputTokens: 1, truncated: true }),
		]);
		expect(view.rows.map((row) => row.outcome)).toEqual([
			"truncated",
			"incomplete",
			"complete",
		]);
	});

	it("truncated comes before interrupted when both hold", () => {
		const view = chatUsageView([
			message({ inputTokens: 1, truncated: true, incomplete: true }),
		]);
		expect(view.rows[0]?.outcome).toBe("truncated");
	});

	/**
	 * A deleted response is no longer part of the conversation, so it is left out of the totals too.
	 */
	it("deleted responses are not counted", () => {
		const view = chatUsageView([
			message({ inputTokens: 10 }),
			message({ inputTokens: 999, deletedAt: "2026-09-12T00:00:09.000Z" }),
		]);
		expect(view.totals.inputTokens).toBe(10);
		expect(view.unreported).toBe(0);
	});

	/** User messages carry no usage. The unit of counting is the assistant response. */
	it("user turns are not counted", () => {
		const view = chatUsageView([
			message({ role: "user", inputTokens: 99 }),
			message({ role: "user" }),
		]);
		expect(view.rows).toHaveLength(0);
		expect(view.unreported).toBe(0);
	});

	/**
	 * Only the list is cut; totals cover the whole conversation. Cutting the totals would silently
	 * shrink them in long conversations.
	 */
	it("the list is cut but the total counts everything", () => {
		const messages = Array.from({ length: 25 }, () =>
			message({ inputTokens: 2, outputTokens: 1 }),
		);
		const view = chatUsageView(messages, { limit: 5 });
		expect(view.rows).toHaveLength(5);
		expect(view.totals).toEqual({ inputTokens: 50, outputTokens: 25 });
	});
});
