import type { MemberRole } from "@rowcat/contracts";
import {
	GALLERY_ERROR_CODE,
	isModeratorRole,
	MEMBERSHIP_ERROR_CODE,
} from "@rowcat/contracts";
import { isChildAge } from "@rowcat/domain/membership";
import {
	MOBILE_UPDATE_CAPABILITY_ROLES,
	type MobileUpdateCapability,
} from "@rowcat/domain/mobile-update-access";
import type { Viewer } from "../auth/viewer.ts";
import { forbidden, unauthorized } from "./errors.ts";

/**
 * Viewing gates. Decisions live here so a check hand-copied per route cannot loosen in one place
 * unnoticed (legacy scattered the same rejection across 7 routes); routes only call.
 */

/**
 * Under-14 account: the axis that dominates the three adult axes.
 *
 * The functions below check it first. `verified`, `adult` and `show_adult` are set by different
 * parties, so a child row with all three on is representable (legacy data, bad seeds, operator
 * error) and opening adult content to it cannot be undone; this axis sits above them, not beside.
 *
 * `unknown` is not a child: folding unverified into child would strip adult content and BYO from
 * every existing member the moment the age gate turns on, a sanction based on an unverified fact.
 * The gate handles unverified (`resolveMembershipGate`).
 */
export const isChildViewer = (viewer: Viewer | null): boolean =>
	!!viewer && isChildAge(viewer.ageStatus);

/**
 * Whether adult content may be shown: 14+, identity-verified, 19+, and display opted in, with the
 * child axis in front. All conditions are required by app-store policy: UGC adult content is hidden
 * by default and shown only when the user explicitly enables it on the web.
 */
export const canViewAdult = (viewer: Viewer | null): boolean =>
	!isChildViewer(viewer) &&
	!!viewer?.verified &&
	!!viewer.adult &&
	!!viewer.showAdult &&
	// One-year recheck (Youth Protection Act enforcement decree art. 17(2)): closes viewing only, so
	// `isAdultVerified` below has no such line. Computed by the viewer projection (`auth/viewer.ts`);
	// always false when the switch is off.
	!viewer.adultRecheckRequired;

/**
 * Whether the viewer is eligible to turn on the display opt-in (legal requirement only), a
 * different axis from actual display. It ignores the one-year recheck: "confirmed 19+" does not
 * become false over time; the recheck closes viewing.
 */
export const isAdultVerified = (viewer: Viewer | null): boolean =>
	!isChildViewer(viewer) && !!viewer?.verified && !!viewer.adult;

/**
 * Rejects operations closed to child accounts; every such rejection goes through this function so a
 * route-local check cannot be missed on one endpoint (which would look like "only this endpoint is
 * open to children", with an identical success response). Codes differ per capability because the
 * screen's next step differs: telling someone blocked from connecting a key to complete adult
 * verification sends them after a procedure that does not exist.
 */
export function requireNonChild(
	viewer: Viewer,
	capability: "adult" | "byo",
): Viewer {
	if (!isChildViewer(viewer)) return viewer;
	throw forbidden(
		capability === "byo"
			? "Members under 14 can't connect a personal API key."
			: "Members under 14 can't use adult content.",
		capability === "byo"
			? MEMBERSHIP_ERROR_CODE.minorByoRestricted
			: MEMBERSHIP_ERROR_CODE.minorAdultRestricted,
	);
}

/** Login required; the non-null return type removes optional chaining at call sites. */
export function requireViewer(viewer: Viewer | null): Viewer {
	if (!viewer) throw unauthorized();
	return viewer;
}

/** Members who may write (favorite, follow, block). Suspended or blocked accounts may read but not write; otherwise suspension would mean nothing. */
export function requireActiveViewer(viewer: Viewer | null): Viewer {
	const v = requireViewer(viewer);
	if (v.status !== "approved")
		throw forbidden("This account is restricted.", "account_restricted");
	return v;
}

/**
 * Operator tools: the one place that checks the role. Per-route role checks would miss one endpoint
 * when the vocabulary or condition changes, which looks like "only this endpoint is open to
 * ordinary members".
 *
 * Stands on `requireActiveViewer`: a sanctioned account must not enforce on others, and an operator
 * who lost the account must not keep enforcing through it. The rejection is a 403 with
 * `moderator_required` rather than a 404, since the path is already in the public SDK and the code
 * lets the screen say "no permission" precisely.
 */
export function requireModeratorViewer(viewer: Viewer | null): Viewer {
	const v = requireActiveViewer(viewer);
	if (!isModeratorRole(v.role as MemberRole))
		throw forbidden("Operator permission is required.", "moderator_required");
	return v;
}

/**
 * Admin-only operations, one layer above `requireModeratorViewer`. `staff` and `admin` were
 * equivalent until real operations worth splitting appeared: the managed-generation allowlist
 * toggle, the app version floor that can lock every mobile user out (undoable only after store
 * review), the app-update announcement and story deletion. Goes through `requireModeratorViewer`, so suspended or
 * blocked admins cannot enter. No permission tiers are pre-built; splits happen next to the
 * operation.
 */
export function requireAdminViewer(viewer: Viewer | null): Viewer {
	const v = requireModeratorViewer(viewer);
	if (v.role !== "admin")
		throw forbidden("Admin permission is required.", "admin_required");
	return v;
}

/**
 * Mobile OTA capability: a capability table over `requireModeratorViewer`. Reads
 * `MOBILE_UPDATE_CAPABILITY_ROLES` from `@rowcat/domain`, the same table the console reads to
 * choose buttons, so the screen cannot show a button that returns 403. The code is not
 * `admin_required` because capability names outlive roles (if the table changes, screen copy stays
 * true).
 */
export function requireMobileUpdateCapability(
	viewer: Viewer | null,
	capability: MobileUpdateCapability,
): Viewer {
	const v = requireModeratorViewer(viewer);
	if (
		!MOBILE_UPDATE_CAPABILITY_ROLES[capability].includes(v.role as MemberRole)
	)
		throw forbidden(
			"You don't have permission for this OTA operation.",
			"mobile_update_capability_required",
		);
	return v;
}

/**
 * Rejection for requests to filter to adult-only works, split by reason: verified-but-display-off
 * is fixed in settings, unverified goes to identity verification. One 403 with one message could
 * not tell the client which screen to show.
 */
export function rejectAdultFilter(viewer: Viewer | null): never {
	// Children are never told to verify as an adult: false for under-14, and it sends them after a
	// procedure that does not exist.
	if (isChildViewer(viewer))
		throw forbidden(
			"Members under 14 can't view adult stories.",
			MEMBERSHIP_ERROR_CODE.minorAdultRestricted,
		);
	// Eligible but the last check is over a year old: do not say display is off, since turning it on
	// would not help. Takes priority even when display is off.
	if (isAdultVerified(viewer) && viewer?.adultRecheckRequired)
		throw forbidden(
			"It's been a year since your last identity verification. Verify again to view adult stories.",
			GALLERY_ERROR_CODE.adultRecheckRequired,
		);
	throw isAdultVerified(viewer)
		? forbidden(
				"Adult content display is off. Turn it on in settings to see it.",
				GALLERY_ERROR_CODE.adultVisibilityOff,
			)
		: forbidden(
				"Only members who completed adult verification can view adult stories.",
				GALLERY_ERROR_CODE.adultVerificationRequired,
			);
}
