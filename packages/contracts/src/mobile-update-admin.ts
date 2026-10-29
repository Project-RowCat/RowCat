import { z } from "zod";
import {
	MobileUpdateChannel,
	MobileUpdateKind,
	MobileUpdatePlatform,
	MobileUpdateStatus,
} from "./mobile-updates.ts";

/**
 * Control surface for mobile OTA: the operator console reads releases, presses safe transitions,
 * and requests publish or rollback. CI does the actual publishing. This file deliberately leaves
 * out:
 * - Manifest body, bundles, asset addresses, signatures, certificates. Publishing starts from a
 *   commit in the repo and the publish tool builds these. A browser field for them would turn the
 *   console into a remote code uploader.
 * - Runtime generation. CI reads it from the checked-out repo and compares it with the
 *   fingerprint record. An operator-entered value could pair a runtime with a native contract it
 *   does not match.
 * - API origin. The channel decides it (its publish environment points at its deployment). A
 *   browser-picked origin would let a TestFlight bundle talk to the production backend.
 * - CI credentials. Job responses carry a run link, never a token. Request schemas are all
 *   `.strict()` for this reason: silently dropping an unknown key would let the sender believe they
 *   had set something.
 */

export const ADMIN_MOBILE_UPDATE_PAGE_SIZE = 25;
export const ADMIN_MOBILE_UPDATE_MAX_PAGE_SIZE = 100;

export const AdminMobileUpdateQuery = z.object({
	channel: z.union([MobileUpdateChannel, z.literal("")]).default(""),
	platform: z.union([MobileUpdatePlatform, z.literal("")]).default(""),
	runtimeVersion: z.string().trim().max(40).default(""),
	status: z.union([MobileUpdateStatus, z.literal("")]).default(""),
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(ADMIN_MOBILE_UPDATE_MAX_PAGE_SIZE)
		.default(ADMIN_MOBILE_UPDATE_PAGE_SIZE),
});
export type AdminMobileUpdateQuery = z.infer<typeof AdminMobileUpdateQuery>;

export function toAdminMobileUpdateSearchParams(
	query: AdminMobileUpdateQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (query.channel) sp.set("channel", query.channel);
	if (query.platform) sp.set("platform", query.platform);
	if (query.runtimeVersion) sp.set("runtimeVersion", query.runtimeVersion);
	if (query.status) sp.set("status", query.status);
	if (query.cursor) sp.set("cursor", query.cursor);
	if (query.limit !== ADMIN_MOBILE_UPDATE_PAGE_SIZE)
		sp.set("limit", String(query.limit));
	return sp;
}

/**
 * One release row, without the manifest body. The signed manifest lists asset URLs and hashes and
 * would make each row hundreds of KB, so every operational field is a separate column instead.
 * `.strict()` lets the response key-set test guard this boundary.
 */
export const AdminMobileUpdateReleaseDto = z
	.object({
		id: z.string(),
		kind: MobileUpdateKind,
		platform: MobileUpdatePlatform,
		channel: MobileUpdateChannel,
		runtimeVersion: z.string(),
		/** Signing time of the signed body. This is the axis used for release selection order. */
		createdAt: z.iso.datetime(),
		registeredAt: z.iso.datetime(),
		status: MobileUpdateStatus,
		statusChangedAt: z.iso.datetime(),
		rolloutPercentage: z.number().int().min(0).max(100),
		keyIds: z.array(z.string()),
		republishOf: z.string().nullable(),
		sourceCommit: z.string(),
		apiOrigin: z.string(),
	})
	.strict();
export type AdminMobileUpdateReleaseDto = z.infer<
	typeof AdminMobileUpdateReleaseDto
>;

export const AdminMobileUpdatePage = z.object({
	items: z.array(AdminMobileUpdateReleaseDto),
	nextCursor: z.string().nullable(),
});
export type AdminMobileUpdatePage = z.infer<typeof AdminMobileUpdatePage>;

