import { describe, expect, it } from "vitest";
import {
	canAdvanceTwoFactorSetup,
	isAuthenticatorCodeShape,
	isTwoFactorRedirect,
	manualEntryKey,
	normalizeAuthenticatorCode,
	normalizeBackupCode,
	twoFactorChallengeFailure,
	twoFactorManageFailure,
} from "./two-factor.ts";

describe("code normalization", () => {
	it("authenticator codes drop only spaces and hyphens", () => {
		expect(normalizeAuthenticatorCode(" 123 456 ")).toBe("123456");
		expect(normalizeAuthenticatorCode("123-456")).toBe("123456");
		/** Non-digit characters are not stripped here; the shape check filters them out. */
		expect(normalizeAuthenticatorCode("12a456")).toBe("12a456");
		expect(isAuthenticatorCodeShape("12a456")).toBe(false);
		expect(isAuthenticatorCodeShape("123456")).toBe(true);
		expect(isAuthenticatorCodeShape("12345")).toBe(false);
	});

	/** Backup codes are case-sensitive; folding case would turn a correct code into a wrong one. */
	it("backup codes drop only surrounding whitespace", () => {
		expect(normalizeBackupCode("  abcDE-FGhij \n")).toBe("abcDE-FGhij");
	});
});

describe("isTwoFactorRedirect", () => {
	it("true only for responses where the server asked for a second factor", () => {
		expect(
			isTwoFactorRedirect({ twoFactorRedirect: true, twoFactorMethods: [] }),
		).toBe(true);
		expect(isTwoFactorRedirect({ token: "x" })).toBe(false);
		expect(isTwoFactorRedirect({ twoFactorRedirect: "true" })).toBe(false);
		expect(isTwoFactorRedirect(null)).toBe(false);
	});
});

describe("twoFactorChallengeFailure", () => {
	/** Folding a failure after the challenge expired into "wrong code" would have someone with the right code keep typing into the same field. */
	it("an expired challenge starts over", () => {
		expect(
			twoFactorChallengeFailure(
				{ status: 401, code: "INVALID_TWO_FACTOR_COOKIE" },
				"authenticator",
			),
		).toMatchObject({ restart: true });
	});

	it("locked starts over — typing in the same field again does not help", () => {
		expect(
			twoFactorChallengeFailure(
				{ status: 403, code: "ACCOUNT_TEMPORARILY_LOCKED" },
				"authenticator",
			).restart,
		).toBe(true);
	});

	it("a wrong code is retyped in place — the sentence follows the method", () => {
		const app = twoFactorChallengeFailure(
			{ status: 401, code: "INVALID_CODE" },
			"authenticator",
		);
		const backup = twoFactorChallengeFailure(
			{ status: 401, code: "INVALID_BACKUP_CODE" },
			"backup",
		);
		expect(app.restart).toBe(false);
		expect(app.message).toContain("authenticator app");
		expect(backup.message).toContain("backup code");
	});

	it("no connection means try again", () => {
		expect(twoFactorChallengeFailure({}, "backup")).toMatchObject({
			restart: false,
		});
	});

	/** `recovery code` is the sync term; the two keys must not share a name. */
	it("never calls a backup code a recovery code", () => {
		const text = [
			twoFactorChallengeFailure({ status: 401 }, "backup").message,
			twoFactorChallengeFailure({ status: 401 }, "authenticator").message,
		].join(" ");
		expect(text).not.toContain("recovery code");
	});
});

describe("enable steps", () => {
	const input = { password: "", savedBackupCodes: false, code: "" };

	/** Cannot advance to the authenticator step without confirming the backup codes were saved. */
	it("backup code confirmation comes before the authenticator", () => {
		expect(canAdvanceTwoFactorSetup("backup", input)).toBe(false);
		expect(
			canAdvanceTwoFactorSetup("backup", { ...input, savedBackupCodes: true }),
		).toBe(true);
	});

	it("does not start with an empty password", () => {
		expect(canAdvanceTwoFactorSetup("password", input)).toBe(false);
		expect(
			canAdvanceTwoFactorSetup("password", { ...input, password: " " }),
		).toBe(true);
	});

	it("does not verify unless six digits", () => {
		expect(canAdvanceTwoFactorSetup("scan", { ...input, code: "12 34" })).toBe(
			false,
		);
		expect(
			canAdvanceTwoFactorSetup("scan", { ...input, code: "123 456" }),
		).toBe(true);
		expect(canAdvanceTwoFactorSetup("done", { ...input, code: "123456" })).toBe(
			false,
		);
	});
});

describe("manualEntryKey", () => {
	it("returns the secret spaced every four characters", () => {
		expect(
			manualEntryKey(
				"otpauth://totp/RowCat:cat%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=RowCat",
			),
		).toBe("JBSW Y3DP EHPK 3PXP");
	});

	/** Showing a made-up key would make that person's authenticator app generate wrong codes forever. */
	it.each([
		"https://example.test/?secret=JBSWY3DP",
		"otpauth://totp/RowCat:x?issuer=RowCat",
		"otpauth://totp/RowCat:x?secret=not-base32!",
		"not a url",
	])("a different shape is null — %s", (uri) => {
		expect(manualEntryKey(uri)).toBeNull();
	});
});

describe("twoFactorManageFailure", () => {
	/** For someone signed in for a while, the recent-login requirement is a next step, not an error. */
	it("separates the recent-login requirement", () => {
		expect(
			twoFactorManageFailure({ status: 403, code: "SESSION_NOT_FRESH" }),
		).toEqual({
			kind: "recent-login",
		});
		expect(
			twoFactorManageFailure({ status: 400, code: "INVALID_PASSWORD" }),
		).toEqual({
			kind: "password",
		});
		expect(twoFactorManageFailure({ status: 500 })).toEqual({ kind: "other" });
	});
});
