import type { ChatMessage } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	countLaterMessages,
	deleteFromMessageCopy,
	editWarningCopy,
	messageActionsFor,
	planMessageEdit,
	regenerateWarningCopy,
} from "./actions.ts";

/**
 * Whether the confirmation copy and the count say **the same thing**.
 *
 * If the copy diverges from the actual range of an irreversible operation, the user agrees without
 * knowing what they agreed to. The error shows only after deletion, and there is no screen to undo
 * it.
 */

const message = (id: string, createdAt: string): ChatMessage =>
	({ id, createdAt }) as unknown as ChatMessage;

const history = [
	message("m1", "2026-01-01T00:00:00.000Z"),
	message("m2", "2026-01-01T00:00:01.000Z"),
	message("m3", "2026-01-01T00:00:02.000Z"),
	message("m4", "2026-01-01T00:00:03.000Z"),
];

describe("actions per role", () => {
	it("user: copy, edit, delete from here", () => {
		expect(messageActionsFor("user")).toEqual(["copy", "edit", "delete-from"]);
	});

	it("assistant: copy, edit, regenerate, report, delete from here", () => {
		expect(messageActionsFor("assistant")).toEqual([
			"copy",
			"edit",
			"regenerate",
			"report",
			"delete-from",
		]);
	});

	/**
	 * Hidden actions are omitted. A dimmed item reads as "something that will work later".
	 *
	 * `edit` now appears on both roles (`messageActionsFor` in `@rowcat/chat`). The storage gates are
	 * still two, and the screen picks one by role (`use-actions.tsx`).
	 */
	it("actions that don't fit the role are not in the list at all", () => {
		expect(messageActionsFor("user")).not.toContain("regenerate");
		expect(messageActionsFor("user")).not.toContain("report");
		expect(messageActionsFor("assistant")).toContain("edit");
	});

	/**
	 * **There is no path that reports one's own message as an AI response** (§47).
	 *
	 * This list and the evidence assembler make the same decision. If the two diverge, the screen
	 * keeps an item that does nothing when pressed. This test catches that mismatch.
	 */
	it("report appears only on assistant replies", () => {
		expect(messageActionsFor("user")).not.toContain("report");
		expect(messageActionsFor("assistant")).toContain("report");
	});
});

describe("count remaining after", () => {
	it("middle, last and first message", () => {
		expect(countLaterMessages(history, "m1")).toBe(3);
		expect(countLaterMessages(history, "m3")).toBe(1);
		expect(countLaterMessages(history, "m4")).toBe(0);
	});

	/** 0 and null mean different things: one says "nothing to delete", the other says "the reference is unknown". */
	it("null when the anchor is not in the list", () => {
		expect(countLaterMessages(history, "missing-id")).toBeNull();
		expect(countLaterMessages([], "m1")).toBeNull();
	});
});

describe("confirmation copy", () => {
	it("delete from here states the count", () => {
		expect(deleteFromMessageCopy(0)).toBe("This message will be deleted.");
		expect(deleteFromMessageCopy(12)).toBe(
			"This message and the 12 after it will be deleted.",
		);
	});

	/** Regenerating the last response has no warning: the only thing deleted is that one response. */
	it("regenerate warns only when there is a tail", () => {
		expect(regenerateWarningCopy(0)).toBeNull();
		expect(regenerateWarningCopy(3)).toBe(
			"Regenerating from this reply deletes the 3 messages after it.",
		);
	});

	it("editing warns only when there is a tail too", () => {
		expect(editWarningCopy(0)).toBeNull();
		expect(editWarningCopy(2)).toBe(
			"Saving deletes the 2 messages after this one.",
		);
	});
});

describe("edit plan", () => {
	it("an empty value is a rejection, not silently folded into a delete", () => {
		expect(planMessageEdit("   ", "original text", 0).kind).toBe("invalid");
	});

	it("saving the last message unchanged does nothing", () => {
		expect(planMessageEdit("original text", "original text", 0)).toEqual({
			kind: "unchanged",
		});
		// Differing only in surrounding whitespace is the same value (the save rule trims whitespace).
		expect(planMessageEdit("  original text  ", "original text", 0).kind).toBe(
			"unchanged",
		);
	});

	/**
	 * Unchanged content still saves **if there is a tail to delete**. In that case what the user
	 * confirmed is not the sentence but "start again from here", and that is what must actually
	 * happen.
	 */
	it("saves even with the same content when there is a tail", () => {
		expect(planMessageEdit("original text", "original text", 4)).toEqual({
			kind: "save",
			content: "original text",
		});
	});

	it("saves an edited value with surrounding whitespace trimmed", () => {
		expect(planMessageEdit("  edited text \n", "original text", 0)).toEqual({
			kind: "save",
			content: "edited text",
		});
	});
});