export const MOBILE_UPDATE_EVENT_ACTIONS = [
	"register",
	"rollout",
	"pause",
	"resume",
	"rollback",
] as const;
export const MobileUpdateEventAction = z.enum(MOBILE_UPDATE_EVENT_ACTIONS);
export type MobileUpdateEventAction = z.infer<typeof MobileUpdateEventAction>;

/**
 * Event row. `actor` and `operator` are two separate axes. `actor` is the name the publish
 * environment gives itself (a CI run or a person's shell name). `operator` is the member who acted
 * in the operator console. It comes only from the session and has no place in the request body. CI
 * and CLI transitions have no member (`null`). Rows of a withdrawn operator stay, with only
 * `operator.nickname` cleared.
 */
export const AdminMobileUpdateEventDto = z
	.object({
		id: z.string(),
		action: MobileUpdateEventAction,
		fromStatus: MobileUpdateStatus.nullable(),
		toStatus: MobileUpdateStatus,
		fromRollout: z.number().int().nullable(),
		toRollout: z.number().int(),
		actor: z.string(),
		operator: z
			.object({ id: z.string(), nickname: z.string().nullable() })
			.nullable(),
		reason: z.string(),
		createdAt: z.iso.datetime(),
	})
	.strict();
export type AdminMobileUpdateEventDto = z.infer<
	typeof AdminMobileUpdateEventDto
>;

/* Direct transitions. These three need no signing key. */

/**
 * Upper bound on the reason an operator records in history. The reason input and server validation
 * both use this value.
 */
export const MOBILE_UPDATE_REASON_MAX_LENGTH = 500;

const optionalReason = z
	.string()
	.trim()
	.max(MOBILE_UPDATE_REASON_MAX_LENGTH)
	.default("");
const requiredReason = z
	.string()
	.trim()
	.min(1)
	.max(MOBILE_UPDATE_REASON_MAX_LENGTH);

/**
 * Raise the rollout percentage. The request takes one target value and has no field for the current
 * percentage: the server reads the locked row. Lowering is not a schema concern. The transition
 * table rejects it (`mobile_update_rollout_decrease`), because only the server knows the current
 * percentage exactly.
 */
export const AdminMobileUpdateRolloutRequest = z
	.object({
		percentage: z.number().int().min(1).max(100),
		reason: optionalReason,
	})
	.strict();
export type AdminMobileUpdateRolloutRequest = z.infer<
	typeof AdminMobileUpdateRolloutRequest
>;

/**
 * Pause is for incident response. Without a recorded reason in history, whoever resumes it cannot
 * judge whether to reopen.
 */
export const AdminMobileUpdatePauseRequest = z
	.object({ reason: requiredReason })
	.strict();
export type AdminMobileUpdatePauseRequest = z.infer<
	typeof AdminMobileUpdatePauseRequest
>;

/** Resume keeps the paused percentage as it is. There is no percentage field. */
export const AdminMobileUpdateResumeRequest = z
	.object({ reason: optionalReason })
	.strict();
export type AdminMobileUpdateResumeRequest = z.infer<
	typeof AdminMobileUpdateResumeRequest
>;

export const AdminMobileUpdateTransitionResponse = z.object({
	release: AdminMobileUpdateReleaseDto,
	/**
	 * False if the request asked for the state the release is already in. Neither history nor the
	 * audit log gains a row.
	 */
	changed: z.boolean(),
});
export type AdminMobileUpdateTransitionResponse = z.infer<
	typeof AdminMobileUpdateTransitionResponse
>;

/* Publish jobs. The API records the intent and CI executes it. */

export const MOBILE_UPDATE_JOB_KINDS = ["publish", "rollback"] as const;
export const MobileUpdateJobKind = z.enum(MOBILE_UPDATE_JOB_KINDS);
export type MobileUpdateJobKind = z.infer<typeof MobileUpdateJobKind>;

