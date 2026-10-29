import {
	APPEAL_ERROR_CODE,
	type AppealStatus,
	isAppealableActionKind,
	MODERATION_MAX_PAGE_SIZE,
	type ModerationActionDto,
	type ModerationActionKind,
	type ModerationActionRequest,
	type ModerationAppealDto,
	type ModerationCapability,
	type ModerationReportDetailDto,
	type ModerationReportSummaryDto,
	type ModerationTargetCurrentDto,
	MY_REPORTS_MAX_PAGE_SIZE,
	type MyModerationStatusDto,
	type MyReportDto,
	type MyReportsPage,
	myReportStateOf,
	REPORT_ERROR_CODE,
	type ReportCreateRequest,
	ReportEvidence,
	type ReportStatus,
	type ReportTargetType,
} from "@rowcat/contracts";
import { isStoryDirectlyViewable } from "@rowcat/domain";
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNull,
	type SQL,
	sql,
} from "drizzle-orm";
import { type Db, db } from "../db/client.ts";
import {
	member,
	member_restriction,
	moderation_action,
	moderation_appeal,
	moderation_case,
	moderation_report,
	story,
} from "../db/schema.ts";
import { decodeTimelineCursor, encodeTimelineCursor } from "../lib/cursor.ts";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors.ts";
import { newId } from "../lib/id.ts";
import { isUniqueViolation } from "../lib/pg-error.ts";
import { checkRateLimit } from "../lib/rate-limit/index.ts";
import { getPublicProfile } from "./account/profile.ts";
import {
	deleteStoryComment,
	getStoryCommentById,
	getStoryCommentSnapshot,
} from "./comments.ts";
import { createNotification, notificationSourceKey } from "./notifications.ts";
import {
	type GallerySelector,
	getStory,
	getStoryForModeration,
	setStoryHidden,
} from "./story/index.ts";

/**
 * Moderation rules: report intake, queue, enforcement and appeals. Routes authenticate (operator
 * gate) and validate, then call here.
 *
 * Enforcement moves several tables at once (action row plus member status, story hidden flag,
 * comment deletion, restriction row), so it lives here rather than in routes, where a partial
 * success could stay committed.
 *
 * - A report is not enforcement: `createReport` only files the report and attaches it to a case.
 *
 * - Actions are never edited. `reverseAction` writes a new row and only fills the original's
 *   `reversed_by`.
 *
 * - `member.status` and the action ledger cannot diverge: every path touching an account axis
 *   calls `recomputeMemberStatus` in the same transaction.
 *
 * - Reversing one action never ignores other active ones: status is recomputed from what remains,
 *   and a story stays hidden while another hide action is active.
 *
 * - Evidence is read before it is deleted: comment removal is `DELETE ... RETURNING`.
 *
 * Deliberately absent:
 *
 * - Body logging. Report details, evidence, comment text and appeal text stay out of ops logs;
 *   diagnostics use report, case and action ids and the target kind.
 *
 * - Outbound notification (mail, push). The in-app notification INSERT is not that: it runs in
 *   the enforcement transaction, and the call sites in `executeAction` and `resolveAppeal` show
 *   which action notifies what, with no dispatcher hiding the wiring.
 *
 * - Automatic judgment (LLM classification, auto-block, risk scores).
 *
 * - Re-implementing visibility. "Can this person see this story" is answered by `getStory`.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Visibility selector for the single-item path (built by the route's `lookupSelector`). */
export type StoryVisibilitySelector = Omit<
	GallerySelector,
	"favoritedBy" | "followingOf" | "creatorId"
>;

/**
 * Finds the target's open case, creating one if absent.
 *
 * One case per target keeps contradictory actions from piling up on the same story and gives
 * actions a single place to attach.
 *
 * Races end at the unique index: the loser catches the violation and re-reads the winner's row.
 *
 * `ai_response` has no target id, so the partial index (`target_id is not null`) never applies and
 * each such report gets its own case.
 */
async function findOrCreateOpenCase(
	tx: Tx,
	targetType: ReportTargetType,
	targetId: string | null,
): Promise<string> {
	if (targetId !== null) {
		const [existing] = await tx
			.select({ id: moderation_case.id })
			.from(moderation_case)
			.where(
				and(
					eq(moderation_case.target_type, targetType),
					eq(moderation_case.target_id, targetId),
					eq(moderation_case.status, "open"),
				),
			)
			.limit(1);
		if (existing) return existing.id;
	}

	const id = newId();
	try {
		await tx
			.insert(moderation_case)
			.values({ id, target_type: targetType, target_id: targetId });
		return id;
	} catch (error) {
		if (targetId === null || !isUniqueViolation(error)) throw error;
		const [raced] = await tx
			.select({ id: moderation_case.id })
			.from(moderation_case)
			.where(
				and(
					eq(moderation_case.target_type, targetType),
					eq(moderation_case.target_id, targetId),
					eq(moderation_case.status, "open"),
				),
			)
			.limit(1);
		if (!raced) throw error;
		return raced.id;
	}
}

/*
 * Burst and targeted-report defence belongs to the shared limiter
 * (`RATE_LIMIT_POLICIES.reportCreate`: 10 per 10 minutes per reporter); this file holds no
 * counters. The window is longer and the cap lower than for comments because reports consume human
 * review time.
 */

export interface CreateReportOptions {
	/** Member id resolved from the session; no request body value can reach it. */
	reporterId: string;
	/** Selector for story visibility; runs the same predicate as the detail view. */
	selector: StoryVisibilitySelector;
	request: ReportCreateRequest;
}

/**
 * Files one report; never enforces.
 *
 * Order is policy: rate limit, target check plus snapshot, duplicate check, then attach to a case
 * and store. For public targets the evidence comes from the row the server just read, since
 * evidence a reporter can invent is not evidence.
 *
 * Every target-check failure is the same 404; separating hidden from nonexistent stories would leak
 * existence through the report path.
 */
export async function createReport({
	reporterId,
	selector,
	request,
}: CreateReportOptions): Promise<{ reportId: string; createdAt: Date }> {
	await checkRateLimit("reportCreate", reporterId);

	const { targetType, targetId, evidence } = await resolveReportTarget(
		reporterId,
		selector,
		request,
	);

	if (targetId !== null)
		await assertNoOpenDuplicate(reporterId, targetType, targetId);

	const reportId = newId();
	const createdAt = await db.transaction(async (tx) => {
		const caseId = await findOrCreateOpenCase(tx, targetType, targetId);
		try {
			const [row] = await tx
				.insert(moderation_report)
				.values({
					id: reportId,
					case_id: caseId,
					reporter: reporterId,
					target_type: targetType,
					target_id: targetId,
					reason: request.reason,
					details: request.details,
					evidence,
				})
				.returning({ createdAt: moderation_report.created_at });
			if (!row) throw new Error("the report was not saved");
			// Bumps the case's activity time so operators can see it is still live; same transaction as the
			// report.
			await tx
				.update(moderation_case)
				.set({ updated_at: new Date() })
				.where(eq(moderation_case.id, caseId));
			return row.createdAt;
		} catch (error) {
			// A duplicate slipped in between the check and the INSERT; the constraint is the final
			// authority.
			if (isUniqueViolation(error)) throw duplicateReport();
			throw error;
		}
	});

	return { reportId, createdAt };
}

