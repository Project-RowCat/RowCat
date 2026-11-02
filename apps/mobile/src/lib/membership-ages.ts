import {
	DEFAULT_MEMBERSHIP_AGES,
	type MembershipAges,
} from "@rowcat/domain/membership";

/**
 * The guardian-consent and adult ages this deployment runs, for **printing only**. The API decides
 * every age question (`MEMBERSHIP_GUARDIAN_CONSENT_AGE` · `MEMBERSHIP_ADULT_AGE`); this module only
 * lets copy say the same number it decides with — "under 14" on a deployment that decides at 13 is
 * the mismatch it removes.
 *
 * A module value rather than a hook argument, because the sentences that carry the numbers are also
 * read outside React (`connect-provider.ts`, the generation error tables), and threading the ages
 * through every one of those signatures would be a second way to get it wrong. The value is the
 * same for every member of a deployment, so it does not cross the account boundary the way a
 * module global holding a session would. Until the runtime config answers — or if it cannot — the
 * defaults stand (Korean law, which is also what an older API runs).
 *
 * This file imports nothing from React or the network, because the copy modules that read it are
 * pure and run in tests with no React Native. The query lives in `membership-ages-sync.tsx`.
 *
 * The web does the same through a `<meta>` tag (`apps/web/src/lib/membership-ages.ts`).
 */

let current: MembershipAges = DEFAULT_MEMBERSHIP_AGES;

export function membershipAges(): MembershipAges {
	return current;
}

/** Root wiring only (`membership-ages-sync.tsx`): the runtime config's answer. */
export function setMembershipAges(ages: MembershipAges): void {
	current = ages;
}

/** Test-only: put a deployment's ages in place, or the defaults back. */
export function __setMembershipAgesForTest(
	ages: MembershipAges = DEFAULT_MEMBERSHIP_AGES,
): void {
	current = ages;
}