/**
 * Job statuses:
 * - queued: recorded and CI was asked. Nothing is signed yet.
 * - running: CI reported start and fixed the source commit.
 * - succeeded: CI reported the result release, and the server confirmed it in the registration
 *   table.
 * - failed: ended, together with the stage where it stopped.
 * - cancelled: withdrawn by the operator before start.
 *
 * There are no progress numbers. CI only reports coarse states, and invented percentages are the
 * first figures to lose trust during an incident.
 */
export const MOBILE_UPDATE_JOB_STATUSES = [
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
] as const;
export const MobileUpdateJobStatus = z.enum(MOBILE_UPDATE_JOB_STATUSES);
export type MobileUpdateJobStatus = z.infer<typeof MobileUpdateJobStatus>;

export const MOBILE_UPDATE_JOB_ACTIVE_STATUSES: readonly MobileUpdateJobStatus[] =
	["queued", "running"];

/**
 * Publish-tool stages: a closed vocabulary for where a failure stopped, as reported by CI. `source`
 * and `install` are workflow steps before the publish tool. The rest are the names the publish tool
 * writes to its result file (`apps/mobile/scripts/ota/result.ts`).
 */
export const MOBILE_UPDATE_JOB_STAGES = [
	"source",
	"install",
	"environment",
	"runtime",
	"update_note",
	"checks",
	"export",
	"assets",
	"signing",
	"registration",
	"plan",
	"unknown",
] as const;
export const MobileUpdateJobStage = z.enum(MOBILE_UPDATE_JOB_STAGES);
export type MobileUpdateJobStage = z.infer<typeof MobileUpdateJobStage>;

/**
 * Failure reasons: a closed list, and the wording is chosen by us. CI logs and command output are
 * not included in responses. That output mixes in environment variables and paths, and a secret
 * shown once stays on many operators' screens and in query caches. The raw output stays in the CI
 * run behind the run link.
 */
export const MOBILE_UPDATE_JOB_FAILURE_CODES = [
	"ci_trigger_unavailable",
	"ci_never_started",
	"ci_run_failed",
	"ci_run_cancelled",
	"ci_result_missing",
	"result_unverified",
	"source_rejected",
	"install_failed",
	"deployment_mismatch",
	"runtime_fingerprint_mismatch",
	"update_note_missing",
	"checks_failed",
	"export_failed",
	"asset_upload_failed",
	"signing_failed",
	"registration_failed",
	"rollback_plan_rejected",
	"unknown",
] as const;
export const MobileUpdateJobFailureCode = z.enum(
	MOBILE_UPDATE_JOB_FAILURE_CODES,
);
export type MobileUpdateJobFailureCode = z.infer<
	typeof MobileUpdateJobFailureCode
>;

/**
 * Maps stage to failure reason. CI reports only the stage; the server picks the reason from this
 * table.
 */
export const MOBILE_UPDATE_STAGE_FAILURE: Record<
	MobileUpdateJobStage,
	MobileUpdateJobFailureCode
> = {
	source: "source_rejected",
	install: "install_failed",
	environment: "deployment_mismatch",
	runtime: "runtime_fingerprint_mismatch",
	update_note: "update_note_missing",
	checks: "checks_failed",
	export: "export_failed",
	assets: "asset_upload_failed",
	signing: "signing_failed",
	registration: "registration_failed",
	plan: "rollback_plan_rejected",
	unknown: "unknown",
};

export const MOBILE_UPDATE_JOB_FAILURE_LABEL: Record<
	MobileUpdateJobFailureCode,
	string
> = {
	ci_trigger_unavailable:
		"Couldn't start the CI job; nothing was signed or registered.",
	ci_never_started:
		"CI did not report a start; treating it as nothing signed or registered.",
	ci_run_failed: "The CI run failed without reporting a result.",
	ci_run_cancelled: "The CI run was cancelled.",
	ci_result_missing:
		"The CI run finished without reporting a result; it may have registered, so check the release list.",
	result_unverified:
		"The result CI reported does not match the registration table; check the release list yourself.",
	source_rejected:
		"The source is not on an allowed branch; only commits merged into an allowed branch are published.",
	install_failed: "Dependency installation failed.",
	deployment_mismatch:
		"The channel environment does not match this deployment (API origin · build profile).",
	runtime_fingerprint_mismatch:
		"The native runtime fingerprint differs from the record; a new runtime generation and a new binary are needed.",
	update_note_missing: "The update note is not in the generated registry.",
	checks_failed: "Checks (types · tests · generated-file freshness) failed.",
	export_failed: "expo export failed.",
	asset_upload_failed: "Asset upload failed.",
	signing_failed: "The signing step failed (key · certificate).",
	registration_failed: "Release registration failed.",
	rollback_plan_rejected:
		"The rollback plan was refused; there may be a newer active release.",
	unknown: "Failed at an unknown step.",
};

