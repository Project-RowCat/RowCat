import { describe, expect, test } from "vitest";
import {
	connectLoginMethodErrorMessage,
	readConnectReturn,
} from "./connect-login-method.ts";

/**
 * Linking return decisions — checked **without React**.
 *
 * The most important assertion here concerns open redirects: this function only **reads** the
 * address and does not decide where to go. If the destination could come from a parameter, the link
 * itself would be a phishing path, so the test checks by value that this module cannot produce a
 * return address from input.
 */

describe("readConnectReturn", () => {
	test("reads the success marker and removes it from the address", () => {
		const { result, cleanedHref } = readConnectReturn(
			"https://rowcat.test/account?connected=google",
		);
		expect(result).toEqual({ status: "connected" });
		expect(cleanedHref).toBe("/account");
	});

	test("reads the failure marker, code and provider together", () => {
		const { result, cleanedHref } = readConnectReturn(
			"https://rowcat.test/account?connect=error&provider=apple&error=account_already_linked_to_different_user",
		);
		expect(result).toEqual({
			status: "failed",
			provider: "apple",
			code: "account_already_linked_to_different_user",
		});
		expect(cleanedHref).toBe("/account");
	});

	/**
	 * **The provider carried in the address is validated before use.** The only thing done with that
	 * value is putting a name in a sentence, but unvalidated, another party's link string would become
	 * our screen's sentence. Unknown values fall to a nameless sentence (nothing is invented).
	 *
	 * For a while the first value in this list was `kakao` — a method **not** in the vocabulary, so it
	 * was the example of an "unknown value". When Kakao actually arrived it was replaced by `naver`:
	 * what is needed is a value outside the vocabulary, not a particular provider, and if a genuinely
	 * implemented name ever took that slot, this test would flip silently that day. `credential` is
	 * included to complement that axis: a **known value that is not a linking target here**.
	 */
	test("drops an unknown provider", () => {
		for (const value of ["naver", "credential", "<script>"]) {
			const { result } = readConnectReturn(
				`https://rowcat.test/account?connect=error&provider=${encodeURIComponent(value)}`,
			);
			expect(result).toEqual({ status: "failed", provider: null, code: null });
		}
	});

	/**
	 * An address with only `error` is not our round trip. Judging by it alone would, on the day
	 * another feature uses the same name, make the account screen draw someone else's failure as a
	 * linking failure.
	 */
	test("without our marker there is no result", () => {
		expect(
			readConnectReturn("https://rowcat.test/account?error=whatever").result,
		).toBeNull();
		expect(readConnectReturn("https://rowcat.test/account").result).toBeNull();
	});

	/** Other parameters are kept — only our traces are removed. */
	test("does not remove unrelated parameters", () => {
		const { cleanedHref } = readConnectReturn(
			"https://rowcat.test/account?connected=google&view=x#security",
		);
		expect(cleanedHref).toBe("/account?view=x#security");
	});

	/**
	 * **The result carries no destination.** If the type had a slot for an address, someday code would
	 * navigate to that value, and the value comes from a link someone else made.
	 */
	test("does not put the return address in the result", () => {
		const { result } = readConnectReturn(
			"https://rowcat.test/account?connected=google&redirect=https://evil.example",
		);
		expect(Object.keys(result ?? {})).toEqual(["status"]);
	});

	/** The cleaned address is always a path inside this app — it cannot express an origin. */
	test("the cleaned address carries no host", () => {
		const { cleanedHref } = readConnectReturn(
			"https://rowcat.test/account?connect=error&error=x",
		);
		expect(cleanedHref.startsWith("/")).toBe(true);
		expect(cleanedHref).not.toContain("rowcat.test");
	});
});

describe("connectLoginMethodErrorMessage", () => {
	test("a conflict says plainly that accounts can't be merged", () => {
		const message = connectLoginMethodErrorMessage(
			"google",
			"account_already_linked_to_different_user",
		);
		expect(message).toContain("another RowCat account");
		expect(message).toContain("can't be merged");
	});

	/** Does not say which account — neither email nor member id appears in the sentence. */
	test("does not identify the other account", () => {
		for (const provider of ["google", "apple"] as const)
			for (const code of [
				"account_already_linked_to_different_user",
				"email_does_not_match",
				"unable_to_link_account",
				null,
			])
				expect(connectLoginMethodErrorMessage(provider, code)).not.toMatch(
					/@|id=/,
				);
	});

	/** Unknown codes do not leak in English either. */
	test("an unknown code falls back to a neutral sentence", () => {
		expect(connectLoginMethodErrorMessage("google", "some_new_code")).toBe(
			"Linking the Google account didn't complete.",
		);
	});

	/**
	 * Provider-unknown branch — when the value in the address was not a method we know. The sentence
	 * must still hold without inventing a name.
	 */
	test("without a known provider it speaks without a name", () => {
		const message = connectLoginMethodErrorMessage(null, "some_new_code");
		expect(message).toBe("Linking the account didn't complete.");
		expect(message).not.toContain("Google");
		expect(message).not.toContain("Apple");
	});

	/**
	 * Choosing Apple's "Hide My Email" yields a relay address, so this branch is close to the normal
	 * path — the sentence says what to do instead of turning the rule off.
	 */
	test("Apple's email mismatch says what to do next", () => {
		expect(
			connectLoginMethodErrorMessage("apple", "email_does_not_match"),
		).toContain("Hide My Email");
	});
});
