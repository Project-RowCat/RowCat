import type { Viewer } from "@rowcat/domain";
import { describe, expect, test } from "vitest";
import { canAdminister, resolveOperatorAccess } from "./operator.ts";

/**
 * Checks only the operator gate's decision, without React. Getting the order wrong is silent: a
 * signed-in operator bounces to sign-in, or a privileged screen draws for one frame before
 * authorization resolves.
 */

const viewer = (patch: Partial<Viewer> = {}): Viewer =>
	({
		id: "m1",
		nickname: "operator",
		status: "approved",
		role: "staff",
		verified: false,
		adult: false,
		showAdult: false,
		ageStatus: "standard",
		membershipGate: "none",
		...patch,
	}) as Viewer;

describe("resolveOperatorAccess", () => {
	test("decides nothing while loading", () => {
		expect(
			resolveOperatorAccess({
				pending: true,
				viewer: undefined,
				failed: false,
			}),
		).toBe("loading");
	});

	/**
	 * The most important case here: folding a failed lookup into guest makes a signed-in operator look
	 * signed out during an API wobble.
	 */
	test("does not fold a failed lookup into guest", () => {
		expect(
			resolveOperatorAccess({
				pending: false,
				viewer: undefined,
				failed: true,
			}),
		).toBe("loading");
	});

	test("guest when the server answers there is no member", () => {
		expect(
			resolveOperatorAccess({ pending: false, viewer: null, failed: false }),
		).toBe("guest");
	});

	/**
	 * A role-less member is not sent to sign-in; what they need is a role grant, which they cannot do
	 * themselves.
	 */
	test("a regular member is a 403, not a guest", () => {
		expect(
			resolveOperatorAccess({
				pending: false,
				viewer: viewer({ role: "user" }),
				failed: false,
			}),
		).toBe("forbidden");
	});

	test.each(["staff", "admin"] as const)("%s gets in", (role) => {
		expect(
			resolveOperatorAccess({
				pending: false,
				viewer: viewer({ role }),
				failed: false,
			}),
		).toBe("operator");
	});

	/**
	 * A suspended operator is refused despite the role, matching the server gate's predicate.
	 * Otherwise the screen opens, every lookup is 403 and the empty console reads as "no data".
	 */
	test.each([
		"suspended",
		"banned",
	] as const)("%s status is refused regardless of role", (status) => {
		expect(
			resolveOperatorAccess({
				pending: false,
				viewer: viewer({ role: "admin", status }),
				failed: false,
			}),
		).toBe("forbidden");
	});
});

describe("canAdminister", () => {
	test("staff do not draw admin operations", () => {
		expect(canAdminister(viewer({ role: "staff" }))).toBe(false);
	});

	test("admin draws them", () => {
		expect(canAdminister(viewer({ role: "admin" }))).toBe(true);
	});

	/** A suspended admin must also be false; checking `role` alone misses that axis. */
	test("a suspended admin is false", () => {
		expect(canAdminister(viewer({ role: "admin", status: "suspended" }))).toBe(
			false,
		);
	});

	test("a guest is false", () => {
		expect(canAdminister(null)).toBe(false);
		expect(canAdminister(undefined)).toBe(false);
	});
});
