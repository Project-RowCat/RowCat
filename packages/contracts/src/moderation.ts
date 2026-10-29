import { z } from "zod";
import { StoryVisibility } from "./story-visibility.ts";

/**
 * Moderation protocol: the shapes that reports, enforcement and appeals take on the foundation. The
 * file covers four different things, and they are not folded into one:
 * - report: someone asks RowCat to review something.
 * - case: the place where an operator works on one target.
 * - action: one enforcement decision. An immutable audit record.
 * - appeal: a member subject to an action contests it. Folding them into one table or schema
 *   would make 'reported and instantly banned' and 'edited an action' expressible. Both must never
 *   happen (§12, §26), so the vocabularies are split first.
 * - Excluded: any penalty chosen by the reporter. No request schema has `ban`, `suspend`, `hide`
 *   or `delete`. Ignoring such a field is not enough, since an implementation could one day miss
 *   one field and the reporter would then be choosing the penalty. It is made unexpressible (§13).
 * - Excluded: reporter identity (comes only from the session, §14), operator private notes (no
 *   `note` in the member-facing `MyModerationStatusDto`, only `publicReason`, §57), member role
 *   outside `ViewerDto` (§19), and free-string targets (`targetType: string` with `targetId:
 *   string`). Each target needs different values, and a free string lets a request exist that the
 *   server cannot know how to validate (§44).
 */

/**
 * Member role: a product-owned value, stored on the `member` table rather than Better Auth's `user`
 * table. Product authorization columns are not added to the auth library's table (see the header of
 * `db/tables/member.ts`). A role is no exception: authorization must not hang on a column that an
 * adapter upgrade silently drops or renames. There are three values, defaulting to `user`. `staff`
 * and `admin` deliberately share the same permissions for now (§22). Ten grades would leave nine
 * names that no route checks, implying a distinction that is not enforced. If an operation really
 * needs splitting, it will be split next to that operation.
 */
export const MemberRole = z.enum(["user", "staff", "admin"]);
export type MemberRole = z.infer<typeof MemberRole>;

/**
 * Roles allowed into the moderation tools. The route gate and the screens use this same predicate.
 */
export const MODERATOR_ROLES: readonly MemberRole[] = ["staff", "admin"];
export const isModeratorRole = (role: MemberRole): boolean =>
	MODERATOR_ROLES.includes(role);

/**
 * Capability restriction vocabulary: only capabilities that a route actually checks (§34).
 * - comment.write: write story comments (POST /v2/stories/:id/comments)
 * - social.write: follows and favorites (PUT /v2/follows, PUT /v2/favorites/:id)
 * - story.publish: publish and update published stories (POST /v2/stories, PUT /v2/stories/:id)
 *
 * `chat.generate` is absent on purpose: deferred, not forgotten. Chat generation has two paths, and
 * server authority exists on only one. The managed path (RowCat key) goes through POST
 * /v2/chat/generate, so the server can block it. BYO calls the provider directly from the browser
 * and never passes through the server. The web app can hide it on its own screen, but that is
 * client policy, not enforcement. If `chat.generate` were in this vocabulary, a restricted user
 * could lift the restriction by entering their own API key in settings, and a 'generation is
 * restricted' message would then be false. Routing BYO through the RowCat server to close the gap
 * is worse, because it voids BYO's privacy design (§41). A managed-only restriction, when needed,
 * must be named for the scope it actually covers (§P1).
 */
export const ModerationCapability = z.enum([
	"comment.write",
	"social.write",
	"story.publish",
]);
export type ModerationCapability = z.infer<typeof ModerationCapability>;

/**
 * Label used to put a restriction into words on screen. Server decisions do not read this value.
 */
export const CAPABILITY_LABEL: Record<ModerationCapability, string> = {
	"comment.write": "Writing comments",
	"social.write": "Follows and favorites",
	"story.publish": "Story publishing",
};

/**
 * Report reason: one bounded vocabulary (§10). Do not add fine-grained subcategories that are not
 * in the policy document. The eleven values here are the axes operators actually respond to
 * differently. Finer splits would give reporters a list that is hard to choose from, and the queue
 * would converge them to the same handling anyway. `other` is last on purpose. A person who meets a
 * problem not on the list should not pick something arbitrary and pollute the statistics. `details`
 * is where they write it.
 */
