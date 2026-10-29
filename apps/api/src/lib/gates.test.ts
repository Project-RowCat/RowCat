import { describe, expect, it } from "vitest";
import type { Viewer } from "../auth/viewer.ts";
import { ApiError } from "./errors.ts";
import { canViewAdult, isAdultVerified, rejectAdultFilter } from "./gates.ts";

/**
 * Adult gate: pins by value where viewing and eligibility diverge. With the one-year recheck, an
 * adult can be eligible while viewing is closed; if one judgement follows the other the symptom is
 * silent: viewing stays open (legal violation) or publishing eligibility locks too.
 */

const viewerOf = (patch: Partial<Viewer> = {}): Viewer => ({
	id: "m1",
	nickname: "Tester",
	status: "approved",
	role: "user",
	verified: true,
	adult: true,
	showAdult: true,
	managedGenerationAllowed: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
	...patch,
});

const codeOf = (fn: () => never): string => {
	try {
		fn();
	} catch (error) {
		if (error instanceof ApiError) return error.code;
		throw error;
	}
	throw new Error("was not rejected");
};

describe("yearly re-verification", () => {
	it("when re-verification is needed, viewing closes and eligibility stays", () => {
		const stale = viewerOf({ adultRecheckRequired: true });
		expect(canViewAdult(stale)).toBe(false);
		expect(isAdultVerified(stale)).toBe(true);
	});

	it("when no re-verification is needed, the three axes open as is", () => {
		expect(canViewAdult(viewerOf())).toBe(true);
	});

	// Do not say display is off: turning it on would not help, so the recheck comes first.
	it("the adult filter's rejection names re-verification first", () => {
		expect(
			codeOf(() => rejectAdultFilter(viewerOf({ adultRecheckRequired: true }))),
		).toBe("adult_recheck_required");
		expect(
			codeOf(() =>
				rejectAdultFilter(
					viewerOf({ adultRecheckRequired: true, showAdult: false }),
				),
			),
		).toBe("adult_recheck_required");
		expect(
			codeOf(() => rejectAdultFilter(viewerOf({ showAdult: false }))),
		).toBe("adult_visibility_off");
	});

	// The child axis still stands above everything; children never get the recheck message.
	it("a child is told about the child restriction, not re-verification", () => {
		expect(
			codeOf(() =>
				rejectAdultFilter(
					viewerOf({ ageStatus: "child", adultRecheckRequired: true }),
				),
			),
		).toBe("minor_adult_restricted");
	});
});
