import type { ViewerDto } from "@rowcat/contracts";
import { adultRecheckDue } from "@rowcat/domain/adult-recheck";
import type { AgeStatus, MembershipGate } from "@rowcat/domain/membership";
import {
	isChildAge,
	resolveAgeStatus,
	resolveMembershipGate,
} from "@rowcat/domain/membership";
import { and, eq, isNull, max, type SQL, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
	guardian_consent,
	identity_verification,
	member,
} from "../db/schema.ts";
import { adultReverificationEnabled, ageGateEnabled } from "../env.ts";
import { newId } from "../lib/id.ts";
import { readFeatureState } from "../services/ops.ts";
import { auth } from "./index.ts";

/**
 * The requester as a product member, not an auth account. All authorization uses `id` (member.id);
 * the auth account id never leaves this module.
 */
export interface Viewer {
	id: string;
	nickname: string;
	status: string;
	/**
	 * Operator role, `user | staff | admin`. A separate axis from `status`: a suspended operator keeps
	 * the role but cannot use operations tools (gates check both). No product API changes it; seed and
	 * ops scripts write the column. It never appears in public responses (`PublicProfileDto`,
	 * `StoryDto.creator`, `StoryCommentDto.author`).
	 */
	role: string;
	verified: boolean;
	adult: boolean;
	showAdult: boolean;
	/**
	 * The raw `member.managed_generation_allowed` column — input, not a decision. Combining it with
	 * deployment mode and role belongs to `services/generation/access.ts`; it never goes on the wire
	 * (the operations console reads it through its own projection).
	 */
	managedGenerationAllowed: boolean;
	/**
	 * The currently effective age bracket, passed through `resolveAgeStatus` rather than stored. A
	 * child turns 14 without doing anything; resolving here rather than in a batch keeps the answer
	 * right while a sweep job is down (same reasoning as moderation expiry).
	 */
	ageStatus: AgeStatus;
	/**
	 * The entry gate to raise now; authorization and screens read the same value. Routes reassembling
	 * their own gate would split priorities, showing up silently as "this one endpoint skips the age
	 * check".
	 */
	membershipGate: MembershipGate;
	/**
	 * True when the last adult verification is over a year old (the Korean Juvenile Protection Act Enforcement Decree art. 17(2),
	 * `@rowcat/domain/adult-recheck`). It closes adult viewing only (`canViewAdult`): `verified` and
	 * `adult` stay set, so publishing eligibility and the display setting ignore it. Always false when
	 * `ADULT_REVERIFICATION_ENABLED` is off, and the query is not run at all.
	 */
	adultRecheckRequired: boolean;
}

/**
 * The viewer projection — there is exactly one.
 *
 * `guardian_consent` is left-joined rather than read with a second SELECT: every authenticated
 * request would pay that round trip, and most members have no row. The partial unique index
 * `guardian_consent_active_idx` makes this one index lookup and guarantees one valid consent per
 * member (two rows would duplicate the member).
 *
 * Not a scalar subquery, and this actually bit: in that context the ORM renders columns
 * unqualified, so `"id"` inside resolved to `guardian_consent.id` instead of the outer member. The
 * condition went silently false and the symptom was "the guardian consented but the gate stays". In
 * a join the ORM always qualifies columns.
 */
const VIEWER_COLUMNS = {
	id: member.id,
	nickname: member.nickname,
	status: member.status,
	role: member.role,
	verified: member.verified,
	adult: member.adult,
	showAdult: member.show_adult,
	managedGenerationAllowed: member.managed_generation_allowed,
	storedAgeStatus: member.age_status,
	ageThresholdDate: member.age_threshold_date,
	/**
	 * The valid consent's id, or NULL when there is none. Only its presence is read: the join
	 * condition (`ACTIVE_CONSENT`) already is the validity rule, so a non-null id means "a guardian
	 * consented and nobody revoked it".
	 */
	guardianConsentId: guardian_consent.id,
};

/**
 * Join condition for a valid consent: consented and not revoked. No expiry by design — the link
 * expires but consent does not; an expiry would close a child account on a date with no event and
 * no explanation.
 */
const ACTIVE_CONSENT = and(
	eq(guardian_consent.member_id, member.id),
	sql`${guardian_consent.consented_at} is not null`,
	isNull(guardian_consent.revoked_at),
);

