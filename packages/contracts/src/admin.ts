import { z } from "zod";
import { MemberStatus } from "./me.ts";
import { MemberRole, ModerationCapability } from "./moderation.ts";
import { AppPlatform, AppVersion } from "./ops.ts";
import { StoryVisibility } from "./publication.ts";

/**
 * Operations console contract: the shapes `/v2/admin/*` exposes on the wire.
 *
 * This file exists because the projection differs, not the path. Operators see members differently
 * from the public profile (`PublicProfileDto`), and works differently from gallery cards
 * (`StoryDto`) and creator lists (`CreatorWorkDto`). Each answers a different question, and reusing
 * one would make a boundary move whenever the other changes.
 *
 * Not exchanged here:
 * - Local conversation text, memory, and lore. These are device-only; the server holds only
 *   ciphertext and has no key.
 * - Sync ciphertext, DEKs, and recovery codes. Operator rights do not open the zero-knowledge
 *   boundary.
 * - BYO provider credentials. They are not stored on the server; no such table exists.
 * - Session tokens and password hashes. They belong to Better Auth and have no place in any
 *   response.
 * - Play payloads (the authored content). Evidence for a reported work lives with moderation.
 * - Birth dates. The server stores only age bands and transition dates.
 *
 * Fields are not excluded by stripping (`const { password, ...rest }`). That hides only known
 * fields, and any new column would reach operator responses automatically. Only the listed fields
 * go out; a test that counts response keys enforces the boundary (`routes/admin/index.test.ts`).
 */

/**
 * Only `ok` and `down`; there is no `degraded`. The check can only tell whether a round-trip
 * succeeded or failed. An intermediate state would invite guessing a value nothing measures.
 */
export const ServiceHealthStatus = z.enum(["ok", "down"]);
export type ServiceHealthStatus = z.infer<typeof ServiceHealthStatus>;

export const ServiceHealthDto = z.object({
	/** `api` or `postgres`. Only services actually checked in this deployment appear. */
	name: z.string(),
	status: ServiceHealthStatus,
	/** Round-trip time in ms; null if the service was not checked. */
	latencyMs: z.number().int().nonnegative().nullable(),
});
export type ServiceHealthDto = z.infer<typeof ServiceHealthDto>;

/**
 * Overview with only measured values. No composite metrics (score, health, engagement): those
 * numbers would fill the dashboard without answering any question, and operators would act on a
 * value whose inputs they cannot see. The creator analytics stop at three metrics for the same
 * reason.
 *
 * Redis is not listed. The stack has a Redis container, but `apps/api` does not depend on Redis.
 * Showing it as healthy would claim to measure something that is not measured.
 */
export const AdminOverviewDto = z.object({
	service: z.object({
		health: z.array(ServiceHealthDto),
		/** Seconds since process start. Shows whether the deployment is fresh. */
		uptimeSeconds: z.number().int().nonnegative(),
		environment: z.string(),
		apiVersion: z.string(),
	}),
	moderation: z.object({
		openReports: z.number().int().nonnegative(),
		openCases: z.number().int().nonnegative(),
		openAppeals: z.number().int().nonnegative(),
		/**
		 * Age in hours of the oldest unresolved report; null if none. Age matters more than count: 20
		 * reports that just arrived and 3 that have been open for four days are very different
		 * situations, and the count alone cannot tell them apart.
		 */
		oldestOpenReportAgeHours: z.number().int().nonnegative().nullable(),
	}),
	product: z.object({
		members: z.number().int().nonnegative(),
		suspendedMembers: z.number().int().nonnegative(),
		stories: z.number().int().nonnegative(),
		hiddenStories: z.number().int().nonnegative(),
		/**
		 * New members in the last 7 days. The period is not selectable by design (V1 is a single number).
		 */
		newMembersLast7Days: z.number().int().nonnegative(),
	}),
});
export type AdminOverviewDto = z.infer<typeof AdminOverviewDto>;

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_MAX_PAGE_SIZE = 50;

