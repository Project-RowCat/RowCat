import { PASSWORD_LENGTH } from "@rowcat/contracts";

/**
 * Pure decisions for the password form, checkable without rendering. Same rules and order as the
 * web `password-form.ts`.
 *
 * Kept out of the component because two things go quietly wrong when assembled there: the required
 * fields differ by mode (settings has no current password; demanding a missing value means the form
 * never submits), and the value must not be trimmed (one `.trim()` splits the screen's verdict from
 * the server's, shown as "the password I just made does not sign in").
 *
 * This is not the authority. It only gives immediate guidance. The final authority on length is the
 * Better Auth config (`apps/api/src/auth/index.ts`), and this function reads the same constant
 * (`PASSWORD_LENGTH`); with three hand-typed numbers, the day one is fixed the form passes a value
 * that comes back as a 400. The login form's `PASSWORD_MIN_LENGTH` is not reused for the same
 * reason: it is this app's hand-written copy, and the contract's constant is the original.
 *
 * Only the confirm field (`confirmPassword`) exists here alone. The server neither knows nor needs
 * it; it hands typos back to the user and is not a security rule.
 *
 * Length is `.length` (UTF-16 code units) because Better Auth counts that way; counting code points
 * would split the two verdicts on passwords containing emoji. What matters is matching, not which
 * axis.
 */

/** Whether this edits an account that has a password or attaches one to an account without. */
export type PasswordFormMode = "change" | "set";

export interface PasswordFormValues {
	/** Unused in `set` mode: that account has no current password. */
	currentPassword: string;
	newPassword: string;
	confirmPassword: string;
}

/**
 * Reason for blocking submit, `null` if none. Not folded to a boolean because the screen attaches a
 * different sentence per reason: "too short" belongs to the new-password field and "does not match"
 * to the confirm field, and one value would show both errors in the same place.
 */
export type PasswordFormIssue =
	| "current_required"
	| "new_required"
	| "too_short"
	| "too_long"
	| "mismatch";

/**
 * Whether submitting now is allowed. The order is the rule: empty, then length, then match.
 * Checking match first would let an untouched form pass through a "passwords match" state, and
 * someone who typed the same short value twice would see a match error instead of a length error.
 */
export function checkPasswordForm(
	mode: PasswordFormMode,
	values: PasswordFormValues,
): PasswordFormIssue | null {
	if (mode === "change" && values.currentPassword.length === 0)
		return "current_required";
	if (values.newPassword.length === 0) return "new_required";
	if (values.newPassword.length < PASSWORD_LENGTH.min) return "too_short";
	if (values.newPassword.length > PASSWORD_LENGTH.max) return "too_long";
	if (values.newPassword !== values.confirmPassword) return "mismatch";
	return null;
}

/**
 * Reason to on-screen sentence. `current_required` and `new_required` deliberately have none: an
 * empty field is not a mistake yet, and red text before typing begins reads as the form scolding
 * the user. A disabled button is enough for those two.
 */
export function passwordFormMessage(issue: PasswordFormIssue): string | null {
	switch (issue) {
		case "too_short":
			return `Passwords must be at least ${PASSWORD_LENGTH.min} characters.`;
		case "too_long":
			return `Passwords must be at most ${PASSWORD_LENGTH.max} characters.`;
		case "mismatch":
			return "The new passwords don't match.";
		default:
			return null;
	}
}

export { PASSWORD_LENGTH };
