import { ROOM_ACTIONS } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import { chat } from "#/lib/i18n/messages/en/chat.ts";
import { roomActionLabel, roomActionsLabel } from "./actions.ts";

/**
 * Locks the room menu's labels. The vocabulary, order, destructive flag and separators live in
 * `@rowcat/chat` and are tested in `packages/chat/src/room-actions.test.ts`; this file only checks
 * that every action has a Korean label.
 */
describe("item copy", () => {
	it("copy exists in the shared vocabulary's order", () => {
		expect(ROOM_ACTIONS.map((action) => roomActionLabel(action.id))).toEqual([
			"Rename",
			"Conversation settings",
			"Delete conversation",
		]);
	});

	/**
	 * A label row without a matching vocabulary entry renders nowhere, and keeping it would suggest an
	 * action exists that does not.
	 */
	it("no copy is left outside the vocabulary", () => {
		expect(Object.keys(chat.roomActions.action).sort()).toEqual(
			ROOM_ACTIONS.map((action) => action.id).sort(),
		);
	});
});

/**
 * The trigger's accessible name includes the conversation title. Without it, screen reader users
 * hear the same name for every row in the sidebar. The sidebar and the conversation list share this
 * function, and mobile's list rows use the same sentence, so one action cannot read as two.
 */
describe("overflow trigger name", () => {
	it("includes the conversation title", () => {
		expect(roomActionsLabel("First conversation")).toBe(
			"Manage conversation First conversation",
		);
	});

	it("even with an empty title, it still says what the trigger is for", () => {
		expect(roomActionsLabel("")).toContain("Manage conversation");
	});
});