export const ReportReason = z.enum([
	"sexual_content",
	"minor_safety",
	"harassment",
	"hate",
	"violence",
	"self_harm",
	"illegal",
	"spam",
	"impersonation",
	"copyright_or_ip",
	"other",
]);
export type ReportReason = z.infer<typeof ReportReason>;

/**
 * Report screen labels. The order follows the enum above; the screen does not rearrange what the
 * server defines.
 */
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
	sexual_content: "Sexual content",
	minor_safety: "Minor safety",
	harassment: "Harassment or bullying",
	hate: "Hate speech",
	violence: "Violence or threats",
	self_harm: "Self-harm or suicide",
	illegal: "Illegal activity",
	spam: "Spam or flooding",
	impersonation: "Impersonation",
	copyright_or_ip: "Copyright or rights infringement",
	other: "Something else",
};

/** Kind of report target: exactly four values, and no free-form string. */
export const ReportTargetType = z.enum([
	"story",
	"comment",
	"member",
	"ai_response",
]);
export type ReportTargetType = z.infer<typeof ReportTargetType>;

export const REPORT_TARGET_LABEL: Record<ReportTargetType, string> = {
	story: "Story",
	comment: "Comment",
	member: "Profile",
	ai_response: "AI response",
};

/**
 * Maximum lengths for report text. **These values are the only authority.** The screen (character
 * counter, submit lock) and the server must read the same values. Separate copies would let the
 * screen pass a report that the server rejects with a 400 the user cannot explain (same reason as
 * the comment limits). `aiEvidenceContent` is the largest because it is one chat response. It still
 * has a limit because that text is plaintext leaving E2EE. Without one, 'upload the whole
 * conversation' would be expressible in a single report (§4, §11).
 */
export const REPORT_LIMITS = {
	details: 1_000,
	/** One block of AI-response evidence: the response body, or the user's message just before it. */
	aiEvidenceContent: 4_000,
	/** Non-secret metadata string, such as provider or model name. */
	aiEvidenceLabel: 120,
	operatorReason: 1_000,
	/** Reason shown to the target of the enforcement. Separate from the internal `operatorReason`. */
	publicReason: 300,
	appealMessage: 2_000,
} as const;

/**
 * AI response evidence: the one path by which data leaves E2EE in this repo. Conversations belong
 * to the device, and the server holds only ciphertext. So a report that says 'this AI response is
 * the problem' has no server row to point at, and no server message id is invented to pretend
 * otherwise. Instead, the user reviews what will be uploaded and confirms, and only that content
 * goes up in plaintext. Only these may be included:
 * - response: the one reported assistant response
 * - precedingUserMessage: the user's message just before it (optional)
 * - model / provider: non-secret generation metadata (optional) Room history, room memory, story
 *   seed, lore, system prompt, BYO keys, generation preferences and other messages have no place in
 *   the schema (§4). The object is `.strict()`, so an unknown key anywhere rejects the whole
 *   request. Room ids and message ids are not sent. The server has nothing to look them up with,
 *   and they are device-local identifiers that could be joined with other reports or devices.
 */
export const AiResponseEvidenceMessage = z
	.object({
		content: z.string().trim().min(1).max(REPORT_LIMITS.aiEvidenceContent),
		/** ISO 8601. The operator uses it to place the response in context. */
		createdAt: z.iso.datetime(),
	})
	.strict();
export type AiResponseEvidenceMessage = z.infer<
	typeof AiResponseEvidenceMessage
>;

export const AiResponseEvidence = z
	.object({
		response: AiResponseEvidenceMessage,
		/**
		 * Preceding user message. Optional, and included only after the screen has shown it to the user.
		 * If present, the operator knows what the response answered; if absent, only the response is
		 * seen. Including it by default is fine, but the screen must let the user remove it.
		 */
		precedingUserMessage: AiResponseEvidenceMessage.optional(),
		/**
		 * Model that produced the response. Not a secret. The value is what the chat message already
		 * holds from the generation stream's `usage` event (`ChatMessage.model`). Keys, endpoints and
		 * Authorization headers never reach this field in any form (§54). **The provider class (managed
		 * or BYO) is not sent.** It would be useful, but the report cannot determine it reliably: the
		 * response may have come from another device or other settings, and deriving it from the current
		 * connection yields a label unrelated to that response. An operator reading that label as 'RowCat
		 * called this on your behalf' would be making a judgment error. Once generation records the fact
		 * on the message, the field can be added.
		 */
		model: z.string().trim().max(REPORT_LIMITS.aiEvidenceLabel).optional(),
	})
	.strict();
