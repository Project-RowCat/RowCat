import type { MessageAction } from "@rowcat/chat";
import { CHAT_ROOM_TITLE_MAX_LENGTH } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	deleteFromMessageCopy,
	editWarningCopy,
	MESSAGE_ACTION_ICON,
	MESSAGE_ACTION_LABEL,
	messageActionsFor,
	messageMenuLabel,
	planMessageEdit,
	planRename,
	regenerateWarningCopy,
} from "./actions.ts";
import { AI_EVIDENCE_DISCLOSURE } from "./ai-evidence.ts";

/**
 * Covers only what this app adds: copy and icons. What actions exist, how many messages get deleted
 * and whether to save are `@rowcat/chat`'s answers, pinned by
 * `packages/chat/src/message-actions.test.ts`. A wrong translation here makes users consent without
 * knowing to what.
 */

const later = (count: number): number => count;

describe("the confirmation copy states the count", () => {
	// A vague "this message is deleted" hides a range that reaches off screen. The number comes from
	// the same function as the real count (`countLaterMessages`).
	it("delete from here states how many remain after it", () => {
		expect(deleteFromMessageCopy(later(0))).not.toMatch(/\d/);
		expect(deleteFromMessageCopy(later(4))).toContain("4");
	});

	// Regenerating the last response needs no confirmation, so no warning.
	it("with no tail there's no regenerate warning", () => {
		expect(regenerateWarningCopy(later(0))).toBeNull();
		expect(regenerateWarningCopy(later(3))).toContain("3");
	});

	it("the edit warning follows the same rule", () => {
		expect(editWarningCopy(later(0))).toBeNull();
		expect(editWarningCopy(later(2))).toContain("2");
	});
});

describe("the vocabulary drawn on a row", () => {
	// An empty list would open that role's menu empty.
	it("every action has a label and an icon", () => {
		const actions: MessageAction[] = [
			...messageActionsFor("user"),
			...messageActionsFor("assistant"),
		];
		for (const action of actions) {
			expect(MESSAGE_ACTION_LABEL[action], action).toBeTruthy();
			expect(MESSAGE_ACTION_ICON[action], action).toBeTruthy();
		}
	});

	// The trigger's name excludes the body: every line has one, and screen readers would read the same
	// text twice.
	it("the menu's name states the role", () => {
		expect(messageMenuLabel("user")).toBe("My message menu");
		expect(messageMenuLabel("assistant")).toBe("Reply menu");
	});
});

describe("edit plan copy", () => {
	it("an empty value says why right there", () => {
		const plan = planMessageEdit("   ", "Original text", 0);
		expect(plan.kind).toBe("invalid");
		expect(plan.kind === "invalid" && plan.message).toContain("enter");
	});

	// The branches belong to the shared rule; this only checks they pass through.
	it("nothing changed and nothing to delete means no save", () => {
		expect(planMessageEdit("Original text", "Original text", 0)).toEqual({
			kind: "unchanged",
		});
		expect(planMessageEdit("Original text", "Original text", 4)).toEqual({
			kind: "save",
			content: "Original text",
		});
	});
});

describe("rename plan copy", () => {
	it("an empty name and an over-limit name get different sentences", () => {
		const empty = planRename("   ", "Old name");
		expect(empty.kind === "invalid" && empty.message).toContain("enter");

		const long = planRename("a".repeat(CHAT_ROOM_TITLE_MAX_LENGTH + 1), "Old");
		expect(long.kind === "invalid" && long.message).toContain(
			String(CHAT_ROOM_TITLE_MAX_LENGTH),
		);
	});

	it("nothing changed means no write", () => {
		expect(planRename("  Same name ", "Same name")).toEqual({
			kind: "unchanged",
		});
	});
});

describe("report notice", () => {
	// Must be the same sentence as web: two apps wording one promise differently leaves no answer to
	// which one we made, and keeping only one half would halve the disclosure.
	it("says both what is sent and what isn't", () => {
		expect(AI_EVIDENCE_DISCLOSURE).toContain("to the RowCat server");
		expect(AI_EVIDENCE_DISCLOSURE).toContain(
			"No other conversation content is sent",
		);
	});
});
