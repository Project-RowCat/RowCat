import { describe, expect, test } from "vitest";
import {
	canDisconnectLoginMethod,
	type LoginMethod,
	type LoginMethodProvider,
	RESEND_COOLDOWN_SECONDS,
	resendCooldownRemaining,
} from "./account.ts";

/**
 * The last-login-method rule, checked without React. Inside a screen it could only be checked by
 * rendering, and a wrong result would be silent: the button is pressed, the server rejects it, and
 * the user does not know why. This file locks the decision itself; server-side enforcement is
 * covered by `me-account-security.test.ts`.
 */

const method = (provider: LoginMethodProvider): LoginMethod => ({
	provider,
	linkedAt: "2026-01-01T00:00:00.000Z",
});

describe("canDisconnectLoginMethod", () => {
	test("with two methods it can disconnect, and says what remains", () => {
		const result = canDisconnectLoginMethod({
			methods: [method("credential"), method("google")],
			target: "google",
		});
		expect(result).toEqual({
			allowed: true,
			remaining: [method("credential")],
		});
	});

	/**
	 * The confirmation copy `You can still sign in with email and password` (you can still sign in with email and
	 * password) is true only because of `remaining`. If the screen guessed, the sentence would one day
	 * be false.
	 */
	test("disconnecting credentials leaves Google", () => {
		const result = canDisconnectLoginMethod({
			methods: [method("credential"), method("google")],
			target: "credential",
		});
		expect(result).toEqual({ allowed: true, remaining: [method("google")] });
	});

	test("the last one cannot be disconnected", () => {
		for (const provider of ["credential", "google"] as const)
			expect(
				canDisconnectLoginMethod({
					methods: [method(provider)],
					target: provider,
				}),
			).toEqual({ allowed: false, reason: "last_method" });
	});

	/**
	 * An empty list means a failed lookup or a stale screen, so disconnecting is refused in that
	 * state.
	 */
	test("an empty list is not linked", () => {
		expect(canDisconnectLoginMethod({ methods: [], target: "google" })).toEqual(
			{ allowed: false, reason: "not_linked" },
		);
	});

	/**
	 * Disconnecting a method that is not linked is `not_linked`, not `last_method`. Merging the two
	 * would make the screen tell the user to link another method instead of refreshing.
	 */
	test("an unlinked method has a different reason", () => {
		expect(
			canDisconnectLoginMethod({
				methods: [method("credential")],
				target: "google",
			}),
		).toEqual({ allowed: false, reason: "not_linked" });
	});

	/** The check must not mutate its input; callers reuse the same list. */
	test("does not mutate the input list", () => {
		const methods = [method("credential"), method("google")];
		canDisconnectLoginMethod({ methods, target: "google" });
		expect(methods).toEqual([method("credential"), method("google")]);
	});
});

/**
 * Resend cooldown: pure arithmetic only. Both apps' email screens call the same function, so
 * locking it here means every device shows the same seconds.
 */
describe("resend cooldown", () => {
	const now = 1_700_000_000_000;

	test("never sent means it can send right away", () => {
		expect(resendCooldownRemaining(null, now)).toBe(0);
	});

	test("just sent leaves the full cap", () => {
		expect(resendCooldownRemaining(now, now)).toBe(RESEND_COOLDOWN_SECONDS);
	});

	test("shrinks as time passes", () => {
		expect(resendCooldownRemaining(now - 10_000, now)).toBe(
			RESEND_COOLDOWN_SECONDS - 10,
		);
	});

	test("past the cap is 0", () => {
		expect(
			resendCooldownRemaining(now - RESEND_COOLDOWN_SECONDS * 1000, now),
		).toBe(0);
		expect(resendCooldownRemaining(now - 10 * 60 * 1000, now)).toBe(0);
	});

	/**
	 * Negative values are not passed through. Clocks do move backward (NTP correction, manual time
	 * changes), and an unclamped negative would show '-3s' and look broken. The clamp errs toward the
	 * locked state.
	 */
	test("a clock going backwards errs toward locked", () => {
		expect(resendCooldownRemaining(now + 5_000, now)).toBe(
			RESEND_COOLDOWN_SECONDS,
		);
		expect(resendCooldownRemaining(Number.NaN, now)).toBe(
			RESEND_COOLDOWN_SECONDS,
		);
	});

	test("the cooldown is 60 seconds", () => {
		expect(RESEND_COOLDOWN_SECONDS).toBe(60);
	});
});
