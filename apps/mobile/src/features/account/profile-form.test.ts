import { BIO_LIMITS, NICKNAME_LIMITS } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	checkBio,
	checkNickname,
	dropStaleSaved,
	type SaveResult,
} from "./profile-form.ts";

/**
 * Submit rules of the profile form.
 *
 * The limits come from the contract's constants rather than literals, so this test moves with them;
 * a hard-coded number would stay green after the contract changes.
 */

describe("checkNickname", () => {
	it("the value with leading and trailing spaces trimmed is the value to send", () => {
		const check = checkNickname("  cat  ", "Puppy");
		expect(check.trimmed).toBe("cat");
		expect(check.error).toBeNull();
		expect(check.unchanged).toBe(false);
	});

	it("an empty value isn't submitted", () => {
		expect(checkNickname("   ", "Cat").error).not.toBeNull();
	});

	it("a value over the limit isn't submitted", () => {
		const over = "a".repeat(NICKNAME_LIMITS.max + 1);
		expect(checkNickname(over, "Cat").error).toContain(
			String(NICKNAME_LIMITS.max),
		);
	});

	/** A round trip saving the same value looks like nothing happened, so it is locked. */
	it("nothing changed is unchanged — even if only spaces differ", () => {
		expect(checkNickname("Cat", "Cat").unchanged).toBe(true);
		expect(checkNickname("  Cat ", "Cat").unchanged).toBe(true);
	});
});

describe("checkBio", () => {
	it("a value within the limit passes", () => {
		const check = checkBio("Bio", "");
		expect(check.error).toBeNull();
		expect(check.tooLong).toBe(false);
		expect(check.count).toBe(3);
	});

	/**
	 * Overflow is never silently trimmed. The verdict only says it overflowed and `trimmed` is the
	 * pasted text as is; saving is locked and the count and sentence give the reason.
	 */
	it("over the limit it locks, and the value isn't truncated", () => {
		const over = "a".repeat(BIO_LIMITS.max + 5);
		const check = checkBio(over, "");
		expect(check.tooLong).toBe(true);
		expect(check.error).toContain(String(BIO_LIMITS.max));
		expect(check.trimmed).toBe(over);
		expect(check.count).toBe(BIO_LIMITS.max + 5);
	});

	it("the same as the saved value is unchanged", () => {
		expect(checkBio("Bio", "Bio").unchanged).toBe(true);
		expect(checkBio("Bio!", "Bio").unchanged).toBe(false);
	});
});

describe("dropStaleSaved", () => {
	/** Once editing starts, `Saved` is false: the field's text is no longer the saved value. */
	it("editing clears the saved marker", () => {
		expect(dropStaleSaved({ kind: "saved" })).toBeNull();
	});

	/** The failure sentence stays: if it vanished while fixing, the user could not see what to fix. */
	it("the failure copy stays through edits", () => {
		const failure: SaveResult = { kind: "error", message: "Didn't work" };
		expect(dropStaleSaved(failure)).toBe(failure);
		expect(dropStaleSaved(null)).toBeNull();
	});
});
