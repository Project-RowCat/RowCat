import {
	isAuthenticatorCodeShape,
	normalizeAuthenticatorCode,
	type TwoFactorCodeMethod,
} from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";
import type { AuthFailure } from "./auth-error.ts";
import { isTransportFailure } from "./auth-error.ts";

/**
 * Screen rules for two-factor authentication. These are pure functions: the login challenge and the
 * account settings dialog both read them.
 *
 * The protocol (TOTP verification, backup code matching, the challenge cookie) belongs to the
 * server's Better Auth plugin. What lives here is only the work of presenting its results to
 * people. The server-side door rule is in `apps/api/src/auth/two-factor-policy.ts`.
 *
 * The code's shape (digit count, normalization) is the same function as on mobile, so it lives in
 * `two-factor.ts` in `@rowcat/domain` and this file only re-exports it. The failure sentences and
 * the enablement steps are this app's own.
 *
 * ## Wording: `backup code`, not `recovery code`
 *
 * In this repository `recovery code` is the sync term: the key that opens encrypted conversations on
 * another device. Calling both by the same name makes someone who lost one look for the other, and
 * worse, lets one be typed into the other's field. So the one-time codes of 2FA are `backup codes`.
 */

export {
	AUTHENTICATOR_CODE_LENGTH,
	isAuthenticatorCodeShape,
	normalizeAuthenticatorCode,
	normalizeBackupCode,
	type TwoFactorCodeMethod,
} from "@rowcat/domain";

/** Whether a sign-in response says "the password was correct and a second factor remains". */
export function isTwoFactorRedirect(data: unknown): boolean {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
	);
}

/**
 * A challenge failure, split by what the person should do next:
 *
 * ```text
 * wrong code                    type it again
 * locked / too many attempts    wait
 * challenge expired (10 min)    start the login over   <- retyping in the same field cannot help
 * no connection                 retry
 * ```
 *
 * The third row is the reason for this table. Folding a failure that happens after the challenge
 * cookie is gone into "wrong code" would have someone holding the right code keep typing it into
 * the same field.
 */
export interface TwoFactorFailureView {
	message: string;
	/** Whether to start the login over. The screen collapses the challenge field and returns to the login form. */
	restart: boolean;
}

export function twoFactorChallengeFailure(
	failure: AuthFailure,
	method: TwoFactorCodeMethod,
): TwoFactorFailureView {
	if (isTransportFailure(failure))
		return {
			message: translator("auth")("twoFactor.disconnected"),
			restart: false,
		};
	switch (failure.code) {
		case "INVALID_TWO_FACTOR_COOKIE":
			return {
				message: translator("auth")("twoFactor.expired"),
				restart: true,
			};
		case "ACCOUNT_TEMPORARILY_LOCKED":
		case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
			return {
				message: translator("auth")("twoFactor.locked"),
				restart: true,
			};
		default:
			break;
	}
	if (failure.status === 429)
		return {
			message: translator("auth")("rateLimited"),
			restart: false,
		};
	return {
		message:
			method === "backup"
				? translator("auth")("twoFactor.backupInvalid")
				: translator("auth")("twoFactor.codeInvalid"),
		restart: false,
	};
}

/* ══════════════════════════════════════════════════════════════════════════
 * Enabling from the account settings
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Enablement steps. **Backup codes come before the authenticator app.**
 *
 * ```text
 * password   re-enter the password             -> the server issues the secret and backup codes (still off)
 * backup     show the ten backup codes         -> saving them must be acknowledged before moving on
 * scan       QR or manual key, then first code -> 2FA turns on only when this code is accepted
 * done       enabled
 * ```
 *
 * The order is this slice's promise. If the authenticator app were registered first, people would
 * stop there and close the dialog, leaving an account with no way in once the second factor is
 * lost. Acknowledging the saved backup codes is a precondition for enabling, so an account enabled
 * without backup codes cannot be represented.
 */
export type TwoFactorSetupStep = "password" | "backup" | "scan" | "done";

/** Whether the current step can advance. Each step requires exactly one thing. */
export function canAdvanceTwoFactorSetup(
	step: TwoFactorSetupStep,
	input: { password: string; savedBackupCodes: boolean; code: string },
): boolean {
	switch (step) {
		case "password":
			return input.password.length > 0;
		case "backup":
			return input.savedBackupCodes;
		case "scan":
			return isAuthenticatorCodeShape(normalizeAuthenticatorCode(input.code));
		case "done":
			return false;
	}
}

/**
 * Extracts the **manual entry key** from an authenticator app URI, for people who cannot scan the
 * QR code.
 *
 * Returned in groups of four, the way authenticator apps display it, which is easier to copy.
 * Returns `null` if the URI does not have the expected shape: showing a made-up key would make
 * their authenticator app generate wrong codes forever.
 */
export function manualEntryKey(totpURI: string): string | null {
	let url: URL;
	try {
		url = new URL(totpURI);
	} catch {
		return null;
	}
	if (url.protocol !== "otpauth:") return null;
	const secret = url.searchParams.get("secret");
	if (!secret || !/^[A-Z2-7]+=*$/.test(secret)) return null;
	return secret
		.replace(/=+$/, "")
		.replace(/(.{4})/g, "$1 ")
		.trim();
}

/**
 * Failures of enabling, disabling and regenerating. The server requires recent login (24 hours)
 * plus the password for these operations. For someone who has been signed in for a while, that is
 * the normal path rather than an error, and the session list draws the same state the same way.
 */
export type TwoFactorManageFailure =
	| { kind: "recent-login" }
	| { kind: "password" }
	| { kind: "code" }
	| { kind: "other" };

export function twoFactorManageFailure(
	failure: AuthFailure,
): TwoFactorManageFailure {
	if (failure.code === "SESSION_NOT_FRESH") return { kind: "recent-login" };
	if (
		failure.code === "INVALID_PASSWORD" ||
		failure.code === "INVALID_EMAIL_OR_PASSWORD"
	)
		return { kind: "password" };
	if (failure.code === "INVALID_CODE") return { kind: "code" };
	return { kind: "other" };
}

export function twoFactorManageMessage(
	kind: TwoFactorManageFailure["kind"],
): string {
	const t = translator("auth");
	if (kind === "recent-login") return t("twoFactor.recentLogin");
	if (kind === "password") return t("twoFactor.passwordInvalid");
	if (kind === "code") return t("twoFactor.codeInvalid");
	return t("twoFactor.otherFailed");
}