const duplicateReport = () =>
	new ApiError(
		409,
		REPORT_ERROR_CODE.duplicate,
		"You've already reported this, and it's still under review.",
	);

async function assertNoOpenDuplicate(
	reporterId: string,
	targetType: ReportTargetType,
	targetId: string,
): Promise<void> {
	const [existing] = await db
		.select({ id: moderation_report.id })
		.from(moderation_report)
		.where(
			and(
				eq(moderation_report.reporter, reporterId),
				eq(moderation_report.target_type, targetType),
				eq(moderation_report.target_id, targetId),
				eq(moderation_report.status, "open"),
			),
		)
		.limit(1);
	if (existing) throw duplicateReport();
}

/**
 * Validates the target and builds the evidence snapshot.
 *
 * Public targets are snapshotted by the server with only the minimum needed to say what was
 * reported; email, adult-verification axes, member status and the sync keyring never enter a
 * snapshot. `ai_response` alone uses device-supplied evidence, since the conversation is E2EE and
 * the server sees nothing; the contract's `.strict()` shape keeps the whole room or memories from
 * riding along.
 */
async function resolveReportTarget(
	reporterId: string,
	selector: StoryVisibilitySelector,
	request: ReportCreateRequest,
): Promise<{
	targetType: ReportTargetType;
	targetId: string | null;
	evidence: ReportEvidence;
}> {
	const target = request.target;
	switch (target.type) {
		case "story": {
			const found = await requireReportableStory(target.storyId, selector);
			return {
				targetType: "story",
				targetId: found.id,
				evidence: {
					type: "story",
					snapshot: {
						title: found.title,
						description: found.description,
						adult: found.adult,
						updatedAt: found.updatedAt,
					},
				},
			};
		}
		case "comment": {
			// Story boundary first: a comment on an unviewable story must not reveal that it exists.
			await requireReportableStory(target.storyId, selector);
			const comment = await getStoryCommentSnapshot(
				target.storyId,
				target.commentId,
			);
			if (!comment) throw notFound("Comment not found.");
			return {
				targetType: "comment",
				targetId: comment.id,
				evidence: {
					type: "comment",
					snapshot: {
						body: comment.body,
						authorId: comment.authorId,
						storyId: comment.storyId,
						createdAt: comment.createdAt.toISOString(),
					},
				},
			};
		}
		case "member": {
			/**
			 * Rejected as a meaningless request, not a security decision; nothing relies on it, so the line
			 * can go if a legitimate reason appears.
			 */
			if (target.memberId === reporterId)
				throw new ApiError(
					400,
					REPORT_ERROR_CODE.selfTarget,
					"You can't report yourself.",
				);
			const profile = await getPublicProfile(target.memberId);
			if (!profile) throw notFound("Member not found.");
			return {
				targetType: "member",
				targetId: profile.id,
				evidence: {
					type: "member",
					// Public profile projection as-is; private account data has no slot here.
					snapshot: {
						displayName: profile.displayName,
						bio: profile.bio ?? "",
					},
				},
			};
		}
		case "ai_response":
			return {
				targetType: "ai_response",
				targetId: null,
				evidence: { type: "ai_response", snapshot: target.evidence },
			};
	}
}

/**
 * A story that can be reported: the detail view's predicate plus public visibility.
 *
 * Mirrors `requireCommentableStory`: a private story is viewable only by its owner, so there is no
 * public norm to judge. Unlike comments, the error code is not split: anyone can probe arbitrary
 * ids here, so a differing response would be an existence detector.
 */
async function requireReportableStory(
	storyId: string,
	selector: StoryVisibilitySelector,
): Promise<{
	id: string;
	title: string;
	description: string;
	adult: boolean;
	updatedAt: string;
}> {
	const found = await getStory(storyId, selector);
	if (!found || !isStoryDirectlyViewable(found.visibility))
		throw notFound("Story not found.");
	return {
		id: found.id,
		title: found.title,
		description: found.description,
		adult: found.adult,
		updatedAt: found.updatedAt,
	};
}

const toSummary = (row: {
	id: string;
	caseId: string;
	targetType: string;
	targetId: string | null;
	reason: string;
	status: string;
	createdAt: Date;
	caseReportCount: number;
}): ModerationReportSummaryDto => ({
	id: row.id,
	caseId: row.caseId,
	targetType: row.targetType as ReportTargetType,
	targetId: row.targetId,
	reason: row.reason as ModerationReportSummaryDto["reason"],
	status: row.status as ReportStatus,
	createdAt: row.createdAt.toISOString(),
	caseReportCount: row.caseReportCount,
});

/**
 * One queue page, oldest first, so the longest-waiting report is never pushed down while new ones
 * pile up.
 *
 * Per-case report count is a correlated subquery because it is a volume signal operators scan in
 * the list; there is no counter column, to avoid drift.
 */
export async function listReports(query: {
	status: ReportStatus;
	targetType: ReportTargetType | "";
	cursor: string;
	limit: number;
}): Promise<{
	items: ModerationReportSummaryDto[];
	nextCursor: string | null;
}> {
	const take = Math.min(Math.max(1, query.limit), MODERATION_MAX_PAGE_SIZE);
	const after = query.cursor ? decodeTimelineCursor(query.cursor) : null;

	/**
	 * Report count of the same case: a correlated subquery whose names are written by hand.
	 *
	 * In a column-position `sql` template drizzle emits column references without table qualification,
	 * so `where r.case_id = ${moderation_report.case_id}` becomes `"case_id" = "case_id"`, always
	 * true, and every row got the total report count. That passed types and tests. Interpolating the
	 * outer table object forces `"moderation_report".case_id`; `alias()` does not help because inside
	 * `sql` it emits only the alias name.
	 *
	 * Verified by `routes/reports.test.ts`, which creates two cases and checks each count.
	 */
	const caseReportCount =
		sql<number>`(select count(*) from ${moderation_report} sibling where sibling.case_id = ${moderation_report}.case_id)`
			.mapWith(Number)
			.as("case_report_count");

	const rows = await db
		.select({
			id: moderation_report.id,
			caseId: moderation_report.case_id,
			targetType: moderation_report.target_type,
			targetId: moderation_report.target_id,
			reason: moderation_report.reason,
			status: moderation_report.status,
			createdAt: moderation_report.created_at,
			caseReportCount,
		})
		.from(moderation_report)
		.where(
			and(
				eq(moderation_report.status, query.status),
				query.targetType
					? eq(moderation_report.target_type, query.targetType)
					: undefined,
				after
					? sql`(${moderation_report.created_at}, ${moderation_report.id}) > (${after.createdAt}::timestamptz, ${after.id}::text)`
					: undefined,
			),
		)
		.orderBy(asc(moderation_report.created_at), asc(moderation_report.id))
		.limit(take + 1);

	const page = rows.slice(0, take);
	const last = page[page.length - 1];
	return {
		items: page.map(toSummary),
		nextCursor: rows.length > take && last ? encodeTimelineCursor(last) : null,
	};
}

