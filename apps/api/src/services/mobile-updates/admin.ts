import {
	type AdminMobileUpdateDetailDto,
	type AdminMobileUpdateEventDto,
	type AdminMobileUpdatePage,
	type AdminMobileUpdateQuery,
	type AdminMobileUpdateReleaseDto,
	type AdminMobileUpdateRollbackPlanDto,
	type AdminMobileUpdateTransitionResponse,
	MOBILE_UPDATE_ADMIN_ERROR_CODE,
	type MobileUpdateEventAction,
	type MobileUpdateStatus,
} from "@rowcat/contracts";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
	member,
	mobile_update_release,
	mobile_update_release_event,
} from "../../db/schema.ts";
import { ApiError, badRequest, notFound } from "../../lib/errors.ts";
import { recordAudit } from "../admin/audit.ts";
import {
	MobileUpdateError,
	planRollback,
	type ReleaseSummary,
	summaryColumns,
	toSummary,
	transitionRelease,
} from "./index.ts";
import {
	activeJobFor,
	decodeMobileUpdateCursor,
	encodeMobileUpdateCursor,
	jobsForRelease,
} from "./jobs.ts";

/**
 * Console OTA reads and direct transitions, built on the same service the CLI uses: same summary
 * projection (`summaryColumns`), same rollback plan (`planRollback`), same transition table
 * (`transitionRelease`) plus the session's operator and one audit row.
 *
 * Console-only states are not redefined here: if the server computed "rolling out" or "paused", the
 * CLI's `active` and the console's would be different words, and two people would call one release
 * by different names during an incident.
 */

const toReleaseDto = (
	summary: ReleaseSummary,
): AdminMobileUpdateReleaseDto => ({
	id: summary.id,
	kind: summary.kind,
	platform: summary.platform,
	channel: summary.channel,
	runtimeVersion: summary.runtimeVersion,
	createdAt: summary.createdAt,
	registeredAt: summary.registeredAt,
	status: summary.status,
	statusChangedAt: summary.statusChangedAt,
	rolloutPercentage: summary.rolloutPercentage,
	keyIds: summary.keyIds,
	republishOf: summary.republishOf,
	sourceCommit: summary.sourceCommit,
	apiOrigin: summary.apiOrigin,
});

export async function listMobileUpdateReleases(
	query: AdminMobileUpdateQuery,
): Promise<AdminMobileUpdatePage> {
	const after = query.cursor ? decodeMobileUpdateCursor(query.cursor) : null;
	const rows = await db
		.select(summaryColumns)
		.from(mobile_update_release)
		.where(
			and(
				query.channel
					? eq(mobile_update_release.channel, query.channel)
					: undefined,
				query.platform
					? eq(mobile_update_release.platform, query.platform)
					: undefined,
				query.runtimeVersion
					? eq(mobile_update_release.runtime_version, query.runtimeVersion)
					: undefined,
				query.status
					? eq(mobile_update_release.status, query.status)
					: undefined,
				after
					? or(
							lt(mobile_update_release.created_at, after.createdAt),
							and(
								eq(mobile_update_release.created_at, after.createdAt),
								lt(mobile_update_release.id, after.id),
							),
						)
					: undefined,
			),
		)
		/** Ordered by the selection axis (signed time); id breaks ties. */
		.orderBy(
			desc(mobile_update_release.created_at),
			desc(mobile_update_release.id),
		)
		.limit(query.limit + 1);
	const page = rows.slice(0, query.limit);
	const last = page.at(-1);
	return {
		items: page.map((row) => toReleaseDto(toSummary(row))),
		nextCursor:
			rows.length > query.limit && last
				? encodeMobileUpdateCursor({ createdAt: last.createdAt, id: last.id })
				: null,
	};
}

async function readEvents(
	releaseId: string,
): Promise<AdminMobileUpdateEventDto[]> {
	const rows = await db
		.select({
			event: mobile_update_release_event,
			nickname: member.nickname,
		})
		.from(mobile_update_release_event)
		/** Left join: an operator who deleted their account must not vanish from the history. */
		.leftJoin(member, eq(mobile_update_release_event.operator_id, member.id))
		.where(eq(mobile_update_release_event.release_id, releaseId))
		.orderBy(
			mobile_update_release_event.created_at,
			mobile_update_release_event.id,
		);
	return rows.map(({ event, nickname }) => ({
		id: event.id,
		action: event.action as MobileUpdateEventAction,
		fromStatus: event.from_status as MobileUpdateStatus | null,
		toStatus: event.to_status as MobileUpdateStatus,
		fromRollout: event.from_rollout,
		toRollout: event.to_rollout,
		actor: event.actor,
		operator: event.operator_id ? { id: event.operator_id, nickname } : null,
		reason: event.reason,
		createdAt: event.created_at.toISOString(),
	}));
}

