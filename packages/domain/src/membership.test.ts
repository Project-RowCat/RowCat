import { describe, expect, it } from "vitest";
import {
	addYears,
	declareAge,
	isCalendarDate,
	isLegalAdultOn,
	LEGAL_ADULT_AGE,
	PRODUCT_TIME_ZONE,
	productDate,
	resolveAgeStatus,
	resolveMembershipGate,
} from "./membership.ts";
import {
	canUseByoProvider,
	canViewAdultContent,
	isAdultEligible,
	isChildViewer,
	type Viewer,
} from "./viewer.ts";

/**
 * Pure membership rules: age calculation, gate priority, and the child invariant. They share a file
 * because the symptom of getting any one wrong is quiet:
 * - Age calculation: off by one day, a person under 14 passes without guardian consent.
 * - Gate order: a child who sees the terms gate is asked for a consent they cannot give.
 * - Child invariant: a child account with the adult flags on gets adult content. All three look
 *   like a normal success response, so they must be checkable without rendering or a database.
 */

/**
 * A specific instant in KST, the product timezone. Boundary tests need to be able to point at
 * midnight.
 */
const kst = (iso: string): Date => new Date(`${iso}+09:00`);

const viewerOf = (patch: Partial<Viewer> = {}): Viewer => ({
	id: "m1",
	nickname: "Tester",
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
	adultRecheckRequired: false,
	...patch,
});

describe("today in the product time zone", () => {
	/**
	 * Computing in UTC is off by one day. Just after KST midnight it is still yesterday in UTC, so a
	 * server counting in UTC would keep a person who has just passed their birthday classed as a child
	 * for nine hours. The opposite error, just before midnight, lets someone not yet 14 through a day
	 * early, which is much worse.
	 */
	it("just after KST midnight is already the next day", () => {
		expect(productDate(kst("2026-08-21T00:00:00"))).toBe("2026-08-21");
	});

	it("just before KST midnight is still that day", () => {
		expect(productDate(kst("2026-08-20T23:59:59"))).toBe("2026-08-20");
	});

	it("the same instant read in UTC is another day, which is why the time zone is fixed", () => {
		const instant = kst("2026-08-21T00:30:00");
		expect(instant.toISOString().slice(0, 10)).toBe("2026-08-20");
		expect(productDate(instant)).toBe("2026-08-21");
	});

	/**
	 * The age rule adds a fixed offset while every screen formats with the IANA name. If a fork
	 * changes one without the other, or picks a zone with daylight saving time, the gate and the
	 * dates on screen disagree about which day it is — so the two are compared across a whole year.
	 */
	it("the fixed offset and the IANA zone give the same day all year", () => {
		const day = new Intl.DateTimeFormat("en-CA", {
			timeZone: PRODUCT_TIME_ZONE,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		});
		for (let month = 0; month < 12; month += 1) {
			for (const hour of [0, 14, 15, 23]) {
				const instant = new Date(Date.UTC(2026, month, 15, hour, 30));
				expect(productDate(instant)).toBe(day.format(instant));
			}
		}
	});
});

describe("calendar dates", () => {
	it("accepts only real dates", () => {
		expect(isCalendarDate("2026-02-28")).toBe(true);
		expect(isCalendarDate("2024-02-29")).toBe(true);
	});

	it("does not roll a nonexistent date into the next month", () => {
		// `new Date` on the string 2026-02-30 silently normalizes to March 2. That normalization must not
		// pass the calendar-date check.
		expect(isCalendarDate("2026-02-30")).toBe(false);
		expect(isCalendarDate("2026-13-01")).toBe(false);
		expect(isCalendarDate("2026-00-10")).toBe(false);
	});

	it("refuses a malformed value", () => {
		for (const value of [
			"2026-8-20",
			"20260820",
			"",
			"today",
			"2026-08-20T00:00:00",
		])
			expect(isCalendarDate(value)).toBe(false);
	});
});

