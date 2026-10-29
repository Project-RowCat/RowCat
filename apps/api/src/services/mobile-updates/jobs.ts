import {
	type AdminMobileUpdateJobDto,
	type AdminMobileUpdateJobPage,
	type AdminMobileUpdateJobsConfigDto,
	type AdminMobileUpdatePublishRequest,
	type AdminMobileUpdateRollbackRequest,
	MOBILE_UPDATE_ADMIN_ERROR_CODE,
	MOBILE_UPDATE_SOURCE_BRANCHES,
	MOBILE_UPDATE_STAGE_FAILURE,
	type MobileUpdateChannel,
	type MobileUpdateJobFailureCode,
	type MobileUpdateJobKind,
	type MobileUpdateJobReport,
	type MobileUpdateJobReportResponse,
	type MobileUpdateJobStage,
	type MobileUpdateJobStatus,
	type MobileUpdatePlatform,
	type MobileUpdateSource,
} from "@rowcat/contracts";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
	member,
	mobile_update_job,
	mobile_update_release,
	mobile_update_release_event,
} from "../../db/schema.ts";
import { ApiError, badRequest, notFound } from "../../lib/errors.ts";
import { newId } from "../../lib/id.ts";
import { isUniqueViolationOn } from "../../lib/pg-error.ts";
import { recordAudit } from "../admin/audit.ts";
import {
	type MobileUpdateCi,
	type MobileUpdateCiDispatchInput,
	mobileUpdateCi,
	mobileUpdateEnvironmentFor,
	runUrlFor,
} from "./ci-trigger.ts";
import { type MobileUpdateTx, planRollback } from "./index.ts";

/**
 * Publish jobs: record the operator's intent, ask CI to run it, and verify CI's reports.
 *
 * ```text
 * request    job row (queued) + one audit row, one transaction
 *            -> start the CI workflow OUTSIDE the transaction
 *            -> if it cannot start, the job is failed (ci_trigger_unavailable) and the request is a 502
 * start      CI reports over OIDC that the source commit is fixed -> running
 *            a `proceed: false` response keeps CI out of the signing step (cancelled/failed job)
 * finish     CI reports the result release id -> re-verified against the registration table -> succeeded
 *            or CI reports the stage it stopped at -> failed
 * reconcile  jobs with no report are closed by a periodic job that asks CI for the run state
 * ```
 *
 * What this file does not do:
 * - Sign. This process has no private key. A release CI registered was already signature-verified
 *   by the registration path (`registration.ts`); here we only check that it is this job's result.
 * - Change release state first. If a rollback request wrote `rolled_back` and then waited for CI,
 *   a day CI failed to start would leave "rolled back" with no recovery release. That order belongs
 *   to the publish tool, where the key lives (step 1 then step 2).
 * - Relay CI logs. A failure arrives only as one stage from a closed vocabulary; the original
 *   text is behind the run link.
 */

const ACTIVE_STATUSES: MobileUpdateJobStatus[] = ["queued", "running"];
const ACTIVE_STREAM_INDEX = "uq_mobile_update_job_active_stream";

/** A job CI has not reported starting after this long is treated as never started. */
export const MOBILE_UPDATE_JOB_START_DEADLINE_MS = 30 * 60 * 1000;

type JobRow = typeof mobile_update_job.$inferSelect;

/* Projections */

const sourceOf = (row: JobRow): MobileUpdateSource | null => {
	if (row.source_kind === "commit" && row.source_ref)
		return { kind: "commit", sha: row.source_ref };
	if (
		row.source_kind === "branch" &&
		(MOBILE_UPDATE_SOURCE_BRANCHES as readonly string[]).includes(
			row.source_ref ?? "",
		)
	)
		return {
			kind: "branch",
			branch: row.source_ref as (typeof MOBILE_UPDATE_SOURCE_BRANCHES)[number],
		};
	return null;
};