async function readReleaseDto(
	id: string,
): Promise<AdminMobileUpdateReleaseDto | null> {
	const [row] = await db
		.select(summaryColumns)
		.from(mobile_update_release)
		.where(eq(mobile_update_release.id, id));
	return row ? toReleaseDto(toSummary(row)) : null;
}

export async function readMobileUpdateRelease(
	id: string,
): Promise<AdminMobileUpdateDetailDto | null> {
	const [row] = await db
		.select({ ...summaryColumns, assets: mobile_update_release.assets })
		.from(mobile_update_release)
		.where(eq(mobile_update_release.id, id));
	if (!row) return null;
	const [events, jobs] = await Promise.all([
		readEvents(id),
		jobsForRelease(id),
	]);
	return {
		release: toReleaseDto(toSummary(row)),
		assets: {
			count: row.assets.length,
			bytes: row.assets.reduce((total, asset) => total + asset.byteSize, 0),
		},
		events,
		jobs,
	};
}

/**
 * Rollback plan: the CLI's query with a recovery name attached. `blocked` is decided first: a newer
 * active release is what clients already receive, and republishing would overwrite it. This is
 * guidance for the screen; enforcement is the job request and CI's publish tool each re-running the
 * same query.
 */
export async function readMobileUpdateRollbackPlan(
	id: string,
): Promise<AdminMobileUpdateRollbackPlanDto | null> {
	const plan = await planRollback(id);
	if (!plan) return null;
	const recovery =
		plan.newerActive.length > 0
			? "blocked"
			: plan.release.status === "draft"
				? "none"
				: plan.previousGood
					? "republish"
					: "embedded";
	return {
		release: toReleaseDto(plan.release),
		newerActive: plan.newerActive.map(toReleaseDto),
		previousGood: plan.previousGood ? toReleaseDto(plan.previousGood) : null,
		recovery,
		activeJob: await activeJobFor(plan.release.channel, plan.release.platform),
	};
}

export type OperatorTransition =
	| { action: "rollout"; percentage: number; reason: string }
	| { action: "pause"; reason: string }
	| { action: "resume"; reason: string };

/** Maps a transition-table refusal to HTTP; the sentence is the service's own (no secrets). */
function translate(error: unknown): never {
	if (error instanceof MobileUpdateError) {
		switch (error.code) {
			case "mobile_update_release_missing":
				throw notFound(
					error.message,
					MOBILE_UPDATE_ADMIN_ERROR_CODE.releaseMissing,
				);
			case "mobile_update_rollout_invalid":
				throw badRequest(
					error.message,
					MOBILE_UPDATE_ADMIN_ERROR_CODE.rolloutInvalid,
				);
			case "mobile_update_rollout_decrease":
				throw new ApiError(
					409,
					MOBILE_UPDATE_ADMIN_ERROR_CODE.rolloutDecrease,
					error.message,
				);
			default:
				throw new ApiError(
					409,
					MOBILE_UPDATE_ADMIN_ERROR_CODE.transitionInvalid,
					error.message,
				);
		}
	}
	throw error;
}

/**
 * Console transition: same table, member operator, one audit row. The operator id comes only from
 * the session (the route passes it). The event row and audit row share a transaction, and the audit
 * row points at the event's id instead of restating values, so the two records cannot disagree. A
 * request for the current state writes neither.
 */
export async function operateMobileUpdateRelease(
	operatorId: string,
	releaseId: string,
	transition: OperatorTransition,
): Promise<AdminMobileUpdateTransitionResponse> {
	let result: Awaited<ReturnType<typeof transitionRelease>>;
	try {
		result = await transitionRelease(releaseId, {
			action: transition.action,
			rolloutPercentage:
				transition.action === "rollout" ? transition.percentage : undefined,
			actor: "admin-console",
			reason: transition.reason,
			operatorId,
			onChanged: (tx, change) =>
				recordAudit(tx, {
					operatorId,
					action: `mobile_updates.release.${transition.action}`,
					targetType: "mobile_update_release",
					targetId: releaseId,
					metadata: { eventId: change.eventId, reason: transition.reason },
				}),
		});
	} catch (error) {
		translate(error);
	}
	const release = await readReleaseDto(releaseId);
	if (!release) throw notFound();
	return { release, changed: result.changed };
}