export type AiResponseEvidence = z.infer<typeof AiResponseEvidence>;

/**
 * Snapshot of the public target, **built by the server**. The request schema has no slot where the
 * client could send it (see `ReportTarget` below). As with replay snapshots, if the reporter could
 * fabricate the evidence, it would not be evidence. The server takes the snapshot from the row it
 * has just read. The point is not to copy the whole account or story row (§7). This holds the
 * minimum that answers 'what was reported at that time'. Email, date of birth, adult-verification
 * state, member status, the sync keyring and BYO connections appear in no snapshot (§8).
 */
export const StoryReportEvidence = z
	.object({
		title: z.string(),
		description: z.string(),
		adult: z.boolean(),
		/** Modification time at report time, so the operator can tell later whether it was edited. */
		updatedAt: z.iso.datetime(),
	})
	.strict();
export type StoryReportEvidence = z.infer<typeof StoryReportEvidence>;

export const CommentReportEvidence = z
	.object({
		body: z.string(),
		authorId: z.string(),
		storyId: z.string(),
		createdAt: z.iso.datetime(),
	})
	.strict();
export type CommentReportEvidence = z.infer<typeof CommentReportEvidence>;

/**
 * Evidence for a member report is **only the public profile projection**, never private account
 * data (§7, §8).
 */
export const MemberReportEvidence = z
	.object({
		displayName: z.string(),
		bio: z.string(),
	})
	.strict();
export type MemberReportEvidence = z.infer<typeof MemberReportEvidence>;

/**
 * Stored evidence: a discriminated union by target kind. `type` is stored with the evidence because
 * the operator screen must know what it is looking at (§53). In particular, `ai_response` is a
 * private conversation the user uploaded, so that fact must be in the data for the screen to draw
 * it as a different kind of card.
 */
export const ReportEvidence = z.discriminatedUnion("type", [
	z.object({ type: z.literal("story"), snapshot: StoryReportEvidence }),
	z.object({ type: z.literal("comment"), snapshot: CommentReportEvidence }),
	z.object({ type: z.literal("member"), snapshot: MemberReportEvidence }),
	z.object({ type: z.literal("ai_response"), snapshot: AiResponseEvidence }),
]);
export type ReportEvidence = z.infer<typeof ReportEvidence>;

/**
 * Report target: one discriminated union stands in for four endpoints (§43, §44). Public targets
 * carry **only an id**. The snapshot is built by the server (see above), so this schema has no
 * place for a title, body or nickname. A comment also carries its story id, because that is part of
 * the ownership relation. The server checks the (storyId, commentId) pair, so a comment from
 * another story cannot be pointed at as if it belonged to this one. Only `ai_response` carries
 * evidence. The server can see nothing else for it, so this is the only place in the slice that
 * leaves E2EE.
 */
export const ReportTarget = z.discriminatedUnion("type", [
	z.object({ type: z.literal("story"), storyId: z.string().min(1) }),
	z.object({
		type: z.literal("comment"),
		storyId: z.string().min(1),
		commentId: z.string().min(1),
	}),
	z.object({ type: z.literal("member"), memberId: z.string().min(1) }),
	z.object({ type: z.literal("ai_response"), evidence: AiResponseEvidence }),
]);
export type ReportTarget = z.infer<typeof ReportTarget>;

/**
 * Report intake: `POST /v2/reports`. It carries only three things: what, why, and optionally a
 * note. There is no penalty field (§13). There is no reporter id either (§14): it comes from the
 * session only.
 */
export const ReportCreateRequest = z.object({
	target: ReportTarget,
	reason: ReportReason,
	/** Optional. Leading and trailing whitespace is trimmed by the contract, as with comments. */
	details: z.string().trim().max(REPORT_LIMITS.details).default(""),
});
export type ReportCreateRequest = z.infer<typeof ReportCreateRequest>;

