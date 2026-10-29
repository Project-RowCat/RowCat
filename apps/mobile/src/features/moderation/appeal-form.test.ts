import { REPORT_LIMITS } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { checkAppealMessage } from "./appeal-form.ts";

/**
 * Verifies the appeal body check by value: it **reports the over-limit rather than cutting the
 * text**.
 *
 * What this check guards is the fact that `maxLength` used to erase: when a pasted body exceeds the
 * limit, that fact must be **expressed** on screen, and no part of the body may disappear.
 */

const LIMIT = REPORT_LIMITS.appealMessage;

describe("checkAppealMessage", () => {
	it("doesn't truncate an over-limit body — the length is the original", () => {
		const long = "a".repeat(LIMIT + 120);
		const check = checkAppealMessage(long);
		expect(check.count).toBe(LIMIT + 120);
		expect(check.tooLong).toBe(true);
		/** The check neither returns nor alters the original; the input belongs to the caller. */
		expect(long.length).toBe(LIMIT + 120);
	});

	it("over the limit it can't be submitted and a notice stands", () => {
		const check = checkAppealMessage("a".repeat(LIMIT + 1));
		expect(check.submittable).toBe(false);
		expect(check.error).not.toBeNull();
	});

	it("exactly the limit is valid — the boundary closes only on excess", () => {
		const check = checkAppealMessage("a".repeat(LIMIT));
		expect(check.tooLong).toBe(false);
		expect(check.submittable).toBe(true);
		expect(check.error).toBeNull();
	});

	it("deleting back under the limit allows submitting again", () => {
		expect(checkAppealMessage("a".repeat(LIMIT + 1)).submittable).toBe(false);
		expect(checkAppealMessage("a".repeat(LIMIT - 1)).submittable).toBe(true);
	});

	it("a whitespace-only body has nothing to send — a different fact from excess, so no sentence", () => {
		const check = checkAppealMessage("   \n\t  ");
		expect(check.empty).toBe(true);
		expect(check.submittable).toBe(false);
		expect(check.tooLong).toBe(false);
		expect(check.error).toBeNull();
	});

	it("trim is used only for emptiness — length counts the original", () => {
		const padded = "  Body  ";
		const check = checkAppealMessage(padded);
		expect(check.empty).toBe(false);
		expect(check.count).toBe(padded.length);
		expect(check.submittable).toBe(true);
	});
});
