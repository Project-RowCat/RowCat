import { describe, expect, it } from "vitest";
import {
	checkWireValue,
	DEFAULT_WIRE_LIMITS,
	decodeWireValue,
	encodeWireValue,
} from "./wire.ts";

/**
 * Wire values: both acceptance and rejection are deterministic. No property-testing tool is brought
 * in. Recursively built fixtures answer two questions: do nested JSON values come back unchanged,
 * and is an unsupported value rejected wherever it is hidden?
 */

const nested = (depth: number): unknown =>
	depth === 0
		? { leaf: [1, "two", true, null, { deep: 3.5 }] }
		: { level: depth, child: nested(depth - 1), list: [nested(0)] };

describe("round trip", () => {
	it("nested JSON values come back as is", () => {
		for (const depth of [0, 1, 3, 8]) {
			const value = nested(depth);
			const encoded = encodeWireValue(value);
			expect(encoded.ok).toBe(true);
			if (!encoded.ok) return;
			const decoded = decodeWireValue(encoded.json);
			expect(decoded).toEqual({ ok: true, value });
		}
	});

	it("objects without a prototype are plain objects too", () => {
		const bare = Object.create(null) as Record<string, unknown>;
		bare.a = 1;
		expect(checkWireValue(bare).ok).toBe(true);
	});
});

describe("refusal", () => {
	it.each([
		"__proto__",
		"constructor",
		"prototype",
	])("the %s key is refused even as an own property: JSON.parse makes it a data property", (key) => {
		const parsed = JSON.parse(`{"${key}":{"polluted":true}}`) as unknown;
		expect(checkWireValue(parsed)).toMatchObject({
			ok: false,
			reason: "forbidden key",
		});
	});
	it.each([
		["undefined", undefined],
		["function", () => 1],
		["symbol", Symbol("s")],
		["bigint", 1n],
		["Map", new Map()],
		["Set", new Set()],
		["Date", new Date(0)],
		["Error", new Error("e")],
		["Promise", Promise.resolve(1)],
		["class instance", new (class Foo {})()],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
	])("%s is not a wire value", (_label, value) => {
		expect(checkWireValue(value).ok).toBe(false);
		expect(checkWireValue({ nested: [{ deep: value }] }).ok).toBe(false);
	});

	it("calls a circular reference circular, not too deep", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const result = checkWireValue(cyclic);
		expect(result).toEqual({ ok: false, reason: "cycle", path: "$.self" });
	});

	it("referencing the same object from two places is not a cycle", () => {
		const shared = { x: 1 };
		expect(checkWireValue({ a: shared, b: shared }).ok).toBe(true);
	});
});

describe("limits", () => {
	const limits = {
		...DEFAULT_WIRE_LIMITS,
		maxDepth: 3,
		maxStringLength: 4,
		maxEntries: 5,
		maxSerializedLength: 50,
	};

	it("depth", () => {
		expect(checkWireValue({ a: { b: 1 } }, limits).ok).toBe(true);
		expect(checkWireValue({ a: { b: { c: 1 } } }, limits)).toMatchObject({
			ok: false,
			reason: "depth exceeded",
		});
	});

	it("string length", () => {
		expect(checkWireValue("abcd", limits).ok).toBe(true);
		expect(checkWireValue("abcde", limits)).toMatchObject({
			ok: false,
			reason: "string too long",
		});
	});

	it("item count", () => {
		expect(checkWireValue([1, 2, 3, 4, 5], limits).ok).toBe(true);
		expect(checkWireValue([1, 2, 3, 4, 5, 6], limits)).toMatchObject({
			ok: false,
			reason: "too many entries",
		});
	});

	it("serialized length stands in both directions", () => {
		const big = { a: "abcd", b: "abcd", c: "abcd", d: "abcd", e: "abcd" };
		expect(encodeWireValue(big, limits)).toMatchObject({ ok: false });
		expect(decodeWireValue(JSON.stringify(big), limits)).toMatchObject({
			ok: false,
		});
	});

	it("broken JSON is a refusal, not an exception", () => {
		expect(decodeWireValue("{oops")).toEqual({
			ok: false,
			reason: "malformed json",
		});
	});
});