/**
 * Report detail, split three ways: the snapshot (what was reported then), the current record, and
 * the case's action history.
 *
 * Operators need to know which they are looking at; in particular `ai_response` evidence is a
 * private conversation the user uploaded, so that fact must be in the data for the screen to draw
 * it differently. A null current record (comment or story already gone) is judging material, not
 * something to hide.
 */
export async function getReportDetail(
	reportId: string,
): Promise<ModerationReportDetailDto | null> {
	const [report] = await db
		.select()
		.from(moderation_report)
		.where(eq(moderation_report.id, reportId))
		.limit(1);
	if (!report) return null;

	const [caseReports, caseActions, current] = await Promise.all([
		listCaseReports(report.case_id),
		listCaseActions(report.case_id),
		loadCurrentTarget(report.target_type as ReportTargetType, report.target_id),
	]);

	/**
	 * Re-validate stored evidence on read: jsonb carries no schema guarantee (the contract only checks
	 * the write boundary) and older reports may differ. Throwing surfaces that; drawing empty evidence
	 * would make operators think there is none.
	 */
	const evidence = ReportEvidence.parse(report.evidence);

	return {
		id: report.id,
		caseId: report.case_id,
		targetType: report.target_type as ReportTargetType,
		targetId: report.target_id,
		reason: report.reason as ModerationReportDetailDto["reason"],
		details: report.details,
		status: report.status as ReportStatus,
		createdAt: report.created_at.toISOString(),
		reporterId: report.reporter,
		evidence,
		current,
		caseReports,
		caseActions,
	};
}

async function listCaseReports(
	caseId: string,
): Promise<ModerationReportSummaryDto[]> {
	const rows = await db
		.select({
			id: moderation_report.id,
			caseId: moderation_report.case_id,
			targetType: moderation_report.target_type,
			targetId: moderation_report.target_id,
			reason: moderation_report.reason,
			status: moderation_report.status,
			createdAt: moderation_report.created_at,
		})
		.from(moderation_report)
		.where(eq(moderation_report.case_id, caseId))
		.orderBy(asc(moderation_report.created_at));
	return rows.map((row) => toSummary({ ...row, caseReportCount: rows.length }));
}

const toActionDto = (
	row: typeof moderation_action.$inferSelect,
): ModerationActionDto => ({
	id: row.id,
	kind: row.kind as ModerationActionKind,
	actorId: row.actor,
	targetMemberId: row.target_member,
	targetStoryId: row.target_story,
	targetCommentId: row.target_comment_id,
	capability: (row.capability as ModerationCapability | null) ?? null,
	reason: row.reason,
	publicReason: row.public_reason,
	createdAt: row.created_at.toISOString(),
	expiresAt: row.expires_at?.toISOString() ?? null,
	reversedByActionId: row.reversed_by,
});

async function listCaseActions(caseId: string): Promise<ModerationActionDto[]> {
	const rows = await db
		.select()
		.from(moderation_action)
		.where(eq(moderation_action.case_id, caseId))
		.orderBy(asc(moderation_action.created_at));
	return rows.map(toActionDto);
}

/**
 * Current record, read with the operator's view (no visibility gate): a hidden story must stay
 * visible in review or nobody can decide whether to unhide it. Only routes already past
 * `requireModeratorViewer` reach this.
 *
 * Only the member record carries `status`: an operator-axis value that never appears on public
 * profiles but is the basis for "is this account already suspended".
 */
async function loadCurrentTarget(
	targetType: ReportTargetType,
	targetId: string | null,
): Promise<ModerationTargetCurrentDto | null> {
	if (!targetId) return null;
	switch (targetType) {
		case "story": {
			const found = await getStoryForModeration(targetId);
			return found
				? {
						type: "story",
						id: found.id,
						title: found.title,
						description: found.description,
						adult: found.adult,
						hidden: found.hidden,
						visibility: found.visibility,
						ownerId: found.ownerId,
						updatedAt: found.updatedAt.toISOString(),
					}
				: null;
		}
		case "comment": {
			const comment = await getStoryCommentById(targetId);
			return comment
				? {
						type: "comment",
						id: comment.id,
						storyId: comment.storyId,
						authorId: comment.authorId,
						body: comment.body,
						createdAt: comment.createdAt.toISOString(),
					}
				: null;
		}
		case "member": {
			const [row] = await db
				.select({
					id: member.id,
					displayName: member.nickname,
					bio: member.bio,
					status: member.status,
				})
				.from(member)
				.where(eq(member.id, targetId))
				.limit(1);
			return row
				? {
						type: "member",
						id: row.id,
						displayName: row.displayName,
						bio: row.bio,
						status: row.status as "approved" | "suspended" | "banned",
					}
				: null;
		}
		default:
			return null;
	}
}

/**
 * Closes a report as resolved or dismissed.
 *
 * The case closes too, but only when it has no other open reports; otherwise unreviewed reports
 * would vanish silently.
 *
 * The reporter notification is inside the same transaction because this transition is the event the
 * reporter is waiting for; outside it, either "closed but no notification" or "notified but still
 * `Under review`" could stay committed. It attaches to the report transition rather than case closure: a
 * case closes only with its last report, which would make earlier reporters wait and require
 * reading the whole reporter list.
 *
 * `notifySocialEvent` is not used: its self and block gates are rules for events with an actor, and
 * here the reviewing operator's identity does not go out (same reason as enforcement
 * notifications). The block gate would let a reporter who blocked that operator miss the completion
 * notice.
 *
 * A reporter who deleted their account (NULL) gets no notification and the close still succeeds;
 * erased identity is not resurrected to notify.
 */
export async function resolveReport(options: {
	reportId: string;
	resolverId: string;
	status: "resolved" | "dismissed";
	note: string;
}): Promise<boolean> {
	return db.transaction(async (tx) => {
		await assertMayResolveReport(tx, options.reportId, options.resolverId);
		/**
		 * The conditional `status = 'open'` UPDATE solves idempotency and races together: a retry that
		 * lost its response updates 0 rows and returns `false` (the route maps it to 404), and of two
		 * operators closing the same report only one passes. The notification sits behind that return, so
		 * both cases yield one notification.
		 */
		const [updated] = await tx
			.update(moderation_report)
			.set({
				status: options.status,
				resolved_at: new Date(),
				resolver: options.resolverId,
				resolution_note: options.note,
			})
			.where(
				and(
					eq(moderation_report.id, options.reportId),
					eq(moderation_report.status, "open"),
				),
			)
			.returning({
				caseId: moderation_report.case_id,
				reporter: moderation_report.reporter,
			});
		if (!updated) return false;

		const [remaining] = await tx
			.select({ n: count() })
			.from(moderation_report)
			.where(
				and(
					eq(moderation_report.case_id, updated.caseId),
					eq(moderation_report.status, "open"),
				),
			);
		if ((remaining?.n ?? 0) === 0)
			await tx
				.update(moderation_case)
				.set({ status: options.status, updated_at: new Date() })
				.where(eq(moderation_case.id, updated.caseId));

		/**
		 * The disposition (`options.status`) is deliberately absent from the notification: one kind that
		 * says only "review finished". Splitting resolved from dismissed would make it a disposition
		 * notice from which the reporter infers what happened to the other party.
		 */
		if (updated.reporter)
			await createNotification(tx, {
				recipientId: updated.reporter,
				kind: "report_reviewed",
				sourceKey: notificationSourceKey.reportReviewed(options.reportId),
			});
		return true;
	});
}

