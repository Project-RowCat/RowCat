import { describe, expect, it } from "vitest";
import { resolveSettingsScreenState } from "./settings-state.ts";

/**
 * Branches of the settings screen. **The order is everything.**
 *
 * Getting this wrong fails silently: a signed-in person reads that their session is gone, or
 * someone who never signed out is invited to sign in.
 */

describe("identity branch", () => {
	it("neutral wait while checking", () => {
		expect(resolveSettingsScreenState("booting")).toEqual({ kind: "booting" });
	});

	it("guests get the notice", () => {
		expect(resolveSettingsScreenState("guest")).toEqual({ kind: "guest" });
	});

	/**
	 * **`unavailable` is not folded into guest.** The stored session is still there; we just could not
	 * ask. Inviting sign-in here would tell a signed-in person they were signed out, and above all the
	 * previous viewer's private settings cannot be drawn.
	 */
	it("a failed session check isn't a guest", () => {
		expect(resolveSettingsScreenState("unavailable")).toEqual({
			kind: "unavailable",
		});
	});

	it("once the member is confirmed it draws the content", () => {
		expect(resolveSettingsScreenState("authenticated")).toEqual({
			kind: "ready",
		});
	});
});

describe("doesn't wait for SQLite", () => {
	/**
	 * Taking a single `SessionPhase` argument expresses that. Two sections need storage (AI and
	 * personas), and that wait belongs to those sections. Gating the whole screen on it would also
	 * break changing brightness on a device whose storage never opens.
	 */
	it("the decision function takes identity alone", () => {
		expect(resolveSettingsScreenState.length).toBe(1);
	});
});
