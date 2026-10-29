import { describe, expect, it } from "vitest";
import {
	countLaterMessages,
	messageActionsFor,
	messagesFromEnd,
	planMessageEdit,
} from "./message-actions.ts";
import type { ChatMessage } from "./model.ts";

/**
 * Shared truth table for line operations.
 *
 * The overlap with web's `message-actions.test.ts` is a result of the migration, not a design
 * choice. The web test now checks only the copy (count to sentence), while this file checks the
 * values that copy is based on. Both apps call the same function, so there must be one table.
 *
 * All three concern the boundary of irreversible operations. A wrong role lets model text be edited
 * by hand, a wrong count makes the confirmation text disagree with the real range, and a wrong plan
 * moves an unedited conversation to the top of the list.
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
	 * Editing applies to both roles, alongside `Regenerate`.
	 *
	 * The two are different answers for the same anchor: one regenerates, the other keeps the text and
	 * edits it. While assistant messages had no edit, the only way to fix one name in a paragraph the
	 * model wrote was Regenerate, and that button discarded the text the user had just read.
	 */
	it("edit stands on both roles, regenerate on the assistant only", () => {
		expect(messageActionsFor("user")).toContain("edit");
		expect(messageActionsFor("assistant")).toContain("edit");
		expect(messageActionsFor("user")).not.toContain("regenerate");
		expect(messageActionsFor("assistant")).toContain("regenerate");
	});

	/**
	 * Reporting is available only on assistant messages. Users must not have a path to report their
	 * own text as an AI response.
	 */
	it("report stands on the assistant only", () => {
		expect(messageActionsFor("user")).not.toContain("report");
		expect(messageActionsFor("assistant")).toContain("report");
	});
});

describe("count to delete", () => {
	it("counts messages after the anchor, not the anchor itself", () => {
		expect(countLaterMessages(history, "m1")).toBe(3);
		expect(countLaterMessages(history, "m3")).toBe(1);
		expect(countLaterMessages(history, "m4")).toBe(0);
	});

	/**
	 * `0` and `null` are not merged. Zero means nothing to delete; null means the anchor is unknown,
	 * so the range cannot be determined. Building the confirmation text from null would show a number
	 * unrelated to the actual range.
	 */
	it("null rather than 0 without an anchor", () => {
		expect(countLaterMessages(history, "없는-id")).toBeNull();
		expect(countLaterMessages([], "m1")).toBeNull();
	});

	/**
	 * Selects by order key, not array position, so the range stays the same right after older messages
	 * are loaded.
	 */
	it("gives the same answer for shuffled input", () => {
		const shuffled = [history[3], history[0], history[2], history[1]].filter(
			(entry): entry is ChatMessage => entry !== undefined,
		);
		expect(countLaterMessages(shuffled, "m2")).toBe(2);
	});
});

describe("edit plan", () => {
	it("an empty value is a refusal: not quietly folded into deletion", () => {
		expect(planMessageEdit("   ", "원래 글", 0)).toEqual({
			kind: "invalid",
			reason: "empty",
		});
	});

	it("saving the last message unchanged does nothing", () => {
		expect(planMessageEdit("원래 글", "원래 글", 0)).toEqual({
			kind: "unchanged",
		});
		expect(planMessageEdit("  원래 글  ", "원래 글", 0).kind).toBe("unchanged");
	});

	/**
	 * If there is a tail to delete, saving happens even when content is unchanged. What the user
	 * confirmed is not the sentence but 'continue from here', and that is what should happen.
	 */
	it("saves even with the same content when a tail exists", () => {
		expect(planMessageEdit("원래 글", "원래 글", 4)).toEqual({
			kind: "save",
			content: "원래 글",
		});
	});

	it("saves the edited value with surrounding whitespace trimmed", () => {
		expect(planMessageEdit("  고친 글 \n", "원래 글", 0)).toEqual({
			kind: "save",
			content: "고친 글",
		});
	});
});

describe("search jump window", () => {
	it("how many to read from the end for that message to be included", () => {
		expect(messagesFromEnd(1000, 999)).toBe(1);
		expect(messagesFromEnd(1000, 500)).toBe(500);
		expect(messagesFromEnd(1000, 0)).toBe(1000);
	});

	/**
	 * Coordinates past the total do not produce 0 or a negative number: the window is at least one.
	 */
	it("opens at least one even out of bounds", () => {
		expect(messagesFromEnd(10, 10)).toBe(1);
		expect(messagesFromEnd(10, 40)).toBe(1);
	});
});
