import { describe, expect, it } from "vitest";
import { adultVisibilityState } from "./adult-visibility.ts";
import type { Viewer } from "./viewer.ts";

/**
 * Folds the three adult-gate axes into screen state, checked without rendering. This is policy, not
 * markup. DOM-based policy tests would break whenever a button moved, and people would then fix
 * selectors instead of policy.
 */

const viewerOf = (patch: Partial<Viewer> = {}): Viewer => ({
	id: "member-1",
	nickname: "Cat",
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
	localOwner: false,
	...patch,
});

describe("adultVisibilityState", () => {
	it("without identity verification it is unverified", () => {
		expect(adultVisibilityState(viewerOf())).toEqual({ kind: "unverified" });
	});

	/**
	 * An age flag alone, without verification, is not eligibility. If the check order is reversed,
	 * this test fails.
	 */
	it("adult alone without verification is still unverified", () => {
		expect(adultVisibilityState(viewerOf({ adult: true }))).toEqual({
			kind: "unverified",
		});
	});

	it("verified but under 19 is minor", () => {
		expect(adultVisibilityState(viewerOf({ verified: true }))).toEqual({
			kind: "minor",
		});
	});

	it("eligible and off is eligible/off", () => {
		expect(
			adultVisibilityState(viewerOf({ verified: true, adult: true })),
		).toEqual({
			kind: "eligible",
			showAdult: false,
			recheckRequired: false,
		});
	});

	it("eligible and on is eligible/on", () => {
		expect(
			adultVisibilityState(
				viewerOf({ verified: true, adult: true, showAdult: true }),
			),
		).toEqual({
			kind: "eligible",
			showAdult: true,
			recheckRequired: false,
		});
	});

	/**
	 * Critical: suspended and banned accounts must still be able to turn display off, as the server
	 * allows. A screen stricter than the server would leave restricted users no way to reduce the
	 * adult content shown to them.
	 */
	it.each([
		"suspended",
		"banned",
	] as const)("a %s account is eligible too when entitled (status is not an input)", (status) => {
		expect(
			adultVisibilityState(
				viewerOf({ status, verified: true, adult: true, showAdult: true }),
			),
		).toEqual({
			kind: "eligible",
			showAdult: true,
			recheckRequired: false,
		});
	});

	/**
	 * Re-verification: eligibility stays and only viewing closes, so the kind does not change and the
	 * display setting can still be flipped. The screen uses the flag to place the re-verification
	 * prompt beside the switch.
	 */
	it("still eligible when re-verification is due, and a flag carries that fact", () => {
		expect(
			adultVisibilityState(
				viewerOf({
					verified: true,
					adult: true,
					showAdult: true,
					adultRecheckRequired: true,
				}),
			),
		).toEqual({ kind: "eligible", showAdult: true, recheckRequired: true });
	});

	it("guests fold to unverified", () => {
		expect(adultVisibilityState(null)).toEqual({ kind: "unverified" });
	});

	/**
	 * Under-14 status overrides all three axes. A child account with all three flags on can exist (old
	 * data, bad seeds, operator error), and letting that combination open the switch cannot be undone.
	 */
	it("a child is not eligible even with all three axes on", () => {
		expect(
			adultVisibilityState(
				viewerOf({
					ageStatus: "child",
					verified: true,
					adult: true,
					showAdult: true,
				}),
			),
		).toEqual({ kind: "child" });
	});

	it("an unverified child is child, not unverified", () => {
		expect(adultVisibilityState(viewerOf({ ageStatus: "child" }))).toEqual({
			kind: "child",
		});
	});

	/**
	 * Unknown age is not treated as a child: no restriction is imposed on a fact that was never
	 * verified.
	 */
	it("unknown age follows the existing decision", () => {
		expect(
			adultVisibilityState(
				viewerOf({
					ageStatus: "unknown",
					verified: true,
					adult: true,
					showAdult: false,
				}),
			),
		).toEqual({
			kind: "eligible",
			showAdult: false,
			recheckRequired: false,
		});
	});
});