function toJobDto(
	row: JobRow,
	nickname: string | null,
): AdminMobileUpdateJobDto {
	return {
		id: row.id,
		kind: row.kind as MobileUpdateJobKind,
		channel: row.channel as MobileUpdateChannel,
		platform: row.platform as MobileUpdatePlatform,
		status: row.status as MobileUpdateJobStatus,
		requestedBy: row.requested_by ? { id: row.requested_by, nickname } : null,
		source: sourceOf(row),
		sourceCommit: row.source_commit,
		runtimeVersion: row.runtime_version,
		targetReleaseId: row.target_release_id,
		toEmbedded: row.to_embedded,
		initialRollout: row.initial_rollout,
		noteId: row.note_id,
		reason: row.reason,
		externalRunUrl: row.external_run_url,
		resultReleaseIds: row.result_release_ids,
		failure: row.failure_code
			? {
					code: row.failure_code as MobileUpdateJobFailureCode,
					stage: (row.failure_stage as MobileUpdateJobStage | null) ?? null,
				}
			: null,
		createdAt: row.created_at.toISOString(),
		startedAt: row.started_at?.toISOString() ?? null,
		finishedAt: row.finished_at?.toISOString() ?? null,
	};
}

/** The requesting operator's nickname is joined at read time, not stored on the row (same as the audit log). */
const jobSelection = { job: mobile_update_job, nickname: member.nickname };

async function readJobRow(id: string): Promise<AdminMobileUpdateJobDto | null> {
	const [row] = await db
		.select(jobSelection)
		.from(mobile_update_job)
		.leftJoin(member, eq(mobile_update_job.requested_by, member.id))
		.where(eq(mobile_update_job.id, id));
	return row ? toJobDto(row.job, row.nickname) : null;
}

export const readMobileUpdateJob = readJobRow;

const encodeCursor = (row: { createdAt: Date; id: string }) =>
	Buffer.from(`${row.createdAt.getTime()}.${row.id}`, "utf8").toString(
		"base64url",
	);

export function decodeMobileUpdateCursor(raw: string): {
	createdAt: Date;
	id: string;
} {
	const text = Buffer.from(raw, "base64url").toString("utf8");
	const dot = text.indexOf(".");
	const ms = Number(text.slice(0, dot));
	const id = text.slice(dot + 1);
	if (
		dot < 1 ||
		!Number.isSafeInteger(ms) ||
		ms < 0 ||
		ms > 8.64e15 ||
		!id ||
		id.length > 64
	)
		throw badRequest(
			"Couldn't continue loading the list. Please refresh and try again.",
			"invalid_cursor",
		);
	return { createdAt: new Date(ms), id };
}

export const encodeMobileUpdateCursor = encodeCursor;

export async function listMobileUpdateJobs(input: {
	cursor: string;
	limit: number;
}): Promise<AdminMobileUpdateJobPage> {
	const after = input.cursor ? decodeMobileUpdateCursor(input.cursor) : null;
	const rows = await db
		.select(jobSelection)
		.from(mobile_update_job)
		.leftJoin(member, eq(mobile_update_job.requested_by, member.id))
		.where(
			after
				? or(
						lt(mobile_update_job.created_at, after.createdAt),
						and(
							eq(mobile_update_job.created_at, after.createdAt),
							lt(mobile_update_job.id, after.id),
						),
					)
				: undefined,
		)
		.orderBy(desc(mobile_update_job.created_at), desc(mobile_update_job.id))
		.limit(input.limit + 1);
	const page = rows.slice(0, input.limit);
	const last = page.at(-1);
	return {
		items: page.map((row) => toJobDto(row.job, row.nickname)),
		nextCursor:
			rows.length > input.limit && last
				? encodeCursor({ createdAt: last.job.created_at, id: last.job.id })
				: null,
	};
}

