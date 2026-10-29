import { PASSWORD_LENGTH } from "@rowcat/contracts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Pure validation for the password form, checkable without rendering.
 *
 * ## Why outside the component
 *
 * Two things here go silently wrong if assembled inside a component. First, **the fields required
 * depend on the mode** (the set mode has no current password, and requiring a value that does not
 * exist means the form can never be submitted). Second, **the values must not be trimmed**. A
 * single `.trim()` makes the screen and the server disagree, and the symptom is "I cannot sign in
 * with the password I just set".
 *
 * ## This is not the authority
 *
 * Here only **immediate guidance** happens. The final authority on length is the Better Auth
 * configuration (`apps/api/src/auth/index.ts`), and that configuration and this function read the
 * **same constant** (`PASSWORD_LENGTH`). If three places each wrote their own number, the day only
 * one was changed the form would pass a value that comes back as a 400.
 *
 * Only the confirmation field (`confirmPassword`) lives here. The server does not know that field
 * and has no reason to. It is a device for catching typos, not a security rule.
 *
 * ## The axis length is counted on
 *
 * `.length` (UTF-16 code units). Better Auth counts on the same axis. Counting code points would
 * make two verdicts differ for passwords containing emoji. The rule is to **match** the server;
 * which axis is used is not itself the rule.
 */

/** Whether the account being changed already has a password, or one is being attached. */
export type PasswordFormMode = "change" | "set";

export interface PasswordFormValues {
	/** Not used in `set` mode: that account has no current password. */
	currentPassword: string;
	newPassword: string;
	confirmPassword: string;
}

/**
 * The reason submission is blocked, or `null` if none.
 *
 * It is not folded to a boolean because the screen attaches a different sentence next to each
 * field. "Too short" belongs to the new password field, and "does not match" to the confirmation
 * field. Folding them into one value would put both errors in the same place.
 */
export type PasswordFormIssue =
	| "current_required"
	| "new_required"
	| "too_short"
	| "too_long"
	| "mismatch";

/**
 * Whether submitting now is allowed.
 *
 * The order is the rule: **empty fields first, then length, then match.** Checking match first
 * would let a form with nothing typed pass through a "passwords match" state, and someone who wrote
 * the same short password in both fields would see a mismatch error instead of the length error.
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
 * Reason to sentence for the screen.
 *
 * `current_required` and `new_required` have no sentence on purpose. An empty field is not yet a
 * mistake, it is **not finished yet**. Showing red text before the user has started typing would
 * read as the form scolding them. Disabling the button is enough for those.
 */
export function passwordFormMessage(issue: PasswordFormIssue): string | null {
	switch (issue) {
		case "too_short":
			return translator("account")("passwordForm.tooShort", {
				min: PASSWORD_LENGTH.min,
			});
		case "too_long":
			return translator("account")("passwordForm.tooLong", {
				max: PASSWORD_LENGTH.max,
			});
		case "mismatch":
			return translator("account")("passwordForm.theNewPasswordsDonT");
		default:
			return null;
	}
}