const REVERSAL_KIND: Partial<
	Record<ModerationActionKind, ModerationActionKind>
> = {
	hide_story: "unhide_story",
	suspend_member: "restore_member",
	ban_member: "restore_member",
	restrict_capability: "unrestrict_capability",
};

/**
 * Recomputes account status from the action ledger.
 *
 * `member.status` is the fast gate write paths read per request; the ledger is the authority.
 * Divergence leaves a lifted suspension blocking or the reverse, with no visible symptom. So every
 * path touching the account axis calls this in the same transaction, and no function takes a status
 * and writes it verbatim: a caller writing "approved because this action was reversed" would ignore
 * other active actions.
 *
 * Ban wins over suspension, so lifting one suspension never demotes a banned account.
 */
async function recomputeMemberStatus(
	tx: Tx,
	memberId: string,
): Promise<"approved" | "suspended" | "banned"> {
	const rows = await tx
		.select({ kind: moderation_action.kind })
		.from(moderation_action)
		.where(
			and(
				eq(moderation_action.target_member, memberId),
				isNull(moderation_action.reversed_by),
				inArray(moderation_action.kind, ["suspend_member", "ban_member"]),
			),
		);
	const status = rows.some((row) => row.kind === "ban_member")
		? "banned"
		: rows.some((row) => row.kind === "suspend_member")
			? "suspended"
			: "approved";
	await tx.update(member).set({ status }).where(eq(member.id, memberId));
	return status;
}

interface InsertActionInput {
	caseId: string;
	actorId: string;
	kind: ModerationActionKind;
	reason: string;
	publicReason: string;
	targetMember?: string | null;
	targetStory?: string | null;
	targetCommentId?: string | null;
	commentSnapshot?: unknown;
	capability?: ModerationCapability | null;
	expiresAt?: Date | null;
}

async function insertAction(
	tx: Tx,
	input: InsertActionInput,
): Promise<typeof moderation_action.$inferSelect> {
	const [row] = await tx
		.insert(moderation_action)
		.values({
			id: newId(),
			case_id: input.caseId,
			actor: input.actorId,
			kind: input.kind,
			reason: input.reason,
			public_reason: input.publicReason,
			target_member: input.targetMember ?? null,
			target_story: input.targetStory ?? null,
			target_comment_id: input.targetCommentId ?? null,
			comment_snapshot: input.commentSnapshot ?? null,
			capability: input.capability ?? null,
			expires_at: input.expiresAt ?? null,
		})
		.returning();
	if (!row) throw new Error("the action was not recorded");
	return row;
}

/**
 * Tells the enforcement target about the action, without the operator's identity.
 *
 * Never pass `actorId`: it would go out as `actor` in the list response and hand the sanctioned
 * person the operator's name and profile address. Only an action reference goes out, and only the
 * public reason is read from it (`NotificationActionDto` has no slot for the internal `reason`).
 *
 * Actions without a target pass silently; a story hidden after its owner deleted the account
 * (`owner` NULL) has nobody to tell. Reversals use this too, so no code path can attach the
 * operator on one side only.
 */
async function notifyTargetMember(
	tx: Tx,
	action: typeof moderation_action.$inferSelect,
	kind: "moderation_action" | "moderation_reversed",
): Promise<void> {
	if (!action.target_member) return;
	await createNotification(tx, {
		recipientId: action.target_member,
		kind,
		sourceKey:
			kind === "moderation_action"
				? notificationSourceKey.actionApplied(action.id)
				: notificationSourceKey.actionReversed(action.id),
		moderationActionId: action.id,
	});
}

/**
 * Reverses one action without editing the record: insert the reversal as a new row, fill the
 * original's `reversed_by` (it is now inactive), then undo the effect while respecting remaining
 * active actions. A story with another active hide stays hidden and status is recomputed from what
 * remains; writing "reversed, so back to normal" would silently void independent enforcement.
 *
 * Notifications are not created here because the two callers tell the user different things: a
 * direct operator reversal sends `moderation_reversed`, while appeal acceptance sends only
 * `appeal_resolved` (the lifting is part of that result). Notifying here would make an accepted
 * appeal two rows; keeping it at the call site prevents that structurally.
 */
async function reverseAction(
	tx: Tx,
	original: typeof moderation_action.$inferSelect,
	actorId: string,
	reason: string,
	publicReason: string,
): Promise<typeof moderation_action.$inferSelect> {
	const kind = REVERSAL_KIND[original.kind as ModerationActionKind];
	if (!kind)
		throw badRequest("This action can't be reversed.", "action_not_reversible");

	const reversal = await insertAction(tx, {
		caseId: original.case_id,
		actorId,
		kind,
		reason,
		publicReason,
		targetMember: original.target_member,
		targetStory: original.target_story,
		capability: (original.capability as ModerationCapability | null) ?? null,
	});

	await tx
		.update(moderation_action)
		.set({ reversed_by: reversal.id })
		.where(eq(moderation_action.id, original.id));

	switch (original.kind) {
		case "hide_story": {
			if (!original.target_story) break;
			/**
			 * Another active hide action on the same story keeps it hidden: the story may have been hidden
			 * by two cases, and reversing one must not void the other.
			 */
			const [other] = await tx
				.select({ id: moderation_action.id })
				.from(moderation_action)
				.where(
					and(
						eq(moderation_action.target_story, original.target_story),
						eq(moderation_action.kind, "hide_story"),
						isNull(moderation_action.reversed_by),
					),
				)
				.limit(1);
			if (!other) await setStoryHidden(tx, original.target_story, false);
			break;
		}
		case "suspend_member":
		case "ban_member":
			if (original.target_member)
				await recomputeMemberStatus(tx, original.target_member);
			break;
		case "restrict_capability":
			/**
			 * Only the restriction this action created is lifted; a restriction from another action keeps
			 * the gate closed (the capability-axis form of respecting remaining active actions).
			 */
			await tx
				.update(member_restriction)
				.set({ revoked_at: new Date() })
				.where(
					and(
						eq(member_restriction.action_id, original.id),
						isNull(member_restriction.revoked_at),
					),
				);
			break;
	}

	return reversal;
}