/**
 * Intake confirmation returns the **minimum** (§49). It carries no case id, no count of other
 * reports on the same target, and no current operator action. The reporter has no use for those
 * values. A count would also signal that a target has already been reported many times, which is
 * usable for coordinating targeted reports. The reporter only needs to know that intake happened.
 */
export const ReportCreateResponse = z.object({
	reportId: z.string(),
	createdAt: z.iso.datetime(),
});
export type ReportCreateResponse = z.infer<typeof ReportCreateResponse>;

/**
 * Failure codes the report path branches on. Clients branch on this value, not on the HTTP status.
 */
export const REPORT_ERROR_CODE = {
	/** The same reporter already has an unresolved report on the same target (§17). */
	duplicate: "report_duplicate",
	/** Too many reports in a short time. `Retry-After` comes with it (§16). */
	rateLimited: "report_rate_limited",
	/**
	 * Self-reporting as a member target. Not a security verdict: it is a meaningless request (§15).
	 */
	selfTarget: "report_self_target",
} as const;
export type ReportErrorCode =
	(typeof REPORT_ERROR_CODE)[keyof typeof REPORT_ERROR_CODE];

/**
 * Kinds of enforcement action. The key point of this vocabulary is that reversals are **separate
 * kinds** (§26). Lifting a hide does not erase the hide record; it writes a new one. That is how
 * 'hidden when, unhidden when' stays in the audit trail. The API has no path that edits or deletes
 * an original action.
 * - hide_story / unhide_story: operator hide of a story (the creator's visibility is untouched)
 * - remove_comment: deletes a comment; irreversible (the original text stays in the action's
 *   snapshot)
 * - suspend_member / ban_member: account state
 * - restore_member: reverts all active account actions for that member
 * - restrict_capability / unrestrict_capability: capability restriction
 */
export const ModerationActionKind = z.enum([
	"hide_story",
	"unhide_story",
	"remove_comment",
	"suspend_member",
	"ban_member",
	"restore_member",
	"restrict_capability",
	"unrestrict_capability",
]);
export type ModerationActionKind = z.infer<typeof ModerationActionKind>;

export const MODERATION_ACTION_LABEL: Record<ModerationActionKind, string> = {
	hide_story: "Hide story",
	unhide_story: "Unhide story",
	remove_comment: "Delete comment",
	suspend_member: "Suspend account",
	ban_member: "Ban account",
	restore_member: "Restore account",
	restrict_capability: "Restrict capability",
	unrestrict_capability: "Lift capability restriction",
};

/**
 * Actions that can be appealed. The reversing kinds (`unhide_story`, `restore_member`,
 * `unrestrict_capability`) are excluded, since contesting the lifting of a sanction is not
 * meaningful. `remove_comment` is excluded too. There is no server path to restore a deleted
 * comment (unlike §28, comments have no hidden state), so an appeal accepted for it could not be
 * executed. Accepting an appeal that cannot be executed only creates the impression that it was
 * received.
 */
export const APPEALABLE_ACTION_KINDS: readonly ModerationActionKind[] = [
	"hide_story",
	"suspend_member",
	"ban_member",
	"restrict_capability",
];
export const isAppealableActionKind = (kind: ModerationActionKind): boolean =>
	APPEALABLE_ACTION_KINDS.includes(kind);

/**
 * Action request: `POST /v2/moderation/actions`. **An internal reason is required** (§56). The
 * schema blocks an enforcement with an empty reason. The reason shown to the user (`publicReason`)
 * is optional; if empty, the screen names only the kind. The two are kept separate per §57: an
 * operator memo must never reach the target by accident.
 */
export const ModerationActionRequest = z.object({
	/** The case this action belongs to. A case is attached to one target. */
	caseId: z.string().min(1),
	kind: ModerationActionKind,
	/** Operator's internal reason, required. Not sent to the enforcement target. */
	reason: z.string().trim().min(1).max(REPORT_LIMITS.operatorReason),
	/** Reason the enforcement target reads. If empty, the screen names only the action kind. */
	publicReason: z.string().trim().max(REPORT_LIMITS.publicReason).default(""),
	/** Used only by `restrict_capability` and `unrestrict_capability`. */
	capability: ModerationCapability.optional(),
	/**
	 * Expiry of a capability restriction. Optional; absent means indefinite. Account suspension and
	 * ban have no expiry (§68). Adding one would make the state depend on the clock, and
	 * `member.status` would silently fall behind without a sweep job. A capability restriction avoids
	 * that: the gate checks expiry on every request, so it is accurate without a sweep (§67).
	 */
	expiresAt: z.iso.datetime().optional(),
});
export type ModerationActionRequest = z.infer<typeof ModerationActionRequest>;

