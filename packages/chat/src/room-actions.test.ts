import { describe, expect, it } from "vitest";
import { ROOM_ACTIONS, type RoomActionId } from "./room-actions.ts";

/**
 * Pins the vocabulary and order of room actions as values. The divergence this guards against is
 * not a compile error. While the web list rows and mobile list rows each held their own array, a
 * delete moved upward on one side broke nothing, and the difference only showed when the two
 * screens were compared side by side.
 */

const ids = ROOM_ACTIONS.map((action) => action.id);

describe("vocabulary", () => {
	it("only three, in a fixed order", () => {
		expect(ids).toEqual<RoomActionId[]>(["rename", "settings", "delete"]);
	});

	it("the same action does not stand twice", () => {
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("the irreversible row", () => {
	/**
	 * Delete alone is destructive, and it is last. The purpose of this layout is to gather the places
	 * a finger might slip into one spot, and the separator creates that distance.
	 */
	it("delete alone is destructive and stands at the bottom", () => {
		expect(
			ROOM_ACTIONS.filter((action) => action.destructive).map((a) => a.id),
		).toEqual(["delete"]);
		expect(ids.at(-1)).toBe("delete");
	});

	it("the separator stands only before that row", () => {
		expect(
			ROOM_ACTIONS.filter((action) => action.separatorBefore).map((a) => a.id),
		).toEqual(["delete"]);
	});
});