/**
 * Executes an action: the only write path of the operator API.
 *
 * The target comes from the case, not the request. A request carrying a story or member id could
 * enforce against something unrelated to the case under review, with no report behind it.
 *
 * One transaction covers the action row and its effect (hide, delete, status, restriction); a split
 * would leave "blocked but unrecorded" or the reverse committed, making the audit record
 * untrustworthy.
 */
export async function executeAction(options: {
	actorId: string;
	request: ModerationActionRequest;
}): Promise<ModerationActionDto> {
	const { actorId, request } = options;

	return db.transaction(async (tx) => {
		const [caseRow] = await tx
			.select()
			.from(moderation_case)
			.where(eq(moderation_case.id, request.caseId))
			.limit(1);
		if (!caseRow) throw notFound("Case not found.");

		const common = {
			caseId: caseRow.id,
			actorId,
			reason: request.reason,
			publicReason: request.publicReason,
		};

		switch (request.kind) {
			case "hide_story": {
				const storyId = requireCaseTarget(caseRow, "story");
				const updated = await setStoryHidden(tx, storyId, true);
				if (!updated) throw notFound("Story not found.");
				const action = await insertAction(tx, {
					...common,
					kind: "hide_story",
					targetStory: storyId,
					/**
					 * The owner becomes `target_member`: appeal ownership checks read this one column, and the
					 * notification recipient is the same column. A story whose identity was erased by account
					 * deletion is null, so nobody can appeal or be notified (the correct state).
					 */
					targetMember: updated.ownerId,
				});
				await notifyTargetMember(tx, action, "moderation_action");
				return toActionDto(action);
			}
			case "remove_comment": {
				const commentId = requireCaseTarget(caseRow, "comment");
				/**
				 * Delete and receive the original text in one statement. It runs before the action INSERT in
				 * the same transaction, so a failing INSERT rolls the delete back; a comment deleted without
				 * evidence cannot commit.
				 *
				 * A top-level comment that still has replies becomes a tombstone: moderator deletion passes the
				 * same structural rule as author deletion (same function). Removing a violating comment must
				 * not also delete other people's replies, a disposition outside this action's vocabulary and
				 * irreversible.
				 *
				 * The audit snapshot is read from the locked row, so tombstone or physical delete leave the
				 * same snapshot and the code below does not branch; leaking that split into the action kind
				 * would make `remove_comment` two dispositions.
				 */
				const snapshot = await deleteStoryComment(
					{ kind: "moderator", commentId },
					tx,
				);
				if (!snapshot) throw notFound("Comment not found.");
				const action = await insertAction(tx, {
					...common,
					kind: "remove_comment",
					targetCommentId: snapshot.id,
					targetMember: snapshot.authorId,
					commentSnapshot: {
						body: snapshot.body,
						authorId: snapshot.authorId,
						storyId: snapshot.storyId,
						createdAt: snapshot.createdAt.toISOString(),
					},
				});
				/**
				 * Notify the author without the body: the original lives only in the action snapshot (audit),
				 * and a copy in the notification would keep the removed text alive in the inbox.
				 */
				await notifyTargetMember(tx, action, "moderation_action");
				return toActionDto(action);
			}
			case "suspend_member":
			case "ban_member": {
				const memberId = await resolveCaseMember(tx, caseRow);
				await assertAccountActionAllowed(tx, actorId, memberId);
				const action = await insertAction(tx, {
					...common,
					kind: request.kind,
					targetMember: memberId,
				});
				// Ledger first, then derive status from it.
				await recomputeMemberStatus(tx, memberId);
				/**
				 * Suspended and banned accounts can still read this notification; the notification router's
				 * gate is `requireViewer` for exactly this reason, since sanctioned people most need to read
				 * why.
				 */
				await notifyTargetMember(tx, action, "moderation_action");
				return toActionDto(action);
			}
			case "restrict_capability": {
				const capability = request.capability;
				if (!capability)
					throw badRequest(
						"You must specify the feature to restrict.",
						"capability_required",
					);
				const memberId = await resolveCaseMember(tx, caseRow);
				await assertAccountActionAllowed(tx, actorId, memberId);
				const expiresAt = request.expiresAt
					? new Date(request.expiresAt)
					: null;
				const action = await insertAction(tx, {
					...common,
					kind: "restrict_capability",
					targetMember: memberId,
					capability,
					expiresAt,
				});
				await tx.insert(member_restriction).values({
					id: newId(),
					member_id: memberId,
					capability,
					action_id: action.id,
					expires_at: expiresAt,
				});
				await notifyTargetMember(tx, action, "moderation_action");
				return toActionDto(action);
			}
			case "unhide_story":
			case "restore_member":
			case "unrestrict_capability": {
				/**
				 * Direct operator reversal: reverses every active action on that axis, unlike appeal
				 * acceptance, which reverses one. Partial reversal would show "lifted" on screen while the gate
				 * still blocks.
				 */
				const originals = await activeActionsForReversal(
					tx,
					caseRow,
					request.kind,
					request.capability,
				);
				if (!originals.length)
					throw notFound(
						"There is no active action to reverse.",
						"action_not_found",
					);
				/**
				 * Lifting goes through the same gate as imposing. While the check existed only on enforcement,
				 * a capability-restricted staff member passed `requireActiveViewer` (a restriction is not a
				 * suspension) and lifted their own restriction, and could lift sanctions an admin placed on
				 * other staff.
				 *
				 * The subject is the member the actions point at, not the case (the account axis was already
				 * narrowed to that member by `activeActionsForReversal`). Unhiding is not an account action and
				 * skips the role rule, blocking only your own story; imposing a hide has no role rule either,
				 * so adding one only to lifting would desync the two.
				 */
				for (const targetId of new Set(
					originals.map((original) => original.target_member),
				)) {
					if (!targetId) continue;
					if (request.kind === "unhide_story")
						assertNotOwnEnforcement(actorId, targetId);
					else await assertAccountActionAllowed(tx, actorId, targetId);
				}
				let last: typeof moderation_action.$inferSelect | null = null;
				for (const original of originals)
					last = await reverseAction(
						tx,
						original,
						actorId,
						request.reason,
						request.publicReason,
					);
				if (!last) throw new Error("the reversal action was not recorded");
				/**
				 * One notification however many reversals: a single `restore_member` can lift both suspension
				 * and ban, which is one event to the user ("account restored"). Uses the same value the
				 * response returns, the last reversal.
				 */
				await notifyTargetMember(tx, last, "moderation_reversed");
				return toActionDto(last);
			}
		}
	});
}

function requireCaseTarget(
	caseRow: typeof moderation_case.$inferSelect,
	expected: ReportTargetType,
): string {
	if (caseRow.target_type !== expected || !caseRow.target_id)
		throw badRequest(
			`this action can be used only on ${expected} cases`,
			"action_target_mismatch",
		);
	return caseRow.target_id;
}

/** Account-axis actions: the kinds the target role rule (`assertAccountActionAllowed`) applies to. */
const ACCOUNT_ACTION_KINDS: ReadonlySet<string> = new Set<ModerationActionKind>(
	["suspend_member", "ban_member", "restrict_capability"],
);