export const ReportStatus = z.enum(["open", "resolved", "dismissed"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const MODERATION_PAGE_SIZE = 25;
export const MODERATION_MAX_PAGE_SIZE = 50;

/**
 * Queue query parameters. It is one list rather than an analytics dashboard, so there are only
 * three axes (§52).
 */
export const ModerationQueueQuery = z.object({
	status: ReportStatus.default("open"),
	/** An empty string means all kinds. */
	targetType: z.union([ReportTargetType, z.literal("")]).default(""),
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(MODERATION_MAX_PAGE_SIZE)
		.default(MODERATION_PAGE_SIZE),
});
export type ModerationQueueQuery = z.infer<typeof ModerationQueueQuery>;

export function toModerationQueueSearchParams(
	query: ModerationQueueQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (query.status !== "open") sp.set("status", query.status);
	if (query.targetType) sp.set("targetType", query.targetType);
	if (query.cursor) sp.set("cursor", query.cursor);
	if (query.limit !== MODERATION_PAGE_SIZE)
		sp.set("limit", String(query.limit));
	return sp;
}

/**
 * Queue row. It carries no evidence: a list should not ship private conversations twenty at a time.
 * The operator only needs enough here to decide what to look at first. Evidence is in the detail
 * view.
 */
export const ModerationReportSummaryDto = z.object({
	id: z.string(),
	caseId: z.string(),
	targetType: ReportTargetType,
	/** `ai_response` has no server target, so this is null. */
	targetId: z.string().nullable(),
	reason: ReportReason,
	status: ReportStatus,
	createdAt: z.iso.datetime(),
	/** Reports attached to this case. Volume is itself an input to judgment (§24). */
	caseReportCount: z.number().int().nonnegative(),
});
export type ModerationReportSummaryDto = z.infer<
	typeof ModerationReportSummaryDto
>;

export const ModerationQueuePage = z.object({
	items: z.array(ModerationReportSummaryDto),
	nextCursor: z.string().nullable(),
});
export type ModerationQueuePage = z.infer<typeof ModerationQueuePage>;

/**
 * Action row: the audit record the operator sees. `reason` (the internal memo) is here and absent
 * from member responses. Two DTOs keep §57 structural: the types differ, so no field-picking step
 * can forget to remove it.
 */
export const ModerationActionDto = z.object({
	id: z.string(),
	kind: ModerationActionKind,
	/**
	 * Operator who ran the action. Null when that account withdraws: the record stays, only the
	 * identity disappears.
	 */
	actorId: z.string().nullable(),
	targetMemberId: z.string().nullable(),
	targetStoryId: z.string().nullable(),
	targetCommentId: z.string().nullable(),
	capability: ModerationCapability.nullable(),
	reason: z.string(),
	publicReason: z.string(),
	createdAt: z.iso.datetime(),
	expiresAt: z.iso.datetime().nullable(),
	/** Id of the action that reversed this one. If present, this action is no longer active. */
	reversedByActionId: z.string().nullable(),
});
export type ModerationActionDto = z.infer<typeof ModerationActionDto>;

/**
 * Report detail: three things, carried separately (§53).
 * - evidence: the snapshot at report time (private conversation evidence is here too)
 * - current: the target's present state, which may have been edited or removed since
 * - caseActions: actions taken so far on this case `current` is nullable on purpose: null means
 *   the reported comment was already deleted or the story is gone. The operator needs to see that
 *   next to the snapshot to judge.
 */
export const ModerationTargetCurrentDto = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("story"),
		id: z.string(),
		title: z.string(),
		description: z.string(),
		adult: z.boolean(),
		hidden: z.boolean(),
		/**
		 * Creator's exposure state, a **separate axis** from operator hiding (§27). The enum is not
		 * restated here. A hand-copied list went stale when `unlisted` was added: this schema kept the
		 * old values, and the mismatch surfaced only when the server returned the state to the review
		 * screen and response validation failed. That would have blocked opening reports on link-shared
		 * stories.
		 */
		visibility: StoryVisibility,
		ownerId: z.string().nullable(),
		updatedAt: z.iso.datetime(),
	}),
	z.object({
		type: z.literal("comment"),
		id: z.string(),
		storyId: z.string(),
		authorId: z.string(),
		body: z.string(),
		createdAt: z.iso.datetime(),
	}),
	z.object({
		type: z.literal("member"),
		id: z.string(),
		displayName: z.string(),
		bio: z.string(),
		/** Axis visible only on the operator screen. Not in public profiles (§19, §85). */
		status: z.enum(["approved", "suspended", "banned"]),
	}),
]);
export type ModerationTargetCurrentDto = z.infer<
	typeof ModerationTargetCurrentDto