/**
 * Source: an allowed branch name or one 40-character commit. Shell syntax, repo URLs, paths and
 * short hashes are rejected. Short hashes become ambiguous as the repo grows, and that ambiguity
 * would change the code being published. Even when a commit is chosen, CI checks that it is already
 * merged into an allowed branch. That keeps tooling from unreviewed branches out of the same step
 * that holds the signing key.
 */
export const MOBILE_UPDATE_SOURCE_BRANCHES = ["main"] as const;
export const MobileUpdateSourceBranch = z.enum(MOBILE_UPDATE_SOURCE_BRANCHES);
export type MobileUpdateSourceBranch = z.infer<typeof MobileUpdateSourceBranch>;

export const MOBILE_UPDATE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export const MobileUpdateSource = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("branch"), branch: MobileUpdateSourceBranch })
		.strict(),
	z
		.object({
			kind: z.literal("commit"),
			sha: z.string().trim().toLowerCase().regex(MOBILE_UPDATE_COMMIT_PATTERN),
		})
		.strict(),
]);
export type MobileUpdateSource = z.infer<typeof MobileUpdateSource>;

/**
 * Initial rollout percentage: a closed list. The production channel only has `null` (draft).
 * Production publish is two steps. Going wide is a separate rollout increase that a person who has
 * confirmed the result release presses.
 */
export const MOBILE_UPDATE_INITIAL_ROLLOUTS = [5, 10, 100] as const;
export const MobileUpdateInitialRollout = z.union([
	z.literal(5),
	z.literal(10),
	z.literal(100),
	z.null(),
]);
export type MobileUpdateInitialRollout = z.infer<
	typeof MobileUpdateInitialRollout
>;

export const MOBILE_UPDATE_NOTE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Release note reference: either the date identifier of a note the repo wrote, or an explicit
 * 'none'. The note body is not sent here. The repo is the source of notes, and CI only checks that
 * the identifier exists in its registry. OTA metadata must not become a second source for notes.
 */
export const MobileUpdateNoteChoice = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("note"),
			id: z.string().regex(MOBILE_UPDATE_NOTE_ID_PATTERN),
		})
		.strict(),
	z.object({ kind: z.literal("none") }).strict(),
]);
export type MobileUpdateNoteChoice = z.infer<typeof MobileUpdateNoteChoice>;

export const AdminMobileUpdatePublishRequest = z
	.object({
		channel: MobileUpdateChannel,
		platform: MobileUpdatePlatform,
		source: MobileUpdateSource,
		initialRollout: MobileUpdateInitialRollout,
		note: MobileUpdateNoteChoice,
		reason: requiredReason,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.channel === "production" && value.initialRollout !== null)
			ctx.addIssue({
				code: "custom",
				path: ["initialRollout"],
				message:
					"production publishes register as draft only; raise the percentage separately after checking the result",
			});
	});
export type AdminMobileUpdatePublishRequest = z.infer<
	typeof AdminMobileUpdatePublishRequest
>;

/**
 * Rollback request. The target is named by the path, and the caller chooses only the direction of
 * recovery. The operator does not pick the release to return to. 'Previous good release' is decided
 * by the server's rollback plan, and the CI publish tool runs the same query again. If the screen
 * picked it, the two decisions could disagree.
 */
