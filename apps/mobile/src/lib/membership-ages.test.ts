import { afterEach, describe, expect, it } from "vitest";
import { ADULT_UNAVAILABLE_TITLE } from "../features/account/account-copy.ts";
import { ageDescription } from "../features/onboarding/gate-copy.ts";
import { providerByoLocked } from "../features/settings/provider-copy.ts";
import {
	__setMembershipAgesForTest,
	membershipAges,
} from "./membership-ages.ts";

/**
 * The copy prints the deployment's ages at the moment it is read, not the numbers this module held
 * when the copy file loaded — a constant built at import time would keep saying 14 on a deployment
 * that decides at 13, which is the whole mismatch this exists to remove.
 */
describe("membership ages in copy", () => {
	afterEach(() => __setMembershipAgesForTest());

	it("defaults to Korean law until the runtime config answers", () => {
		expect(membershipAges()).toEqual({ guardianConsent: 14, adult: 19 });
		expect(ADULT_UNAVAILABLE_TITLE.child).toBe("This account is under 14.");
		expect(ADULT_UNAVAILABLE_TITLE.minor).toBe("This account is under 19.");
	});

	it("reads the deployment's ages when the copy is read", () => {
		__setMembershipAgesForTest({ guardianConsent: 13, adult: 18 });
		expect(ADULT_UNAVAILABLE_TITLE.child).toBe("This account is under 13.");
		expect(ADULT_UNAVAILABLE_TITLE.minor).toBe("This account is under 18.");
		expect(ageDescription()).toContain("the date you turn 13");
		expect(ageDescription()).not.toContain("14");
		expect(providerByoLocked()).toContain("Members under 13");
	});
});
