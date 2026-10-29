import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PASSWORD_LENGTH } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	checkNewPassword,
	checkResetEmail,
	requestResetErrorMessage,
	resetFailureOf,
	resetTokenFrom,
} from "./password-reset.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));

describe("new password checks", () => {
	it("length comes from the contract alone", () => {
		expect(checkNewPassword("", "")).toBe("empty");
		const short = "x".repeat(PASSWORD_LENGTH.min - 1);
		expect(checkNewPassword(short, short)).toBe("too_short");
		const long = "x".repeat(PASSWORD_LENGTH.max + 1);
		expect(checkNewPassword(long, long)).toBe("too_long");
	});

	it("does not submit when the confirmation differs", () => {
		expect(checkNewPassword("a-long-passphrase", "a-long-passphrasE")).toBe(
			"mismatch",
		);
	});

	/** Whitespace is part of the password. Trimming it would make the stored value differ from the next one typed. */
	it("does not trim the password", () => {
		expect(checkNewPassword(" spaced passphrase ", "spaced passphrase")).toBe(
			"mismatch",
		);
		expect(
			checkNewPassword(" spaced passphrase ", " spaced passphrase "),
		).toBeNull();
	});
});

describe("reset email request", () => {
	it("the address only loses surrounding whitespace", () => {
		expect(checkResetEmail("  reader@example.test ")).toEqual({
			ok: true,
			email: "reader@example.test",
		});
		expect(checkResetEmail("").ok).toBe(false);
		expect(checkResetEmail("not-an-email").ok).toBe(false);
	});

	/**
	 * **No failure reveals whether an account exists.** The server answers success for unknown
	 * addresses, so that sentence has no place to arrive, but this checks that an unknown code falls
	 * back to a generic sentence on the day one appears.
	 */
	it.each([
		{},
		{ status: 429 },
		{ status: 400, code: "RESET_PASSWORD_DISABLED" },
		{ status: 400, code: "USER_NOT_FOUND" },
		{ status: 500 },
	])("the failure sentence does not reveal whether an account exists — %o", (failure) => {
		const message = requestResetErrorMessage(failure);
		for (const leak of ["not registered", "no account", "not found"])
			expect(message).not.toContain(leak);
	});
});

describe("new password submit failures", () => {
	it("a dead token goes to the request-again face", () => {
		expect(resetFailureOf({ status: 400, code: "INVALID_TOKEN" })).toEqual({
			kind: "link_expired",
		});
	});

	/** An attempt that fails the length rule does not consume the token, so it stays on the form. */
	it("a length failure retries in the same form", () => {
		expect(
			resetFailureOf({ status: 400, code: "PASSWORD_TOO_SHORT" }).kind,
		).toBe("retry");
		expect(resetFailureOf({}).kind).toBe("retry");
	});
});

describe("token from the address", () => {
	it("accepts only well-shaped values", () => {
		expect(resetTokenFrom("AbCdEf0123456789xyzQWERT")).toBe(
			"AbCdEf0123456789xyzQWERT",
		);
		expect(resetTokenFrom("")).toBeUndefined();
		expect(resetTokenFrom("<script>")).toBeUndefined();
		expect(resetTokenFrom("x".repeat(500))).toBeUndefined();
		expect(resetTokenFrom(["AbCdEf0123456789"])).toBeUndefined();
	});
});

/**
 * **Reset goes through the auth client, not through our contract.**
 *
 * If SDK-calling code appears in this file, a password has found a path across `@rowcat/contracts`
 * (this pairs with the same check for email change).
 */
it("reset goes through the auth client", () => {
	const body = readFileSync(join(HERE, "password-reset.ts"), "utf8");
	expect(body).toContain(".requestPasswordReset(");
	expect(body).toContain(".resetPassword(");
	expect(body).not.toContain("getRowCatClient");
});
