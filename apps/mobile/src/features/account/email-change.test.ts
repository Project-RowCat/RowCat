import { describe, expect, it } from "vitest";
import {
	changeEmailCheckMessage,
	checkNewEmail,
	EMAIL_CHANGE_RETURN_VALUE,
	isEmailChangeReturn,
} from "./email-change.ts";

const CURRENT = "me@example.com";

describe("checkNewEmail", () => {
	it("doesn't send an empty value", () => {
		expect(checkNewEmail("", CURRENT)).toEqual({ ok: false, reason: "empty" });
		expect(checkNewEmail("   ", CURRENT)).toEqual({
			ok: false,
			reason: "empty",
		});
	});

	it("doesn't send a value that isn't an email", () => {
		for (const bad of ["me", "me@", "@example.com", "me@example", "a b@c.com"])
			expect(checkNewEmail(bad, CURRENT), bad).toEqual({
				ok: false,
				reason: "format",
			});
	});

	/**
	 * The server rejects this value with a 400, so the round trip is saved. The comparison folds case
	 * because the server lowercases the new address; without folding, `Me@x.com` would pass the form
	 * and then be rejected.
	 */
	it("refuses the address in use now, regardless of case", () => {
		expect(checkNewEmail(CURRENT, CURRENT).ok).toBe(false);
		expect(checkNewEmail("ME@EXAMPLE.COM", CURRENT)).toEqual({
			ok: false,
			reason: "same",
		});
		expect(checkNewEmail("  me@example.com  ", CURRENT)).toEqual({
			ok: false,
			reason: "same",
		});
		/** The current address's whitespace is folded too; same fact from either side. */
		expect(checkNewEmail(CURRENT, `  ${CURRENT} `)).toEqual({
			ok: false,
			reason: "same",
		});
	});

	/** Only surrounding whitespace is trimmed; case is the mail server's decision. */
	it("a sendable value comes back with only the whitespace trimmed", () => {
		expect(checkNewEmail("  New@Example.com ", CURRENT)).toEqual({
			ok: true,
			email: "New@Example.com",
		});
	});

	/**
	 * No account enumeration: reasons like "already used by another account" are not in the
	 * vocabulary, so no code can draw that sentence.
	 */
	it("there are only three reasons in the vocabulary", () => {
		const reasons = ["empty", "format", "same"] as const;
		for (const reason of reasons)
			expect(changeEmailCheckMessage(reason)).toBeTruthy();
		for (const reason of reasons)
			expect(changeEmailCheckMessage(reason)).not.toMatch(
				/already in use|another account|used by/i,
			);
	});
});

describe("isEmailChangeReturn", () => {
	it("only the one value we wrote is true", () => {
		expect(isEmailChangeReturn(EMAIL_CHANGE_RETURN_VALUE)).toBe(true);
	});

	/**
	 * With `Boolean(param)`, any string in a hand-edited deep link would pass, and code drawing that
	 * string would follow sooner or later.
	 */
	it("every other value is false", () => {
		for (const raw of [
			undefined,
			null,
			"",
			"1",
			"true",
			"evil",
			"changed ",
			"Changed",
			["changed"],
			{ toString: () => "changed" },
		])
			expect(isEmailChangeReturn(raw), String(raw)).toBe(false);
	});
});
