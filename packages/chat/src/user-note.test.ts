import { describe, expect, it } from "vitest";
import {
	applyRoomUserNote,
	CHAT_USER_NOTE_MAX_LENGTH,
	ChatUserNoteError,
	checkChatUserNote,
	clampChatUserNote,
	requireChatUserNote,
	roomUserNote,
} from "./user-note.ts";

describe("an empty value clears rather than being refused", () => {
	it.each(["", "   ", "\n\t "])("%j is no note", (input) => {
		expect(checkChatUserNote(input)).toEqual({ ok: true, note: null });
	});

	it("trims only the ends: inner line breaks remain", () => {
		expect(checkChatUserNote("  첫 줄\n둘째 줄  ")).toEqual({
			ok: true,
			note: "첫 줄\n둘째 줄",
		});
	});
});

describe("the cap counts code points", () => {
	it("passes at exactly the cap", () => {
		const note = "가".repeat(CHAT_USER_NOTE_MAX_LENGTH);
		expect(checkChatUserNote(note)).toEqual({ ok: true, note });
	});

	it("refuses one character over: does not truncate", () => {
		expect(
			checkChatUserNote("가".repeat(CHAT_USER_NOTE_MAX_LENGTH + 1)),
		).toEqual({ ok: false, reason: "too_long" });
	});

	it("an emoji is one character too", () => {
		const note = "🐱".repeat(CHAT_USER_NOTE_MAX_LENGTH);
		expect(note.length).toBe(CHAT_USER_NOTE_MAX_LENGTH * 2);
		expect(checkChatUserNote(note).ok).toBe(true);
	});
});

describe("the gate right before save", () => {
	it("`null` passes as is: it clears", () => {
		expect(requireChatUserNote(null)).toBeNull();
	});

	it("an empty string becomes `null` too: there is one representation", () => {
		expect(requireChatUserNote("   ")).toBeNull();
	});

	it("throws over the cap", () => {
		expect(() =>
			requireChatUserNote("가".repeat(CHAT_USER_NOTE_MAX_LENGTH + 1)),
		).toThrow(ChatUserNoteError);
	});
});

describe("folding is deterministic: two devices make the same value", () => {
	it("within the cap it only normalizes", () => {
		expect(clampChatUserNote("  짧다  ")).toBe("짧다");
	});

	it("overflow keeps only up to the cap", () => {
		const clamped = clampChatUserNote(
			"가".repeat(CHAT_USER_NOTE_MAX_LENGTH + 50),
		);
		expect([...clamped]).toHaveLength(CHAT_USER_NOTE_MAX_LENGTH);
	});

	it("does not split surrogate pairs", () => {
		const clamped = clampChatUserNote(
			"🐱".repeat(CHAT_USER_NOTE_MAX_LENGTH + 10),
		);
		expect(clamped).not.toContain("�");
		expect([...clamped]).toHaveLength(CHAT_USER_NOTE_MAX_LENGTH);
	});
});

describe("absence has one representation: the missing key", () => {
	/** Imitates only part of the room record. This function reads just that one key. */
	const target = (userNote?: string): { id: string; userNote?: string } =>
		userNote === undefined ? { id: "r1" } : { id: "r1", userNote };

	it("setting a note creates the key", () => {
		expect(applyRoomUserNote(target(), "짧게 써 주세요")).toEqual({
			id: "r1",
			userNote: "짧게 써 주세요",
		});
	});

	it.each([null, "", "   "])("%j clears the key", (value) => {
		expect(applyRoomUserNote(target("예전 값"), value)).toEqual({ id: "r1" });
	});

	/**
	 * Applying the same page twice must give the same result. The difference shows only in whether the
	 * encoder includes the key. The symptom is two devices sending the room record back and forth
	 * forever.
	 */
	it("applying twice gives the same shape", () => {
		const once = applyRoomUserNote(target(), null);
		expect(applyRoomUserNote(once, null)).toEqual(once);
		expect(Object.hasOwn(once, "userNote")).toBe(false);
	});
});

describe("there is one reading point too", () => {
	it("`null` when absent or empty", () => {
		expect(roomUserNote({})).toBeNull();
		expect(roomUserNote({ userNote: "" })).toBeNull();
		expect(roomUserNote({ userNote: "  " })).toBeNull();
	});

	it("the normalized value when present", () => {
		expect(roomUserNote({ userNote: "  써 주세요  " })).toBe("써 주세요");
	});
});