/**
 * Member search has three axes. `q` matches a member ID exactly, a nickname partially, or an email
 * exactly, all at once. These are not separate fields because the operator cannot know in advance
 * which value they hold: reports carry member IDs, support emails carry addresses, and screenshots
 * carry nicknames.
 *
 * Email is an exact match, not partial. A partial match would let a query such as `@gmail.com`
 * enumerate the member list, turning an operations tool into a leak path.
 */
export const AdminMemberQuery = z.object({
	q: z.string().trim().max(200).default(""),
	status: z.union([MemberStatus, z.literal("")]).default(""),
	role: z.union([MemberRole, z.literal("")]).default(""),
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(ADMIN_MAX_PAGE_SIZE)
		.default(ADMIN_PAGE_SIZE),
});
export type AdminMemberQuery = z.infer<typeof AdminMemberQuery>;

export function toAdminMemberSearchParams(
	query: AdminMemberQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (query.q) sp.set("q", query.q);
	if (query.status) sp.set("status", query.status);
	if (query.role) sp.set("role", query.role);
	if (query.cursor) sp.set("cursor", query.cursor);
	if (query.limit !== ADMIN_PAGE_SIZE) sp.set("limit", String(query.limit));
	return sp;
}

/**
 * One list row, with no email. Search can match an email exactly, but the list never shows one. The
 * two are different operations: searching answers 'is this the member with the address I know',
 * while listing would hand whoever opens the page twenty addresses. Email appears only when a
 * member is opened individually, and that lookup is logged.
 */
export const AdminMemberSummaryDto = z.object({
	id: z.string(),
	nickname: z.string(),
	status: MemberStatus,
	role: MemberRole,
	/** `unknown | child | standard`. An age band, not a birth date. */
	ageStatus: z.string(),
	createdAt: z.iso.datetime(),
	/**
	 * Restrictions active right now. Zero does not mean no sanctions: a suspension is a status, not a
	 * restriction.
	 */
	activeRestrictions: z.number().int().nonnegative(),
});
export type AdminMemberSummaryDto = z.infer<typeof AdminMemberSummaryDto>;

export const AdminMemberPage = z.object({
	items: z.array(AdminMemberSummaryDto),
	nextCursor: z.string().nullable(),
});
export type AdminMemberPage = z.infer<typeof AdminMemberPage>;

/**
 * A live restriction. This is for the operator screen, so it also points to the action that created
 * it.
 */
export const AdminRestrictionDto = z.object({
	id: z.string(),
	capability: ModerationCapability,
	actionId: z.string(),
	createdAt: z.iso.datetime(),
	expiresAt: z.iso.datetime().nullable(),
});
export type AdminRestrictionDto = z.infer<typeof AdminRestrictionDto>;

/**
 * One action taken against this member, as a summary line. Full details live in the moderation
 * case.
 */
export const AdminMemberActionDto = z.object({
	id: z.string(),
	caseId: z.string(),
	kind: z.string(),
	reason: z.string(),
	publicReason: z.string(),
	createdAt: z.iso.datetime(),
	reversedByActionId: z.string().nullable(),
});
export type AdminMemberActionDto = z.infer<typeof AdminMemberActionDto>;

/**
 * Member detail. Public and operator axes stay separate inside one object, not flattened, because
 * the screen must draw that distinction. If an operator cannot tell which values other people also
 * see and which only operators see, they could read an internal value aloud to a user.
 *
 * `email` is here because account support needs it, so this query itself writes an audit entry
 * (`admin.member.view`). The auth account ID (`user.id`) is not included: authorization is keyed by
 * member ID, so operators have no reason to see it.
 */
