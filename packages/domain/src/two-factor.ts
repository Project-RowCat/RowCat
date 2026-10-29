/**
 * The shape of a two-factor code. The web and mobile challenges call the same functions.
 * Verification is done by the server (the Better Auth two-factor plugin). This module only folds
 * what a person typed into the form the server expects.
 *
 * If each app wrote its own rules, one would accept `123 456` while the other rejected it, and the
 * mismatch would surface only as 'this code does not work in this app.'
 *
 * The label is `backup code`. `Recovery code` is the sync key. Two keys under the same name would send someone
 * who lost one looking for the other.
 */

/** Digit count of an authenticator code. It matches the server plugin's default of 6. */
export const AUTHENTICATOR_CODE_LENGTH = 6;

/** What the challenge accepts: a six-digit authenticator code or one backup code. */
export type TwoFactorCodeMethod = "authenticator" | "backup";

/**
 * Folds an authenticator code by removing only whitespace and hyphens. Apps display codes as `123
 * 456` or `123-456`, and people type what they see.
 *
 * Non-digit characters are left in place so that isAuthenticatorCodeShape rejects them. Silently
 * removing them would shorten a mistyped code to the right length and send it on.
 */
export const normalizeAuthenticatorCode = (raw: string): string =>
	raw.replace(/[\s-]/g, "");

export const isAuthenticatorCodeShape = (code: string): boolean =>
	code.length === AUTHENTICATOR_CODE_LENGTH && /^\d+$/.test(code);

/**
 * Folds a backup code by trimming surrounding whitespace only. Backup codes are case-sensitive
 * alphanumerics (for example `abcde-FGHIJ`). Folding case would make valid codes invalid, and
 * removing hyphens would no longer match the issued format. This follows the same rule as not
 * normalizing a password.
 */
export const normalizeBackupCode = (raw: string): string => raw.trim();

/** Whether the current input can be sent. The shape depends on the method. */
export function twoFactorCodeReady(
	method: TwoFactorCodeMethod,
	raw: string,
): boolean {
	return method === "authenticator"
		? isAuthenticatorCodeShape(normalizeAuthenticatorCode(raw))
		: normalizeBackupCode(raw).length > 0;
}

/** Folds the value by method. What goes to the server is always this result. */
export const normalizeTwoFactorCode = (
	method: TwoFactorCodeMethod,
	raw: string,
): string =>
	method === "authenticator"
		? normalizeAuthenticatorCode(raw)
		: normalizeBackupCode(raw);
