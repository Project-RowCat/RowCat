import { describe, expect, it } from "vitest";
import {
	adultAxesDirty,
	adultGrantBlockedForChild,
	applyAdultAxis,
} from "./adult-axes.ts";

describe("applyAdultAxis", () => {
	it("turning off identity verification turns off adult eligibility too", () => {
		expect(
			applyAdultAxis({ verified: true, adult: true }, "verified", false),
		).toEqual({ verified: false, adult: false });
	});

	it("turning on adult eligibility turns on identity verification too", () => {
		expect(
			applyAdultAxis({ verified: false, adult: false }, "adult", true),
		).toEqual({ verified: true, adult: true });
	});

	/** A verified account under 19 is a normal state. */
	it("turning on identity verification alone does not turn on adult eligibility", () => {
		expect(
			applyAdultAxis({ verified: false, adult: false }, "verified", true),
		).toEqual({ verified: true, adult: false });
	});

	it("adult eligibility alone can be revoked", () => {
		expect(
			applyAdultAxis({ verified: true, adult: true }, "adult", false),
		).toEqual({ verified: true, adult: false });
	});

	/** No path through this function produces the combination the contract rejects. */
	it("adult eligibility without identity verification is not representable", () => {
		const axes: boolean[] = [false, true];
		for (const verified of axes)
			for (const adult of axes)
				for (const axis of ["verified", "adult"] as const)
					for (const next of axes) {
						const result = applyAdultAxis({ verified, adult }, axis, next);
						expect(result.adult && !result.verified).toBe(false);
					}
	});
});

describe("adultAxesDirty", () => {
	it("the same state has no operation to send", () => {
		expect(
			adultAxesDirty(
				{ verified: true, adult: false },
				{ verified: true, adult: false },
			),
		).toBe(false);
	});

	it("one differing axis is a change", () => {
		expect(
			adultAxesDirty(
				{ verified: true, adult: false },
				{ verified: true, adult: true },
			),
		).toBe(true);
	});
});

describe("adultGrantBlockedForChild", () => {
	it("blocks a draft that grants it to a child", () => {
		expect(
			adultGrantBlockedForChild("child", { verified: true, adult: false }),
		).toBe(true);
	});

	/** Operations that reduce entitlement stay open on child accounts. */
	it("does not block revoking on a child account", () => {
		expect(
			adultGrantBlockedForChild("child", { verified: false, adult: false }),
		).toBe(false);
	});

	it("does not block when not a child", () => {
		expect(
			adultGrantBlockedForChild("standard", { verified: true, adult: true }),
		).toBe(false);
		expect(
			adultGrantBlockedForChild("unknown", { verified: true, adult: true }),
		).toBe(false);
	});
});
