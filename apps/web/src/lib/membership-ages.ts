import {
	DEFAULT_MEMBERSHIP_AGES,
	type MembershipAges,
} from "@rowcat/domain/membership";
import { runtimeMeta } from "./runtime-meta.ts";

/**
 * The guardian-consent and adult ages this deployment runs, for **printing only**. The API decides
 * every age question; this module only lets copy say the same number the API decides with (a screen
 * saying "under 14" on a deployment that decides at 13 is the mismatch it removes).
 *
 * ```text
 * server   the API's runtime config, which the root loader re-reads at most once a minute per process
 *          (`routes/__root.tsx`) and hands to `setServerMembershipAges`
 * browser  the <meta> tag the server wrote from that same value — not a second fetch, so the browser
 *          cannot draw a different number than the server rendered (hydration)
 * ```
 *
 * Process-wide on the server is right here: the ages are a fact of the deployment, identical for
 * every request, unlike the locale. Until the first read (or if the API cannot answer) the defaults —
 * Korean law, which is also what an older API runs — stand.
 *
 * This file imports nothing that fetches, because the i18n instances read it (`i18n/instance.ts`) and
 * those also run in workers.
 */

export const MEMBERSHIP_AGES_META = "rowcat-membership-ages";

/** How long the server trusts its copy. Ages change only when the API restarts with new values. */
export const SERVER_MEMBERSHIP_AGES_TTL_MS = 60_000;

let serverAges: MembershipAges = DEFAULT_MEMBERSHIP_AGES;
let serverReadAt = 0;
let browserAges: MembershipAges | null = null;

export const encodeMembershipAges = (ages: MembershipAges): string =>
	`${ages.guardianConsent},${ages.adult}`;

export function decodeMembershipAges(
	value: string | undefined,
): MembershipAges | null {
	const [guardianConsent, adult] = (value ?? "").split(",").map(Number);
	if (
		guardianConsent === undefined ||
		adult === undefined ||
		!Number.isInteger(guardianConsent) ||
		!Number.isInteger(adult) ||
		guardianConsent <= 0 ||
		adult <= 0
	)
		return null;
	return { guardianConsent, adult };
}

export function membershipAges(): MembershipAges {
	if (typeof document === "undefined") return serverAges;
	browserAges ??=
		decodeMembershipAges(runtimeMeta(MEMBERSHIP_AGES_META)) ??
		DEFAULT_MEMBERSHIP_AGES;
	return browserAges;
}

/** Server only: whether the process copy is older than the TTL and worth re-reading. */
export const serverMembershipAgesStale = (now = Date.now()): boolean =>
	now - serverReadAt >= SERVER_MEMBERSHIP_AGES_TTL_MS;

export function setServerMembershipAges(
	ages: MembershipAges,
	now = Date.now(),
): void {
	serverAges = ages;
	serverReadAt = now;
}

/** Test-only: forget what this process read. */
export function __resetMembershipAgesForTest(): void {
	serverAges = DEFAULT_MEMBERSHIP_AGES;
	serverReadAt = 0;
	browserAges = null;
}
