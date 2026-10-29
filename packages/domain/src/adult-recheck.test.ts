import { describe, expect, it } from "vitest";
import { adultRecheckDue, adultRecheckDueAt } from "./adult-recheck.ts";

/**
 * Date rule for the one-year re-verification. Its error direction is fixed: a deadline one day late
 * opens one day outside the legal 'within one year' window, and one day early asks for
 * re-verification a day sooner. If one error must happen, prevent the first.
 */

/** Korea time (+09:00) to an instant, so tests can state dates in the product's own calendar. */
const kst = (iso: string): Date => new Date(`${iso}+09:00`);

describe("adultRecheckDueAt", () => {
	it("an ordinary day is exactly one calendar year later", () => {
		expect(
			adultRecheckDueAt(kst("2026-03-15T10:20:30.000")).toISOString(),
		).toBe(kst("2027-03-15T10:20:30.000").toISOString());
	});

	/**
	 * Feb 29 plus one year does not exist in a non-leap year. It is pulled back to Feb 28, not pushed
	 * to Mar 1.
	 */
	it("one year after February 29 is February 28", () => {
		expect(
			adultRecheckDueAt(kst("2028-02-29T09:00:00.000")).toISOString(),
		).toBe(kst("2029-02-28T09:00:00.000").toISOString());
	});

	/**
	 * Counted in the product time zone. Early morning Feb 29 in Korea time is still Feb 28 in UTC, so
	 * counting in UTC would shift the deadline by a day.
	 */
	it("date boundaries follow Korea time", () => {
		expect(
			adultRecheckDueAt(kst("2028-02-29T02:00:00.000")).toISOString(),
		).toBe(kst("2029-02-28T02:00:00.000").toISOString());
		expect(
			adultRecheckDueAt(kst("2028-03-01T02:00:00.000")).toISOString(),
		).toBe(kst("2029-03-01T02:00:00.000").toISOString());
	});

	it("February 28 of a leap year stays February 28", () => {
		expect(
			adultRecheckDueAt(kst("2028-02-28T12:00:00.000")).toISOString(),
		).toBe(kst("2029-02-28T12:00:00.000").toISOString());
	});
});

describe("adultRecheckDue", () => {
	const verifiedAt = kst("2026-05-01T12:00:00.000");

	it("not required before a year passes", () => {
		expect(
			adultRecheckDue({
				lastAdultVerifiedAt: verifiedAt,
				now: kst("2027-05-01T11:59:59.999"),
			}),
		).toBe(false);
	});

	it("required from the moment a year passes", () => {
		expect(
			adultRecheckDue({
				lastAdultVerifiedAt: verifiedAt,
				now: kst("2027-05-01T12:00:00.000"),
			}),
		).toBe(true);
		expect(
			adultRecheckDue({
				lastAdultVerifiedAt: verifiedAt,
				now: kst("2028-01-01T00:00:00.000"),
			}),
		).toBe(true);
	});

	it("required without a verification record", () => {
		expect(
			adultRecheckDue({
				lastAdultVerifiedAt: null,
				now: kst("2026-05-01T12:00:00.000"),
			}),
		).toBe(true);
	});
});