export const AdminMemberDetailDto = z.object({
	profile: z.object({
		id: z.string(),
		nickname: z.string(),
		bio: z.string(),
		avatarUrl: z.string(),
		followers: z.number().int().nonnegative(),
		stories: z.number().int().nonnegative(),
	}),
	operator: z.object({
		email: z.string(),
		status: MemberStatus,
		role: MemberRole,
		ageStatus: z.string(),
		verified: z.boolean(),
		adult: z.boolean(),
		showAdult: z.boolean(),
		/**
		 * Whether the member is on the managed-generation allowlist. Mirrors the value of
		 * `member.managed_generation_allowed`. Operator and admin roles are always allowed regardless of
		 * this value; the server decides. When the deployment sets `MANAGED_GENERATION_ACCESS=everyone`,
		 * the list is not consulted at all.
		 */
		managedGenerationAllowed: z.boolean(),
		createdAt: z.iso.datetime(),
	}),
	restrictions: z.array(AdminRestrictionDto),
	/**
	 * Recent actions only, not the full history. The full audit trail lives in moderation cases and
	 * the audit log.
	 */
	recentActions: z.array(AdminMemberActionDto),
});
export type AdminMemberDetailDto = z.infer<typeof AdminMemberDetailDto>;

/**
 * Sets adult eligibility manually. Admin only, and not an identity verification step.
 *
 * The member's own check (`services/adult-verification.ts`) reflects what the verifier confirmed.
 * It only turns eligibility on and never removes it. That file leaves revocation to operators, and
 * this operation is that path. It does not create or change `identity_verification` rows, which
 * record what the verifier answered, not an operator's judgment. Operator actions are recorded in
 * the audit log.
 *
 * `verified` (identity check done) and `adult` (19 or older) are separate inputs. They genuinely
 * differ: a verified member under 19 is a valid state. One switch would make revoking adult
 * eligibility also erase the identity fact.
 *
 * `adult` without `verified` is not representable; the schema rejects it. The legal requirement's
 * first half (identity verification) would be missing, and adult publishing would rest on an
 * unverified fact.
 *
 * `showAdult` is not part of the request. Members set it themselves on the web. An operator
 * flipping it would expose content the member never chose, and turning it off on revocation would
 * lose the member's choice at their next normal verification. Without eligibility, adult content
 * stays closed regardless (`canViewAdult` checks three axes).
 *
 * No idempotency key. This sets a target state, so repeating the request gives the same result.
 * Grants and corrections are deltas and need one; this does not.
 */
export const AdminAdultVerificationRequest = z
	.object({
		verified: z.boolean(),
		adult: z.boolean(),
		/**
		 * Required, since the value is written to the audit log. The length cap matches other operator
		 * action reasons.
		 */
		reason: z.string().trim().min(1).max(200),
	})
	.refine((value) => value.verified || !value.adult, {
		message:
			"Adult eligibility cannot be turned on without identity verification.",
		path: ["adult"],
	});
export type AdminAdultVerificationRequest = z.infer<
	typeof AdminAdultVerificationRequest
>;

/**
 * The response carries the three adult axes as stored on the member row, not the values the screen
 * sent. The server does not always follow the request: it refuses to turn adult on for child
 * accounts. The check is re-run inside the same transaction as the write.
 *
 * `showAdult` is included because this response refreshes that field on the detail screen. It also
 * shows that this operation did not change it.
 */
export const AdminAdultVerificationResponse = z.object({
	memberId: z.string(),
	verified: z.boolean(),
	adult: z.boolean(),
	showAdult: z.boolean(),
	/**
	 * Whether this request actually changed the member row. False when re-requested with the same
	 * state.
	 */
	changed: z.boolean(),
});
export type AdminAdultVerificationResponse = z.infer<
	typeof AdminAdultVerificationResponse
>;

/**
 * Managed-generation allowlist: an admin-only target state. In the public build, managed generation
 * uses the operator's provider key. Rate limits (per minute and per day) bound how much one person
 * uses; this list bounds who uses it. It matters only in allowlist mode
 * (`MANAGED_GENERATION_ACCESS=allowlist`, the default). No idempotency key, as with adult
 * eligibility; the reason goes to the audit log.
 */
export const AdminManagedGenerationRequest = z
	.object({
		allowed: z.boolean(),
		reason: z.string().trim().min(1).max(200),
	})
	.strict();
