import { CHAT_MEMORY_CONTENT_MAX_LENGTH, type ChatMemory } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	groupMemories,
	MEMORY_COUNTER_THRESHOLD,
	memoryContentLength,
	planMemorySave,
} from "./form.ts";

/**
 * Verifies the memory form's decisions without rendering.
 *
 * All three failures are silent: the add button does nothing, an unedited memory is saved and
 * leaves for other devices, or the order reverses while splitting into two groups.
 */

const memory = (overrides: Partial<ChatMemory>): ChatMemory =>
	({
		id: "m",
		roomId: "room-1",
		content: "memory",
		pinned: false,
		source: "user",
		originAt: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		dirty: 1,
		serverVersion: 0,
		rev: { t: 1, c: 0, d: "d" },
		...overrides,
	}) satisfies ChatMemory;

describe("planMemorySave", () => {
	it("empty input is not saved and says why", () => {
		const plan = planMemorySave("   ");
		expect(plan.kind).toBe("invalid");
	});

	it("past the limit it states the character count", () => {
		const plan = planMemorySave("a".repeat(CHAT_MEMORY_CONTENT_MAX_LENGTH + 1));
		expect(plan).toEqual({
			kind: "invalid",
			message: `A memory can be up to ${CHAT_MEMORY_CONTENT_MAX_LENGTH} characters.`,
		});
	});

	it("differing only in surrounding whitespace is no change, so no revision is wasted", () => {
		expect(planMemorySave("  memory  ", "memory")).toEqual({
			kind: "unchanged",
		});
	});

	it("adding has no `unchanged`, since there is nothing to compare", () => {
		expect(planMemorySave("memory")).toEqual({
			kind: "save",
			content: "memory",
		});
	});

	it("saves the trimmed value when it really changed", () => {
		expect(planMemorySave("  edited memory ", "memory")).toEqual({
			kind: "save",
			content: "edited memory",
		});
	});
});

describe("display helpers", () => {
	it("character count is code points, the same unit the store counts", () => {
		expect(memoryContentLength(" 🙂🙂 ")).toBe(2);
	});

	it("the character count appears only near the limit", () => {
		expect(MEMORY_COUNTER_THRESHOLD).toBeLessThan(
			CHAT_MEMORY_CONTENT_MAX_LENGTH,
		);
		expect(memoryContentLength("short memory")).toBeLessThan(
			MEMORY_COUNTER_THRESHOLD,
		);
	});

	it("joining the two groups returns the original order, without re-sorting", () => {
		const ordered = [
			memory({ id: "p1", pinned: true }),
			memory({ id: "p2", pinned: true }),
			memory({ id: "o1" }),
			memory({ id: "o2" }),
		];
		const { pinned, others } = groupMemories(ordered);
		expect([...pinned, ...others].map((m) => m.id)).toEqual(
			ordered.map((m) => m.id),
		);
	});
});
