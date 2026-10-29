import { describe, expect, it } from "vitest";
import {
	messagesFromEnd,
	type RevealableRow,
	revealRowIndex,
} from "./reveal.ts";

/**
 * The arithmetic of jumping. Pixels are not checked here: a browser can only confirm "roughly in
 * the middle", which a unit test cannot answer. What this file pins is which index is handed to the
 * virtualizer. An off-by-one jump looks plausible on screen, so it survives the longest.
 */

const rows = (count: number, options: { loadOlder?: boolean } = {}) => {
	const list: RevealableRow[] = [];
	if (options.loadOlder) list.push({ kind: "load-older", key: "load-older" });
	for (let index = 0; index < count; index += 1)
		list.push({ kind: "message", key: `m-${index}` });
	return list;
};

describe("window size", () => {
	it("counts by position from the end", () => {
		expect(messagesFromEnd(1000, 999)).toBe(1);
		expect(messagesFromEnd(1000, 500)).toBe(500);
		expect(messagesFromEnd(1000, 0)).toBe(1000);
	});

	it("never gives 0 for a stray coordinate, since an empty window has nowhere to jump", () => {
		expect(messagesFromEnd(10, 10)).toBe(1);
		expect(messagesFromEnd(10, 40)).toBe(1);
	});
});

describe("row number", () => {
	it("shifts by one when `Load earlier messages` is present", () => {
		expect(revealRowIndex(rows(1000, { loadOlder: true }), "m-500")).toBe(501);
		expect(revealRowIndex(rows(1000), "m-500")).toBe(500);
	});

	it("a message outside the window is -1, the signal for the screen to widen the window", () => {
		expect(revealRowIndex(rows(50), "m-500")).toBe(-1);
	});

	it("rows that are not messages are not targets", () => {
		const list: RevealableRow[] = [
			{ kind: "load-older", key: "m-0" },
			{ kind: "response", key: "m-1" },
			{ kind: "message", key: "m-2" },
		];
		expect(revealRowIndex(list, "m-0")).toBe(-1);
		expect(revealRowIndex(list, "m-1")).toBe(-1);
		expect(revealRowIndex(list, "m-2")).toBe(2);
	});
});