/** Jobs targeting this release and jobs that produced it, for the detail screen's relations. */
export async function jobsForRelease(
	releaseId: string,
): Promise<AdminMobileUpdateJobDto[]> {
	const rows = await db
		.select(jobSelection)
		.from(mobile_update_job)
		.leftJoin(member, eq(mobile_update_job.requested_by, member.id))
		.where(
			or(
				eq(mobile_update_job.target_release_id, releaseId),
				sql`${mobile_update_job.result_release_ids} @> ${JSON.stringify([releaseId])}::jsonb`,
			),
		)
		.orderBy(desc(mobile_update_job.created_at), desc(mobile_update_job.id))
		.limit(20);
	return rows.map((row) => toJobDto(row.job, row.nickname));
}

/** The live job in the same stream, so the rollback confirmation can say one is already running. */
export async function activeJobFor(
	channel: MobileUpdateChannel,
	platform: MobileUpdatePlatform,
): Promise<AdminMobileUpdateJobDto | null> {
	const [row] = await db
		.select(jobSelection)
		.from(mobile_update_job)
		.leftJoin(member, eq(mobile_update_job.requested_by, member.id))
		.where(
			and(
				eq(mobile_update_job.channel, channel),
				eq(mobile_update_job.platform, platform),
				inArray(mobile_update_job.status, ACTIVE_STATUSES),
			),
		)
		.limit(1);
	return row ? toJobDto(row.job, row.nickname) : null;
}

export function mobileUpdateJobsConfig(): AdminMobileUpdateJobsConfigDto {
	const ci = mobileUpdateCi();
	return {
		available: ci !== null,
		channels: ci ? [...ci.channels] : [],
		sourceBranches: [...MOBILE_UPDATE_SOURCE_BRANCHES],
	};
}

/* Requests */

function requireCi(channel: MobileUpdateChannel): MobileUpdateCi {
	const ci = mobileUpdateCi();
	if (!ci)
		throw new ApiError(
			503,
			MOBILE_UPDATE_ADMIN_ERROR_CODE.ciUnavailable,
			"This deployment has no OTA publish CI connected. Publish through the CLI (pnpm mobile:update).",
		);
	if (!ci.channels.includes(channel))
		throw badRequest(
			`This deployment doesn't register the ${channel} channel — that channel's releases are registered on another deployment.`,
			MOBILE_UPDATE_ADMIN_ERROR_CODE.channelNotServed,
		);
	return ci;
}

interface NewJob {
	kind: MobileUpdateJobKind;
	channel: MobileUpdateChannel;
	platform: MobileUpdatePlatform;
	source: MobileUpdateSource | null;
	targetReleaseId: string | null;
	toEmbedded: boolean;
	initialRollout: number | null;
	noteId: string | null;
	reason: string;
}

/**
 * Writes the job row and one audit row in one transaction. A live job in the same stream is
 * rejected by the partial unique index and mapped to 409; a disabled button on screen is not the
 * authority.
 */
async function insertJob(
	operatorId: string,
	job: NewJob,
	guard?: (tx: MobileUpdateTx) => Promise<void>,
): Promise<string> {
	const id = newId();
	try {
		await db.transaction(async (tx) => {
			await guard?.(tx);
			await tx.insert(mobile_update_job).values({
				id,
				kind: job.kind,
				channel: job.channel,
				platform: job.platform,
				status: "queued",
				requested_by: operatorId,
				source_kind: job.source?.kind ?? null,
				source_ref:
					job.source?.kind === "branch"
						? job.source.branch
						: (job.source?.sha ?? null),
				target_release_id: job.targetReleaseId,
				to_embedded: job.toEmbedded,
				initial_rollout: job.initialRollout,
				note_id: job.noteId,
				reason: job.reason,
			});
			await recordAudit(tx, {
				operatorId,
				action: `mobile_updates.job.${job.kind}`,
				targetType: "mobile_update_job",
				targetId: id,
				metadata: {
					channel: job.channel,
					platform: job.platform,
					source: job.source,
					targetReleaseId: job.targetReleaseId,
					toEmbedded: job.toEmbedded,
					initialRollout: job.initialRollout,
					noteId: job.noteId,
					reason: job.reason,
				},
			});
		});
	} catch (error) {
		if (isUniqueViolationOn(error, ACTIVE_STREAM_INDEX)) {
			const active = await activeJobFor(job.channel, job.platform);
			throw new ApiError(
				409,
				MOBILE_UPDATE_ADMIN_ERROR_CODE.jobInProgress,
				`${job.channel} · ${job.platform} already has a job in progress — request again after it finishes.`,
				{ details: active ? { jobId: active.id } : undefined },
			);
		}
		throw error;
	}
	return id;
}

