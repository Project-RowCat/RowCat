import { CHAT_ERROR_CODE } from "@rowcat/contracts";
import type { Viewer } from "../../auth/viewer.ts";
import { managedGenerationAccess } from "../../env.ts";
import { ApiError } from "../../lib/errors.ts";

/**
 * **Who** may use managed generation — this file alone decides.
 *
 * In the public release, managed generation runs unmetered on the operator's provider key. There are
 * three spending defences:
 *
 * ```text
 * who        this file                        in allowlist mode, listed members and staff/admin only
 * how much   managedGeneration(Daily)         30/min · 400/24h per member (fail-closed)
 * how long   MANAGED_GENERATION_WALL_CLOCK_MS  wall-clock cap per stream
 * ```
 *
 * Comparing role and column in every route means the day a path is added one place gets missed,
 * and the symptom is "anyone uses the operator's key through this one path", which looks like an
 * ordinary success and goes unnoticed. So both generation paths (regular and protected) go through
 * this one function, placed **before** the rate limit, so a disallowed member's request does not
 * spend that member's rate window.
 *
 * **Why staff and admin are always allowed**: if operators had to put their own row on the list to
 * test their own deployment, the first thing that operation leaves in the audit would be "lent the
 * key to myself". Roles already have no promotion path in the product API (seed and ops scripts write
 * them), so this opens no new door.
 *
 * BYO generation does not go through this decision: that request never reaches our server, and the
 * key it uses is not the operator's. That is why the refusal copy says "connect your own key".
 */
export const canUseManagedGeneration = (
	viewer: Pick<Viewer, "role" | "managedGenerationAllowed">,
	access: "allowlist" | "everyone" = managedGenerationAccess,
): boolean =>
	access === "everyone" ||
	viewer.role === "staff" ||
	viewer.role === "admin" ||
	viewer.managedGenerationAllowed;

export function requireManagedGenerationAccess(
	viewer: Pick<Viewer, "role" | "managedGenerationAllowed">,
): void {
	if (!canUseManagedGeneration(viewer))
		throw new ApiError(
			403,
			CHAT_ERROR_CODE.managedNotAllowed,
			"This server's default AI is available only to allowed accounts. Connect your own API key in AI settings.",
		);
}
