import { describe, expect, it } from "vitest";
import {
	recentSidebarRooms,
	SIDEBAR_RECENT_CHAT_LIMIT,
} from "./sidebar-rooms.ts";

/** Mimics the order storage returns: most recent first. */
const rows = (count: number) =>
	Array.from({ length: count }, (_, index) => ({ id: `r${index}` }));

describe("the sidebar holds only the most recent rows", () => {
	it("cuts to the cap", () => {
		expect(recentSidebarRooms(rows(50), null)).toHaveLength(
			SIDEBAR_RECENT_CHAT_LIMIT,
		);
	});

	it("only as many as there are when fewer", () => {
		expect(recentSidebarRooms(rows(3), null).map((r) => r.id)).toEqual([
			"r0",
			"r1",
			"r2",
		]);
	});

	/**
	 * The order is not changed here. Storage's order (most recent activity) is the contract. If the
	 * sidebar re-sorted by its own rules, the room list screen and the sidebar would disagree about
	 * order.
	 */
	it("keeps the order the store gave", () => {
		expect(recentSidebarRooms(rows(4), null, 4).map((r) => r.id)).toEqual([
			"r0",
			"r1",
			"r2",
			"r3",
		]);
	});
});

describe("the currently open room stays even outside the window", () => {
	/**
	 * Opening a room does not bump its activity time, so opening an old conversation by address
	 * correctly places it outside the recent window. If the sidebar then dropped that row, no row
	 * would be highlighted and the whole list would look like someone else's conversations.
	 */
	it("brings an active room from outside the window to the end", () => {
		const result = recentSidebarRooms(rows(30), "r25", 3);
		expect(result.map((r) => r.id)).toEqual(["r0", "r1", "r2", "r25"]);
	});

	it("adds nothing when it is inside the window", () => {
		const result = recentSidebarRooms(rows(30), "r1", 3);
		expect(result.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
	});

	/**
	 * An active id that is not in the list at all (a deleted room, or another account's address) is
	 * not invented. The canvas's 'not found' state reports that, and the sidebar keeps showing its
	 * remaining rows.
	 */
	it("does not invent a missing room", () => {
		const result = recentSidebarRooms(rows(3), "지워진-방", 3);
		expect(result.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
	});

	it("does not break on an empty list", () => {
		expect(recentSidebarRooms([], "r0")).toEqual([]);
	});
});

describe("does not collapse on a strange cap", () => {
	/**
	 * A window of zero shows zero rows. A negative number passed to `slice` cuts from the end, so the
	 * oldest rooms would rise up as 'recent conversations'. That mistake is silent.
	 */
	it("0 and negatives are an empty window", () => {
		expect(recentSidebarRooms(rows(5), null, 0)).toEqual([]);
		expect(recentSidebarRooms(rows(5), null, -3)).toEqual([]);
	});

	/**
	 * Even with an empty window, the currently open room stays. That is the definition of this
	 * exception.
	 */
	it("brings the active room even into an empty window", () => {
		expect(recentSidebarRooms(rows(5), "r3", 0).map((r) => r.id)).toEqual([
			"r3",
		]);
	});
});
