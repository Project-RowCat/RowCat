import { describe, expect, test } from "vitest";
import {
	SOCIAL_PROVIDERS,
	socialCallbackErrorCodeFrom,
	socialCallbackErrorMessage,
	socialProviderFrom,
	socialProviderLabel,
} from "./social-sign-in.ts";

/**
 * Only the **pure rules** of social sign-in are checked. Whether this screen actually leaves and
 * returns belongs to the journeys (`e2e/`); what is locked here is how far a value arriving in the
 * address goes.
 */

describe("SOCIAL_PROVIDERS", () => {
	/**
	 * The list is also the drawing order, and the label table must cover **all** of it. If it does
	 * not, one button draws `Continue with undefined`. The type already blocks this, but that protection holds
	 * only while the table is typed as a `Record`.
	 */
	test("every method has a label", () => {
		for (const provider of SOCIAL_PROVIDERS) {
			expect(socialProviderLabel(provider)).toBeTruthy();
		}
	});

	test("credentials are not in this list", () => {
		expect(SOCIAL_PROVIDERS).not.toContain("credential");
	});
});

describe("values from the address", () => {
	/**
	 * **Without validation, a string from a link someone else made becomes a sentence on our screen.**
	 * The route puts only values that have passed both checks into search parameters.
	 */
	test("only known providers pass", () => {
		expect(socialProviderFrom("kakao")).toBe("kakao");
		for (const value of ["naver", "credential", "<script>", "", null, 7])
			expect(socialProviderFrom(value)).toBeUndefined();
	});

	test("only named reasons pass", () => {
		expect(socialCallbackErrorCodeFrom("email_not_found")).toBe(
			"email_not_found",
		);
		expect(socialCallbackErrorCodeFrom("account_not_linked")).toBe(
			"account_not_linked",
		);
		/** A code that exists but has no sentence on our side also falls through to the default sentence. */
		for (const value of ["no_code", "invalid_code", "<script>", null])
			expect(socialCallbackErrorCodeFrom(value)).toBeUndefined();
	});
});

describe("socialCallbackErrorMessage", () => {
	/**
	 * **This is why the function exists.** Kakao's email is optional consent. Telling a person who
	 * declined it `Sign-in failed` would make them press the same button and untick
	 * the same consent again. The sentence must point at the **consent item** for that person to have
	 * something to do.
	 */
	test("declined email consent points at the consent item", () => {
		const message = socialCallbackErrorMessage("kakao", "email_not_found");
		expect(message).toContain("Kakao");
		expect(message).toContain("email");
		expect(message).toContain("agree");
	});

	/** When the provider is unknown, the name is **not invented**; the next step is still stated. */
	test("an unknown provider is not named", () => {
		const message = socialCallbackErrorMessage(undefined, "email_not_found");
		expect(message).toContain("email");
		expect(message).not.toContain("undefined");
	});

	/**
	 * **Never write `try again` for a reason that pressing again does not resolve.**
	 *
	 * This is the case where an account with the same email already exists and is not yet linked to
	 * this method. Pressing the button again yields the same result, so the sentence must point at one
	 * thing the person can actually do: sign in with the method they already use, then link it from
	 * the account screen.
	 */
	test("an unlinked account is not told to try again", () => {
		const message = socialCallbackErrorMessage("google", "account_not_linked");
		expect(message).toContain("Google");
		expect(message).toContain("link");
		expect(message).toContain("account screen");
		expect(message).not.toMatch(/try again/i);
	});

	/**
	 * The rule of not inventing a provider name when the provider is unknown applies to this reason
	 * too; the sentence still states what to do.
	 */
	test("an unlinked account can be described without the provider", () => {
		const message = socialCallbackErrorMessage(undefined, "account_not_linked");
		expect(message).toContain("link");
		expect(message).not.toContain("undefined");
	});

	/**
	 * **Does not reveal whether an account exists.** For a failure caused by a mismatched email,
	 * confirming "an account registered with that address exists" would turn this screen into a
	 * member-directory lookup.
	 */
	test("an email mismatch does not say which account", () => {
		const message = socialCallbackErrorMessage("kakao", "email_does_not_match");
		expect(message).not.toMatch(/is registered|already registered|exists\b/);
	});

	/**
	 * Someone who **stopped on their own** at the provider's screen also arrives by this path. A flat
	 * statement would make that person doubt their own account, so the default sentence is neutral.
	 */
	test("an unknown reason is not asserted", () => {
		const message = socialCallbackErrorMessage("google", undefined);
		expect(message).toContain("Google");
		expect(message).not.toMatch(/fail/i);
	});
});
