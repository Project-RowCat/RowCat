import { describe, expect, it } from "vitest";
import { AUTH_FAILURE_MESSAGE } from "./auth-error.ts";
import {
	authFailureMessage,
	SOCIAL_PROVIDER_LABEL,
	SOCIAL_PROVIDERS,
	socialProviderOf,
	socialSignInLabel,
} from "./auth-social.ts";

/**
 * Pure rules for social sign-in — the list, the names and the copy.
 *
 * This app's tests do not render screens (same judgment as the other files), so checking values
 * here is how this screen's guarantees are verified. The regression to catch comes down to one
 * thing: **the methods became two, but somewhere one spot still assumes there is one.**
 */

describe("list", () => {
	it("Google comes first, in the same order as the web", () => {
		expect([...SOCIAL_PROVIDERS]).toEqual(["google", "apple"]);
	});

	/**
	 * The label table covers the vocabulary **exactly**. `Record` catches half of it at the type
	 * level, but the type cannot say when values are empty or equal to each other. Two buttons
	 * carrying the same name is the quietest defect on this screen.
	 */
	it("each method has a different name", () => {
		const labels = SOCIAL_PROVIDERS.map(
			(provider) => SOCIAL_PROVIDER_LABEL[provider],
		);
		expect(labels.every((label) => label.length > 0)).toBe(true);
		expect(new Set(labels).size).toBe(labels.length);
	});

	/** Brand names are not translated — the screen the user lands on afterwards uses that name. */
	it("doesn't transcribe brand names", () => {
		expect(SOCIAL_PROVIDER_LABEL.google).toBe("Google");
		expect(SOCIAL_PROVIDER_LABEL.apple).toBe("Apple");
	});
});

describe("socialProviderOf", () => {
	it("only social procedures have a provider", () => {
		for (const provider of SOCIAL_PROVIDERS)
			expect(socialProviderOf(provider)).toBe(provider);
		for (const action of ["sign-in", "sign-up", "sign-out"])
			expect(socialProviderOf(action), action).toBeNull();
	});
});

describe("button labels", () => {
	it("says so while leaving", () => {
		expect(socialSignInLabel("apple", false)).toBe("Continue with Apple");
		expect(socialSignInLabel("apple", true)).toBe("Going to Apple…");
	});

	/**
	 * **Apple's guidelines limit the title to three forms** (`Sign in with Apple`, `Continue with Apple`, `Sign up
	 * with Apple`). Other sentences fail review, and if the ending differs per method, two buttons of the same
	 * rank read as different sentences — so both are built from the same frame.
	 */
	it("uses the allowed title pattern", () => {
		for (const provider of SOCIAL_PROVIDERS)
			expect(socialSignInLabel(provider, false), provider).toBe(
				`Continue with ${SOCIAL_PROVIDER_LABEL[provider]}`,
			);
	});
});

describe("failure copy", () => {
	/**
	 * **This group is the defect this slice actually fixed.**
	 *
	 * While there was one method, both sentences had `Google` hard-coded. Once there were two, someone
	 * who failed with Apple would read guidance telling them to check Google — and it compiles and
	 * renders without complaint.
	 */
	it("social failures carry the provider's name", () => {
		for (const reason of [
			"provider_unavailable",
			"social_without_session",
		] as const) {
			const apple = authFailureMessage({ reason, provider: "apple" });
			expect(apple, reason).toContain("Apple");
			expect(apple, reason).not.toContain("Google");

			const google = authFailureMessage({ reason, provider: "google" });
			expect(google, reason).toContain("Google");
			expect(google, reason).not.toContain("Apple");
		}
	});

	/**
	 * If the source is unknown, **do not make up a name.** The shared table's sentences must stay true
	 * in that state, which is why that table has no provider name.
	 */
	it("without a source it falls to the shared table, and that sentence has no brand", () => {
		for (const reason of [
			"provider_unavailable",
			"social_without_session",
		] as const) {
			const neutral = authFailureMessage({ reason, provider: null });
			expect(neutral, reason).toBe(AUTH_FAILURE_MESSAGE[reason]);
			for (const label of Object.values(SOCIAL_PROVIDER_LABEL))
				expect(neutral, `${reason} — ${label}`).not.toContain(label);
		}
	});

	/**
	 * Non-social facts keep the shared table's copy even with a provider attached. The criterion for
	 * adding a name is "would the guidance be less accurate without knowing which provider", and
	 * credential-family facts do not answer that question.
	 */
	it("facts that aren't social don't get a name", () => {
		expect(
			authFailureMessage({ reason: "unreachable", provider: "apple" }),
		).toBe(AUTH_FAILURE_MESSAGE.unreachable);
		expect(
			authFailureMessage({ reason: "invalid_credentials", provider: null }),
		).toBe(AUTH_FAILURE_MESSAGE.invalid_credentials);
	});

	/**
	 * **Do not assert cancellation as failure.** The person who closed the sheet themselves and the
	 * person the server rejected become the same value in this app (`social_without_session` in
	 * `auth-error.ts`).
	 */
	it("doesn't assert an unfinished round trip was cancelled or failed", () => {
		const message = authFailureMessage({
			reason: "social_without_session",
			provider: "apple",
		});
		expect(message).toMatch(/didn't complete/);
		expect(message).not.toMatch(/cancelled|failed/i);
	});
});