/**
 * The member's last adult verification time — the sole basis for the one-year recheck. Read from
 * `identity_verification` rather than a member column: that row already records when and on whose
 * clock (`verified_at` is the authority's) the person was confirmed 19+, and a copy would leave two
 * candidates for the evidence. Retention deletes only `pending` attempts
 * (`jobs/legal/retention-policies.ts`), so finished ones live as long as the account.
 *
 * A later minor result (`adult = false`) does not reset the deadline, just as it does not revoke
 * entitlement. `LATERAL`, not a scalar subquery, for the same ORM pitfall noted on
 * `VIEWER_COLUMNS`, and it runs for the one outer member only (`identity_verification_member_idx`).
 */
const LAST_ADULT_VERIFICATION = db
	.select({
		at: max(identity_verification.verified_at).as("last_adult_verified_at"),
	})
	.from(identity_verification)
	.where(
		and(
			eq(identity_verification.member_id, member.id),
			eq(identity_verification.purpose, "adult_eligibility"),
			eq(identity_verification.status, "verified"),
			eq(identity_verification.adult, true),
		),
	)
	.as("last_adult_verification");

/**
 * The only query shape for reading a viewer. Two branches because of the one-year re-verification
 * switch: deployments with it off do not read the verification ledger at all, since this is the
 * hottest read every authenticated request takes. Both share `VIEWER_COLUMNS` and the same
 * conditions.
 */
async function selectViewerRow(where: SQL): Promise<ViewerRow | undefined> {
	if (!adultReverificationEnabled) {
		const [row] = await db
			.select(VIEWER_COLUMNS)
			.from(member)
			.leftJoin(guardian_consent, ACTIVE_CONSENT)
			.where(where)
			.limit(1);
		return row ? { ...row, lastAdultVerifiedAt: null } : undefined;
	}
	const [row] = await db
		.select({
			...VIEWER_COLUMNS,
			lastAdultVerifiedAt: LAST_ADULT_VERIFICATION.at,
		})
		.from(member)
		.leftJoin(guardian_consent, ACTIVE_CONSENT)
		.leftJoinLateral(LAST_ADULT_VERIFICATION, sql`true`)
		.where(where)
		.limit(1);
	return row;
}

/**
 * Member row → viewer. Age transition and gate resolution live only here; all three lookups
 * (`ensureMember`, `readViewer`, `updateViewer`) go through it so a new axis cannot be missed in
 * one.
 */
type ViewerRow = {
	id: string;
	nickname: string;
	status: string;
	role: string;
	verified: boolean;
	adult: boolean;
	showAdult: boolean;
	managedGenerationAllowed: boolean;
	storedAgeStatus: string;
	ageThresholdDate: string | null;
	guardianConsentId: string | null;
	/** Always `null` when the re-verification switch is off (not queried). */
	lastAdultVerifiedAt: Date | null;
};

function toViewer(row: ViewerRow, now = new Date()): Viewer {
	const ageStatus = resolveAgeStatus({
		stored: row.storedAgeStatus as AgeStatus,
		thresholdDate: row.ageThresholdDate,
		now,
	});
	return {
		id: row.id,
		nickname: row.nickname,
		status: row.status,
		role: row.role,
		verified: row.verified,
		adult: row.adult,
		showAdult: row.showAdult,
		managedGenerationAllowed: row.managedGenerationAllowed,
		ageStatus,
		membershipGate: resolveMembershipGate({
			ageStatus,
			ageGateEnabled,
			guardianConsentValid: row.guardianConsentId !== null,
		}),
		/**
		 * Asked only of people otherwise entitled. For the unverified, under-19 or children, another axis
		 * already closed viewing and "verify again" would be wrong guidance.
		 */
		adultRecheckRequired:
			adultReverificationEnabled &&
			!isChildAge(ageStatus) &&
			row.verified &&
			row.adult &&
			adultRecheckDue({ lastAdultVerifiedAt: row.lastAdultVerifiedAt, now }),
	};
}

/**
 * Ensures a member row exists for the auth account. Created on the first request rather than in a
 * Better Auth signup hook: a failing hook leaves an account that can sign in with no member and
 * never self-heals, while here the next request is the retry.
 */
