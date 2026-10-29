import { describe, expect, test } from "vitest";
import { CACHE_KEY_VERSION, cacheKey } from "./keys.ts";

/**
 * Keys are deterministic and collision-free. The two failures look opposite, so both are checked:
 * the first makes the cache never hit (silently slower), the second makes one filter draw another's
 * result (no error).
 */
describe("cacheKey", () => {
	test("starts with the versioned prefix", () => {
		expect(cacheKey("gallery", ["guest"])).toBe(
			`cache:${CACHE_KEY_VERSION}:gallery:guest`,
		);
	});

	test("the same axes give the same key", () => {
		expect(cacheKey("gallery", ["guest", null, false, "recent", 1])).toBe(
			cacheKey("gallery", ["guest", null, false, "recent", 1]),
		);
	});

	/** `null` (unspecified) and an empty string are different facts and cannot share a slot. */
	test("null and the empty string differ", () => {
		expect(cacheKey("gallery", [null])).not.toBe(cacheKey("gallery", [""]));
	});

	/** A number and its string are the same value on the same axis, so sharing a slot is fine. */
	test("booleans and numbers are expressed as segments", () => {
		expect(cacheKey("ns", [true, false, 0, 12])).toBe(
			`cache:${CACHE_KEY_VERSION}:ns:true:false:0:12`,
		);
	});

	// A delimiter in a segment makes different axis combinations the same key; without throwing, that
	// collision gives no signal.
	test("throws when a segment contains the separator", () => {
		expect(() => cacheKey("gallery", ["a:b"])).toThrow(/separator/);
		expect(() => cacheKey("gal:lery", ["a"])).toThrow(/separator/);
	});

	test("one differing axis always gives a different key", () => {
		const base = cacheKey("gallery", ["guest", "female", "recent", 1]);
		expect(cacheKey("gallery", ["guest", "male", "recent", 1])).not.toBe(base);
		expect(cacheKey("gallery", ["guest", "female", "popular", 1])).not.toBe(
			base,
		);
		expect(cacheKey("gallery", ["guest", "female", "recent", 2])).not.toBe(
			base,
		);
	});
});
