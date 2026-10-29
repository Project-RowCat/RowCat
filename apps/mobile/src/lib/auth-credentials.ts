import type { AuthFailure } from "./auth-error.ts";

/**
 * Things the form filters **before** sending to the server. This is guidance that saves a round
 * trip, not policy.
 *
 * The server is the final authority (`emailAndPassword` in `apps/api/src/auth/index.ts`). Loosening
 * a rule here opens no door, and creating a rule here that the server lacks would create a password
 * that only mobile refuses — that is a second policy, not guidance.
 *
 * So these are deliberately absent: uppercase/digit/symbol requirements, a banned-word list, a
 * nickname length cap (the server's value is not in the contract), and an email domain allowlist.
 *
 * The reason for purity is the same as the other checks in this repo: inside a form component they
 * cannot be verified without rendering, and their mistakes are silent (the submit button never
 * becomes pressable).
 */

/** Password length policy. Same values as the server's `minPasswordLength` and `maxPasswordLength`. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Only trims leading and trailing whitespace.
 *
 * Not lowercased: case sensitivity of the local part is set by the mail server, and folding here
 * would make an account created that way and a sign-in attempt different strings. The server
 * (Better Auth) decides with its own rules.
 */
export const normalizeEmail = (email: string): string => email.trim();

/**
 * **The password is never normalized in any way.**
 *
 * The absence of a function is the rule. If trim, lowercasing or Unicode normalization were
 * applied, a password created with leading or trailing spaces would work only on the device that
 * made it: a form on another device that does not do the same normalization would never let that
 * person sign in with the right password, and there would be no way to find out why.
 */

/** Email shape. Not hand-extended; the server makes the final decision. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether this string has the email shape — **the only place in this app where this check lives.**
 *
 * The email change on the account screen is the second consumer. A second regex there would let the
 * two forms accept different values, and the mismatch would reproduce on only one screen. The web
 * uses zod's `z.email()`, but this app does not depend on zod directly, so it does not make a copy.
 *
 * Leading and trailing whitespace is **not assumed trimmed by the caller** — it is trimmed here
 * again (idempotent).
 */
export const looksLikeEmail = (value: string): boolean =>
	EMAIL_SHAPE.test(value.trim());

export interface SignInInput {
	email: string;
	password: string;
}

export interface SignUpInput extends SignInInput {
	name: string;
	confirmPassword: string;
}

/**
 * Sign-in checks **only emptiness.**
 *
 * Applying length rules here would hurt in two ways: a password created under an older, shorter
 * policy could not get past the sign-in screen, and the message "8 characters or more" would make
 * the form read the server policy. Same reason as the web's check.
 */
export function checkSignIn(input: SignInInput): AuthFailure | null {
	const email = normalizeEmail(input.email);
	if (!email || !EMAIL_SHAPE.test(email)) return "invalid_email";
	if (!input.password) return "invalid_credentials";
	return null;
}

/**
 * Sign-up must say the reason to be fixable: length and confirmation match are values the user can
 * change. (Unlike sign-in, the reason is not blurred here; blurring it would leave the user never
 * knowing why sign-up failed.)
 */
export function checkSignUp(input: SignUpInput): AuthFailure | null {
	if (!input.name.trim()) return "name_required";

	const email = normalizeEmail(input.email);
	if (!email || !EMAIL_SHAPE.test(email)) return "invalid_email";

	if (input.password.length < PASSWORD_MIN_LENGTH) return "password_too_short";
	if (input.password.length > PASSWORD_MAX_LENGTH) return "password_too_long";
	if (input.password !== input.confirmPassword) return "password_mismatch";

	return null;
}