/**
 * Starts CI, outside the transaction.
 *
 * If it cannot start, the job ends `failed` and a 502 is thrown, so a request never looks started
 * when it was not; for a rollback the bad release keeps going out while that claim is false.
 *
 * If only the response was lost and GitHub accepted the run, that run soon reports `started`, gets
 * `proceed: false` because the job is already `failed`, and stops before signing. It errs only
 * toward failure.
 */
async function dispatchJob(
	ci: MobileUpdateCi,
	id: string,
	input: Omit<MobileUpdateCiDispatchInput, "jobId">,
): Promise<AdminMobileUpdateJobDto> {
	let run: { runId: string | null; runUrl: string | null };
	try {
		run = await ci.trigger.dispatch({ jobId: id, ...input });
	} catch (error) {
		console.error(
			`[mobile-updates] failed to start CI job=${id}`,
			error instanceof Error ? error.message : "unknown",
		);
		await db
			.update(mobile_update_job)
			.set({
				status: "failed",
				failure_code: "ci_trigger_unavailable",
				finished_at: new Date(),
			})
			.where(
				and(
					eq(mobile_update_job.id, id),
					eq(mobile_update_job.status, "queued"),
				),
			);
		throw new ApiError(
			502,
			MOBILE_UPDATE_ADMIN_ERROR_CODE.ciDispatchFailed,
			"Couldn't start the CI job — nothing was signed or registered. Request again in a moment or proceed with the CLI.",
		);
	}
	if (run.runId)
		await db
			.update(mobile_update_job)
			.set({
				external_run_id: sql`coalesce(${mobile_update_job.external_run_id}, ${run.runId})`,
				external_run_url: sql`coalesce(${mobile_update_job.external_run_url}, ${run.runUrl ?? runUrlFor(ci.repository, run.runId)})`,
			})
			.where(eq(mobile_update_job.id, id));
	const job = await readJobRow(id);
	if (!job) throw notFound();
	return job;
}

export async function requestPublishJob(
	operatorId: string,
	request: AdminMobileUpdatePublishRequest,
): Promise<AdminMobileUpdateJobDto> {
	const ci = requireCi(request.channel);
	/**
	 * Production publishes register only as draft. The contract rejects otherwise first; this is the
	 * server's second line, so a caller that bypasses the contract cannot send a production publish
	 * straight to users.
	 */
	const initialRollout =
		request.channel === "production" ? null : request.initialRollout;
	const noteId = request.note.kind === "note" ? request.note.id : null;
	const id = await insertJob(operatorId, {
		kind: "publish",
		channel: request.channel,
		platform: request.platform,
		source: request.source,
		targetReleaseId: null,
		toEmbedded: false,
		initialRollout,
		noteId,
		reason: request.reason,
	});
	return dispatchJob(ci, id, {
		kind: "publish",
		channel: request.channel,
		platform: request.platform,
		source:
			request.source.kind === "branch"
				? request.source.branch
				: request.source.sha,
		rollout: initialRollout === null ? "draft" : String(initialRollout),
		note: noteId ?? "none",
		targetReleaseId: "",
		toEmbedded: false,
	});
}

/**
 * Rollback request: re-asks for the plan and creates no job if blocked.
 *
 * The plan the screen showed is not trusted (another release may have become active meanwhile). The
 * same query runs again inside the transaction that writes the job row, and the CI publish tool
 * runs it once more when it starts.
 */
