import { describe, expect, it } from "vitest";
import { earliestMessage, latestMessage, messageExcerpt } from "./copy.ts";

describe("messageExcerpt", () => {
	it("keeps a short message whole", () => {
		expect(messageExcerpt("Hello there")).toBe("Hello there");
	});

	it("folds whitespace before measuring", () => {
		expect(messageExcerpt("\n\n  Hello\n   there  ")).toBe("Hello there");
	});

	it("cuts in code points and marks the cut", () => {
		const text = "😀".repeat(30);
		const excerpt = messageExcerpt(text, 5);
		expect(excerpt).toBe(`${"😀".repeat(5)}…`);
	});
});

describe("earliest and latest", () => {
	const messages = [
		{ id: "b", createdAt: "2026-01-01T00:00:01.000Z" },
		{ id: "a", createdAt: "2026-01-01T00:00:01.000Z" },
		{ id: "c", createdAt: "2026-01-01T00:00:00.000Z" },
		{ id: "d", createdAt: "2026-01-01T00:00:02.000Z" },
	];

	it("orders by time, then id, like the shared position", () => {
		expect(earliestMessage(messages)?.id).toBe("c");
		expect(latestMessage(messages)?.id).toBe("d");
		expect(earliestMessage(messages.slice(0, 2))?.id).toBe("a");
	});

	it("answers null for a room with no stored message", () => {
		expect(earliestMessage([])).toBeNull();
		expect(latestMessage([])).toBeNull();
	});
});