>;

export const ModerationReportDetailDto = z.object({
	id: z.string(),
	caseId: z.string(),
	targetType: ReportTargetType,
	targetId: z.string().nullable(),
	reason: ReportReason,
	details: z.string(),
	status: ReportStatus,
	createdAt: z.iso.datetime(),
	/** Null for a report whose reporter identity was erased by account withdrawal (§70). */
	reporterId: z.string().nullable(),
	evidence: ReportEvidence,
	current: ModerationTargetCurrentDto.nullable(),
	caseReports: z.array(ModerationReportSummaryDto),
	caseActions: z.array(ModerationActionDto),
});
export type ModerationReportDetailDto = z.infer<
	typeof ModerationReportDetailDto
>;

export const ModerationResolveRequest = z.object({
	status: z.enum(["resolved", "dismissed"]),
	note: z.string().trim().max(REPORT_LIMITS.operatorReason).default(""),
});
export type ModerationResolveRequest = z.infer<typeof ModerationResolveRequest>;

export const AppealStatus = z.enum(["open", "accepted", "rejected"]);
export type AppealStatus = z.infer<typeof AppealStatus>;

/**
 * Appeal: `POST /v2/me/moderation/appeals`. The target is **one action**. The request does not say
 * whose action it is: the server matches the session member against the action's `target_member`.
 * Pointing at someone else's action gets the same 404 as a nonexistent one (§62).
 */
export const AppealCreateRequest = z.object({
	actionId: z.string().min(1),
	message: z.string().trim().min(1).max(REPORT_LIMITS.appealMessage),
});
export type AppealCreateRequest = z.infer<typeof AppealCreateRequest>;

/**
 * The appeal as the member sees it. The operator's resolution note (`resolutionNote`) is not sent.
 */
export const MyAppealDto = z.object({
	id: z.string(),
	actionId: z.string(),
	status: AppealStatus,
	createdAt: z.iso.datetime(),
	resolvedAt: z.iso.datetime().nullable(),
});
export type MyAppealDto = z.infer<typeof MyAppealDto>;

/** The appeal as the operator sees it, including the body and the resolution note. */
export const ModerationAppealDto = z.object({
	id: z.string(),
	actionId: z.string(),
	memberId: z.string(),
	message: z.string(),
	status: AppealStatus,
	createdAt: z.iso.datetime(),
	resolvedAt: z.iso.datetime().nullable(),
	resolverId: z.string().nullable(),
	resolutionNote: z.string(),
	/** The appealed action. The operator decides from this whether to reverse it. */
	action: ModerationActionDto,
});
export type ModerationAppealDto = z.infer<typeof ModerationAppealDto>;

export const ModerationAppealsPage = z.object({
	items: z.array(ModerationAppealDto),
	nextCursor: z.string().nullable(),
});
export type ModerationAppealsPage = z.infer<typeof ModerationAppealsPage>;

export const ModerationAppealResolveRequest = z.object({
	status: z.enum(["accepted", "rejected"]),
	note: z.string().trim().max(REPORT_LIMITS.operatorReason).default(""),
});
export type ModerationAppealResolveRequest = z.infer<
	typeof ModerationAppealResolveRequest
>;