export async function requestRollbackJob(
	operatorId: string,
	releaseId: string,
	request: AdminMobileUpdateRollbackRequest,
): Promise<AdminMobileUpdateJobDto> {
	const [release] = await db
		.select({
			channel: mobile_update_release.channel,
			platform: mobile_update_release.platform,
		})
		.from(mobile_update_release)
		.where(eq(mobile_update_release.id, releaseId));
	if (!release)
		throw notFound(
			"No release.",
			MOBILE_UPDATE_ADMIN_ERROR_CODE.releaseMissing,
		);
	const channel = release.channel as MobileUpdateChannel;
	const platform = release.platform as MobileUpdatePlatform;
	const ci = requireCi(channel);

	const id = await insertJob(
		operatorId,
		{
			kind: "rollback",
			channel,
			platform,
			source: null,
			targetReleaseId: releaseId,
			toEmbedded: request.toEmbedded,
			initialRollout: null,
			noteId: null,
			reason: request.reason,
		},
		async (tx) => {
			const plan = await planRollback(releaseId, tx);
			if (!plan) throw notFound();
			if (plan.newerActive.length > 0)
				throw new ApiError(
					409,
					MOBILE_UPDATE_ADMIN_ERROR_CODE.rollbackSuperseded,
					`There is an active release newer than this one (${plan.newerActive.map((r) => r.id).join(", ")}) — clients already receive it. Handle that release first, or pausing this one is enough.`,
				);
		},
	);
	return dispatchJob(ci, id, {
		kind: "rollback",
		channel,
		platform,
		source: "",
		rollout: "",
		note: "",
		targetReleaseId: releaseId,
		toEmbedded: request.toEmbedded,
	});
}

/**
 * Cancel, only before CI reports starting.
 *
 * A job that reported starting may already be in the signing step, and cancelling then would leave
 * "was it registered?" unanswerable. So cancel works from `queued` only, and a later `started`
 * report gets `proceed: false` and stops before signing. A running run is stopped in the CI UI and
 * reconciliation records its result.
 */
export async function cancelMobileUpdateJob(
	operatorId: string,
	jobId: string,
	reason: string,
): Promise<AdminMobileUpdateJobDto> {
	const cancelled = await db.transaction(async (tx) => {
		const [row] = await tx
			.update(mobile_update_job)
			.set({ status: "cancelled", finished_at: new Date() })
			.where(
				and(
					eq(mobile_update_job.id, jobId),
					eq(mobile_update_job.status, "queued"),
				),
			)
			.returning({ id: mobile_update_job.id });
		if (!row) return false;
		await recordAudit(tx, {
			operatorId,
			action: "mobile_updates.job.cancel",
			targetType: "mobile_update_job",
			targetId: jobId,
			metadata: { reason },
		});
		return true;
	});
	const job = await readJobRow(jobId);
	if (!job)
		throw notFound("No job.", MOBILE_UPDATE_ADMIN_ERROR_CODE.jobMissing);
	if (!cancelled && job.status !== "cancelled")
		throw new ApiError(
			409,
			MOBILE_UPDATE_ADMIN_ERROR_CODE.jobNotCancellable,
			job.status === "running"
				? "A job CI has already started isn't cancelled here — signing may be in progress. Stop it on the CI run screen and the result is recorded on this job."
				: "This job already finished.",
		);
	return job;
}

/* CI reports */

export interface MobileUpdateRunClaims {
	runId: string;
	environment: string | null;
}

const rejectReport = (status: 403 | 409, message: string) =>
	new ApiError(status, MOBILE_UPDATE_ADMIN_ERROR_CODE.reportRejected, message);

/**
 * Whether the result release belongs to this job, answered from the registration table. CI's id is
 * not recorded as-is: if it were a release in another stream or one that existed before this job,
 * the operator would raise the rollout of the wrong release.
 */
