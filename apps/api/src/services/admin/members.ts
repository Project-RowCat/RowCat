import type {
	AdminMemberDetailDto,
	AdminMemberPage,
	AdminMemberQuery,
	AdminMemberSummaryDto,
	MemberRole,
	MemberStatus,
	ModerationCapability,
} from "@rowcat/contracts";
import {
	and,
	count,
	desc,
	eq,
	gt,
	ilike,
	isNull,
	lt,
	or,
	sql,
} from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
	follow,
	member,
	member_restriction,
	moderation_action,
	story,
	user,
} from "../../db/schema.ts";
import {
	decodeTimelineCursor,
	encodeTimelineCursor,
} from "../../lib/cursor.ts";
import { containsPattern } from "../../lib/like.ts";

/**
 * Operator member lookup; read-only. No statement here changes a member row: suspension, ban and
 * capability restriction all go through `executeAction` in `services/moderation.ts` so the action
 * ledger and `member.status` stay consistent. A second UPDATE path would be an enforcement with no
 * audit row and nothing to appeal.
 *
 * Email is on the detail only. Search may match an email exactly (an operator brings an address
 * from a support mail), but the list does not carry it, and partial matching stays closed: one
 * `@gmail.com` could sweep the roster. The detail view leaves an audit row (`admin.member.view`),
 * written by the route, since it is the only lookup that returns an email.
 */

/** Looks like a member id: the hyphenless UUIDv4 `newId()` makes. */
const looksLikeMemberId = (value: string): boolean =>
	/^[0-9a-f]{32}$/i.test(value);

/** Looks like an email; decides which axis to compare, not a format validation. */
const looksLikeEmail = (value: string): boolean =>
	value.includes("@") && !value.includes(" ");

/**
 * Counts only live restrictions, in the same shape the gate uses. Expiry is decided by the
 * predicate, not a sweep: while cleanup lags, an expired restriction must not be counted and tempt
 * the operator to lift something that is gone.
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
 * The cursor's axis: `created_at` truncated to milliseconds. The column stores microseconds but the
 * cursor carries a JS `Date`, so comparing the raw column would treat `.123456` as neither before
 * nor equal to `.123` and silently drop same-millisecond rows at page boundaries. Ordering and
 * predicate both use the truncated value, or they disagree again; id breaks ties within a
 * millisecond.
 */
const createdAtMs = sql<Date>`date_trunc('milliseconds', ${member.created_at})`;

export async function listAdminMembers(
	query: AdminMemberQuery,
): Promise<AdminMemberPage> {
	const size = query.limit;
	const after = query.cursor ? decodeTimelineCursor(query.cursor) : null;
	const q = query.q;

	/**
	 * Three axes ORed: the operator's value type is unknown in advance, and separate parameters would
	 * make them choose an input field each time. Only the nickname is a partial match
	 * (`member_nickname_trgm_idx`); id and email are exact, which keeps this search from being a
	 * roster dump.
	 */
	const search = q
		? or(
				looksLikeMemberId(q) ? eq(member.id, q) : undefined,
				looksLikeEmail(q) ? eq(user.email, q) : undefined,
				ilike(member.nickname, containsPattern(q)),
			)
		: undefined;

	const rows = await db
		.select({
			id: member.id,
			nickname: member.nickname,
			status: member.status,
			role: member.role,
			ageStatus: member.age_status,
			createdAt: member.created_at,
			/**
			 * Live restriction count as a scalar subquery: a join would duplicate the member per
			 * restriction, and `GROUP BY` would force every list column into the group key.
			 */
			activeRestrictions: sql<number>`(
				select count(*)::int from ${member_restriction}
				where ${member_restriction.member_id} = ${member.id}
				  and ${member_restriction.revoked_at} is null
				  and (${member_restriction.expires_at} is null
				       or ${member_restriction.expires_at} > now())
			)`,
		})
		.from(member)
		/**
		 * Left join for email comparison; an inner join would hide members whose auth row is being
		 * cleaned up mid-deletion. `user.email` is not selected, since that would break the header's
		 * boundary.
		 */
		.leftJoin(user, eq(member.user_id, user.id))
		.where(
			and(
				search,
				query.status ? eq(member.status, query.status) : undefined,
				query.role ? eq(member.role, query.role) : undefined,
				after
					? or(
							lt(createdAtMs, after.createdAt),
							and(eq(createdAtMs, after.createdAt), lt(member.id, after.id)),
						)
					: undefined,
			),
		)
		.orderBy(desc(createdAtMs), desc(member.id))
		.limit(size + 1);

	const page = rows.slice(0, size);
	const items: AdminMemberSummaryDto[] = page.map((row) => ({
		id: row.id,
		nickname: row.nickname,
		status: row.status as MemberStatus,
		role: row.role as MemberRole,
		ageStatus: row.ageStatus,
		createdAt: row.createdAt.toISOString(),
		activeRestrictions: Number(row.activeRestrictions ?? 0),
	}));

	const last = page.at(-1);
	return {
		items,
		nextCursor:
			rows.length > size && last
				? encodeTimelineCursor({ createdAt: last.createdAt, id: last.id })
				: null,
	};
}