describe("N years later: a nonexistent date moves to the next day", () => {
	it("an ordinary date", () => {
		expect(addYears("2012-08-20", 14)).toBe("2026-08-20");
	});

	/**
	 * A February 29 birth's 14th birthday falls on a date missing from a common year. The rule is to
	 * move it to March 1. The reason is the direction of the error: moving later extends the child
	 * period by a day (more protection), while moving earlier gives a day of unprotected use.
	 */
	it("a February 29 birthday moves to March 1 in a common year", () => {
		expect(addYears("2012-02-29", 14)).toBe("2026-03-01");
	});

	it("if 14 years later is a leap year again, the day stays", () => {
		expect(addYears("2008-02-29", 16)).toBe("2024-02-29");
	});
});

describe("age declaration", () => {
	const today = kst("2026-08-20T12:00:00");

	it("the day before the 14th birthday is a child", () => {
		const result = declareAge("2012-08-21", today);
		expect(result).toEqual({
			status: "ok",
			ageStatus: "child",
			thresholdDate: "2026-08-21",
		});
	});

	/**
	 * A person turns 14 on their birthday. Article 158 of the Korean Civil Act counts the birth date
	 * in the age calculation, so the 14th birthday is the day they become 14 and stop being a child.
	 */
	it("the 14th birthday itself is not a child", () => {
		expect(declareAge("2012-08-20", today)).toEqual({
			status: "ok",
			ageStatus: "standard",
			thresholdDate: null,
		});
	});

	it("the day after turning 14 is not a child", () => {
		expect(declareAge("2012-08-19", today).status).toBe("ok");
		expect(declareAge("2012-08-19", today)).toMatchObject({
			ageStatus: "standard",
		});
	});

	/**
	 * From age 14 on, not even a transition date is recorded. There is no reason to keep the value.
	 */
	it("no transition date is kept for 14 and over", () => {
		expect(declareAge("1990-01-01", today)).toMatchObject({
			thresholdDate: null,
		});
	});

	it("someone born today can declare too (a child)", () => {
		expect(declareAge("2026-08-20", today)).toMatchObject({
			ageStatus: "child",
			thresholdDate: "2040-08-20",
		});
	});

	it("a future date has its own reason", () => {
		expect(declareAge("2026-08-21", today)).toEqual({
			status: "invalid",
			reason: "future",
		});
	});

	it("a malformed value says it is malformed", () => {
		expect(declareAge("2026-02-30", today)).toEqual({
			status: "invalid",
			reason: "malformed",
		});
		expect(declareAge("", today)).toEqual({
			status: "invalid",
			reason: "malformed",
		});
	});

	it("an impossible year is yet another reason", () => {
		expect(declareAge("1899-12-31", today)).toEqual({
			status: "invalid",
			reason: "implausible",
		});
	});

	/** Leap-year birth boundary: the folding rule gives the same answer at declaration. */
	it("a February 29 birthday turns 14 on March 1 of a common year", () => {
		expect(declareAge("2012-02-29", kst("2026-02-28T23:00:00"))).toMatchObject({
			ageStatus: "child",
			thresholdDate: "2026-03-01",
		});
		expect(declareAge("2012-02-29", kst("2026-03-01T00:00:00"))).toMatchObject({
			ageStatus: "standard",
		});
	});

	/**
	 * Crossing midnight flips the result: same member, same birth date, nine hours apart. Computing
	 * this in UTC would be off by a day.
	 */
	it("leaves child status at the KST midnight boundary", () => {
		expect(declareAge("2012-08-21", kst("2026-08-20T23:59:59"))).toMatchObject({
			ageStatus: "child",
		});
		expect(declareAge("2012-08-21", kst("2026-08-21T00:00:00"))).toMatchObject({
			ageStatus: "standard",
		});
	});
});