async function verifyResult(
	tx: MobileUpdateTx,
	job: JobRow,
	releaseIds: readonly string[],
): Promise<boolean> {
	const rows =
		releaseIds.length === 0
			? []
			: await tx
					.select()
					.from(mobile_update_release)
					.where(inArray(mobile_update_release.id, [...releaseIds]));
	if (rows.length !== releaseIds.length) return false;
	const sameStream = (row: (typeof rows)[number]) =>
		row.channel === job.channel &&
		row.platform === job.platform &&
		row.registered_at.getTime() >= job.created_at.getTime();

	if (job.kind === "publish") {
		const [row] = rows;
		return (
			rows.length === 1 &&
			!!row &&
			sameStream(row) &&
			row.kind === "update" &&
			row.republish_of === null &&
			row.source_commit === job.source_commit &&
			row.runtime_version === job.runtime_version
		);
	}

	if (!job.target_release_id) return false;
	const [target] = await tx
		.select({
			status: mobile_update_release.status,
			runtimeVersion: mobile_update_release.runtime_version,
		})
		.from(mobile_update_release)
		.where(eq(mobile_update_release.id, job.target_release_id));
	if (!target || target.status !== "rolled_back") return false;

	if (rows.length === 0) {
		/** No recovery release is expected only when a draft was rolled back (no installs had received it). */
		const [last] = await tx
			.select({ fromStatus: mobile_update_release_event.from_status })
			.from(mobile_update_release_event)
			.where(
				and(
					eq(mobile_update_release_event.release_id, job.target_release_id),
					eq(mobile_update_release_event.action, "rollback"),
				),
			)
			.orderBy(desc(mobile_update_release_event.created_at))
			.limit(1);
		return last?.fromStatus === "draft";
	}
	const [recovery] = rows;
	if (!recovery || rows.length !== 1) return false;
	const directive = recovery.kind === "rollback_to_embedded";
	return (
		sameStream(recovery) &&
		recovery.runtime_version === target.runtimeVersion &&
		recovery.status === "active" &&
		recovery.rollout_percentage === 100 &&
		(directive || (!job.to_embedded && recovery.republish_of !== null))
	);
}

/**
 * Applies one CI report. Idempotent, and accepts only reports the job's current state can take.
 *
 * Token verification (is this that workflow's run) was done by the route. Here we check three
 * things: the run's environment matches the job's channel, the first report bound the run and later
 * reports are from the same run, and the report makes sense in the current state.
 */
export async function applyMobileUpdateJobReport(
	jobId: string,
	report: MobileUpdateJobReport,
	claims: MobileUpdateRunClaims,
): Promise<MobileUpdateJobReportResponse> {
	const ci = mobileUpdateCi();
	return db.transaction(async (tx) => {
		const [job] = await tx
			.select()
			.from(mobile_update_job)
			.where(eq(mobile_update_job.id, jobId))
			.for("update");
		if (!job)
			throw notFound("No job.", MOBILE_UPDATE_ADMIN_ERROR_CODE.jobMissing);
		if (
			claims.environment !==
			mobileUpdateEnvironmentFor(job.channel as MobileUpdateChannel)
		)
			throw rejectReport(
				403,
				"this run's environment differs from the job's channel.",
			);
		if (job.external_run_id && job.external_run_id !== claims.runId)
			throw rejectReport(409, "this job is bound to another CI run.");

		const status = job.status as MobileUpdateJobStatus;
		const respond = (next: MobileUpdateJobStatus, proceed = false) => ({
			jobId,
			status: next,
			proceed,
		});
		const finish = async (
			next: "succeeded" | "failed",
			values: Partial<typeof mobile_update_job.$inferInsert>,
		) => {
			await tx
				.update(mobile_update_job)
				.set({ status: next, finished_at: new Date(), ...values })
				.where(eq(mobile_update_job.id, jobId));
			return respond(next);
		};

		switch (report.event) {
			case "started": {
				if (status === "running")
					return respond(status, job.source_commit === report.sourceCommit);
				/** Cancelled or failed job: CI stops before signing. */
				if (status !== "queued") return respond(status);
				const bind = {
					external_run_id: claims.runId,
					external_run_url:
						job.external_run_url ??
						(ci ? runUrlFor(ci.repository, claims.runId) : null),
					source_commit: report.sourceCommit,
					runtime_version: report.runtimeVersion,
				};
				/** Do not publish if the chosen commit differs from the one CI fixed. */
				if (
					job.source_kind === "commit" &&
					job.source_ref !== report.sourceCommit
				)
					return finish("failed", {
						...bind,
						failure_code: "source_rejected",
						failure_stage: "source",
					});
				await tx
					.update(mobile_update_job)
					.set({ ...bind, status: "running", started_at: new Date() })
					.where(eq(mobile_update_job.id, jobId));
				return respond("running", true);
			}
			case "succeeded": {
				if (status === "succeeded") {
					const same =
						JSON.stringify([...job.result_release_ids].sort()) ===
						JSON.stringify([...report.releaseIds].sort());
					if (!same)
						throw rejectReport(
							409,
							"the job already ended with a different result.",
						);
					return respond(status);
				}
				if (status !== "running")
					throw rejectReport(409, `a ${status} job doesn't accept results.`);
				const verified = await verifyResult(tx, job, report.releaseIds);
				if (!verified)
					return finish("failed", {
						failure_code: "result_unverified",
						failure_stage: null,
					});
				return finish("succeeded", {
					result_release_ids: [...report.releaseIds],
				});
			}
			case "failed": {
				if (status === "failed") return respond(status);
				if (status !== "queued" && status !== "running")
					throw rejectReport(409, `a ${status} job doesn't accept failures.`);
				return finish("failed", {
					external_run_id: job.external_run_id ?? claims.runId,
					failure_code: MOBILE_UPDATE_STAGE_FAILURE[report.stage],
					failure_stage: report.stage,
				});
			}
		}
	});
}

