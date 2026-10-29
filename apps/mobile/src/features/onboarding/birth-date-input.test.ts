import { describe, expect, it } from "vitest";
import { formatBirthDateInput } from "./birth-date-input.ts";

/**
 * Half of this suite is about what the function does NOT do. It does not correct the date, compare
 * it with today, or compute an age. All of that belongs to the server.
 */
describe("formatBirthDateInput", () => {
	it("typing eight digits gives the shape the contract accepts", () => {
		expect(formatBirthDateInput("20110307")).toBe("2011-03-07");
	});

	/** A hyphen is inserted only once more digits follow, so that deleting works. */
	it("no hyphen up to four digits", () => {
		expect(formatBirthDateInput("2011")).toBe("2011");
		expect(formatBirthDateInput("20110")).toBe("2011-0");
	});

	it("one hyphen up to six digits", () => {
		expect(formatBirthDateInput("201103")).toBe("2011-03");
		expect(formatBirthDateInput("2011031")).toBe("2011-03-1");
	});

	it("re-entering a value with hyphens gives the same", () => {
		expect(formatBirthDateInput("2011-03-07")).toBe("2011-03-07");
	});

	it("drops pasted noise and excess digits", () => {
		expect(formatBirthDateInput("2011 / 03 / 07 abc")).toBe("2011-03-07");
		expect(formatBirthDateInput("201103071234")).toBe("2011-03-07");
	});

	it("an empty value is empty", () => {
		expect(formatBirthDateInput("")).toBe("");
		expect(formatBirthDateInput("--")).toBe("");
	});

	/**
	 * **It does not correct dates that cannot exist.** The server decides that (`declareAge`). Folding
	 * it here would make the value the user typed differ from the value we send.
	 */
	it("impossible dates pass through as is", () => {
		expect(formatBirthDateInput("20110230")).toBe("2011-02-30");
		expect(formatBirthDateInput("29991231")).toBe("2999-12-31");
	});
});
