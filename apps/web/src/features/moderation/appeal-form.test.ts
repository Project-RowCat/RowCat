import { REPORT_LIMITS } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { checkAppealMessage } from "./appeal-form.ts";

/**
 * Appeal body judgment: pins that over-length text is reported, not truncated. This guards what
 * maxLength used to erase: an over-limit body must be visible, and no character may disappear. The
 * matrix matches the mobile test of the same name. Both apps hold the same judgment for now;
 * keeping them equal is what this overlap guards, and the commit that moves it to a shared package
 * makes them one.
 */

const LIMIT = REPORT_LIMITS.appealMessage;

describe("checkAppealMessage", () => {
	it("does not cut an over-long body — the length is the original", () => {
		const long = "a".repeat(LIMIT + 120);
		const check = checkAppealMessage(long);
		expect(check.count).toBe(LIMIT + 120);
		expect(check.tooLong).toBe(true);
		/**
		 * The judgment neither returns nor modifies the original text. The input belongs to the caller.
		 */
		expect(long.length).toBe(LIMIT + 120);
	});

	it("over the limit cannot submit and shows the guidance", () => {
		const check = checkAppealMessage("a".repeat(LIMIT + 1));
		expect(check.submittable).toBe(false);
		expect(check.error).not.toBeNull();
	});

	it("exactly the limit is valid — the boundary closes only above it", () => {
		const check = checkAppealMessage("a".repeat(LIMIT));
		expect(check.tooLong).toBe(false);
		expect(check.submittable).toBe(true);
		expect(check.error).toBeNull();
	});

	it("deleting back under the limit allows submitting again", () => {
		expect(checkAppealMessage("a".repeat(LIMIT + 1)).submittable).toBe(false);
		expect(checkAppealMessage("a".repeat(LIMIT - 1)).submittable).toBe(true);
	});

	it("a whitespace-only body has nothing to send — a different fact from over-long, so no sentence", () => {
		const check = checkAppealMessage("   \n\t  ");
		expect(check.empty).toBe(true);
		expect(check.submittable).toBe(false);
		expect(check.tooLong).toBe(false);
		expect(check.error).toBeNull();
	});

	it("trim is only for emptiness — length counts the original", () => {
		const padded = "  body  ";
		const check = checkAppealMessage(padded);
		expect(check.empty).toBe(false);
		expect(check.count).toBe(padded.length);
		expect(check.submittable).toBe(true);
	});

	it("the screen does not retype the limit — it carries the contract's value", () => {
		expect(checkAppealMessage("").limit).toBe(REPORT_LIMITS.appealMessage);
	});
});