describe("stored state → currently effective state", () => {
	it("a child past the birthday becomes standard on its own", () => {
		expect(
			resolveAgeStatus({
				stored: "child",
				thresholdDate: "2026-08-20",
				now: kst("2026-08-20T00:00:00"),
			}),
		).toBe("standard");
	});

	it("before the birthday it stays a child", () => {
		expect(
			resolveAgeStatus({
				stored: "child",
				thresholdDate: "2026-08-21",
				now: kst("2026-08-20T23:59:59"),
			}),
		).toBe("child");
	});

	/**
	 * In an inconsistent state (a child with no transition date), do not open to adult. That would
	 * make an unverified fact true.
	 */
	it("a child without a transition date stays a child", () => {
		expect(
			resolveAgeStatus({
				stored: "child",
				thresholdDate: null,
				now: kst("2099-01-01T00:00:00"),
			}),
		).toBe("child");
	});

	it("unknown and standard stay over time", () => {
		for (const stored of ["unknown", "standard"] as const)
			expect(
				resolveAgeStatus({
					stored,
					thresholdDate: "2000-01-01",
					now: kst("2026-08-20T00:00:00"),
				}),
			).toBe(stored);
	});
});

describe("entry gate precedence", () => {
	const gate = (input: Partial<Parameters<typeof resolveMembershipGate>[0]>) =>
		resolveMembershipGate({
			ageStatus: "standard",
			ageGateEnabled: true,
			guardianConsentValid: false,
			...input,
		});

	it("unknown age comes first", () => {
		expect(gate({ ageStatus: "unknown" })).toBe("age_required");
	});

	it("14 and over → pass", () => {
		expect(gate({})).toBeNull();
	});

	it("child + no guardian consent → guardian", () => {
		expect(gate({ ageStatus: "child" })).toBe("guardian_consent_required");
	});

	it("child + valid guardian consent → pass", () => {
		expect(gate({ ageStatus: "child", guardianConsentValid: true })).toBeNull();
	});

	describe("rollout switch", () => {
		it("when off it does not ask about unknown age", () => {
			expect(gate({ ageStatus: "unknown", ageGateEnabled: false })).toBeNull();
		});

		/**
		 * A member already confirmed as a child is not affected by the switch. Turning the switch off
		 * only means age is not asked yet. 'Under 14 with no guardian consent' stays true whatever the
		 * switch says; letting them through would switch the law off.
		 */
		it("even when off the child guardian gate stands", () => {
			expect(gate({ ageStatus: "child", ageGateEnabled: false })).toBe(
				"guardian_consent_required",
			);
		});
	});
});

describe("child invariant: dominates the three adult axes", () => {
	/**
	 * The most important check in this file. verified, adult, and show_adult are each set by a
	 * different party, so a child account with all three on can actually exist (old data, a bad seed,
	 * an operator mistake). Opening adult content for that combination cannot be undone.
	 */
	it("child + verified + adult + showAdult still closes adult content", () => {
		const corrupt = viewerOf({
			ageStatus: "child",
			verified: true,
			adult: true,
			showAdult: true,
		});
		expect(isChildViewer(corrupt)).toBe(true);
		expect(canViewAdultContent(corrupt)).toBe(false);
		expect(isAdultEligible(corrupt)).toBe(false);
	});

	it("an account 14 or over with the same three axes stays open", () => {
		const adult = viewerOf({
			ageStatus: "standard",
			verified: true,
			adult: true,
			showAdult: true,
		});
		expect(canViewAdultContent(adult)).toBe(true);
		expect(isAdultEligible(adult)).toBe(true);
	});

	/**
	 * Annual re-verification closes viewing only; eligibility stays. Folding the two checks into one
	 * axis would also lock an adult's publishing eligibility and display-setting toggle once their
	 * re-verification lapsed.
	 */
	it("when re-verification is due only viewing closes and eligibility stays", () => {
		const stale = viewerOf({
			ageStatus: "standard",
			verified: true,
			adult: true,
			showAdult: true,
			adultRecheckRequired: true,
		});
		expect(canViewAdultContent(stale)).toBe(false);
		expect(isAdultEligible(stale)).toBe(true);
	});

	it("BYO is closed to children", () => {
		const child = viewerOf({ ageStatus: "child" });
		expect(canUseByoProvider(child)).toBe(false);
	});

	/**
	 * Unknown is not child. Folding it into child would strip payments and adult content from every
	 * existing member who predates the age gate, all at once, on a fact that was never verified.
	 */
	it("an unknown-age account does not fold to child", () => {
		const unknown = viewerOf({ ageStatus: "unknown" });
		expect(isChildViewer(unknown)).toBe(false);
		expect(canUseByoProvider(unknown)).toBe(true);
	});

	/**
	 * Child restrictions are not applied to guests. A failed /me lookup arrives as null, and blocking
	 * every member's payments and provider links in that case would be much worse. The server is the
	 * final authority.
	 */
	it("no viewer (guest or failed lookup) is not a child", () => {
		expect(isChildViewer(null)).toBe(false);
		expect(canUseByoProvider(null)).toBe(true);
		expect(canViewAdultContent(null)).toBe(false);
	});
});

