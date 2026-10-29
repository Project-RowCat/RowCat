/**
 * Membership rules: why a signed-in person cannot enter the product yet, and what a child account
 * (under 14) structurally cannot do.
 *
 * The server, the web app and the future Expo app all evaluate this one rule set. If each wrote its
 * own copy, a loosened rule in one place would not show, because success responses look the same.
 *
 * The rules live in domain rather than @rowcat/contracts because they are product and legal policy.
 * The contract carries only ageStatus and membershipGate.
 *
 * Not in this file:
 * - Birth dates. The server never stores them (see docs/membership/ARCHITECTURE.md). Only the
 *   folded result is kept.
 * - Guardian identity. The server holds the consent record. This file receives only whether it is
 *   valid now.
 * - The identity verification provider, which is deployment configuration (services/guardian/).
 */

/**
 * The age band of a member. There are exactly three values, and no fourth is created.
 *
 * - unknown: not yet verified. The default for existing members. The gate clears this value.
 * - child: under 14. Usable only with legal guardian consent.
 * - standard: 14 or older. Same as members before this vocabulary existed.
 *
 * `standard` does not mean adult. The 19+ axis (`verified`, `adult`) is a separate axis and is not
 * folded into this vocabulary. Folding would either give 15-year-olds adult-content eligibility, or
 * make verified adults special on this axis.
 *
 * `unknown` is the default on purpose. Defaulting to `standard` would make one migration line
 * declare that every existing member is 14 or older, a fact that was never checked.
 */
export const AGE_STATUSES = ["unknown", "child", "standard"] as const;
export type AgeStatus = (typeof AGE_STATUSES)[number];

/**
 * The age (14) below which legal guardian consent is required. Taken from Article 22-2(1) of the
 * Personal Information Protection Act.
 *
 * Kept as one constant so the number does not scatter through the code. Changing it means the law
 * changed.
 */
export const GUARDIAN_CONSENT_AGE = 14;

/**
 * Product time zone (UTC+9). Age decisions always use the calendar date in this zone, not the
 * device zone.
 *
 * A device-zone calculation could flip one person's 14th-birthday status while travelling. The
 * server runs on UTC. For 9 hours between UTC midnight and KST midnight, web and server would
 * disagree and the gate would flicker. Date display (lib/format.ts) uses the same zone.
 */
export const PRODUCT_TIME_ZONE_OFFSET_MINUTES = 9 * 60;

/**
 * The same zone as an IANA name, for `Intl` formatting and the job scheduler. Every app reads this
 * one value: web, operations console and mobile each used to carry their own `"Asia/Seoul"`, and a
 * fork that changed only one would show a work's date a day apart between them.
 *
 * The offset above is a fixed number because the age rule is pure arithmetic with no `Intl` (it also
 * runs on Hermes). That only holds for a zone without daylight saving time, and
 * `membership.test.ts` pins the two values to each other. Changing the zone does not change which
 * country's law the age, consent and retention rules were written for (`docs/oss/FORKING.md`).
 */
export const PRODUCT_TIME_ZONE = "Asia/Seoul";

/**
 * A date string in YYYY-MM-DD form with no time part. Age decisions need only the calendar date.
 */
export type CalendarDate = string;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The earliest birth year a real person can have. Anything earlier is a typo, not a member. */
const EARLIEST_BIRTH_YEAR = 1900;

/**
 * Returns the current calendar date in the product time zone. `now` is passed in to keep this
 * function pure.
 *
 * Calling Date.now() inside would make the boundary cases (birthday, leap day, just before
 * midnight) untestable. Those boundaries are exactly where this module is most likely to be wrong.
 */
export function productDate(now: Date): CalendarDate {
	const shifted = new Date(
		now.getTime() + PRODUCT_TIME_ZONE_OFFSET_MINUTES * 60_000,
	);
	return shifted.toISOString().slice(0, 10);
}

/**
 * Checks that the value is a real calendar date. The format pattern alone accepts `2026-02-30`, so
 * this function rejects it separately.
 */
