import { ROOM_ACTIONS, ROOM_SORTS } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import { ROOM_ACTION_LABEL, roomActionsLabel } from "../chat/room/actions.ts";
import { ROOM_SORT_LABEL } from "./room-library-copy.ts";

/**
 * Whether the shared vocabulary actually has Korean. Rules and order belong to `@rowcat/chat` with
 * their own tests; this checks that this app's copy covers the vocabulary completely. Types catch
 * half (`Record<RoomSort, string>` fails compilation on a missing key); the other half is values
 * left over outside the vocabulary, which types do not report.
 */

describe("sort copy", () => {
	it("there is copy in the shared vocabulary's order", () => {
		expect(ROOM_SORTS.map((sort) => ROOM_SORT_LABEL[sort])).toEqual([
			"Recent activity",
			"Oldest activity",
			"Name",
		]);
	});

	it("no copy outside the vocabulary remains", () => {
		expect(Object.keys(ROOM_SORT_LABEL).sort()).toEqual([...ROOM_SORTS].sort());
	});
});

describe("row menu copy", () => {
	/** Same words as the web's `ROOM_ACTION_LABEL`; diverging gives one action two names. */
	it("there is copy in the shared vocabulary's order", () => {
		expect(ROOM_ACTIONS.map((action) => ROOM_ACTION_LABEL[action.id])).toEqual([
			"Rename",
			"Conversation settings",
			"Delete conversation",
		]);
	});

	it("no copy outside the vocabulary remains", () => {
		expect(Object.keys(ROOM_ACTION_LABEL).sort()).toEqual(
			ROOM_ACTIONS.map((action) => action.id).sort(),
		);
	});
});

/**
 * The trigger's name includes which conversation it is, since for users who cannot see the screen
 * the list would otherwise be twenty identically named buttons. The web's function builds the same
 * sentence.
 */
describe("the name of the row trigger", () => {
	it("includes the conversation title", () => {
		expect(roomActionsLabel("The first conversation")).toBe(
			"Manage conversation The first conversation",
		);
	});

	it("even with an empty title it still says what the trigger is for", () => {
		expect(roomActionsLabel("")).toContain("Manage conversation");
	});
});