/** How many recent actions the detail carries; not the full history (audit is another screen). */
const RECENT_ACTION_LIMIT = 20;

/**
 * Member detail, or `null`. Not thrown so the route decides (404). A deleted member and an unknown
 * id are the same 404, or the response would reveal that the id existed (same as public profiles).
 */
export async function readAdminMemberDetail(
	memberId: string,
): Promise<AdminMemberDetailDto | null> {
	const [row] = await db
		.select({
			id: member.id,
			nickname: member.nickname,
			bio: member.bio,
			avatarUrl: member.avatar_url,
			status: member.status,
			role: member.role,
			ageStatus: member.age_status,
			verified: member.verified,
			adult: member.adult,
			showAdult: member.show_adult,
			managedGenerationAllowed: member.managed_generation_allowed,
			createdAt: member.created_at,
			/**
			 * Email: the only place this file returns the column. Support handling needs it, which is why
			 * the calling route leaves an audit row. Password hashes, session tokens and social provider ids
			 * are not here; no operator needs them and they would eventually be drawn.
			 */
			email: user.email,
		})
		.from(member)
		.leftJoin(user, eq(member.user_id, user.id))
		.where(eq(member.id, memberId))
		.limit(1);
	if (!row) return null;

	const [followers, stories, restrictions, actions] = await Promise.all([
		db
			.select({ value: count() })
			.from(follow)
			.where(eq(follow.creator, memberId)),
		db.select({ value: count() }).from(story).where(eq(story.owner, memberId)),
		db
			.select({
				id: member_restriction.id,
				capability: member_restriction.capability,
				actionId: member_restriction.action_id,
				createdAt: member_restriction.created_at,
				expiresAt: member_restriction.expires_at,
			})
			.from(member_restriction)
			.where(activeRestriction(memberId))
			.orderBy(desc(member_restriction.created_at)),
		db
			.select({
				id: moderation_action.id,
				caseId: moderation_action.case_id,
				kind: moderation_action.kind,
				reason: moderation_action.reason,
				publicReason: moderation_action.public_reason,
				createdAt: moderation_action.created_at,
				reversedBy: moderation_action.reversed_by,
			})
			.from(moderation_action)
			.where(eq(moderation_action.target_member, memberId))
			.orderBy(desc(moderation_action.created_at))
			.limit(RECENT_ACTION_LIMIT),
	]);

	return {
		profile: {
			id: row.id,
			nickname: row.nickname,
			bio: row.bio,
			avatarUrl: row.avatarUrl,
			followers: followers[0]?.value ?? 0,
			stories: stories[0]?.value ?? 0,
		},
		operator: {
			/** Empty string when the auth row is missing mid-state; not invented. */
			email: row.email ?? "",
			status: row.status as MemberStatus,
			role: row.role as MemberRole,
			ageStatus: row.ageStatus,
			verified: row.verified,
			adult: row.adult,
			showAdult: row.showAdult,
			managedGenerationAllowed: row.managedGenerationAllowed,
			createdAt: row.createdAt.toISOString(),
		},
		restrictions: restrictions.map((r) => ({
			id: r.id,
			capability: r.capability as ModerationCapability,
			actionId: r.actionId,
			createdAt: r.createdAt.toISOString(),
			expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
		})),
		recentActions: actions.map((a) => ({
			id: a.id,
			caseId: a.caseId,
			kind: a.kind,
			reason: a.reason,
			publicReason: a.publicReason,
			createdAt: a.createdAt.toISOString(),
			reversedByActionId: a.reversedBy,
		})),
	};
}