/**
 * Checks the target of an account-axis action (suspend, ban, capability restriction); the actor's
 * own eligibility was already checked by the gate.
 *
 * Without this, one `staff` could report and ban the only `admin`; since every operator gate sits
 * on `requireActiveViewer`, the admin would lose the ability to reverse it, leaving only direct DB
 * access. Rules: never yourself, only admin may sanction operators, and nobody may sanction an
 * admin (admin disputes are outside this tool).
 *
 * Refused with a named code rather than a bare 404 because the recipient is an operator: existence
 * hiding protects nothing, and the reason determines the next step.
 */
async function assertAccountActionAllowed(
	tx: Tx,
	actorId: string,
	targetId: string,
): Promise<void> {
	if (actorId === targetId)
		throw forbidden(
			"You can't take account action against yourself.",
			MODERATION_TARGET_PRIVILEGED,
		);
	const rows = await tx
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(inArray(member.id, [actorId, targetId]));
	const actorRole = rows.find((r) => r.id === actorId)?.role ?? "user";
	const targetRole = rows.find((r) => r.id === targetId)?.role ?? "user";
	if (targetRole === "admin")
		throw forbidden(
			"You can't take action against an admin account.",
			MODERATION_TARGET_PRIVILEGED,
		);
	if (targetRole === "staff" && actorRole !== "admin")
		throw forbidden(
			"Only admins can take action against operator accounts.",
			MODERATION_TARGET_PRIVILEGED,
		);
}

/** Code for the refusal above; the operations console picks its guidance text from it. */
const MODERATION_TARGET_PRIVILEGED = "moderation_target_privileged";

/**
 * Closing a report is the one moderation write that had no conflict-of-interest rule. Enforcement,
 * reversal and appeals all refuse an operator acting on themselves, but a staff member could dismiss
 * every report about their own account, story or comment; the case closed and never reached an
 * admin's open queue, with the `resolver` column the only trace. The same two rules as account
 * actions apply here: never about yourself, and a report about an operator account is an admin's to
 * close.
 *
 * A report whose target is gone (deleted story, an `ai_response` case with no member) has no one to
 * protect, so it closes as before; refusing it would leave the queue holding reports nobody can
 * close.
 */
async function assertMayResolveReport(
	tx: Tx,
	reportId: string,
	resolverId: string,
): Promise<void> {
	const [row] = await tx
		.select({ caseRow: moderation_case })
		.from(moderation_report)
		.innerJoin(
			moderation_case,
			eq(moderation_case.id, moderation_report.case_id),
		)
		.where(
			and(
				eq(moderation_report.id, reportId),
				eq(moderation_report.status, "open"),
			),
		)
		.limit(1);
	/** Not open (or not there): the conditional UPDATE answers that, as before. */
	if (!row) return;
	let targetId: string;
	try {
		targetId = await resolveCaseMember(tx, row.caseRow);
	} catch (error) {
		if (error instanceof ApiError) return;
		throw error;
	}
	if (targetId === resolverId)
		throw forbidden(
			"You can't review a report about yourself.",
			MODERATION_TARGET_PRIVILEGED,
		);
	const roles = await tx
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(inArray(member.id, [resolverId, targetId]));
	const resolverRole = roles.find((r) => r.id === resolverId)?.role ?? "user";
	const targetRole = roles.find((r) => r.id === targetId)?.role ?? "user";
	if (targetRole !== "user" && resolverRole !== "admin")
		throw forbidden(
			"Only admins can review reports about operator accounts.",
			MODERATION_TARGET_PRIVILEGED,
		);
}

/**
 * Nobody lifts or processes an enforcement placed on themselves; used for non-account actions
 * (hide) and appeal handling. A conflict-of-interest rule independent of role (an admin cannot
 * process their own appeal either).
 */
function assertNotOwnEnforcement(actorId: string, targetId: string): void {
	if (actorId === targetId)
		throw forbidden(
			"You can't lift or resolve an action placed on yourself.",
			MODERATION_TARGET_PRIVILEGED,
		);
}

/**
 * Case to enforcement-target member: the member itself, the story's owner, or the comment's author.
 * A deleted comment falls back to the report evidence snapshot, which is why evidence exists;
 * otherwise there is no target.
 *
 * `ai_response` cases have no member target: the server does not know whose conversation it is
 * (E2EE), and the target is the model's response, not whoever the reporter pointed at. An account
 * action there is a mistake and is refused; silently sanctioning the reporter would be the worst
 * outcome.
 */
async function resolveCaseMember(
	tx: Tx,
	caseRow: typeof moderation_case.$inferSelect,
): Promise<string> {
	const targetId = caseRow.target_id;
	switch (caseRow.target_type) {
		case "member": {
			if (!targetId) break;
			const [row] = await tx
				.select({ id: member.id })
				.from(member)
				.where(eq(member.id, targetId))
				.limit(1);
			if (!row) throw notFound("Member not found.");
			return row.id;
		}
		case "story": {
			if (!targetId) break;
			const [row] = await tx
				.select({ owner: story.owner })
				.from(story)
				.where(eq(story.id, targetId))
				.limit(1);
			if (!row?.owner)
				throw notFound(
					"The story's owner wasn't found.",
					"action_target_missing",
				);
			return row.owner;
		}
		case "comment": {
			if (!targetId) break;
			const comment = await getStoryCommentById(targetId);
			if (comment) return comment.authorId;
			const authorId = await authorFromCaseEvidence(tx, caseRow.id);
			if (authorId) return authorId;
			throw notFound(
				"The comment's author wasn't found.",
				"action_target_missing",
			);
		}
	}
	throw badRequest(
		"This case has no target for an account action.",
		"action_target_mismatch",
	);
}

/** Author of a deleted comment, read from the case's earliest report evidence. */
async function authorFromCaseEvidence(
	tx: Tx,
	caseId: string,
): Promise<string | null> {
	const rows = await tx
		.select({ evidence: moderation_report.evidence })
		.from(moderation_report)
		.where(eq(moderation_report.case_id, caseId))
		.orderBy(asc(moderation_report.created_at))
		.limit(1);
	const parsed = ReportEvidence.safeParse(rows[0]?.evidence);
	return parsed.success && parsed.data.type === "comment"
		? parsed.data.snapshot.authorId
		: null;
}

async function activeActionsForReversal(
	tx: Tx,
	caseRow: typeof moderation_case.$inferSelect,
	reversalKind: ModerationActionKind,
	capability: ModerationCapability | undefined,
): Promise<(typeof moderation_action.$inferSelect)[]> {
	const conditions: (SQL | undefined)[] = [
		isNull(moderation_action.reversed_by),
	];

	if (reversalKind === "unhide_story") {
		const storyId = requireCaseTarget(caseRow, "story");
		conditions.push(
			eq(moderation_action.target_story, storyId),
			eq(moderation_action.kind, "hide_story"),
		);
	} else {
		const memberId = await resolveCaseMember(tx, caseRow);
		conditions.push(eq(moderation_action.target_member, memberId));
		if (reversalKind === "restore_member")
			conditions.push(
				inArray(moderation_action.kind, ["suspend_member", "ban_member"]),
			);
		else {
			conditions.push(eq(moderation_action.kind, "restrict_capability"));
			if (capability)
				conditions.push(eq(moderation_action.capability, capability));
		}
	}

	return tx
		.select()
		.from(moderation_action)
		.where(and(...conditions))
		.orderBy(asc(moderation_action.created_at));
}