export const APPEAL_ERROR_CODE = {
	/** The same action already has an unresolved appeal (§63). */
	duplicate: "appeal_duplicate",
	/** Action kind that cannot be appealed, such as a reversing action. */
	notAppealable: "appeal_not_appealable",
	/** The action was already reversed, so there is nothing left to contest. */
	alreadyReversed: "appeal_already_reversed",
	/** Too many attempts in a short time. `Retry-After` comes with it. */
	rateLimited: "appeal_rate_limited",
} as const;
export type AppealErrorCode =
	(typeof APPEAL_ERROR_CODE)[keyof typeof APPEAL_ERROR_CODE];

/**
 * One capability restriction in effect, **in the shape the member reads**. It has no internal
 * reason. It says which capability is restricted, when it expires, why (the public reason), and
 * whether an appeal is possible. That is the minimum the screen needs to answer the four questions
 * in §59.
 */
export const MyRestrictionDto = z.object({
	capability: ModerationCapability,
	/** The action that created this restriction. It is the target of an appeal. */
	actionId: z.string(),
	publicReason: z.string(),
	createdAt: z.iso.datetime(),
	/** Null means the restriction has no expiry. */
	expiresAt: z.iso.datetime().nullable(),
});
export type MyRestrictionDto = z.infer<typeof MyRestrictionDto>;

/** An active action (suspension or ban) that currently sets the account state. */
export const MyAccountActionDto = z.object({
	actionId: z.string(),
	kind: z.enum(["suspend_member", "ban_member"]),
	publicReason: z.string(),
	createdAt: z.iso.datetime(),
});
export type MyAccountActionDto = z.infer<typeof MyAccountActionDto>;

/**
 * Hiding action on my story. The creator needs to know why their story is missing from the gallery.
 */
export const MyStoryActionDto = z.object({
	actionId: z.string(),
	storyId: z.string(),
	publicReason: z.string(),
	createdAt: z.iso.datetime(),
});
export type MyStoryActionDto = z.infer<typeof MyStoryActionDto>;

/**
 * `GET /v2/me/moderation`: a resource **split off from `/me`** (§58). `/me` is the hottest read:
 * root SSR, the header and the auth guard hit it on every request. Putting the restriction list and
 * appeal status there would make every route's HTML carry the person's sanction history. A value
 * that only the account screen reads should be a query of its own (the same reasoning that split
 * email into `/me/account`). An account with no restrictions still gets a normal response with
 * empty arrays. A 404 would make it impossible for the screen to tell 'no restrictions' from
 * 'lookup failed'.
 */
export const MyModerationStatusDto = z.object({
	status: z.enum(["approved", "suspended", "banned"]),
	/** Active actions currently setting the account status. Empty when `approved`. */
	accountActions: z.array(MyAccountActionDto),
	restrictions: z.array(MyRestrictionDto),
	hiddenStories: z.array(MyStoryActionDto),
	/** Appeals I have filed. The same action cannot have two open appeals (§63). */
	appeals: z.array(MyAppealDto),
	/**
	 * Ids of actions that can be appealed right now. The screen uses this to decide whether to draw
	 * the button.
	 */
	appealableActionIds: z.array(z.string()),
});
export type MyModerationStatusDto = z.infer<typeof MyModerationStatusDto>;

/**
 * Failure code for requests blocked by a capability restriction. Clients pick the guidance text
 * from it.
 */
export const CAPABILITY_ERROR_CODE = {
	restricted: "capability_restricted",
} as const;

/**
 * Status the reporter sees, with **only two values**: `reviewing` and `reviewed`. This is a
 * different vocabulary from the database `ReportStatus` (open, resolved, dismissed) on purpose.
 * Those three are axes operators handle differently, but the reporter asks only one question: has
 * RowCat reviewed my reports? Exactly what action was taken is not answered here, and this type has
 * no slot for it. `dismissed` is not shown as `Dismissed`. That would expose an internal disposition
 * ('review found nothing to act on') as a statement of what was decided, and give the other party
 * material to infer what did or did not happen. Because the vocabulary differs, not only the
 * projection, a later screen that draws the raw status cannot erase the boundary.
 */
export const MyReportState = z.enum(["reviewing", "reviewed"]);
export type MyReportState = z.infer<typeof MyReportState>;

