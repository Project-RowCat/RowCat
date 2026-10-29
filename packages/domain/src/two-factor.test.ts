import { describe, expect, it } from "vitest";
import {
	isAuthenticatorCodeShape,
	normalizeAuthenticatorCode,
	normalizeBackupCode,
	normalizeTwoFactorCode,
	twoFactorCodeReady,
} from "./two-factor.ts";

/**
 * The login challenge on web and mobile calls this same function, so a mistake here breaks both
 * apps together.
 */
describe("authenticator codes", () => {
	it("removes only spaces and hyphens", () => {
		expect(normalizeAuthenticatorCode(" 123 456 ")).toBe("123456");
		expect(normalizeAuthenticatorCode("123-456")).toBe("123456");
		expect(normalizeAuthenticatorCode("1２3456")).toBe("1２3456");
	});

	/**
	 * Stripping non-digit characters would shorten a mistyped code to the right length and send it to
	 * the server. The test pins that only six ASCII digits pass the shape check.
	 */
	it("only six Arabic digits are well-formed", () => {
		expect(isAuthenticatorCodeShape("123456")).toBe(true);
		expect(isAuthenticatorCodeShape("12345")).toBe(false);
		expect(isAuthenticatorCodeShape("1234567")).toBe(false);
		expect(isAuthenticatorCodeShape("12a456")).toBe(false);
		expect(isAuthenticatorCodeShape("1２3456")).toBe(false);
	});
});

describe("backup codes", () => {
	/**
	 * Backup codes are case-sensitive, so folding case would turn a valid code into an invalid one.
	 * Only surrounding whitespace is trimmed.
	 */
	it("trims surrounding whitespace only and keeps case and hyphens", () => {
		expect(normalizeBackupCode("  abcDE-FGhij\n")).toBe("abcDE-FGhij");
	});
});

describe("by method", () => {
	it("can it be submitted", () => {
		expect(twoFactorCodeReady("authenticator", "123 456")).toBe(true);
		expect(twoFactorCodeReady("authenticator", "abcde-fghij")).toBe(false);
		expect(twoFactorCodeReady("backup", "abcde-fghij")).toBe(true);
		expect(twoFactorCodeReady("backup", "   ")).toBe(false);
	});

	it("folds per method", () => {
		expect(normalizeTwoFactorCode("authenticator", "123 456")).toBe("123456");
		expect(normalizeTwoFactorCode("backup", " ab cd ")).toBe("ab cd");
	});
});
