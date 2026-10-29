import { canModerate, type MemberRole, type Viewer } from "./viewer.ts";

/**
 * The operations capability vocabulary. It does not cross the wire. The server gate and the ops
 * console read the same table, which is a product rule, so it lives here. The contract has no place
 * for it, since requests do not declare their own capabilities.
 */
export const MOBILE_UPDATE_CAPABILITIES = [
	"read",
	"operate",
	"publish",
] as const;
export type MobileUpdateCapability =
	(typeof MOBILE_UPDATE_CAPABILITIES)[number];

/**
 * Release and job statuses. These values mirror the contract vocabulary (`MobileUpdateStatus` in
 * @rowcat/contracts) and must stay in sync with it.
 */
type MobileUpdateStatus = "draft" | "active" | "paused" | "rolled_back";
type MobileUpdateJobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";

/**
 * OTA operation permissions: three capabilities layered over the role, in one table.
 *
 * - read: staff and admin. Releases, history, rollback plans, jobs.
 * - operate: admin only. Raise rollout percentage, pause, resume.
 * - publish: admin only. New releases and signed rollback requests.
 *
 * No separate ACL table. This repo's only permission store is `member.role` (there is no promotion
 * path in the product API). A second store would give 'who may do what' two answers. Capability
 * names are where operations diverge, and the mapping to roles belongs in this table. The server
 * gate (requireMobileUpdateCapability) and the ops console both read it.
 *
 * Why operate is admin-only: raising a rollout on the operate channel is effectively a deploy
 * button for remote code execution. Its weight matches the admin-only actions already in the repo,
 * such as payouts and the minimum version that locks users out. Stop was considered for staff, but
 * resume is the same capability. Splitting one capability in two would make 'can stop but nobody
 * can revert' the normal state at night. If that judgment changes, one line of this table changes.
 *
 * Suspended operators have no capabilities. They must pass canModerate, the same predicate the
 * server gate uses.
 */
export const MOBILE_UPDATE_CAPABILITY_ROLES: Record<
	MobileUpdateCapability,
	readonly MemberRole[]
> = {
	read: ["staff", "admin"],
	operate: ["admin"],
	publish: ["admin"],
};

export const hasMobileUpdateCapability = (
	viewer: Viewer | null | undefined,
	capability: MobileUpdateCapability,
): boolean =>
	!!viewer &&
	canModerate(viewer) &&
	MOBILE_UPDATE_CAPABILITY_ROLES[capability].includes(viewer.role);

/**
 * The next rollout step. Only increases are offered.
 *
 * The ladder runs from canary to full release (5, 10, 25, 50, 100). Only steps above the current
 * percentage are returned, so the screen has nowhere to draw a 'decrease' control. The server's
 * transition table enforces the same rule again. This function picks a button; it is not
 * authorization.
 *
 * A draft starts at 0%, so any step can be chosen. Stop and rollback are not states that raise the
 * percentage, so they return an empty list. A stopped release is reopened by resume.
 */
export const MOBILE_UPDATE_ROLLOUT_STEPS = [5, 10, 25, 50, 100] as const;

export function nextRolloutSteps(
	status: MobileUpdateStatus,
	rolloutPercentage: number,
	kind: "update" | "rollback_to_embedded" = "update",
): number[] {
	if (status !== "draft" && status !== "active") return [];
	if (kind !== "update") return rolloutPercentage < 100 ? [100] : [];
	return MOBILE_UPDATE_ROLLOUT_STEPS.filter((step) => step > rolloutPercentage);
}

/**
 * Whether the job is still running. The screen's refetch interval and cancel button both read this
 * one predicate.
 */
export const isMobileUpdateJobActive = (status: MobileUpdateJobStatus) =>
	status === "queued" || status === "running";
