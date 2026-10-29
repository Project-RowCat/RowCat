import { PASSWORD_LENGTH } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	checkPasswordForm,
	type PasswordFormValues,
	passwordFormMessage,
} from "./password-form.ts";

const values = (
	patch: Partial<PasswordFormValues> = {},
): PasswordFormValues => ({
	currentPassword: "",
	newPassword: "",
	confirmPassword: "",
	...patch,
});

const OK = "hunter2hunter2";

describe("checkPasswordForm — set", () => {
	/** Settings has no current password: that account has no such value, so requiring one means the form never submits. */
	it("doesn't require the current password", () => {
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: OK, confirmPassword: OK }),
			),
		).toBeNull();
	});

	it("blocks an empty new password", () => {
		expect(checkPasswordForm("set", values())).toBe("new_required");
	});
});

describe("checkPasswordForm — change", () => {
	it("requires the current password", () => {
		expect(
			checkPasswordForm(
				"change",
				values({ newPassword: OK, confirmPassword: OK }),
			),
		).toBe("current_required");
	});

	it("passes when all three are right", () => {
		expect(
			checkPasswordForm(
				"change",
				values({
					currentPassword: "old",
					newPassword: OK,
					confirmPassword: OK,
				}),
			),
		).toBeNull();
	});
});

describe("checkPasswordForm — order and length", () => {
	/**
	 * The order is the rule: empty, then length, then match. Checking match first would show a
	 * mismatch error instead of a length error to someone who typed the same short value twice.
	 */
	it("length comes first even when the short values match", () => {
		const short = "a".repeat(PASSWORD_LENGTH.min - 1);
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: short, confirmPassword: short }),
			),
		).toBe("too_short");
	});

	it("blocks over the limit", () => {
		const long = "a".repeat(PASSWORD_LENGTH.max + 1);
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: long, confirmPassword: long }),
			),
		).toBe("too_long");
	});

	it("boundary values pass", () => {
		for (const length of [PASSWORD_LENGTH.min, PASSWORD_LENGTH.max]) {
			const value = "a".repeat(length);
			expect(
				checkPasswordForm(
					"set",
					values({ newPassword: value, confirmPassword: value }),
				),
				String(length),
			).toBeNull();
		}
	});

	it("blocks when the confirmation differs", () => {
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: OK, confirmPassword: `${OK}x` }),
			),
		).toBe("mismatch");
	});

	/**
	 * Passwords are not trimmed. Surrounding whitespace is part of the value, so two values differing
	 * only in whitespace are different passwords; folding them would create a password that works only
	 * on the device that made it.
	 */
	it("counts spaces as part of the value", () => {
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: ` ${OK} `, confirmPassword: OK }),
			),
		).toBe("mismatch");

		const spaced = `  ${OK}  `;
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: spaced, confirmPassword: spaced }),
			),
		).toBeNull();

		/** A whitespace-only value passes if it is long enough: the judgment is length, not content. */
		const blanks = " ".repeat(PASSWORD_LENGTH.min);
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: blanks, confirmPassword: blanks }),
			),
		).toBeNull();
	});
});

describe("passwordFormMessage", () => {
	/** An empty field gets no sentence: not yet a mistake, and a disabled button is enough. */
	it("no sentence on empty fields", () => {
		expect(passwordFormMessage("current_required")).toBeNull();
		expect(passwordFormMessage("new_required")).toBeNull();
	});

	/** The length sentence reads the contract's constant; a hand-typed number would split the policy. */
	it("the length sentence comes from the shared constant", () => {
		expect(passwordFormMessage("too_short")).toContain(
			String(PASSWORD_LENGTH.min),
		);
		expect(passwordFormMessage("too_long")).toContain(
			String(PASSWORD_LENGTH.max),
		);
		expect(passwordFormMessage("mismatch")).toBeTruthy();
	});
});
