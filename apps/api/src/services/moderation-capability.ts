import {
	CAPABILITY_ERROR_CODE,
	type ModerationCapability,
} from "@rowcat/contracts";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { member_restriction } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";

/**
 * Capability restriction gate: the only place that knows whether a capability is blocked right now
 * (§36).
 *
 * It is split from `services/moderation.ts` for dependency direction: comment, social and publish
 * routes pass through this check on every write, and importing the module that also holds the
 * report queue, action execution and appeals would tie them to all of moderation. Only one
 * predicate and one function turning it into a rejection live here.
 *
 * The screen holds no such check. Disabling a button is courtesy, not enforcement; a restricted
 * member calling the API directly is stopped here (§82 verifies exactly that).
 */

/**
 * Expiry and revocation are decided in the predicate, so no sweep job is a correctness condition
 * (§67): `revoked_at is null and (expires_at is null or expires_at > now)`. A cleanup job for old
 * rows would be capacity management, not policy.
 *
 * `now` is deliberately not a parameter. If callers could pick the time, someone would eventually
 * judge with a cached one, keeping an expired restriction alive or releasing a live one early.
 */
const activeRestriction = (memberId: string) =>
	and(
		eq(member_restriction.member_id, memberId),
		isNull(member_restriction.revoked_at),
		or(
			isNull(member_restriction.expires_at),
			gt(member_restriction.expires_at, new Date()),
		),
	);

/**
 * Rejects with 403 when the capability is restricted.
 *
 * Stands right next to `requireActiveViewer` in a route because the two answer different questions:
 * that one asks whether the account may write at all, this one whether it may do this particular
 * thing. Suspended accounts are stopped earlier, so only members with a narrow restriction reach
 * here.
 *
 * Takes a member id rather than a viewer object: with a viewer, callers could choose which viewer
 * to pass, making a request that checks someone else's restriction expressible.
 *
 * The extra lookup costs one index probe (`idx_member_restriction_active`). It is not folded into
 * viewer resolution (same reason as §58) because most requests have no restriction and should not
 * pay for it.
 */
export async function requireCapability(
	memberId: string,
	capability: ModerationCapability,
): Promise<void> {
	const [row] = await db
		.select({ id: member_restriction.id })
		.from(member_restriction)
		.where(
			and(
				activeRestriction(memberId),
				eq(member_restriction.capability, capability),
			),
		)
		.limit(1);
	if (!row) return;
	// Say which capability is blocked but not why. The reason is what the account screen fetches via
	// `GET /v2/me/moderation`; carrying a public reason on every failure would let the same sentence
	// diverge in two places.
	throw new ApiError(
		403,
		CAPABILITY_ERROR_CODE.restricted,
		`This account is restricted from that feature (${capability}).`,
	);
}
