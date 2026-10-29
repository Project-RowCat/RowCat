import { describe, expect, it } from "vitest";
import {
	isPinnableWork,
	movePinnedItem,
	pinItem,
	pinnedWorkNotice,
	samePinnedOrder,
	unpinItem,
} from "./profile-pins.ts";

const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };

describe("isPinnableWork", () => {
	it("only public, unhidden works can be newly pinned", () => {
		expect(isPinnableWork({ visibility: "public", hidden: false })).toBe(true);
		expect(isPinnableWork({ visibility: "public", hidden: true })).toBe(false);
		for (const visibility of ["unlisted", "private", "archived"] as const)
			expect(isPinnableWork({ visibility, hidden: false })).toBe(false);
	});
});

describe("pinnedWorkNotice", () => {
	it("a visible pin says nothing", () => {
		expect(
			pinnedWorkNotice({ visibility: "public", hidden: false }),
		).toBeNull();
	});

	it("operator hiding comes before exposure", () => {
		/**
		 * A public work can still be hidden by moderation, so the notice cannot be derived from
		 * visibility alone.
		 */
		expect(pinnedWorkNotice({ visibility: "public", hidden: true })).toContain(
			"Hidden",
		);
		expect(pinnedWorkNotice({ visibility: "private", hidden: true })).toContain(
			"Hidden",
		);
	});

	it("states exposure in product words", () => {
		expect(
			pinnedWorkNotice({ visibility: "unlisted", hidden: false }),
		).toContain("link-only");
		expect(
			pinnedWorkNotice({ visibility: "archived", hidden: false }),
		).toContain("archived");
	});
});

describe("list operations", () => {
	it("appends at the end, and returns the same array if present or full", () => {
		const one = [a];
		expect(pinItem(one, b, 3)).toEqual([a, b]);
		expect(pinItem(one, a, 3)).toBe(one);
		const full = [a, b, c];
		expect(pinItem(full, { id: "d" }, 3)).toBe(full);
	});

	it("removes, and returns the same array if absent", () => {
		const list = [a, b];
		expect(unpinItem(list, "a")).toEqual([b]);
		expect(unpinItem(list, "z")).toBe(list);
	});

	it("moves one step, and returns the same array past the end", () => {
		const list = [a, b, c];
		expect(movePinnedItem(list, "c", -1)).toEqual([a, c, b]);
		expect(movePinnedItem(list, "a", 1)).toEqual([b, a, c]);
		expect(movePinnedItem(list, "a", -1)).toBe(list);
		expect(movePinnedItem(list, "c", 1)).toBe(list);
		expect(movePinnedItem(list, "z", 1)).toBe(list);
	});

	it("lists are equal only with the same order", () => {
		expect(samePinnedOrder([a, b], [a, b])).toBe(true);
		expect(samePinnedOrder([a, b], [b, a])).toBe(false);
		expect(samePinnedOrder([a], [a, b])).toBe(false);
	});
});
