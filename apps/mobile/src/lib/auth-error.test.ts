import { describe, expect, it } from "vitest";
import {
	checkSignIn,
	checkSignUp,
	normalizeEmail,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
} from "./auth-credentials.ts";
import {
	AUTH_FAILURE_MESSAGE,
	type AuthFailure,
	AuthFlowError,
	authFailure,
	authFailureOf,
	isTwoFactorRedirect,
	twoFactorRestartRequired,
} from "./auth-error.ts";

describe("server error → a fact the user reads", () => {
	/**
	 * **Do not revive account enumeration on screen.** The server answers "no such email" and "wrong
	 * password" with the same code (`apps/api/src/auth/credentials.test.ts` guards that). If the
	 * screen split them into different sentences here, that effort would be entirely undone on screen.
	 */
	it("the credential family folds into one cell", () => {
		for (const code of [
			"INVALID_EMAIL_OR_PASSWORD",
			"INVALID_PASSWORD",
			"USER_NOT_FOUND",
			"CREDENTIAL_ACCOUNT_NOT_FOUND",
			"ACCOUNT_NOT_FOUND",
			"INVALID_USER",
		])
			expect(authFailure({ code, status: 401 })).toBe("invalid_credentials");
	});

	it("a sign-up failure tells the reason — the value can be fixed", () => {
		expect(authFailure({ code: "USER_ALREADY_EXISTS", status: 422 })).toBe(
			"email_taken",
		);
		expect(authFailure({ code: "PASSWORD_TOO_SHORT", status: 400 })).toBe(
			"password_too_short",
		);
		expect(authFailure({ code: "PASSWORD_TOO_LONG", status: 400 })).toBe(
			"password_too_long",
		);
		expect(authFailure({ code: "INVALID_EMAIL", status: 400 })).toBe(
			"invalid_email",
		);
	});

	/**
	 * **Do not fold every failure into "wrong password".** Server unreachable and wrong password need
	 * different actions from the user: the first means waiting, the second means correcting the input.
	 */
	it("send failures and server errors aren't credential failures", () => {
		expect(authFailure({})).toBe("unreachable");
		expect(authFailure({ status: 0 })).toBe("unreachable");
		expect(authFailure({ status: 500 })).toBe("unreachable");
		expect(authFailure({ status: 503 })).toBe("unreachable");
	});

	it("rapid-press limits are said separately", () => {
		expect(authFailure({ status: 429 })).toBe("too_many_attempts");
	});

	it("a provider not being configured isn't the user's fault", () => {
		expect(authFailure({ code: "PROVIDER_NOT_FOUND", status: 404 })).toBe(
			"provider_unavailable",
		);
	});

	it("no error means unknown", () => {
		expect(authFailure(null)).toBe("unknown");
		expect(authFailure(undefined)).toBe("unknown");
	});

	it("every fact has copy — screens don't draw empty strings", () => {
		const failures: AuthFailure[] = [
			"invalid_credentials",
			"email_taken",
			"invalid_email",
			"password_too_short",
			"password_too_long",
			"password_mismatch",
			"name_required",
			"too_many_attempts",
			"provider_unavailable",
			"social_without_session",
			"unreachable",
			"session_without_viewer",
			"sign_out_failed",
			"unknown",
		];
		for (const failure of failures)
			expect(AUTH_FAILURE_MESSAGE[failure]?.length ?? 0).toBeGreaterThan(0);
	});

	/**
	 * **Do not assert what we have not confirmed.**
	 *
	 * A social round trip can end without a session in two ways (the user closed the sheet, or the
	 * server rejected sign-in), and this app cannot tell them apart. Writing "cancelled" would make
	 * someone who was rejected read that they did something they did not do, and they would press the
	 * same button and get the same result.
	 */
	it("doesn't assert a social failure was a cancellation", () => {
		const message = AUTH_FAILURE_MESSAGE.social_without_session;
		expect(message).not.toContain("Cancel");
		/** It must stay inside a true sentence even for a branch that does not resolve on retry. */
		expect(message).toContain("email");
	});

	it("copy leaks neither internal codes nor status", () => {
		for (const message of Object.values(AUTH_FAILURE_MESSAGE)) {
			expect(message).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
			expect(message).not.toMatch(/https?:\/\//);
		}
	});
});

describe("thrown value → fact", () => {
	it("our errors bring their own fact", () => {
		expect(authFailureOf(new AuthFlowError("email_taken"))).toBe("email_taken");
	});

	it("an unfamiliar exception is treated as a send failure — usually what fetch threw", () => {
		expect(authFailureOf(new Error("boom"))).toBe("unreachable");
		expect(authFailureOf("string")).toBe("unreachable");
	});
});

describe("what gets filtered before sending", () => {
	const password = "correct-horse-battery-staple";

	it("email trims only leading and trailing spaces — doesn't fold case", () => {
		/**
		 * The local part's case sensitivity is set by the mail server. If we fold, the account created
		 * that way and a sign-in attempt become different strings.
		 */
		expect(normalizeEmail("  Alice@Example.test  ")).toBe("Alice@Example.test");
	});

	it("sign-in only checks emptiness", () => {
		expect(checkSignIn({ email: "a@b.test", password: "x" })).toBeNull();
		expect(checkSignIn({ email: "a@b.test", password: "" })).toBe(
			"invalid_credentials",
		);
		expect(checkSignIn({ email: "not-an-email", password })).toBe(
			"invalid_email",
		);
		expect(checkSignIn({ email: "  ", password })).toBe("invalid_email");
	});

	/**
	 * Sign-in carries no length rule. With one, a shorter password made under an earlier policy could
	 * not get past the sign-in screen, and the message "8 characters or more" would make the form read
	 * the server policy.
	 */
	it("sign-in doesn't block short passwords", () => {
		expect(checkSignIn({ email: "a@b.test", password: "1234" })).toBeNull();
	});

	it("sign-up splits the reasons", () => {
		const base = {
			name: "Alice",
			email: "a@b.test",
			password,
			confirmPassword: password,
		};
		expect(checkSignUp(base)).toBeNull();
		expect(checkSignUp({ ...base, name: "   " })).toBe("name_required");
		expect(checkSignUp({ ...base, email: "nope" })).toBe("invalid_email");
		expect(
			checkSignUp({ ...base, password: "short", confirmPassword: "short" }),
		).toBe("password_too_short");
		expect(
			checkSignUp({
				...base,
				password: "x".repeat(PASSWORD_MAX_LENGTH + 1),
				confirmPassword: "x".repeat(PASSWORD_MAX_LENGTH + 1),
			}),
		).toBe("password_too_long");
		expect(checkSignUp({ ...base, confirmPassword: "A different value" })).toBe(
			"password_mismatch",
		);
	});

	/**
	 * **Do not normalize passwords.** If a password created with leading or trailing spaces works only
	 * on the device that made it, that person can never sign in with the password they know, and has
	 * no way to learn why.
	 */
	it("accepts a password containing spaces as is", () => {
		const spaced = "  A password with two spaces  ";
		expect(spaced.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
		expect(
			checkSignUp({
				name: "Alice",
				email: "a@b.test",
				password: spaced,
				confirmPassword: spaced,
			}),
		).toBeNull();
		expect(checkSignIn({ email: "a@b.test", password: spaced })).toBeNull();
	});

	/**
	 * Do not create rules the server lacks. That is not guidance: it is a **second policy existing
	 * only in mobile**, and it would reject passwords made on other devices in this app alone.
	 */
	it("doesn't require uppercase, digits or symbols", () => {
		const plain = "aaaaaaaaaa";
		expect(
			checkSignUp({
				name: "Alice",
				email: "a@b.test",
				password: plain,
				confirmPassword: plain,
			}),
		).toBeNull();
	});
});

/**
 * **Email ownership confirmation is not a credential failure.**
 *
 * On deployments with a mail transport, the server issues this code **after** verifying the
 * password. So only this fact splits off from the credential family, and the split does not become
 * material for account enumeration — to see this sentence you must already know that account's
 * password.
 */
describe("email ownership verification", () => {
	it("folds into a fact different from credential failure", () => {
		expect(authFailure({ code: "EMAIL_NOT_VERIFIED", status: 403 })).toBe(
			"email_not_verified",
		);
		expect(authFailure({ code: "EMAIL_NOT_VERIFIED", status: 403 })).not.toBe(
			"invalid_credentials",
		);
	});

	/**
	 * The sentence says **where to look.** This app has no screen that resends the confirmation mail
	 * (that is the web's job), so this is all it can do here.
	 */
	it("points at the inbox", () => {
		expect(AUTH_FAILURE_MESSAGE.email_not_verified).toContain(
			"verification email",
		);
	});

	/**
	 * **Do not guide users to a procedure that does not exist.** This app has no resend button and no
	 * email change screen — if the sentence promised them, the user would hunt for screens that are
	 * not there.
	 */
	it("doesn't promise operations this app lacks", () => {
		const message = AUTH_FAILURE_MESSAGE.email_not_verified;
		expect(message).not.toContain("send again");
		expect(message).not.toContain("Change email");
	});
});

/**
 * Reasons for a two-factor challenge — same branches as the web's `features/auth/two-factor.ts`.
 *
 * Folding expiry or lockout into "wrong code" would have someone holding the correct code keep
 * typing into the same field, so those two end the challenge and return to the sign-in form.
 */
describe("two-factor challenge", () => {
	it.each([
		["INVALID_CODE", "two_factor_invalid_code", false],
		["INVALID_BACKUP_CODE", "two_factor_invalid_backup_code", false],
		["INVALID_TWO_FACTOR_COOKIE", "two_factor_expired", true],
		["ACCOUNT_TEMPORARILY_LOCKED", "two_factor_locked", true],
		["TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "two_factor_locked", true],
	] as const)("%s → %s", (code, reason, restart) => {
		const failure = authFailure({ code, status: 401 });
		expect(failure).toBe(reason);
		expect(twoFactorRestartRequired(failure)).toBe(restart);
	});

	/** Folding a challenge response into success would make `/me` answer guest and show a signed-in person as signed out. */
	it("recognizes the challenge response", () => {
		expect(
			isTwoFactorRedirect({
				twoFactorRedirect: true,
				twoFactorMethods: ["totp"],
			}),
		).toBe(true);
		expect(isTwoFactorRedirect({ token: "t", user: {} })).toBe(false);
		expect(isTwoFactorRedirect(null)).toBe(false);
	});

	/** `Recovery code` is sync's term. Backup codes are not called by that name. */
	it("doesn't call backup codes recovery codes", () => {
		for (const reason of [
			"two_factor_invalid_code",
			"two_factor_invalid_backup_code",
			"two_factor_expired",
			"two_factor_locked",
		] as const)
			expect(AUTH_FAILURE_MESSAGE[reason]).not.toContain("Recovery code");
	});
});