async function ensureMember(
	userId: string,
	name: string,
): Promise<Viewer | null> {
	const existing = await selectViewerRow(eq(member.user_id, userId));
	if (existing) return toViewer(existing);

	/**
	 * Where the signup breaker actually stands (`ops`). Email signup is already blocked by `app.ts`'s
	 * middleware, but social sign-in arrives via `/auth/callback/*` after authentication is done; this
	 * is where both paths meet.
	 *
	 * Returns `null` instead of throwing: this runs on every request's viewer resolution, so throwing
	 * would 403 even the public gallery for that account. `null` means "not a member" and the person
	 * browses as a guest. Existing members returned above — closing signup does not close sign-in.
	 */
	const signup = await readFeatureState("signup");
	if (!signup.enabled) {
		console.warn(
			`[ops] sign-up is off, so member creation is skipped: user=${userId}`,
		);
		return null;
	}

	/**
	 * Two concurrent requests for the same account both read nothing above; `unique(user_id)` is the
	 * final authority, so the loser ignores the conflict and re-reads the winner's row.
	 *
	 * Not projected via `RETURNING` (it cannot express the join, and hand-writing "no consent" here
	 * would be a second projection). This runs once per account, so the extra round trip is cheap.
	 */
	await db
		.insert(member)
		.values({ id: newId(), user_id: userId, nickname: name })
		.onConflictDoNothing({ target: member.user_id });

	const row = await selectViewerRow(eq(member.user_id, userId));
	if (!row) throw new Error(`failed to create the member: user=${userId}`);
	return toViewer(row);
}

/** Session cookie → member. Signed out or expired is `null`, not an error: public reads pass through. */
export async function resolveViewer(headers: Headers): Promise<Viewer | null> {
	const session = await auth.api.getSession({ headers });
	if (!session?.user) return null;
	return ensureMember(session.user.id, session.user.name ?? "");
}

/**
 * Re-reads a viewer by member id. Separate from `updateViewer` because an empty patch is invalid
 * SQL (`UPDATE ... SET` with nothing), so callers that wrote elsewhere (age declaration, guardian
 * consent) would 500 on `updateViewer(id, {})` — and their own SELECT would be another copy of
 * `VIEWER_COLUMNS`.
 *
 * Call only with an already authenticated member id; taking that id from the client reads someone
 * else's viewer.
 */
export async function readViewer(id: string): Promise<Viewer | null> {
	const row = await selectViewerRow(eq(member.id, id));
	return row ? toViewer(row) : null;
}

/**
 * Updates the member row and returns the committed viewer. Lives here, not in a route, because the
 * response needs the same projection as `VIEWER_COLUMNS`; a second column list in a route means a
 * new axis is missing only from update responses, and the screen redraws the old value.
 *
 * `null` when the row vanished (a concurrent account deletion); the caller decides what to do.
 */
export async function updateViewer(
	id: string,
	patch: Partial<typeof member.$inferInsert>,
): Promise<Viewer | null> {
	/**
	 * Not built with `RETURNING`: the projection needs a join it cannot express, and a separate column
	 * list here would drop new axes from update responses only. Check a row was touched, then re-read.
	 */
	const [updated] = await db
		.update(member)
		.set(patch)
		.where(eq(member.id, id))
		.returning({ id: member.id });
	return updated ? readViewer(updated.id) : null;
}

/**
 * Viewer → wire vocabulary. The owner of the projection owns the mapping too: in routes it would be
 * copied per route (`/me`, the three updates, the membership writes), and a new axis missed in
 * one copy is silent.
 */
export const toViewerDto = (v: Viewer): ViewerDto => ({
	id: v.id,
	nickname: v.nickname,
	status: v.status as ViewerDto["status"],
	role: v.role as ViewerDto["role"],
	verified: v.verified,
	adult: v.adult,
	showAdult: v.showAdult,
	/**
	 * Only the gate result goes out, never its inputs (consent rows, threshold dates). The priority
	 * belongs to one domain function, and a copy in the client would silently diverge.
	 */
	ageStatus: v.ageStatus,
	membershipGate: v.membershipGate,
	adultRecheckRequired: v.adultRecheckRequired,
});
