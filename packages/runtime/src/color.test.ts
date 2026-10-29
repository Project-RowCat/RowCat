import { describe, expect, it } from "vitest";
import { color, isRuntimeColor } from "./color.ts";
import { RUNTIME_ERROR_CODE, RuntimeError } from "./internal/errors.ts";

/**
 * Color contract: the type and the runtime value must describe the same set of formats. The
 * type-level rejection (color("red") does not compile) only shows up in a real program, so the
 * compiler tests own it. This file checks the runtime predicate, which must agree with the same
 * format list.
 */

const VALID = [
	"#fff",
	"#FFF",
	"#000",
	"#12abEF",
	"#123456",
	"#12345678",
	"#AABBCCDD",
];

const INVALID = [
	"#",
	"#f",
	"#ff",
	"#ffff",
	"#fffff",
	"#fffffff",
	"#fffffffff",
	"#ggg",
	"#gggggg",
	"#ff 00 aa",
	" #ffffff",
	"#ffffff ",
	"fff",
	"red",
	"rgb(1,2,3)",
	"rgba(1,2,3,0.5)",
	"transparent",
	"currentColor",
	"",
];

describe("predicate", () => {
	it.each(VALID)("%s is a color", (value) => {
		expect(isRuntimeColor(value)).toBe(true);
	});

	it.each(INVALID)("%s is not a color", (value) => {
		expect(isRuntimeColor(value)).toBe(false);
	});
});

describe("sealing", () => {
	it("returns the value as is: does not fold case", () => {
		expect(color("#12abEF")).toBe("#12abEF");
		expect(color("#FFF")).toBe("#FFF");
	});

	/**
	 * Even without a type check (a JS-ported host, a later VM boundary), this line is the gate.
	 * Relying on the type having let the value through would remove validation at that boundary.
	 */
	it("values that bypassed the type throw too", () => {
		const sneak = color as unknown as (value: string) => string;
		for (const value of INVALID) {
			try {
				sneak(value);
				throw new Error(`did not throw: ${value}`);
			} catch (error) {
				expect(error).toBeInstanceOf(RuntimeError);
				expect((error as RuntimeError).code).toBe(
					RUNTIME_ERROR_CODE.invalidColor,
				);
			}
		}
	});

	/**
	 * The only route for colors computed at runtime is the single predicate isRuntimeColor. Its
	 * narrowness is what keeps the literal check meaningful.
	 */
	it("narrowed strings can be used as colors", () => {
		const dynamic: string = ["#", "ff", "00", "aa"].join("");
		expect(isRuntimeColor(dynamic)).toBe(true);
		if (isRuntimeColor(dynamic)) expect(dynamic).toBe("#ff00aa");
	});
});
