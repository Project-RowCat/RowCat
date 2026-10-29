import { describe, expect, test } from "vitest";
import { parseByteRange } from "./range.ts";

/**
 * Range decisions are pinned by value: a wrong slice surfaces as silently truncated audio, not a
 * 500.
 */

const TOTAL = 100;

describe("requests that aren't ranges", () => {
	test.each([
		["no header", undefined],
		["empty string", ""],
		["a different unit", "items=0-9"],
		["syntax error", "bytes=abc"],
		["empty spec", "bytes="],
		["start after end", "bytes=50-10"],
	])("%s → whole", (_label, header) => {
		expect(parseByteRange(header, TOTAL)).toEqual({ kind: "full" });
	});

	// Multi-range is ignored, not rejected: a 416 would leave the sender with nothing.

	test("multiple ranges → whole", () => {
		expect(parseByteRange("bytes=0-9,20-29", TOTAL)).toEqual({ kind: "full" });
	});

	// A 416 on an empty resource would make the empty file unfetchable.
	test("total 0 → whole", () => {
		expect(parseByteRange("bytes=0-9", 0)).toEqual({ kind: "full" });
	});
});

describe("slices", () => {
	test("the first ten bytes", () => {
		expect(parseByteRange("bytes=0-9", TOTAL)).toEqual({
			kind: "partial",
			start: 0,
			endInclusive: 9,
		});
	});

	test("from the middle to the end", () => {
		expect(parseByteRange("bytes=10-", TOTAL)).toEqual({
			kind: "partial",
			start: 10,
			endInclusive: 99,
		});
	});

	// The suffix form counts from the end.
	test("the last ten bytes", () => {
		expect(parseByteRange("bytes=-10", TOTAL)).toEqual({
			kind: "partial",
			start: 90,
			endInclusive: 99,
		});
	});

	// A client that does not know the size asks this way, so it gets the whole resource.
	test("a suffix larger than the total is the whole slice", () => {
		expect(parseByteRange("bytes=-500", TOTAL)).toEqual({
			kind: "partial",
			start: 0,
			endInclusive: 99,
		});
	});

	test("an end past the total is clipped to the last byte", () => {
		expect(parseByteRange("bytes=90-500", TOTAL)).toEqual({
			kind: "partial",
			start: 90,
			endInclusive: 99,
		});
	});

	test("one byte", () => {
		expect(parseByteRange("bytes=7-7", TOTAL)).toEqual({
			kind: "partial",
			start: 7,
			endInclusive: 7,
		});
	});

	test("ignores case and whitespace", () => {
		expect(parseByteRange("  Bytes=0-1 ", TOTAL)).toEqual({
			kind: "partial",
			start: 0,
			endInclusive: 1,
		});
	});
});

describe("unsatisfiable ranges", () => {
	test("start outside the resource", () => {
		expect(parseByteRange("bytes=100-200", TOTAL)).toEqual({
			kind: "unsatisfiable",
		});
	});

	// `bytes=-0` means the last 0 bytes and cannot be satisfied; folding it to full flips its meaning.
	test("zero-length suffix", () => {
		expect(parseByteRange("bytes=-0", TOTAL)).toEqual({
			kind: "unsatisfiable",
		});
	});
});
