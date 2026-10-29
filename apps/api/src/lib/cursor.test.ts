import { describe, expect, test } from "vitest";
import { decodeTimelineCursor, encodeTimelineCursor } from "./cursor.ts";

const encode = (raw: string): string =>
	Buffer.from(raw, "utf8").toString("base64url");

describe("timeline cursor", () => {
	test("round-trips", () => {
		const at = new Date("2026-09-03T00:00:00.123Z");
		const id = "a".repeat(32);
		expect(
			decodeTimelineCursor(encodeTimelineCursor({ createdAt: at, id })),
		).toEqual({
			createdAt: at,
			id,
		});
	});

	test.each([
		["has no dot", encode("123")],
		["the time is not a number", encode("abc.id")],
		["has no id", encode("123.")],
		[
			"a time Date can't represent — 400, not 500",
			encode("9000000000000000.id"),
		],
		["negative time", encode("-5.id")],
		["the id is too long", encode(`123.${"x".repeat(33)}`)],
	])("%s", (_label, raw) => {
		expect(() => decodeTimelineCursor(raw)).toThrow(
			expect.objectContaining({ code: "invalid_cursor" }),
		);
	});
});
