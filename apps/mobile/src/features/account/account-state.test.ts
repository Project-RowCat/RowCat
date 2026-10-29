import { describe, expect, it } from "vitest";
import {
	accountDetailsPanelView,
	resolveAccountScreenState,
} from "./account-state.ts";

/**
 * State ordering of the account screen. Mistakes here are silent: a signed-in person sees the
 * sign-in prompt for a boot frame, an unconfirmed session reads as signed out, or an offline user
 * sees a placeholder that never ends.
 */

describe("resolveAccountScreenState", () => {
	it("booting is a neutral wait — the guest notice isn't drawn first", () => {
		expect(resolveAccountScreenState("booting")).toEqual({ kind: "booting" });
	});

	it("a guest gets the sign-in notice", () => {
		expect(resolveAccountScreenState("guest")).toEqual({ kind: "guest" });
	});

	/** `unavailable` is not a guest: the stored session is intact and was merely not confirmed. */
	it("unavailable isn't folded into guest", () => {
		expect(resolveAccountScreenState("unavailable")).toEqual({
			kind: "unavailable",
		});
	});

	it("once the member is confirmed, account content is drawn", () => {
		expect(resolveAccountScreenState("authenticated")).toEqual({
			kind: "ready",
		});
	});
});

describe("accountDetailsPanelView", () => {
	const view = (
		patch: Partial<Parameters<typeof accountDetailsPanelView>[0]>,
	) =>
		accountDetailsPanelView({
			isPaused: false,
			isError: false,
			isPending: false,
			hasData: false,
			...patch,
		});

	it("loading while the first lookup runs", () => {
		expect(view({ isPending: true })).toEqual({
			state: "loading",
			retryable: false,
		});
	});

	/**
	 * Paused comes before loading: a paused query is still `isPending`, so reversed order shows
	 * offline users a placeholder that never ends.
	 */
	it("a paused lookup is offline, not loading", () => {
		expect(view({ isPaused: true, isPending: true })).toEqual({
			state: "offline",
			retryable: true,
		});
	});

	/** A failure is not an empty account; there is no branch that draws "email: -". */
	it("a failure with no held value is an error", () => {
		expect(view({ isError: true })).toEqual({
			state: "error",
			retryable: true,
		});
	});

	it("draws when there is a held value", () => {
		expect(view({ hasData: true })).toEqual({
			state: "ready",
			retryable: false,
		});
	});

	/** A held value is not erased; a failed background refresh only leaves a staleness note. */
	it("a failed background refresh doesn't erase the held value", () => {
		expect(view({ hasData: true, isError: true })).toEqual({
			state: "ready",
			retryable: true,
		});
		expect(view({ hasData: true, isPaused: true })).toEqual({
			state: "ready",
			retryable: true,
		});
	});
});