export type AdminManagedGenerationRequest = z.infer<
	typeof AdminManagedGenerationRequest
>;

export const AdminManagedGenerationResponse = z.object({
	memberId: z.string(),
	allowed: z.boolean(),
	changed: z.boolean(),
});
export type AdminManagedGenerationResponse = z.infer<
	typeof AdminManagedGenerationResponse
>;

export const AdminStoryQuery = z.object({
	/** Story ID exact match, or partial match on title. */
	q: z.string().trim().max(200).default(""),
	/** Only works by one creator. A member ID, not a nickname: identity is carried by the ID. */
	ownerId: z.string().trim().max(64).default(""),
	visibility: z.union([StoryVisibility, z.literal("")]).default(""),
	/** Empty for all, `1` for hidden only, `0` for not hidden only. */
	hidden: z.union([z.literal(""), z.literal("0"), z.literal("1")]).default(""),
	/** Empty for all, `1` for adult works only, `0` for all-ages works only. */
	adult: z.union([z.literal(""), z.literal("0"), z.literal("1")]).default(""),
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(ADMIN_MAX_PAGE_SIZE)
		.default(ADMIN_PAGE_SIZE),
});
export type AdminStoryQuery = z.infer<typeof AdminStoryQuery>;

export function toAdminStorySearchParams(
	query: AdminStoryQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (query.q) sp.set("q", query.q);
	if (query.ownerId) sp.set("ownerId", query.ownerId);
	if (query.visibility) sp.set("visibility", query.visibility);
	if (query.hidden) sp.set("hidden", query.hidden);
	if (query.adult) sp.set("adult", query.adult);
	if (query.cursor) sp.set("cursor", query.cursor);
	if (query.limit !== ADMIN_PAGE_SIZE) sp.set("limit", String(query.limit));
	return sp;
}

/**
 * Work row: exposure axes and metrics only, with no play payload (`play_payload`). The payload is
 * authored content. Operators need it only for one reported work, and moderation's evidence already
 * holds that path. Opening it to 'admins see everything' would turn this screen into a reader of
 * every user's manuscripts.
 */
export const AdminStorySummaryDto = z.object({
	id: z.string(),
	title: z.string(),
	/** Null for works whose owner's identity was erased on account deletion. */
	ownerId: z.string().nullable(),
	ownerNickname: z.string().nullable(),
	visibility: StoryVisibility,
	hidden: z.boolean(),
	adult: z.boolean(),
	views: z.number().int().nonnegative(),
	favorites: z.number().int().nonnegative(),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
});
export type AdminStorySummaryDto = z.infer<typeof AdminStorySummaryDto>;

export const AdminStoryPage = z.object({
	items: z.array(AdminStorySummaryDto),
	nextCursor: z.string().nullable(),
});
export type AdminStoryPage = z.infer<typeof AdminStoryPage>;

/**
 * Work detail: the summary plus moderation context and public metadata. `openCaseId` lets an
 * operator act on the case from here. The screen has no hide toggle for this reason: hiding is an
 * enforcement that writes a `moderation_action`. Flipping the column directly here would create a
 * second enforcement path with no audit record (§26).
 */
export const AdminStoryDetailDto = z.object({
	story: AdminStorySummaryDto,
	description: z.string(),
	tags: z.array(z.string()),
	/** Open case for this work; null if none. The screen then does not draw an enforcement path. */
	openCaseId: z.string().nullable(),
	actionCount: z.number().int().nonnegative(),
	/** Unresolved reports filed against this work. */
	openReportCount: z.number().int().nonnegative(),
	commentCount: z.number().int().nonnegative(),
});
export type AdminStoryDetailDto = z.infer<typeof AdminStoryDetailDto>;

