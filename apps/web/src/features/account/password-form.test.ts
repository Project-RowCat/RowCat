import { PASSWORD_LENGTH } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import {
	checkPasswordForm,
	type PasswordFormValues,
	passwordFormMessage,
} from "./password-form.ts";

/**
 * Password form verdicts, **checked without React**.
 *
 * The most important assertion here is that whitespace is preserved. If that rule breaks, the form
 * still works and most tests still pass. The symptom appears much later: someone who set a password
 * starting with a space cannot sign in.
 */

const values = (
	over: Partial<PasswordFormValues> = {},
): PasswordFormValues => ({
	currentPassword: "current-secret-value",
	newPassword: "correct-horse-battery",
	confirmPassword: "correct-horse-battery",
	...over,
});

describe("checkPasswordForm", () => {
	test("a fully filled change form passes", () => {
		expect(checkPasswordForm("change", values())).toBeNull();
	});

	/** The set mode has **no** current password. Requiring one would make that form never submittable. */
	test("set mode does not require the current password", () => {
		expect(
			checkPasswordForm("set", values({ currentPassword: "" })),
		).toBeNull();
	});

	test("change mode requires the current password", () => {
		expect(checkPasswordForm("change", values({ currentPassword: "" }))).toBe(
			"current_required",
		);
	});

	test("does not submit when the confirmation differs", () => {
		expect(
			checkPasswordForm("change", values({ confirmPassword: "different" })),
		).toBe("mismatch");
	});

	test.each([
		["short", "a".repeat(PASSWORD_LENGTH.min - 1), "too_short"],
		["long", "a".repeat(PASSWORD_LENGTH.max + 1), "too_long"],
	])("catches a length violation (%s)", (_label, password, issue) => {
		expect(
			checkPasswordForm(
				"change",
				values({ newPassword: password, confirmPassword: password }),
			),
		).toBe(issue);
	});

	test("boundary values pass", () => {
		for (const length of [PASSWORD_LENGTH.min, PASSWORD_LENGTH.max]) {
			const password = "a".repeat(length);
			expect(
				checkPasswordForm(
					"change",
					values({ newPassword: password, confirmPassword: password }),
				),
			).toBeNull();
		}
	});

	/**
	 * **Do not trim whitespace.** If it were trimmed, the two fields would look equal and pass, but
	 * the server stores the untrimmed value, so the user would end up with a password different from
	 * the one they typed into the confirmation field.
	 */
	test("different surrounding whitespace does not match", () => {
		expect(
			checkPasswordForm(
				"change",
				values({
					newPassword: " padded-secret-value ",
					confirmPassword: "padded-secret-value",
				}),
			),
		).toBe("mismatch");
	});

	/** A password made only of whitespace passes once the length is met. This means no trimming is applied. */
	test("whitespace alone passes if it meets the length", () => {
		const password = " ".repeat(PASSWORD_LENGTH.min);
		expect(
			checkPasswordForm(
				"set",
				values({ newPassword: password, confirmPassword: password }),
			),
		).toBeNull();
	});

	/** Empty fields are unfinished, not mistakes, so no sentence is shown. */
	test("an empty field has no sentence", () => {
		expect(passwordFormMessage("current_required")).toBeNull();
		expect(passwordFormMessage("new_required")).toBeNull();
	});

	test("a fixable mistake has a sentence", () => {
		for (const issue of ["too_short", "too_long", "mismatch"] as const)
			expect(passwordFormMessage(issue)).toBeTruthy();
	});
});
