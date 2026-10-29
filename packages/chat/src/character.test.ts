import { describe, expect, it } from "vitest";
import {
	CHAT_CHARACTER_NAME_MAX_LENGTH,
	CHAT_CHARACTER_PROMPT_MAX_LENGTH,
	type ChatCharacter,
	ChatCharacterFieldError,
	checkCharacterName,
	checkCharacterPrompt,
	createCharacterRecord,
	requireCharacterName,
	sortCharacters,
} from "./character.ts";

const stamp = (at: string, id = "c1") => ({
	id,
	now: at,
	rev: { t: 1, c: 0, d: "device-a" },
});

const record = (patch: Partial<ChatCharacter> = {}): ChatCharacter => ({
	...createCharacterRecord(
		{ roomId: "room-1", name: "유진" },
		stamp("2026-01-01T00:00:00.000Z"),
	),
	...patch,
});

describe("validation", () => {
	it("a character without a name is not built: it is a value nothing can point at", () => {
		expect(checkCharacterName("   ")).toEqual({ ok: false, reason: "empty" });
		expect(() => requireCharacterName("")).toThrow(ChatCharacterFieldError);
	});

	/**
	 * A character without a description is a complete value. Requiring one would prevent the character
	 * from being created. Even a name alone is information for the model, the same rule as persona
	 * descriptions.
	 */
	it("an empty description passes", () => {
		expect(checkCharacterPrompt("")).toEqual({ ok: true, prompt: "" });
		expect(record({ prompt: "" }).prompt).toBe("");
	});

	/**
	 * Length is counted in code points. String.length counts UTF-16 units, so names containing emoji
	 * would pass on one side only. The mismatch shows up as a rejection by the receiving device's
	 * decoder.
	 */
	it("length counts code points", () => {
		const emoji = "🙂".repeat(CHAT_CHARACTER_NAME_MAX_LENGTH);
		expect(emoji.length).toBeGreaterThan(CHAT_CHARACTER_NAME_MAX_LENGTH);
		expect(checkCharacterName(emoji).ok).toBe(true);
		expect(checkCharacterName(`${emoji}🙂`).ok).toBe(false);
	});

	it("refuses a description over the cap", () => {
		expect(
			checkCharacterPrompt("가".repeat(CHAT_CHARACTER_PROMPT_MAX_LENGTH + 1)),
		).toEqual({ ok: false, reason: "too_long" });
	});

	it("trims surrounding whitespace before saving", () => {
		const created = createCharacterRecord(
			{ roomId: "room-1", name: "  유진  ", prompt: "  무뚝뚝하다  " },
			stamp("2026-01-01T00:00:00.000Z"),
		);
		expect(created.name).toBe("유진");
		expect(created.prompt).toBe("무뚝뚝하다");
	});
});

describe("display order", () => {
	/**
	 * Sorted by creation order, not by name. localeCompare can give different results on different
	 * devices, which would assemble the same room's prompt in a different order on each.
	 * Same-timestamp ties are broken by id.
	 */
	it("creation order, with id on ties", () => {
		const later = record({ id: "b", createdAt: "2026-02-01T00:00:00.000Z" });
		const earlier = record({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" });
		const sameTime = record({ id: "c", createdAt: "2026-01-01T00:00:00.000Z" });
		expect(sortCharacters([later, sameTime, earlier]).map((c) => c.id)).toEqual(
			["a", "c", "b"],
		);
	});

	it("does not mutate the input array in place", () => {
		const input = [record({ id: "b" }), record({ id: "a" })];
		sortCharacters(input);
		expect(input.map((c) => c.id)).toEqual(["b", "a"]);
	});
});

describe("record", () => {
	it("a built character is live and dirty", () => {
		const created = record();
		expect(created.deletedAt).toBeNull();
		expect(created.dirty).toBe(1);
		expect(created.serverVersion).toBe(0);
		expect(created.roomId).toBe("room-1");
	});
});