/**
 * Operator deletion of a published work (`POST /v2/admin/stories/:id/delete`).
 *
 * There is no in-app delete for published works; a deployment that takes deletion requests through
 * its own contact channel answers them with this operation. A creator's own delete button is a
 * separate product decision.
 *
 * Archive moves one visibility state and can be reversed. Delete is irreversible and has one
 * outcome: the row, its cover, runtime, comments, favorites, and view records are removed together.
 * An earlier variant kept the row when other users had the work in their collection. It was removed
 * when the collection concept went away (`docs/oss/PLAN.md` §3).
 *
 * A work referenced by any moderation action is not deleted. The enforcement records and appeals
 * pointing at it would vanish too, so the server returns 409 (`story_delete_has_enforcement`). Such
 * works are handled by hiding instead.
 *
 * The body is a reason only and is `.strict()`. There is no axis to choose the outcome.
 */
export const AdminStoryDeleteRequest = z
	.object({
		/** Internal reason, written to the audit log. Not shown to the creator. */
		reason: z.string().trim().min(1).max(200),
	})
	.strict();
export type AdminStoryDeleteRequest = z.infer<typeof AdminStoryDeleteRequest>;

export const ADMIN_STORY_DELETE_OUTCOMES = ["deleted"] as const;
export const AdminStoryDeleteOutcome = z.enum(ADMIN_STORY_DELETE_OUTCOMES);
export type AdminStoryDeleteOutcome = z.infer<typeof AdminStoryDeleteOutcome>;

export const AdminStoryDeleteResponse = z.object({
	outcome: AdminStoryDeleteOutcome,
});
export type AdminStoryDeleteResponse = z.infer<typeof AdminStoryDeleteResponse>;

export const ADMIN_STORY_DELETE_ERROR_CODE = {
	/**
	 * An action references this work. Deleting it would remove the enforcement records and appeals
	 * with it (409).
	 */
	enforcement: "story_delete_has_enforcement",
} as const;

/**
 * Notice status for one platform. Two things are absent on purpose:
 * - No consent axis. An app update has nothing to accept; the notice informs and is done.
 * - No email axis. This notice is not sent by email.
 *
 * Absent rather than zero: zero would claim 'no one has consented yet' for a question that was
 * never asked.
 */
export const AppUpdateBroadcastStatusDto = z.object({
	platform: AppPlatform,
	/**
	 * The platform's current floor. Null means there is nothing to announce: the screen draws a
	 * sentence instead of the send button, and the server rejects the request.
	 */
	minVersion: AppVersion.nullable(),
	totalRecipients: z.number().int().nonnegative(),
	/**
	 * Members who received the notice for the current floor. Changing the floor resets this count to
	 * zero, since a new floor is a different event with a different idempotency key. That is the exact
	 * meaning: no one has yet been told about 1.4.0.
	 */
	notifiedRecipients: z.number().int().nonnegative(),
	pendingRecipients: z.number().int().nonnegative(),
	/** Whether every current member has this floor's notice. False when there is no floor. */
	broadcastComplete: z.boolean(),
	/**
	 * Creation time of the latest notice row for this floor; null if never sent. Derived from
	 * notification rows, not a send log.
	 */
	lastNotifiedAt: z.iso.datetime().nullable(),
});
export type AppUpdateBroadcastStatusDto = z.infer<
	typeof AppUpdateBroadcastStatusDto
>;

/** Both platforms, returned even when a platform has no floor row, same as the floor list. */
export const AppUpdateBroadcastStatusesDto = z.object({
	items: z.array(AppUpdateBroadcastStatusDto),
});
export type AppUpdateBroadcastStatusesDto = z.infer<
	typeof AppUpdateBroadcastStatusesDto
>;

/**
 * The platform is in the path, same as the feature switch and floor change. The server reads the
 * version from the floor row. `.strict()` because a silently
 * dropped `{ version: '1.9.0' }` would look like a successful announcement.
 *
 * No free-text message either. The floor row's `message` is the sentence the app draws on its block
 * screen. Accepting arbitrary strings here would turn this operation into a way to send free text
 * to every member.
 */
export const AdminAppUpdateBroadcastRequest = z
	.object({
		reason: z.string().trim().min(1).max(200),
	})
	.strict();
