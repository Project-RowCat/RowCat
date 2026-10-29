import { CHAT_ROOM_TITLE_MAX_LENGTH } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import { COUNTER_THRESHOLD, planRename, titleLength } from "./rename.ts";

/**
 * Rename form decisions, checked without rendering. Focus, closing and disabled states need a real
 * screen and belong to runtime QA; this file checks the rules beneath them. Mistakes here are
 * silent: saving does nothing, or an unchanged conversation jumps to the top of the list.
 */

describe("what to do", () => {
	it("saves the value with surrounding whitespace trimmed", () => {
		expect(planRename("  new name  ", "old name")).toEqual({
			kind: "save",
			title: "new name",
		});
	});

	/** A value that differs only in whitespace is the same value; saving it would move the room to the top. */
	it("does not write when nothing changed", () => {
		expect(planRename("same name", "same name")).toEqual({ kind: "unchanged" });
		expect(planRename("  same name ", "same name")).toEqual({
			kind: "unchanged",
		});
	});

	it("an empty name is rejected on the spot, not folded to a default", () => {
		const plan = planRename("   ", "old name");
		expect(plan.kind).toBe("invalid");
		// The message states what the user has to do.
		expect(plan.kind === "invalid" && plan.message).toContain("enter");
	});

	it("past the limit it states the length", () => {
		const plan = planRename("a".repeat(CHAT_ROOM_TITLE_MAX_LENGTH + 1), "old");
		expect(plan.kind).toBe("invalid");
		expect(plan.kind === "invalid" && plan.message).toContain(
			String(CHAT_ROOM_TITLE_MAX_LENGTH),
		);
	});

	it("a length exactly at the limit is saved", () => {
		const limit = "a".repeat(CHAT_ROOM_TITLE_MAX_LENGTH);
		expect(planRename(limit, "old")).toEqual({ kind: "save", title: limit });
	});
});

describe("character count display", () => {
	/** Counts in the store's unit, so a title with emoji does not show a doubled count. */
	it("one emoji is one character", () => {
		expect(titleLength("🌙🌙")).toBe(2);
		expect(titleLength("  a  ")).toBe(1);
	});

	it("appears only near the limit", () => {
		expect(COUNTER_THRESHOLD).toBeLessThan(CHAT_ROOM_TITLE_MAX_LENGTH);
		expect(titleLength("short name")).toBeLessThan(COUNTER_THRESHOLD);
	});
});
