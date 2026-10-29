import { PRODUCT_TIME_ZONE_OFFSET_MINUTES } from "./membership.ts";

/**
 * One-year re-verification of adult status. A pure rule.
 *
 * Under article 17(2) of the Enforcement Decree of the Juvenile Protection Act (Korea), a verified member's status may count for one year after the
 * verification date. After that, adult content must be re-verified before it is viewed.
 *
 * Only viewing closes. Eligibility (`verified`, `adult`) is not cleared: both are monotonic
 * (`services/adult-verification.ts`), and turning them off would make the fact 'verified as an
 * adult' false because of elapsed time. Publishing eligibility (`isAdultVerified`) and the display
 * toggle (`show_adult`) are unchanged. The toggle can be on, but nothing shows before
 * re-verification.
 *
 * The server decides. The viewer projection (`auth/viewer.ts`) calls this and passes the result as
 * `Viewer.adultRecheckRequired`. The screen does not recompute it: the last verification time is
 * not on the viewer, and a screen-side comparison would use the device clock.
 */

/** Re-verification period in calendar years (not 365 days), counted from the verification time. */
export const ADULT_RECHECK_PERIOD_YEARS = 1;

/**
 * Verification time plus one calendar year: re-verification is required from this instant. Counted
 * on the product time zone's wall clock. Feb 29 plus one year is pulled back to Feb 28, not pushed
 * to Mar
 * 1. This is deliberately the opposite of `addYears` in `membership.ts`: there the later date is
 *    the protective one, but here the earlier one is, since the law allows 'within one year' and
 *    asking a day late opens that day outside the window. Not counted in UTC either: a Korea-time
 *    Feb 29 morning is Feb 28 in UTC, and the nine-hour gap would move the deadline by a day.
 */
export function adultRecheckDueAt(verifiedAt: Date): Date {
	const offsetMs = PRODUCT_TIME_ZONE_OFFSET_MINUTES * 60_000;
	const wall = new Date(verifiedAt.getTime() + offsetMs);
	const year = wall.getUTCFullYear() + ADULT_RECHECK_PERIOD_YEARS;
	const month = wall.getUTCMonth();
	/** Last day of that month. Keeps `Date.UTC` from overflowing into the next month. */
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const shifted = Date.UTC(
		year,
		month,
		Math.min(wall.getUTCDate(), lastDay),
		wall.getUTCHours(),
		wall.getUTCMinutes(),
		wall.getUTCSeconds(),
		wall.getUTCMilliseconds(),
	);
	return new Date(shifted - offsetMs);
}

/**
 * Whether re-verification is needed now. No verification record means it is needed. This covers
 * members who qualified before the attempt-record table existed (old data, seeds, operational
 * fixes). Their verification time is unknown, and reading an unknown time as 'not yet a year' would
 * skip a re-verification the law requires. The boundary is `>=`: at exactly one year, the window
 * has closed.
 */
export function adultRecheckDue(input: {
	lastAdultVerifiedAt: Date | null;
	now: Date;
}): boolean {
	if (!input.lastAdultVerifiedAt) return true;
	return (
		input.now.getTime() >=
		adultRecheckDueAt(input.lastAdultVerifiedAt).getTime()
	);
}