/**
 * Adult determination (age 19): the only calculation that gates adult eligibility, so every
 * boundary is run. It uses a different constant from declareAge (age 14), and its consumer differs:
 * the identity adapter folds the verifier's birth date into a boolean with it
 * (services/identity/portone.ts). If that folding is off by one day, a person who is 18 years and
 * 364 days old gets adult eligibility. That mistake does not show as an error; it stays open.
 *
 * The tests run at a fixed instant. Computed against the machine's today, the test would check a
 * different day each day and fail only near the boundary, by which time the code is already
 * deployed.
 */
describe("adulthood decision", () => {
	/**
	 * A point during the given KST day: 03:00 UTC, which is 12:00 KST. The calendar date is the same
	 * in both zones.
	 */
	const kstNoon = (date: string): Date => new Date(`${date}T03:00:00Z`);

	it("an adult from the day of turning 19", () => {
		const birth = "2007-08-21";
		expect(isLegalAdultOn(birth, kstNoon("2026-08-20"))).toBe(false);
		expect(isLegalAdultOn(birth, kstNoon("2026-08-21"))).toBe(true);
		expect(isLegalAdultOn(birth, kstNoon("2026-08-22"))).toBe(true);
	});

	/**
	 * Not counted in UTC. For the nine hours between KST midnight and UTC midnight the result is off
	 * by a day, and one of those directions lets someone who is not yet adult through.
	 */
	it("crosses at KST midnight", () => {
		const birth = "2007-08-21";
		/** UTC 2026-08-20T14:59:59Z is KST 2026-08-20 23:59:59: not yet adult. */
		expect(isLegalAdultOn(birth, new Date("2026-08-20T14:59:59Z"))).toBe(false);
		/** UTC 2026-08-20T15:00:00Z is KST 2026-08-21 00:00:00: adult from this instant. */
		expect(isLegalAdultOn(birth, new Date("2026-08-20T15:00:00Z"))).toBe(true);
	});

	/**
	 * A February 29 birth's 19th year falls on a date missing from a common year. Move it to March 1.
	 * This never shortens protection, and it is the same rule addYears uses for age 14. Splitting the
	 * rule would make the same person read differently on the two axes by one day.
	 */
	it("a February 29 birthday becomes an adult on March 1 of a common year", () => {
		const birth = "2008-02-29";
		expect(addYears(birth, LEGAL_ADULT_AGE)).toBe("2027-03-01");
		expect(isLegalAdultOn(birth, kstNoon("2027-02-28"))).toBe(false);
		expect(isLegalAdultOn(birth, kstNoon("2027-03-01"))).toBe(true);
	});

	it("no off-by-one at year end", () => {
		const birth = "2007-01-01";
		expect(isLegalAdultOn(birth, kstNoon("2025-12-31"))).toBe(false);
		expect(isLegalAdultOn(birth, kstNoon("2026-01-01"))).toBe(true);
	});

	/**
	 * Not mixed with the age-14 constant. Folding them into one number would tie 'can act as a legal
	 * guardian' to 'needs guardian consent', and different laws set those two.
	 */
	it("14 is not an adult", () => {
		expect(isLegalAdultOn("2012-08-21", kstNoon("2026-08-21"))).toBe(false);
	});
});