/**
 * Maps the internal disposition to the reporter's status. **This function is the single
 * authority.** The server projection goes through it, and screens receive only the result. If the
 * mapping were an inline ternary in the service, a second consumer (a later Expo client, or an
 * operator console preview) would hold a copy that drifts. The drift has a known direction: one
 * side starts exposing `dismissed`.
 */
export const myReportStateOf = (status: ReportStatus): MyReportState =>
	status === "open" ? "reviewing" : "reviewed";

/**
 * Reporter-screen labels. `Dismissed` and `Resolved` (the operator queue wording) are deliberately absent. If
 * both vocabularies sat on the same line, someone would eventually adopt the operator wording
 * because it seems more precise. From then on this screen would start stating dispositions.
 */
export const MY_REPORT_STATE_LABEL: Record<MyReportState, string> = {
	reviewing: "In review",
	reviewed: "Reviewed",
};

export const MY_REPORTS_PAGE_SIZE = 20;
export const MY_REPORTS_MAX_PAGE_SIZE = 50;

/**
 * List query parameters: **the only axes are the cursor and the count.** There is no `reporterId`,
 * `memberId` or `viewerId`. That is not 'accepted and ignored': it cannot be expressed. Ownership
 * comes only from the session, the same axis as notifications and sync. There is no status filter
 * either. With two values, tabs would each get their own cache slot and empty state, and the only
 * gain would be splitting a twenty-row list into two pieces.
 */
export const MyReportsQuery = z.object({
	/**
	 * Empty string is the first page. This follows the repo's convention for queries where unspecified
	 * means empty string.
	 */
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(MY_REPORTS_MAX_PAGE_SIZE)
		.default(MY_REPORTS_PAGE_SIZE),
});
export type MyReportsQuery = z.infer<typeof MyReportsQuery>;

export function toMyReportsSearchParams(
	query: MyReportsQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (query.cursor) sp.set("cursor", query.cursor);
	if (query.limit !== MY_REPORTS_PAGE_SIZE)
		sp.set("limit", String(query.limit));
	return sp;
}

/**
 * A report row as the reporter sees it. **Allow-list.** It does not reuse
 * `ModerationReportSummaryDto`, which has `caseId`, `caseReportCount` and the internal `status`.
 * Reusing it would make this response carry them. The boundary is that this is a **different
 * type**, not a field-picking step: omission can be forgotten, and that only shows after a value
 * has leaked.
 * - Not the case id (`caseId`) or the count of reports on the same target (`caseReportCount`).
 *   The count can coordinate targeted reports or reveal moderation activity, and the intake
 *   response already leaves it out for the same reason (§49).
 * - Not the operator (`resolver`) or the resolution note (`resolutionNote`). The first is an
 *   identity and the second an internal record. `MyModerationStatusDto` already draws the same line
 *   (§57).
 * - Not the evidence (`evidence`). AI-response evidence is the user's own private conversation,
 *   and story or comment evidence copies content an operator may have removed. Redrawing it here
 *   would keep deleted content on the reporter's account screen.
 * - Not the target's current state (`hidden`, `deleted`, `suspended`). That answers 'what
 *   happened to the other party', which is not this screen's question, and it would become a
 *   detector for existence and moderation.
 * - Not `targetId`. The reporter already knows which story or comment they chose. Sending it back
 *   would make this list a tool for checking whether an id is still valid.
 */
export const MyReportDto = z.object({
	id: z.string(),
	targetType: ReportTargetType,
	reason: ReportReason,
	state: MyReportState,
	createdAt: z.iso.datetime(),
	/** Time the review finished. Null while `reviewing`. */
	reviewedAt: z.iso.datetime().nullable(),
});
export type MyReportDto = z.infer<typeof MyReportDto>;

/**
 * One page of my reports, **newest first**. This is intentionally the reverse of the operator queue
 * (oldest first). The queue's order is policy, since the report that has waited longest is seen
 * first. This list is where a person checks how a report they just filed is doing, like an inbox,
 * so it uses that axis. There is no total count. The number of reports is not a question this
 * screen needs to answer, and showing it would lead users to manage the volume of their report
 * history.
 */
export const MyReportsPage = z.object({
	items: z.array(MyReportDto),
	nextCursor: z.string().nullable(),
});
export type MyReportsPage = z.infer<typeof MyReportsPage>;