export type AdminAppUpdateBroadcastRequest = z.infer<
	typeof AdminAppUpdateBroadcastRequest
>;

/**
 * The confirmed status as is; the screen does not add numbers. The counts are split because of
 * reruns: the operation is idempotent, so a second call creates nothing, and `alreadyNotified` gives
 * that zero its meaning (everyone already had the notice).
 */
export const AdminAppUpdateBroadcastResponse = z.object({
	status: AppUpdateBroadcastStatusDto,
	notified: z.number().int().nonnegative(),
	alreadyNotified: z.number().int().nonnegative(),
});
export type AdminAppUpdateBroadcastResponse = z.infer<
	typeof AdminAppUpdateBroadcastResponse
>;

/**
 * Audit action. This is a free-form string on purpose. Feature-switch keys form a closed set
 * because a key means something only when a route reads it. Audit actions work the other way: if a
 * new privileged operation appears and the vocabulary is not extended, the operation goes
 * unrecorded. Instead of a closed list, the convention is a prefix (`domain.target.verb`), and the
 * screen draws unknown values as they are.
 *
 * Values in use: `admin.member.view` (member detail views; the only read that exposes email),
 * `admin.member.managed_generation.set`, `admin.app-update.broadcast` (one line in every member's
 * inbox), `ops.feature_flag.set`, and `ops.version_floor.set`.
 */
export const AuditLogEntryDto = z.object({
	id: z.string(),
	/**
	 * The operator who performed the action. Null if that account is deleted; the record itself
	 * remains.
	 */
	operatorMemberId: z.string().nullable(),
	operatorNickname: z.string().nullable(),
	action: z.string(),
	targetType: z.string(),
	targetId: z.string(),
	/**
	 * Values needed to understand the operation. Secrets never appear here. The service chooses what
	 * to include, and a static scan checks the boundary (`lib/no-secret-logging.test.ts`). The field
	 * is free-form JSON because each operation needs different values: a feature switch's before and
	 * after state has nothing in common with an app update notice's version. The axes that queries read
	 * (who, what, when) are all columns.
	 */
	metadata: z.record(z.string(), z.unknown()),
	createdAt: z.iso.datetime(),
});
export type AuditLogEntryDto = z.infer<typeof AuditLogEntryDto>;

export const AuditLogQuery = z.object({
	/** Exact match on the operator's member ID. */
	operatorId: z.string().trim().max(64).default(""),
	/** Prefix match on the action (`ops.` alone shows all operational setting changes). */
	action: z.string().trim().max(120).default(""),
	targetId: z.string().trim().max(64).default(""),
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(ADMIN_MAX_PAGE_SIZE)
		.default(ADMIN_PAGE_SIZE),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

export function toAuditLogSearchParams(query: AuditLogQuery): URLSearchParams {
	const sp = new URLSearchParams();
	if (query.operatorId) sp.set("operatorId", query.operatorId);
	if (query.action) sp.set("action", query.action);
	if (query.targetId) sp.set("targetId", query.targetId);
	if (query.cursor) sp.set("cursor", query.cursor);
	if (query.limit !== ADMIN_PAGE_SIZE) sp.set("limit", String(query.limit));
	return sp;
}

export const AuditLogPage = z.object({
	items: z.array(AuditLogEntryDto),
	nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof AuditLogPage>;

export const ADMIN_ERROR_CODE = {
	/** Operator permission is required; thrown by `requireModeratorViewer`. */
	moderatorRequired: "moderator_required",
	/** Admin permission is required, for operations that staff cannot reach. */
	adminRequired: "admin_required",
	/**
	 * The platform has no version floor set: fail closed. No floor means every version passes, so
	 * there is nothing to announce. A silent success would make the operator think the notice went out
	 * while nothing appears in any inbox.
	 */
	appVersionFloorUnset: "app_version_floor_unset",
} as const;
export type AdminErrorCode =
	(typeof ADMIN_ERROR_CODE)[keyof typeof ADMIN_ERROR_CODE];