export function isCalendarDate(value: string): value is CalendarDate {
	if (!DATE_PATTERN.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number) as [
		number,
		number,
		number,
	];
	if (month < 1 || month > 12 || day < 1) return false;
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

/**
 * Adds N years to a birth date. A date that does not exist in the target year rolls forward to the
 * next day. A Feb 29 birthday in a non-leap year becomes Mar 1, not Feb 28.
 *
 * This is the one judgment here, and it is chosen by the direction of error. A day late keeps the
 * child period one day longer. A day early grants one day of use without guardian consent. When one
 * must be chosen, choose the one that does not shorten protection.
 */
export function addYears(date: CalendarDate, years: number): CalendarDate {
	const [year, month, day] = date.split("-").map(Number) as [
		number,
		number,
		number,
	];
	// Date.UTC rolls a nonexistent date into the next month, so 2027-02-29 becomes 2027-03-01.
	// addYears relies on this roll-forward behavior.
	const shifted = new Date(Date.UTC(year + years, month - 1, day));
	return shifted.toISOString().slice(0, 10);
}

/**
 * Age of majority (19) under Article 4 of the Civil Act. Deliberately a separate constant from
 * GUARDIAN_CONSENT_AGE. The two numbers come from different laws (Civil Act Art. 4, and Personal
 * Information Protection Act Art. 22-2), so they must not be tied together.
 *
 * The 19+ adult-content axis uses the same number because it is the same article. That axis has its
 * own gate (`verified`, `adult`) and must not reuse this constant.
 */
export const LEGAL_ADULT_AGE = 19;

/**
 * Whether this birth date has reached legal adulthood on the given date. Used only for guardian
 * eligibility.
 *
 * The server folds the birth date through this function and discards it immediately. The result is
 * a single boolean, and the birth date appears in no column or response (GuardianVerification has
 * no slot for it).
 *
 * It uses the same calendar, time zone and leap-day rules as the age-14 check. Otherwise a guardian
 * born on Feb 29 could read as not adult for a day.
 */
export const isLegalAdultOn = (birthDate: CalendarDate, now: Date): boolean =>
	productDate(now) >= addYears(birthDate, LEGAL_ADULT_AGE);

/**
 * The date this person turns 14. This is the only age information stored, and only while the status
 * is `child`. The birth date itself is discarded after this value is computed (see
 * docs/membership/ARCHITECTURE.md).
 */
export const guardianConsentThresholdDate = (
	birthDate: CalendarDate,
): CalendarDate => addYears(birthDate, GUARDIAN_CONSENT_AGE);

/**
 * Result of declaring a birth date. Failure reasons are split because the screen acts differently
 * on each. A malformed or future date can be fixed by the user. Merging all failures into one
 * 'invalid value' message would hide what needs fixing.
 */
export type AgeDeclaration =
	| {
			status: "ok";
			ageStatus: Exclude<AgeStatus, "unknown">;
			/** Only set when the status is `child`. A `standard` declaration stores no value. */
			thresholdDate: CalendarDate | null;
	  }
	| { status: "invalid"; reason: "malformed" | "future" | "implausible" };

/**
 * Converts a declared birth date into the age status to store. This is the only place that reads
 * the birth date.
 *
 * The result does not carry the date, so callers cannot read it again. Code that wants to 'store
 * the date in the column for now' would first have to change this signature.
 */
export function declareAge(birthDate: string, now: Date): AgeDeclaration {
	if (!isCalendarDate(birthDate))
		return { status: "invalid", reason: "malformed" };

	const today = productDate(now);
	if (birthDate > today) return { status: "invalid", reason: "future" };

	const year = Number(birthDate.slice(0, 4));
	if (year < EARLIEST_BIRTH_YEAR)
		return { status: "invalid", reason: "implausible" };

	const thresholdDate = guardianConsentThresholdDate(birthDate);
	return today < thresholdDate
		? { status: "ok", ageStatus: "child", thresholdDate }
		: { status: "ok", ageStatus: "standard", thresholdDate: null };
}

/**
 * Stored age status -> age status effective now.
 *
 * A child becomes 14 without any action, and the transition is not done by a batch job. This is the
 * same reasoning as moderation restriction expiry: when the predicate decides, the sweep is not a
 * condition of correctness. If the batch stalled for a day, a member past their birthday would stay
 * treated as a child, with no visible reason.
 *
 * This also never writes on the hot read path. Viewer resolution runs on every authenticated
 * request, so a conditional UPDATE here would write on each member's first request after their
 * birthday.
 */
export function resolveAgeStatus(input: {
	stored: AgeStatus;
	thresholdDate: CalendarDate | null;
	now: Date;
}): AgeStatus {
	if (input.stored !== "child") return input.stored;
	/**
	 * A child with no threshold date stays `child`. That data is inconsistent, since the threshold is
	 * written along with `child`. Opening it to standard here would make an unverified fact true.
	 */
	if (!input.thresholdDate) return "child";
	return productDate(input.now) < input.thresholdDate ? "child" : "standard";
}

/**
 * The single reason a signed-in person cannot enter the product yet, or null.
 *
 * - age_required: age has not been verified.
 * - guardian_consent_required: under 14, with no valid guardian consent.
 *
 * Before adding a value, ask whether it blocks the whole product. Adult verification and sanctions
 * do not belong here. They block specific features. Blocking the whole product would leave a
 * sanctioned person unable to appeal or withdraw.
 */
export const MEMBERSHIP_GATES = [
	"age_required",
	"guardian_consent_required",
] as const;
export type MembershipGate = (typeof MEMBERSHIP_GATES)[number] | null;

export interface MembershipGateInput {
	/** Age status that is effective now (already passed through resolveAgeStatus). */
	ageStatus: AgeStatus;
	/**
	 * Whether the age gate is on in this deployment. This is a rollout switch.
	 *
	 * It lives here because of deploy order between the migration and the screens. If the column ships
	 * first, every existing member becomes `unknown` at once. If the age screen is not deployed yet,
	 * those members lose the whole app with no explanation. With the switch off, the column exists and
	 * the gate does not appear.
	 *
	 * The switch does not apply to members already verified as children. Turning it off only stops
	 * asking for age. The fact 'under 14 without guardian consent' stays true regardless. Letting that
	 * state through would turn off a legal requirement with a switch.
	 */
	ageGateEnabled: boolean;
	/**
	 * Whether a valid guardian consent exists for this member. A child's consent to using the service
	 * and to the processing of their personal information is given by the legal guardian (Civil Act
	 * Art. 5; Personal Information Protection Act Art. 22-2), so this — not anything the child pressed
	 * — is what lets a child in.
	 */
	guardianConsentValid: boolean;
}

/**
 * Picks the single next gate. The priority order is the whole function:
 *
 * - Age not verified -> age_required.
 * - Child without a valid guardian consent -> guardian_consent_required.
 *
 * This repository ships no terms of service, so there is no terms gate. A fork that adds its own
 * documents and wants consent recorded adds that gate here, after these two — and for a child, inside
 * the guardian consent flow, since a child's own consent is one the guardian can revoke.
 *
 * Routes, screens and mutations must not each write this decision. If priorities diverge, the
 * symptoms are silent: 'I agreed and the gate keeps showing' or 'age was skipped'.
 */
export function resolveMembershipGate(
	input: MembershipGateInput,
): MembershipGate {
	if (input.ageStatus === "unknown")
		return input.ageGateEnabled ? "age_required" : null;
	if (input.ageStatus === "child")
		return input.guardianConsentValid ? null : "guardian_consent_required";
	return null;
}

/**
 * Things a child account cannot do. There are only two:
 *
 * - adult: opting in to view, publish and display adult-rated works.
 * - byo: connecting a personal API key and generating with it.
 *
 * A third value, purchase (paid purchases and subscriptions), was removed when payments left the
 * product (docs/oss/PLAN.md, stage 3).
 *
 * Managed generation, chat, drafts, publishing of all-ages works, comments, favorites, follows,
 * sync and account withdrawal stay open. The boundary is deliberate: a child account should not
 * become a half-account. Only what law or provider terms actually require is blocked.
 *
 * The reasons for these two are in docs/membership/ARCHITECTURE.md. In short: adult content is
 * governed by the Youth Protection Act. For BYO, the prompt never passes through this server, so
 * the provider's age policy cannot be satisfied on the provider's behalf.
 */
export const MINOR_RESTRICTED_CAPABILITIES = ["adult", "byo"] as const;
export type MinorRestrictedCapability =
	(typeof MINOR_RESTRICTED_CAPABILITIES)[number];

/**
 * Whether this age status is a child. `unknown` is not a child.
 *
 * Unverified members are not folded into child. Errors in that direction are not silent: before the
 * age gate turns on, every existing member would lose adult content and BYO. That restriction would
 * rest on a fact no one checked. Unverified members are handled by the gate instead, which is why
 * age_required comes first.
 */
export const isChildAge = (ageStatus: AgeStatus): boolean =>
	ageStatus === "child";
