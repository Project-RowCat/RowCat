import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { AUTH_FAILURE_MESSAGE } from "../../lib/auth-error.ts";
import {
	authSecurityErrorMessage,
	needsRecentLogin,
	RECENT_LOGIN_REQUIRED,
	securityErrorMessage,
} from "./security-error.ts";

const api = (code: string, status = 400) =>
	new RowCatApiError({ status, code, message: "internal english message" });

describe("needsRecentLogin", () => {
	it("the same fact from two channels folds to the same value", () => {
		expect(needsRecentLogin(api("recent_login_required", 403))).toBe(true);
		expect(needsRecentLogin({ code: "SESSION_NOT_FRESH" })).toBe(true);
		expect(needsRecentLogin({ code: "SESSION_EXPIRED" })).toBe(true);
	});

	it("other failures aren't it", () => {
		expect(needsRecentLogin(api("login_required", 401))).toBe(false);
		expect(needsRecentLogin({ code: "INVALID_PASSWORD" })).toBe(false);
		expect(needsRecentLogin(null)).toBe(false);
		expect(needsRecentLogin(new Error("boom"))).toBe(false);
	});
});

describe("securityErrorMessage — RowCat API", () => {
	/**
	 * The screen branches on the reason, not the sentence, and the server names the reason. Server
	 * copy is not drawn as is: it is English and describes internal state.
	 */
	it("doesn't draw the server's raw text", () => {
		expect(securityErrorMessage(api("last_login_method", 409))).not.toContain(
			"internal english message",
		);
	});

	it("each reason the server sets has a sentence", () => {
		for (const code of [
			"recent_login_required",
			"login_required",
			"password_already_set",
			"last_login_method",
			"login_method_not_linked",
			"current_session_revoke",
			"passkey_not_found",
			"passkey_update_failed",
			"invalid_input",
			"invalid_request",
		]) {
			const message = securityErrorMessage(api(code));
			expect(message, code).toBeTruthy();
			/** A reason in the vocabulary is not folded into the generic sentence; if it has a name, say it. */
			expect(message, code).not.toBe(
				"Couldn't process the request. Please try again in a moment.",
			);
		}
	});

	/** There is something the user can actually do; ending at "cannot be removed" reads as a dead end. */
	it("the last-method notice says what to do next", () => {
		expect(securityErrorMessage(api("last_login_method", 409))).toMatch(
			/Link another sign-in method first/,
		);
	});

	/** A fresh-session requirement uses the same sentence on both paths, so the same problem is not met twice in different words. */
	it("both channels use the same sentence for the same reason", () => {
		expect(securityErrorMessage(api("recent_login_required", 403))).toBe(
			RECENT_LOGIN_REQUIRED,
		);
		expect(
			authSecurityErrorMessage({ code: "SESSION_NOT_FRESH", status: 403 }, "x"),
		).toBe(RECENT_LOGIN_REQUIRED);
	});

	/** Does not tell them to wait: waiting does not improve this state. */
	it("the fresh-session notice points at signing in again", () => {
		expect(RECENT_LOGIN_REQUIRED).toMatch(/Sign out and sign in again/);
		expect(RECENT_LOGIN_REQUIRED).not.toMatch(/in a moment|wait/i);
	});

	it("a failure that never reached the server points at the connection", () => {
		expect(securityErrorMessage(new Error("network"))).toMatch(
			/check your connection/i,
		);
		expect(securityErrorMessage(undefined)).toMatch(/check your connection/i);
	});

	it("an unknown code folds into a generic sentence", () => {
		expect(securityErrorMessage(api("never_seen_before"))).toMatch(
			/try again in a moment/i,
		);
	});
});

describe("authSecurityErrorMessage — Better Auth", () => {
	it("each known reason has a sentence", () => {
		for (const code of [
			"INVALID_PASSWORD",
			"PASSWORD_TOO_SHORT",
			"PASSWORD_TOO_LONG",
			"CREDENTIAL_ACCOUNT_NOT_FOUND",
			"SESSION_NOT_FRESH",
			"SESSION_EXPIRED",
			"UNAUTHORIZED",
			"INVALID_EMAIL",
			"EMAIL_ALREADY_VERIFIED",
			"VERIFICATION_EMAIL_NOT_ENABLED",
			"CHANGE_EMAIL_DISABLED",
		]) {
			const message = authSecurityErrorMessage(
				{ code, status: 400 },
				"default",
			);
			expect(message, code).toBeTruthy();
			expect(message, code).not.toBe("default");
		}
	});

	/**
	 * No response at all is a different fact from the server refusing. An empty object has that shape,
	 * and the only thing to say is "check your connection".
	 */
	it("no response points at the connection", () => {
		expect(authSecurityErrorMessage({}, "default")).toMatch(
			/check your connection/i,
		);
	});

	/** Only a 429 gets better by waiting. */
	it("too many requests says to wait", () => {
		expect(authSecurityErrorMessage({ status: 429 }, "default")).toMatch(
			/try again in a moment/i,
		);
	});

	/**
	 * `fallback` is a parameter on purpose: four operations leave through this path, so a fixed
	 * sentence would make someone whose confirmation mail failed read that they tried to change their
	 * password.
	 */
	it("an unknown reason folds into the sentence the call site gave", () => {
		expect(
			authSecurityErrorMessage(
				{ code: "NEVER_SEEN", status: 400 },
				"Mail failure",
			),
		).toBe("Mail failure");
		expect(
			authSecurityErrorMessage(
				{ code: "NEVER_SEEN", status: 400 },
				"Password failure",
			),
		).toBe("Password failure");
	});

	/**
	 * The login mapper is not reused: it deliberately blurs reasons (account-enumeration defense),
	 * while here we must speak precisely to someone already authenticated as themselves.
	 */
	it("doesn't borrow the sign-in screen's sentences", () => {
		expect(
			authSecurityErrorMessage({ code: "INVALID_PASSWORD" }, "default"),
		).not.toBe(AUTH_FAILURE_MESSAGE.invalid_credentials);
		expect(
			authSecurityErrorMessage({ code: "INVALID_PASSWORD" }, "default"),
		).toMatch(/current password/i);
	});
});
