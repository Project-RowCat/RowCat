import { describe, expect, test } from "vitest";
import {
	resendErrorMessage,
	verificationCallbackUrl,
} from "./email-verification.ts";

/**
 * Resend rules: only the **pure parts** are checked.
 *
 * This file checks only the failure sentences and the callback address. Inside a component they
 * could not be checked without rendering, and this repository's web tests have no React rendering.
 * The cooldown arithmetic is locked by `@rowcat/domain`'s tests, because both apps call the same
 * function.
 */

describe("resend failure messages", () => {
	/**
	 * **Never says `that address does not exist`.**
	 *
	 * The server answers success for unknown addresses too (existence hiding), so such a reason never
	 * arrives in the first place, but this test exists to stop that sentence from appearing in the
	 * message list.
	 */
	test("no sentence reveals existence", () => {
		const messages = [
			resendErrorMessage({}),
			resendErrorMessage({ status: 429 }),
			resendErrorMessage({ status: 400, code: "EMAIL_ALREADY_VERIFIED" }),
			resendErrorMessage({ status: 500, code: "SOMETHING_NEW" }),
		];
		for (const message of messages) {
			expect(message).not.toContain("no such");
			expect(message).not.toContain("not registered");
			expect(message).not.toContain("does not exist");
		}
	});

	test("a transport failure says to check the connection", () => {
		expect(resendErrorMessage({})).toContain("connection");
	});

	test("an already verified address says what to do next", () => {
		expect(
			resendErrorMessage({ status: 400, code: "EMAIL_ALREADY_VERIFIED" }),
		).toContain("sign in");
	});

	/** An unknown code must not leak onto the screen: library strings are never drawn. */
	test("an unknown code falls back to the generic message", () => {
		const message = resendErrorMessage({ status: 500, code: "WHATEVER" });
		expect(message).not.toContain("WHATEVER");
		expect(message).toBe(resendErrorMessage({ status: 500 }));
	});
});

/**
 * Callback address: **this value is also the destination after sign-in.**
 *
 * The whole point of this group is that `sign-in/email` uses `callbackURL` in two ways. For an
 * unverified account it is where the verification mail returns the user. For a **successful
 * sign-in** the response carries `redirect: true`, and better-auth's client reloads the document at
 * that address. Until that was known, this function always returned `/login?verified=1`, so email
 * sign-in lost `?redirect=`: a guest who pressed `Start conversation` on a work and signed in could not get back
 * to it, and someone signing in with a payment return address arrived at the discovery screen
 * without finishing approval. Google sign-in passed its own destination, so only that path worked.
 *
 * Two things are checked here: **the destination is carried**, and the carried value is **only an
 * internal path of this app**. The second matters most because this address becomes a mailed link.
 */
describe("verification and return callback URL", () => {
	const ORIGIN = "https://web.test";

	/**
	 * Rather than imitating `window`, this sets only the origin on the **real global**. The function
	 * reads only `window.location.origin`, so there is no reason to build more; building more would
	 * make the test start imitating a browser.
	 */
	const withOrigin = <T>(run: () => T): T => {
		const globals = globalThis as { window?: unknown };
		const had = "window" in globals;
		const previous = globals.window;
		globals.window = { location: { origin: ORIGIN } };
		try {
			return run();
		} finally {
			if (had) globals.window = previous;
			else delete globals.window;
		}
	};

	test("builds no URL during server render", () => {
		expect(verificationCallbackUrl("/billing")).toBeUndefined();
	});

	test("without a destination only the verified marker rides", () => {
		expect(withOrigin(() => verificationCallbackUrl())).toBe(
			`${ORIGIN}/login?verified=1`,
		);
	});

	test("an internal path rides as the destination", () => {
		expect(withOrigin(() => verificationCallbackUrl("/billing"))).toBe(
			`${ORIGIN}/login?verified=1&redirect=%2Fbilling`,
		);
	});

	/**
	 * The point of this line is that the search axis survives: gallery filters and search live in the
	 * address, and someone returning after sign-in must see the same list.
	 *
	 * The value is what `redirectTargetFrom` normalises once with `new URL` (non-ASCII is
	 * percent-encoded at that step). The test does not imitate that normalisation; it **reverses** it
	 * to compare, because what it must check is not the encoding rule but whether the axis survives
	 * intact.
	 */
	test("a path with search params carries through as is", () => {
		const url = withOrigin(() =>
			verificationCallbackUrl("/?q=cat&sort=popular"),
		);
		expect(url).toBe(
			`${ORIGIN}/login?verified=1&redirect=${encodeURIComponent("/?q=cat&sort=popular")}`,
		);
		const redirect = new URL(url ?? "").searchParams.get("redirect");
		expect(redirect).toBe("/?q=cat&sort=popular");
	});

	/**
	 * **Outside origins are never carried.** This address becomes a mailed link, so one leak here
	 * makes the mail itself phishing. The server's `trustedOrigins` adds another layer, but this check
	 * does not rely on it: no spot is left with a single line of defence.
	 */
	test.each([
		["an absolute URL", "https://evil.test/steal"],
		["protocol-relative", "//evil.test/steal"],
		["a backslash", "/\\evil.test"],
		["a scheme", "javascript:alert(1)"],
		["a non-path value", "billing"],
		["a number", 42],
		["nothing", null],
	])("%s cannot be a destination", (_label, value) => {
		expect(
			withOrigin(() => verificationCallbackUrl(value as unknown as string)),
		).toBe(`${ORIGIN}/login?verified=1`);
	});

	/**
	 * The sign-in screen itself and the default destination are not carried. Carrying them would embed
	 * a meaningless address such as `?redirect=%2F` in the mail, and a value pointing back at the
	 * sign-in screen would form a loop.
	 */
	test.each([
		"/",
		"/login",
		"/login?redirect=%2Fbilling",
	])("%s cannot be a destination", (value) => {
		expect(withOrigin(() => verificationCallbackUrl(value))).toBe(
			`${ORIGIN}/login?verified=1`,
		);
	});
});