/**
 * Files an appeal, only against an action that targets the caller.
 *
 * Ownership checks `target_member` alone. Following a per-kind ownership path (story owner, comment
 * author, account holder) here would eventually loosen one kind and allow appealing someone else's
 * action; the action writer already fills that column.
 *
 * Someone else's action and a nonexistent one are the same 404, so the response cannot reveal that
 * the action exists.
 */
export async function createAppeal(options: {
	memberId: string;
	actionId: string;
	message: string;
}): Promise<{ appealId: string; createdAt: Date }> {
	return db.transaction(async (tx) => {
		const [action] = await tx
			.select()
			.from(moderation_action)
			.where(
				and(
					eq(moderation_action.id, options.actionId),
					eq(moderation_action.target_member, options.memberId),
				),
			)
			.limit(1);
		if (!action) throw notFound("Action not found.");

		if (!isAppealableActionKind(action.kind as ModerationActionKind))
			throw new ApiError(
				400,
				APPEAL_ERROR_CODE.notAppealable,
				"This action can't be appealed.",
			);
		if (action.reversed_by)
			throw new ApiError(
				409,
				APPEAL_ERROR_CODE.alreadyReversed,
				"This action has already been lifted.",
			);

		const id = newId();
		try {
			const [row] = await tx
				.insert(moderation_appeal)
				.values({
					id,
					action_id: action.id,
					member_id: options.memberId,
					message: options.message,
				})
				.returning({ createdAt: moderation_appeal.created_at });
			if (!row) throw new Error("the appeal was not saved");
			return { appealId: id, createdAt: row.createdAt };
		} catch (error) {
			// One open appeal per action; the unique index is the final authority.
			if (isUniqueViolation(error))
				throw new ApiError(
					409,
					APPEAL_ERROR_CODE.duplicate,
					"An appeal for this action is already under review.",
				);
			throw error;
		}
	});
}

export async function listAppeals(query: {
	status: AppealStatus;
	cursor: string;
	limit: number;
}): Promise<{ items: ModerationAppealDto[]; nextCursor: string | null }> {
	const take = Math.min(Math.max(1, query.limit), MODERATION_MAX_PAGE_SIZE);
	const after = query.cursor ? decodeTimelineCursor(query.cursor) : null;

	const rows = await db
		.select({ appeal: moderation_appeal, action: moderation_action })
		.from(moderation_appeal)
		.innerJoin(
			moderation_action,
			eq(moderation_action.id, moderation_appeal.action_id),
		)
		.where(
			and(
				eq(moderation_appeal.status, query.status),
				after
					? sql`(${moderation_appeal.created_at}, ${moderation_appeal.id}) > (${after.createdAt}::timestamptz, ${after.id}::text)`
					: undefined,
			),
		)
		.orderBy(asc(moderation_appeal.created_at), asc(moderation_appeal.id))
		.limit(take + 1);

	const page = rows.slice(0, take);
	const last = page[page.length - 1];
	return {
		items: page.map(({ appeal, action }) => ({
			id: appeal.id,
			actionId: appeal.action_id,
			memberId: appeal.member_id,
			message: appeal.message,
			status: appeal.status as AppealStatus,
			createdAt: appeal.created_at.toISOString(),
			resolvedAt: appeal.resolved_at?.toISOString() ?? null,
			resolverId: appeal.resolver,
			resolutionNote: appeal.resolution_note,
			action: toActionDto(action),
		})),
		nextCursor:
			rows.length > take && last
				? encodeTimelineCursor({
						createdAt: last.appeal.created_at,
						id: last.appeal.id,
					})
				: null,
	};
}

/**
 * Resolves an appeal.
 *
 * Acceptance actually reverses the action (marking "accepted" while the sanction stays would not be
 * acceptance). It reverses that one action only; remaining active actions keep the status
 * (`reverseAction` upholds that). Rejection reverses nothing.
 */
export async function resolveAppeal(options: {
	appealId: string;
	resolverId: string;
	status: "accepted" | "rejected";
	note: string;
}): Promise<boolean> {
	return db.transaction(async (tx) => {
		/**
		 * The resolver must not be the appeal's party. Acceptance is a reversal and passes the same gate
		 * as enforcement; before this check, a restricted staff member could file an appeal and accept it
		 * themselves. Rejection passes the same door because who decides is set by the target, not the
		 * outcome (an account action against an operator was placed by admin, so admin judges that appeal
		 * too).
		 *
		 * Asked before the conditional UPDATE: afterwards a rejection would rely on transaction rollback
		 * to undo an already-processed row. An already-closed appeal ends as false at the UPDATE below.
		 */
		const [pending] = await tx
			.select({
				memberId: moderation_appeal.member_id,
				actionKind: moderation_action.kind,
			})
			.from(moderation_appeal)
			.innerJoin(
				moderation_action,
				eq(moderation_action.id, moderation_appeal.action_id),
			)
			.where(
				and(
					eq(moderation_appeal.id, options.appealId),
					eq(moderation_appeal.status, "open"),
				),
			)
			.limit(1);
		if (pending) {
			assertNotOwnEnforcement(options.resolverId, pending.memberId);
			if (ACCOUNT_ACTION_KINDS.has(pending.actionKind))
				await assertAccountActionAllowed(
					tx,
					options.resolverId,
					pending.memberId,
				);
		}

		const [updated] = await tx
			.update(moderation_appeal)
			.set({
				status: options.status,
				resolved_at: new Date(),
				resolver: options.resolverId,
				resolution_note: options.note,
			})
			.where(
				and(
					eq(moderation_appeal.id, options.appealId),
					eq(moderation_appeal.status, "open"),
				),
			)
			.returning({
				actionId: moderation_appeal.action_id,
				memberId: moderation_appeal.member_id,
			});
		if (!updated) return false;

		/**
		 * Notify the appellant, one row whether accepted or rejected. The conditional UPDATE guarantees
		 * we closed an open appeal, so this exists only when state actually changed; a second request
		 * updates 0 rows and returns false above.
		 *
		 * The reversal below deliberately does not create `moderation_reversed`: acceptance already
		 * includes lifting the sanction, and sending both would be two rows for one event. Only the
		 * operator's direct unlock path (the reversal branch of `executeAction`) uses that kind.
		 *
		 * The resolution note is not in the notification: the member-facing appeal type (`MyAppealDto`)
		 * has no such field, and adding it here would defeat that boundary.
		 */
		await createNotification(tx, {
			recipientId: updated.memberId,
			kind: "appeal_resolved",
			sourceKey: notificationSourceKey.appealResolved(options.appealId),
			moderationAppealId: options.appealId,
		});

		if (options.status === "rejected") return true;

		const [action] = await tx
			.select()
			.from(moderation_action)
			.where(eq(moderation_action.id, updated.actionId))
			.limit(1);
		// The operator may have lifted it while the appeal was open; nothing left to reverse.
		if (!action || action.reversed_by) return true;

		await reverseAction(
			tx,
			action,
			options.resolverId,
			`Appeal accepted: ${options.note}`.slice(0, 1_000),
			"Your appeal was accepted and the sanction was lifted.",
		);
		return true;
	});
}