export const AdminMobileUpdateRollbackRequest = z
	.object({
		reason: requiredReason,
		/** Also roll back to the store bundle, even when a previous good OTA exists. */
		toEmbedded: z.boolean().default(false),
	})
	.strict();
export type AdminMobileUpdateRollbackRequest = z.infer<
	typeof AdminMobileUpdateRollbackRequest
>;

export const AdminMobileUpdateJobCancelRequest = z
	.object({ reason: requiredReason })
	.strict();
export type AdminMobileUpdateJobCancelRequest = z.infer<
	typeof AdminMobileUpdateJobCancelRequest
>;

export const AdminMobileUpdateJobDto = z
	.object({
		id: z.string(),
		kind: MobileUpdateJobKind,
		channel: MobileUpdateChannel,
		platform: MobileUpdatePlatform,
		status: MobileUpdateJobStatus,
		requestedBy: z
			.object({ id: z.string(), nickname: z.string().nullable() })
			.nullable(),
		source: MobileUpdateSource.nullable(),
		/** Commit that CI fixed. Null until the job starts. */
		sourceCommit: z.string().nullable(),
		/** Runtime generation that CI read from the checkout. Null until the job starts. */
		runtimeVersion: z.string().nullable(),
		targetReleaseId: z.string().nullable(),
		toEmbedded: z.boolean(),
		initialRollout: z.number().int().nullable(),
		noteId: z.string().nullable(),
		reason: z.string(),
		/**
		 * Link to the CI run page. Only operators with permission can read it, and it carries no token.
		 */
		externalRunUrl: z.string().nullable(),
		resultReleaseIds: z.array(z.string()),
		failure: z
			.object({
				code: MobileUpdateJobFailureCode,
				stage: MobileUpdateJobStage.nullable(),
			})
			.nullable(),
		createdAt: z.iso.datetime(),
		startedAt: z.iso.datetime().nullable(),
		finishedAt: z.iso.datetime().nullable(),
	})
	.strict();
export type AdminMobileUpdateJobDto = z.infer<typeof AdminMobileUpdateJobDto>;

export const ADMIN_MOBILE_UPDATE_JOB_PAGE_SIZE = 20;

export const AdminMobileUpdateJobQuery = z.object({
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(ADMIN_MOBILE_UPDATE_MAX_PAGE_SIZE)
		.default(ADMIN_MOBILE_UPDATE_JOB_PAGE_SIZE),
});
export type AdminMobileUpdateJobQuery = z.infer<
	typeof AdminMobileUpdateJobQuery
>;

export const AdminMobileUpdateJobPage = z.object({
	items: z.array(AdminMobileUpdateJobDto),
	nextCursor: z.string().nullable(),
});
export type AdminMobileUpdateJobPage = z.infer<typeof AdminMobileUpdateJobPage>;

/**
 * Whether this deployment can request publish jobs: whether a CI connection exists, and which
 * channels it covers. `channels` lists the channels this deployment is registered for. Production
 * deployments do not receive TestFlight releases, because their bundles use a different API origin.
 * This value only keeps the screen from drawing publish buttons for other channels. It is not
 * authorization: the server rejects with the same list.
 */
export const AdminMobileUpdateJobsConfigDto = z.object({
	available: z.boolean(),
	channels: z.array(MobileUpdateChannel),
	sourceBranches: z.array(MobileUpdateSourceBranch),
});
export type AdminMobileUpdateJobsConfigDto = z.infer<
	typeof AdminMobileUpdateJobsConfigDto
>;

export const AdminMobileUpdateDetailDto = z.object({
	release: AdminMobileUpdateReleaseDto,
	/**
	 * Only the count and size of assets. Addresses and hashes live in the signed body and do not come
	 * here.
	 */
	assets: z.object({ count: z.number().int(), bytes: z.number().int() }),
	/** Oldest first. Rows with the same timestamp are ordered by id. */
	events: z.array(AdminMobileUpdateEventDto),
	/** Jobs that target this release, plus the job that produced it. */
	jobs: z.array(AdminMobileUpdateJobDto),
});
export type AdminMobileUpdateDetailDto = z.infer<
	typeof AdminMobileUpdateDetailDto
