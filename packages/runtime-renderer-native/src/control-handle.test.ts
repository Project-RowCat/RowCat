import { describe, expect, it } from "vitest";
import { controlHandleOf } from "./control-handle.ts";

/**
 * Reference-to-handle mapping. The only thing this file verifies is that the deck calls the
 * reference's methods directly. Whether an animated component forwards refs is answered on the
 * device. What this file settles is what happens when the forwarded value is not a handle: it is
 * not attached and commands are silently dropped, the same state as a deployment without a deck.
 */

describe("controlHandleOf", () => {
	it("recognizes scroll references", () => {
		const scroll = { scrollTo: () => {}, scrollToEnd: () => {} };
		expect(controlHandleOf(scroll)).toBe(scroll);
	});

	it("recognizes text input references", () => {
		const entry = { focus: () => {}, blur: () => {}, isFocused: () => true };
		expect(controlHandleOf(entry)).toBe(entry);
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["string", "scroll"],
		["empty object", {}],
		["half a scroll handle", { scrollTo: () => {} }],
		["half a text input handle", { focus: () => {} }],
		["non-method cells", { focus: 1, blur: 2 }],
	])("%s is not a handle", (_label, value) => {
		expect(controlHandleOf(value)).toBeNull();
	});

	/**
	 * This file does not know the other capabilities of RN refs. Having measure or setNativeProps does
	 * not make a value a handle.
	 */
	it("a reference with only another capability is not a handle", () => {
		expect(
			controlHandleOf({ measure: () => {}, setNativeProps: () => {} }),
		).toBeNull();
	});
});
