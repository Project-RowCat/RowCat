/**
 * The viewer is a RowCat member, not an auth account. Better Auth owns login, sessions and OAuth;
 * product identity (nickname, member status, adult gate) lives here.
 *
 * Authorization decisions use only the member id. The auth account id must not enter product code,
 * or changing the login method would change the authorization model.
 *
 * The screen's source of truth is `/me`, not the Better Auth session hook. Using both lets them
 * disagree, e.g. a session exists but no member does.
 */

import {
	type AgeStatus,
	isChildAge,
	type MembershipGate,
} from "./membership.ts";

/** Member status. Suspended and banned members can still read but cannot write. */
export const MEMBER_STATUSES = ["approved", "suspended", "banned"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * Operator role. Visible only to the member themselves: never included in public profiles, work
 * creator summaries, or comment authors.
 */
export const MEMBER_ROLES = ["user", "staff", "admin"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface Viewer {
	/** RowCat member id. The only identity authorization uses; not the auth account id. */
	id: string;
	nickname: string;
	status: MemberStatus;
	/**
	 * Operator role. The screen uses it only to show a link to the moderation tool. Real authorization
	 * is re-checked by the server on every route, so editing this value by hand opens no door.
	 */
	role: MemberRole;
	verified: boolean;
	/** Member is 19 or older (the adult threshold). */
	adult: boolean;
	/** Opt-in switch for showing adult content. Off unless the member enables it. */
	showAdult: boolean;
	/**
	 * Age band: unknown, child, or standard. Visible only to the member themselves. It is never in
	 * public profiles, work creator summaries, comment authors, or notifications: an 'under 14' status
	 * is private, and once it reaches a public projection it spreads to screens, logs and caches at
	 * once.
	 *
	 * The server supplies the currently valid value (resolveAgeStatus runs on the server). A child
	 * whose birthday has passed becomes standard automatically; the screen does not compute that
	 * transition.
	 */
	ageStatus: AgeStatus;
	/**
	 * Entry gate to enforce now, or null if none. The server computes this (resolveMembershipGate).
	 * The screen must not reassemble the decision from ageStatus: such copies diverge when priorities
	 * differ, and the symptom is passing through without an age check.
	 */
	membershipGate: MembershipGate;
	/**
	 * Whether identity must be re-verified before adult content can be viewed, because the last adult
	 * check was over a year ago (Enforcement Decree of the Juvenile Protection Act, Art. 17(2);
	 * adult-recheck.ts). The server computes it. The projection has no last-check time, and the screen
	 * does not recount the deadline: a local copy would read the device clock, and a device with a
	 * wrong clock would show an already-closed view as open. Always false where rechecks are disabled
	 * in deployment and on old servers.
	 *
	 * This closes viewing only. verified and adult are unchanged, so posting eligibility and
	 * isAdultEligible ignore this value.
	 */
	adultRecheckRequired: boolean;
	/**
	 * The deployment's local owner — the account this computer is signed in as without a password.
	 * The server decides it; screens only drop what has no meaning for it (signing out).
	 */
	localOwner: boolean;
}

/**
 * Whether the viewer may interact (favorite, follow). This is a display-layer check; the server
 * makes the final decision. Its only job is to disable buttons that would obviously be rejected, so
 * users do not press them and see a failure. Loosening it opens nothing: the server still blocks.
 */
export const canInteract = (viewer: Viewer | null): boolean =>
	viewer?.status === "approved";

/**
 * Whether the viewer may see adult content: identity verified, age 19 or older, and the display
 * opt-in. All three are required because of app store policy: adult content in UGC is hidden by
 * default and shown only when the user turns it on explicitly. Eligibility and display are
 * different axes; collapsing them would open adult works to anyone who merely passed verification.
 *
 * Like canInteract, this is a client-side pre-check (gates.ts on the server is final). It matters
 * most for conversation creation: this value selects the safety guard, and if the server verdict
 * were the only input, the client could not know which guard to set when assembling the prompt.
 */
export const canViewAdultContent = (viewer: Viewer | null): boolean =>
	!isChildViewer(viewer) &&
	!!viewer?.verified &&
	viewer.adult &&
	viewer.showAdult &&
	/**
	 * Annual recheck: a fourth condition that stands beside the three axes. It closes viewing without
	 * removing eligibility (adult-recheck.ts). The server's canViewAdult has the same line.
	 */
	!viewer.adultRecheckRequired;

/**
 * Whether the viewer may turn adult display on: identity verified and age 19 or older. Kept apart
 * from canViewAdultContent on purpose: this is the legal requirement, while that adds the display
 * opt-in. Merging them would leave the account screen unable to tell 'can enable' from 'has
 * enabled', so it could not decide whether to draw the toggle. The server (isAdultVerified in
 * apps/api/src/lib/gates.ts) is final; this only blocks requests that would obviously fail.
 */
export const isAdultEligible = (viewer: Viewer | null): boolean =>
	!isChildViewer(viewer) && !!viewer?.verified && viewer.adult;

/**
 * Whether the account is under 14. This dominates the three adult axes: the two functions above
 * check it first. verified, adult and showAdult are each set by different parties, so an account
 * with all three on is representable (old data, a bad seed, operator error), and letting that
 * combination open adult content cannot be undone. That is why this axis sits above the three
 * rather than beside them. The server is final (same rule in apps/api/src/lib/gates.ts).
 */
export const isChildViewer = (viewer: Viewer | null): boolean =>
	!!viewer && isChildAge(viewer.ageStatus);

/**
 * Whether the viewer may use a personal (BYO) API key. This is the only axis that closes BYO to
 * children. The prompt never passes through our server: the request goes from the browser straight
 * to the provider, and we cannot meet that provider's age or guardian requirements on its behalf.
 * Routing it through our server to get around this would break the definition of BYO.
 *
 * Managed generation is not blocked: it calls our contracted provider on our account, and final
 * safety policy lives on our server.
 */
export const canUseByoProvider = (viewer: Viewer | null): boolean =>
	!isChildViewer(viewer);

/**
 * Whether the viewer's role can open the moderation tool. Display-layer check; the server is final
 * (requireModeratorViewer in apps/api/src/lib/gates.ts). Its only job is to avoid drawing a link
 * that ordinary members cannot use. Suspended accounts are filtered with the same predicate as the
 * server gate: if they diverged, the link would show and then return 403 when pressed.
 */
export const canModerate = (viewer: Viewer | null): boolean =>
	!!viewer &&
	viewer.status === "approved" &&
	(viewer.role === "staff" || viewer.role === "admin");