/* Reconciliation of lost reports */

/**
 * Asks CI again about unfinished jobs.
 *
 * ```text
 * no run, or deadline passed               ci_never_started
 * run finished (success), no result report ci_result_missing   (may have been registered; the screen says so)
 * run finished (cancelled)                 ci_run_cancelled
 * run finished (otherwise)                 ci_run_failed
 * run still going                          left alone (the workflow's timeout-minutes decides the end)
 * ```
 *
 * No result is invented: "it succeeded, so the stream's newest release is the result" is a guess,
 * and a wrong one makes the operator raise the wrong release. Closing is a conditional update; if a
 * report arrived while reconciliation was asking, that report wins.
 */
export async function reconcileMobileUpdateJobs(
	now: Date,
	ci: MobileUpdateCi | null = mobileUpdateCi(),
): Promise<{ checked: number; finished: number; errors: number }> {
	const rows = await db
		.select()
		.from(mobile_update_job)
		.where(inArray(mobile_update_job.status, ACTIVE_STATUSES))
		.orderBy(mobile_update_job.created_at)
		.limit(50);
	let finished = 0;
	let errors = 0;
	for (const job of rows) {
		let code: MobileUpdateJobFailureCode | null = null;
		const overdue =
			now.getTime() - job.created_at.getTime() >
			MOBILE_UPDATE_JOB_START_DEADLINE_MS;
		if (!job.external_run_id) {
			if (job.status === "queued" && overdue) code = "ci_never_started";
		} else if (ci) {
			try {
				const run = await ci.trigger.run(job.external_run_id);
				if (!run) {
					if (overdue) code = "ci_never_started";
				} else if (run.status === "completed")
					code =
						run.conclusion === "success"
							? "ci_result_missing"
							: run.conclusion === "cancelled"
								? "ci_run_cancelled"
								: "ci_run_failed";
			} catch {
				errors++;
				continue;
			}
		}
		if (!code) continue;
		const [updated] = await db
			.update(mobile_update_job)
			.set({ status: "failed", failure_code: code, finished_at: now })
			.where(
				and(
					eq(mobile_update_job.id, job.id),
					eq(mobile_update_job.status, job.status),
				),
			)
			.returning({ id: mobile_update_job.id });
		if (updated) finished++;
	}
	return { checked: rows.length, finished, errors };
}
