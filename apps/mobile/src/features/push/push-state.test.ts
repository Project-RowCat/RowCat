import { describe, expect, it } from "vitest";
import {
	type PushSectionInput,
	pushTokenChanged,
	resolvePushSectionState,
	shouldRegisterPush,
} from "./push-state.ts";

/**
 * Decisions for the push settings section: **the six states and their order.**
 *
 * The most expensive thing locked here is that a bare `granted` never draws "on". Folding it would
 * show the screen as on while the server has no registration, and the user waits for notifications
 * that never come. That state does not heal itself: there is no way to turn it on again on screen.
 *
 * One more axis sits beside it: **OS permission and this installation's decision are different
 * values.** Turning off leaves the permission granted, so a permission-only check would revive a
 * turned-off device just by restarting the app.
 */

const input = (patch: Partial<PushSectionInput> = {}): PushSectionInput => ({
	permission: "granted",
	canAskAgain: true,
	phase: "registered",
	failure: null,
	signedIn: true,
	preference: "unset",
	...patch,
});

describe("state decision", () => {
	it("doesn't draw the control while reading permission", () => {
		expect(resolvePushSectionState(input({ permission: "checking" }))).toEqual({
			kind: "checking",
		});
	});

	it("offers turning on when not yet asked", () => {
		expect(
			resolvePushSectionState(
				input({ permission: "undetermined", phase: "idle" }),
			),
		).toEqual({ kind: "offer", busy: false });
	});

	it("on when both permission and registration exist", () => {
		expect(resolvePushSectionState(input())).toEqual({
			kind: "enabled",
			busy: false,
		});
	});

	/** The costliest split in this slice. */
	it("doesn't draw it as on with permission but no registration", () => {
		expect(
			resolvePushSectionState(input({ phase: "failed", failure: "server" })),
		).toEqual({ kind: "incomplete", busy: false, failure: "server" });
	});

	it("not yet attempted isn't on either", () => {
		const state = resolvePushSectionState(input({ phase: "idle" }));
		expect(state.kind).toBe("incomplete");
	});

	it("when denied and askable again, offers turning on again", () => {
		expect(
			resolvePushSectionState(
				input({ permission: "denied", canAskAgain: true, phase: "idle" }),
			),
		).toEqual({ kind: "retry-permission", busy: false });
	});

	/** On iOS, once refused, the prompt never reappears; only one action remains. */
	it("when it can't ask again, sends to system settings", () => {
		expect(
			resolvePushSectionState(
				input({ permission: "denied", canAskAgain: false }),
			),
		).toEqual({ kind: "blocked" });
	});

	it("not signed in isn't on", () => {
		expect(resolvePushSectionState(input({ signedIn: false })).kind).toBe(
			"offer",
		);
	});

	it("in progress is an axis, not a state", () => {
		const state = resolvePushSectionState(
			input({ permission: "undetermined", phase: "registering" }),
		);
		expect(state).toEqual({ kind: "offer", busy: true });
	});

	/**
	 * Turning off is not a failure. Falling into `incomplete` would bring the action the user just
	 * pressed back as a red error message.
	 */
	it("a device explicitly turned off is the same screen as one not yet turned on", () => {
		expect(
			resolvePushSectionState(input({ preference: "disabled", phase: "idle" })),
		).toEqual({ kind: "offer", busy: false });
	});

	/** On a device the OS blocked, the only way to enable is system settings, so that guidance comes first. */
	it("blocked permission comes before having turned it off", () => {
		expect(
			resolvePushSectionState(
				input({
					preference: "disabled",
					permission: "denied",
					canAskAgain: false,
				}),
			),
		).toEqual({ kind: "blocked" });
	});

	/**
	 * Until unregistration finishes, the device is still receiving. Folding into `registering` would
	 * flash "could not register" for a frame, a failure that did not happen.
	 */
	it("draws it as still receiving while turning off", () => {
		expect(resolvePushSectionState(input({ phase: "unregistering" }))).toEqual({
			kind: "enabled",
			busy: true,
		});
	});

	/** The screen turns off only after the fact of turning off is written; that order is the honesty. */
	it("returns to on when turning off fails", () => {
		expect(
			resolvePushSectionState(
				input({ preference: "unset", phase: "registered", failure: "server" }),
			),
		).toEqual({ kind: "enabled", busy: false });
	});
});

describe("automatic refresh decision", () => {
	const base = {
		signedIn: true,
		permission: "granted" as const,
		preference: "unset" as const,
		registeredToken: null,
	};

	it("true only when signed in · permitted · unregistered are all true", () => {
		expect(shouldRegisterPush(base)).toBe(true);
	});

	/**
	 * If this function is true, the caller goes to fetch a token, and that call itself shows the
	 * system prompt, so the "never ask" promise breaks on one sign-in.
	 */
	it("not true without permission", () => {
		expect(shouldRegisterPush({ ...base, permission: "undetermined" })).toBe(
			false,
		);
		expect(shouldRegisterPush({ ...base, permission: "denied" })).toBe(false);
	});

	it("doesn't fold an unknown state into permitted", () => {
		expect(shouldRegisterPush({ ...base, permission: "checking" })).toBe(false);
	});

	it("doesn't upload while signed out", () => {
		expect(shouldRegisterPush({ ...base, signedIn: false })).toBe(false);
	});

	it("doesn't upload again once uploaded", () => {
		expect(
			shouldRegisterPush({ ...base, registeredToken: "ExponentPushToken[a]" }),
		).toBe(false);
	});

	/**
	 * **The second costliest split in this file.** Looking at permission alone, the installation of
	 * someone who pressed `Turn off on this device` would be registered just by reopening the app (the OS permission
	 * stays granted).
	 */
	it("an install explicitly turned off doesn't upload even with permission", () => {
		expect(shouldRegisterPush({ ...base, preference: "disabled" })).toBe(false);
	});

	/**
	 * The check after a token change passes through the same function: even when the uploaded fact has
	 * been forgotten (`null`), the fact of turning off wins.
	 */
	it("an install turned off isn't re-registered even when the token changes", () => {
		expect(
			shouldRegisterPush({
				...base,
				preference: "disabled",
				registeredToken: null,
			}),
		).toBe(false);
	});

	it("an install explicitly turned on uploads", () => {
		expect(shouldRegisterPush({ ...base, preference: "enabled" })).toBe(true);
	});

	/**
	 * **The default at the moment the version rises.** Installations uploaded before this value
	 * existed are all `unset`. Folding them to `disabled` would switch off push for everyone who had
	 * it on, with one update, and that silence shows nothing. So `unset` behaves **the same as
	 * before** this value existed (devices whose permission is already granted keep refreshing).
	 */
	it("an install that never chose refreshes as before", () => {
		expect(shouldRegisterPush({ ...base, preference: "unset" })).toBe(true);
	});
});

describe("token replacement", () => {
	it("doesn't upload the same value", () => {
		expect(
			pushTokenChanged("ExponentPushToken[a]", "ExponentPushToken[a]"),
		).toBe(false);
	});

	it("uploads when it changed", () => {
		expect(
			pushTokenChanged("ExponentPushToken[a]", "ExponentPushToken[b]"),
		).toBe(true);
		expect(pushTokenChanged(null, "ExponentPushToken[b]")).toBe(true);
	});

	it("failing to fetch isn't a replacement", () => {
		expect(pushTokenChanged("ExponentPushToken[a]", null)).toBe(false);
	});
});
