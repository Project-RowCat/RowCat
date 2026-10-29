import { describe, expect, test } from "vitest";
import {
	changeEmailCheckMessage,
	changeEmailErrorMessage,
	checkNewEmail,
	readEmailReturn,
} from "./change-email.ts";

/**
 * The pure parts of email change: input checks, failure copy, and reading the return marker.
 *
 * The change itself is done by the server and two emails; the API integration test covers that flow
 * (`apps/api/src/routes/change-email.verified.test.ts`). What is checked here are the decisions the
 * screen makes **before** starting that flow.
 */

const CURRENT = "reader@example.test";

describe("new address check", () => {
	test("an empty value is rejected", () => {
		expect(checkNewEmail("   ", CURRENT)).toEqual({
			ok: false,
			reason: "empty",
		});
	});

	test("a malformed address is rejected", () => {
		expect(checkNewEmail("not-an-email", CURRENT)).toEqual({
			ok: false,
			reason: "format",
		});
	});

	/**
	 * **Compared case-insensitively.**
	 *
	 * The server lowercases the new address (`newEmail.toLowerCase()`). Without folding here,
	 * `Reader@example.test` would pass the form and then receive a 400 for "same address".
	 */
	test("an address differing only in case is the same address", () => {
		expect(checkNewEmail("READER@EXAMPLE.TEST", CURRENT)).toEqual({
			ok: false,
			reason: "same",
		});
	});

	test("returns the value with surrounding whitespace trimmed", () => {
		expect(checkNewEmail("  next@example.test  ", CURRENT)).toEqual({
			ok: true,
			email: "next@example.test",
		});
	});

	test("each reason has its own sentence", () => {
		const messages = (["empty", "format", "same"] as const).map(
			changeEmailCheckMessage,
		);
		expect(new Set(messages).size).toBe(3);
	});
});

describe("failure messages", () => {
	/**
	 * **Does not say "this address is already in use".**
	 *
	 * The server returns success in that case (existence hiding), and even if it could say so, it must
	 * not: this form would become a lookup answering "is this address signed up with RowCat".
	 */
	test("does not reveal that another account exists", () => {
		const messages = [
			changeEmailErrorMessage({}),
			changeEmailErrorMessage({ status: 429 }),
			changeEmailErrorMessage({ status: 400, code: "INVALID_EMAIL" }),
			changeEmailErrorMessage({ status: 400, code: "USER_ALREADY_EXISTS" }),
			changeEmailErrorMessage({ status: 403, code: "SESSION_NOT_FRESH" }),
		];
		for (const message of messages) {
			expect(message).not.toContain("already in use");
			expect(message).not.toContain("another account");
			expect(message).not.toContain("registered");
		}
	});

	/** A state that signing in again resolves does **not** tell the user to wait. */
	test("a fresh-session requirement says to sign in again", () => {
		expect(
			changeEmailErrorMessage({ status: 403, code: "SESSION_NOT_FRESH" }),
		).toContain("sign in again");
	});

	/** On a deployment without a mail transport, "try again" is false — state only the fact. */
	test("a deployment with the feature off does not suggest retrying", () => {
		const message = changeEmailErrorMessage({
			status: 400,
			code: "CHANGE_EMAIL_DISABLED",
		});
		expect(message).not.toContain("try again");
	});
});

describe("return marker", () => {
	/**
	 * Creates the address **with the marker removed**. If it were not removed, refresh and back would
	 * redraw the same notice, and the parameter would stay in browser history.
	 */
	test("reads the marker and removes it from the address", () => {
		expect(
			readEmailReturn("https://app.test/account?email=changed&view=x"),
		).toEqual({ returned: true, cleanedHref: "/account?view=x" });
	});

	test("without the marker the address is untouched", () => {
		const href = "https://app.test/account?view=x";
		expect(readEmailReturn(href)).toEqual({
			returned: false,
			cleanedHref: href,
		});
	});

	/** The hash is kept — it is not a value we attached. */
	test("keeps the hash", () => {
		expect(
			readEmailReturn("https://app.test/account?email=changed#security"),
		).toMatchObject({ cleanedHref: "/account#security" });
	});
});