/**
 * Everything currently applied to the caller, answered by the member's own resource rather than
 * `/me`.
 *
 * The internal `reason` appears nowhere; only the public reason goes out (empty means the screen
 * states the action kind alone). `appealableActionIds` is sent so the screen draws appeal buttons
 * from the server's decision; re-deciding on the client would duplicate the rule and produce
 * buttons that return 400.
 */
export async function getMyModerationStatus(
	memberId: string,
): Promise<MyModerationStatusDto> {
	const [statusRow] = await db
		.select({ status: member.status })
		.from(member)
		.where(eq(member.id, memberId))
		.limit(1);

	const [actions, restrictions, appeals] = await Promise.all([
		db
			.select()
			.from(moderation_action)
			.where(
				and(
					eq(moderation_action.target_member, memberId),
					isNull(moderation_action.reversed_by),
				),
			)
			.orderBy(asc(moderation_action.created_at)),
		db
			.select({
				capability: member_restriction.capability,
				actionId: member_restriction.action_id,
				createdAt: member_restriction.created_at,
				expiresAt: member_restriction.expires_at,
				publicReason: moderation_action.public_reason,
			})
			.from(member_restriction)
			.innerJoin(
				moderation_action,
				eq(moderation_action.id, member_restriction.action_id),
			)
			.where(
				and(
					eq(member_restriction.member_id, memberId),
					isNull(member_restriction.revoked_at),
				),
			),
		db
			.select()
			.from(moderation_appeal)
			.where(eq(moderation_appeal.member_id, memberId))
			.orderBy(asc(moderation_appeal.created_at)),
	]);

	const now = Date.now();
	const active = restrictions.filter(
		(row) => !row.expiresAt || row.expiresAt.getTime() > now,
	);

	return {
		status:
			(statusRow?.status as MyModerationStatusDto["status"]) ?? "approved",
		accountActions: actions
			.filter(
				(row) => row.kind === "suspend_member" || row.kind === "ban_member",
			)
			.map((row) => ({
				actionId: row.id,
				kind: row.kind as "suspend_member" | "ban_member",
				publicReason: row.public_reason,
				createdAt: row.created_at.toISOString(),
			})),
		restrictions: active.map((row) => ({
			capability: row.capability as ModerationCapability,
			actionId: row.actionId,
			publicReason: row.publicReason,
			createdAt: row.createdAt.toISOString(),
			expiresAt: row.expiresAt?.toISOString() ?? null,
		})),
		hiddenStories: actions
			.filter((row) => row.kind === "hide_story" && row.target_story)
			.map((row) => ({
				actionId: row.id,
				storyId: row.target_story ?? "",
				publicReason: row.public_reason,
				createdAt: row.created_at.toISOString(),
			})),
		appeals: appeals.map((row) => ({
			id: row.id,
			actionId: row.action_id,
			status: row.status as AppealStatus,
			createdAt: row.created_at.toISOString(),
			resolvedAt: row.resolved_at?.toISOString() ?? null,
		})),
		/**
		 * Actions that can be appealed: active, appealable kind, no open appeal yet. Expired capability
		 * restrictions are excluded with the same decision as the gate; an appeal against an already
		 * ineffective restriction would change nothing.
		 */
		appealableActionIds: actions
			.filter((row) => isAppealableActionKind(row.kind as ModerationActionKind))
			.filter((row) => !row.expires_at || row.expires_at.getTime() > now)
			.filter(
				(row) =>
					!appeals.some(
						(appeal) => appeal.action_id === row.id && appeal.status === "open",
					),
			)
			.map((row) => row.id),
	};
}

/**
 * One page of the caller's own reports, ownership pinned in the predicate.
 *
 * `where reporter = :reporterId` in SQL is the whole point; comparing the reporter in application
 * code after reading would return someone else's report the day a condition is dropped, and that
 * omission shows only after a leak (notification read-marking and appeal ownership use the same
 * shape). No request field can carry a member id, so "show Bob's reports" is inexpressible.
 *
 * The target is not re-queried: no `galleryWhere`, `getStory`, or joins to `story`,
 * `story_comment`, `member`. The list answers "what did I report and is review finished", all
 * available in the report row. Joining target visibility would make the history lose a row exactly
 * when an operator hides or deletes the target, and make row presence a detector of the target's
 * current state. For the same reason the response has no `targetId`.
 *
 * Cursor is `(created_at, id)` descending: two reports in the same millisecond happen in practice
 * (consecutive reports from one screen), and without the second key a row at that boundary appears
 * twice or vanishes. The column is `timestamp(3)` so the cursor's milliseconds represent it exactly
 * (`lib/cursor.ts`).
 */
export async function listMyReports(query: {
	/** Member id from the session; no request body or query value can reach it. */
	reporterId: string;
	cursor: string;
	limit: number;
}): Promise<MyReportsPage> {
	const take = Math.min(Math.max(1, query.limit), MY_REPORTS_MAX_PAGE_SIZE);
	const after = query.cursor ? decodeTimelineCursor(query.cursor) : null;

	const rows = await db
		.select({
			id: moderation_report.id,
			targetType: moderation_report.target_type,
			reason: moderation_report.reason,
			status: moderation_report.status,
			createdAt: moderation_report.created_at,
			resolvedAt: moderation_report.resolved_at,
		})
		.from(moderation_report)
		.where(
			and(
				eq(moderation_report.reporter, query.reporterId),
				after
					? sql`(${moderation_report.created_at}, ${moderation_report.id}) < (${after.createdAt}::timestamptz, ${after.id}::text)`
					: undefined,
			),
		)
		.orderBy(desc(moderation_report.created_at), desc(moderation_report.id))
		.limit(take + 1);

	const page = rows.slice(0, take);
	const last = page[page.length - 1];
	return {
		items: page.map((row) => {
			const state = myReportStateOf(row.status as ReportStatus);
			return {
				id: row.id,
				targetType: row.targetType as ReportTargetType,
				reason: row.reason as MyReportDto["reason"],
				state,
				createdAt: row.createdAt.toISOString(),
				/**
				 * Always null while still under review. The column is folded through state because the two can
				 * disagree (old data, manual fixes); a `Under review` row with a completion time would read to the user
				 * as something we did wrong.
				 */
				reviewedAt:
					state === "reviewed" ? (row.resolvedAt?.toISOString() ?? null) : null,
			};
		}),
		nextCursor: rows.length > take && last ? encodeTimelineCursor(last) : null,
	};
}