>;

/**
 * What the rollback will do:
 * - republish: re-sign the previous good OTA's code with a new timestamp.
 * - embedded: issue a signed instruction to fall back to the bundle in the store binary.
 * - none: the release was a draft and no install received it, so only the status is reverted.
 * - blocked: a newer active release exists, and clients already receive it.
 */
export const MOBILE_UPDATE_RECOVERY_KINDS = [
	"republish",
	"embedded",
	"none",
	"blocked",
] as const;
export const MobileUpdateRecoveryKind = z.enum(MOBILE_UPDATE_RECOVERY_KINDS);
export type MobileUpdateRecoveryKind = z.infer<typeof MobileUpdateRecoveryKind>;

export const AdminMobileUpdateRollbackPlanDto = z.object({
	release: AdminMobileUpdateReleaseDto,
	newerActive: z.array(AdminMobileUpdateReleaseDto),
	previousGood: AdminMobileUpdateReleaseDto.nullable(),
	/** Recovery used when `toEmbedded` is not chosen. If it is chosen, the recovery is `embedded`. */
	recovery: MobileUpdateRecoveryKind,
	/** If a job is already running on the same stream, this is that job. */
	activeJob: AdminMobileUpdateJobDto.nullable(),
});
export type AdminMobileUpdateRollbackPlanDto = z.infer<
	typeof AdminMobileUpdateRollbackPlanDto
>;

/* Reports from CI. CI's OIDC token authenticates these, not a session. */

/**
 * Job events reported by CI. This is orchestration state, not signing authority.
 * - started: source commit fixed. If the response is not 2xx, CI stops before signing and the job
 *   is cancelled.
 * - succeeded: registered release id. The server re-checks that id against the registration
 *   table.
 * - failed: the stage where it stopped. The server chooses the reason and the wording.
 *
 * There is no room for the release body, signature, channel or runtime. The registration path
 * already verified the signature and recorded those values in the table. Letting this report
 * restate them would create two sources of truth.
 */
export const MobileUpdateJobReport = z.discriminatedUnion("event", [
	z
		.object({
			event: z.literal("started"),
			sourceCommit: z.string().regex(MOBILE_UPDATE_COMMIT_PATTERN),
			runtimeVersion: z.string().regex(/^rowcat-native-[1-9][0-9]{0,5}$/),
		})
		.strict(),
	z
		.object({
			event: z.literal("succeeded"),
			releaseIds: z.array(z.string().min(1).max(64)).max(2),
		})
		.strict(),
	z
		.object({
			event: z.literal("failed"),
			stage: MobileUpdateJobStage,
		})
		.strict(),
]);
export type MobileUpdateJobReport = z.infer<typeof MobileUpdateJobReport>;

export const MobileUpdateJobReportResponse = z.object({
	jobId: z.string(),
	status: MobileUpdateJobStatus,
	/** Answer to `started`. If false, CI does not enter the signing step. */
	proceed: z.boolean(),
});
export type MobileUpdateJobReportResponse = z.infer<
	typeof MobileUpdateJobReportResponse
>;

export const MOBILE_UPDATE_ADMIN_ERROR_CODE = {
	capabilityRequired: "mobile_update_capability_required",
	releaseMissing: "mobile_update_release_missing",
	transitionInvalid: "mobile_update_transition_invalid",
	rolloutDecrease: "mobile_update_rollout_decrease",
	rolloutInvalid: "mobile_update_rollout_invalid",
	ciUnavailable: "mobile_update_ci_unavailable",
	ciDispatchFailed: "mobile_update_ci_dispatch_failed",
	channelNotServed: "mobile_update_channel_not_served",
	jobInProgress: "mobile_update_job_in_progress",
	jobMissing: "mobile_update_job_missing",
	jobNotCancellable: "mobile_update_job_not_cancellable",
	rollbackSuperseded: "mobile_update_rollback_superseded",
	reportRejected: "mobile_update_job_report_rejected",
} as const;
