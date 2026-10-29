import { describe, expect, it } from "vitest";
import { LOGIN_METHOD_LABEL } from "./account-copy.ts";
import {
	canConnectOnMobile,
	connectOutcomeNotice,
	isConnectableProvider,
	LOGIN_METHOD_ROWS,
	MOBILE_CONNECTABLE_PROVIDERS,
} from "./connect-login-method.ts";

describe("LOGIN_METHOD_ROWS", () => {
	/**
	 * Same display order as the server (`LOGIN_METHOD_ORDER` in `services/account/index.ts`). The
	 * server sorts connected methods and this list fills "not connected" rows around them; if the two
	 * orders diverged, connecting one method would move its row.
	 */
	it("draws the whole vocabulary in the same order as the server", () => {
		expect(LOGIN_METHOD_ROWS).toEqual([
			"credential",
			"google",
			"apple",
			"kakao",
		]);
		/* A new vocabulary value breaks the label table at compile time, and this check pins the row count. */
		expect(LOGIN_METHOD_ROWS).toHaveLength(
			Object.keys(LOGIN_METHOD_LABEL).length,
		);
	});
});

describe("methods that can be linked", () => {
	/**
	 * Credentials come from setting a password, not an OAuth round trip; a button here would make two
	 * entrances to one action, one of which cannot say by name what it does.
	 */
	it("the credential is not something to link", () => {
		expect(isConnectableProvider("credential")).toBe(false);
		expect(canConnectOnMobile("credential")).toBe(false);
	});

	/**
	 * Being in the vocabulary does not mean it is wired. A `Link` button on an unwired method sends the
	 * person to the provider screen and back before they learn it cannot work.
	 *
	 * This list stays the same after Apple arrived on the login screen: that wiring does not mean it
	 * succeeds on this deployment (provider registration may be empty until the effective date). Why
	 * the two screens behave differently is in the `connect-login-method.ts` header.
	 */
	it("draws linking only for methods this app can actually start", () => {
		expect([...MOBILE_CONNECTABLE_PROVIDERS]).toEqual(["google"]);
		expect(canConnectOnMobile("google")).toBe(true);
		for (const provider of ["apple", "kakao"] as const) {
			expect(isConnectableProvider(provider), provider).toBe(true);
			expect(canConnectOnMobile(provider), provider).toBe(false);
		}
	});

	/** Connectable methods are always a subset of the link targets. */
	it("the linkable list doesn't go outside the vocabulary", () => {
		for (const provider of MOBILE_CONNECTABLE_PROVIDERS)
			expect(LOGIN_METHOD_ROWS, provider).toContain(provider);
	});
});

describe("connectOutcomeNotice", () => {
	/**
	 * Success is said by the row itself ("connected" + time); a further sentence would state the same
	 * fact twice.
	 */
	it("when linked, no sentence stands", () => {
		expect(connectOutcomeNotice("google", true)).toBeNull();
	});

	/**
	 * Someone who closed the sheet themselves and someone the server rejected become the same value
	 * here (the plugin consumes the reason internally). Asserting failure would make a person who
	 * simply quit doubt their account.
	 */
	it("when not linked, it is one sentence that doesn't assert anything", () => {
		const notice = connectOutcomeNotice("google", false);
		expect(notice).toBeTruthy();
		expect(notice).toContain(LOGIN_METHOD_LABEL.google);
		expect(notice).not.toMatch(/\bfailed\b|you cancelled|\berror\b/i);
		expect(notice).toMatch(/didn't complete/);
	});

	/**
	 * Never reveal another account. A conflict may be mentioned but not which account, and merging is
	 * never offered; that path does not exist in this repository.
	 */
	it("doesn't reveal another account's identity", () => {
		const notice = connectOutcomeNotice("google", false) ?? "";
		expect(notice).not.toMatch(/@|nickname|member ?ID|memberId|userId/i);
		expect(notice).not.toMatch(/merge|migrat|transfer/i);
	});

	/* The sentence takes the name from the label table; "Apple" is not re-written here. */
	it("the name's source is one label table", () => {
		for (const provider of ["google", "apple", "kakao"] as const)
			expect(connectOutcomeNotice(provider, false), provider).toContain(
				LOGIN_METHOD_LABEL[provider],
			);
	});
});
