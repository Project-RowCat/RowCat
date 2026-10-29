import {
	type AdminMobileUpdatePublishRequest,
	type AdminMobileUpdateReleaseDto,
	MOBILE_UPDATE_COMMIT_PATTERN,
	MOBILE_UPDATE_NOTE_ID_PATTERN,
	type MobileUpdateChannel,
	type MobileUpdateEventAction,
	type MobileUpdateInitialRollout,
	type MobileUpdateJobKind,
	type MobileUpdateJobStage,
	type MobileUpdateJobStatus,
	type MobileUpdatePlatform,
	type MobileUpdateRecoveryKind,
	type MobileUpdateSourceBranch,
	type MobileUpdateStatus,
} from "@rowcat/contracts";
import {
	hasMobileUpdateCapability,
	type MobileUpdateCapability,
	nextRolloutSteps,
	type Viewer,
} from "@rowcat/domain";

/**
 * Decisions for the mobile OTA screens — choosing which buttons to draw, not authorization.
 *
 * The server's transition table and capability gate are the authority. The screen reads the same
 * tables (`nextRolloutSteps` · `hasMobileUpdateCapability`) so nothing is drawn that answers
 * 409/403 when pressed; a decreasing rollout has no cell to draw at all.
 */

export const CHANNEL_LABEL: Record<MobileUpdateChannel, string> = {
	production: "Production",
	testflight: "TestFlight",
	preview: "Preview",
};

export const PLATFORM_LABEL: Record<MobileUpdatePlatform, string> = {
	ios: "iOS",
	android: "Android",
};

/** The server's status vocabulary with labels attached; no screen-only states are invented. */
export const STATUS_LABEL: Record<MobileUpdateStatus, string> = {
	draft: "draft",
	active: "Active",
	paused: "Paused",
	rolled_back: "Rolled back",
};

export const STATUS_TONE: Record<
	MobileUpdateStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	active: "default",
	draft: "secondary",
	paused: "destructive",
	rolled_back: "outline",
};

export const EVENT_LABEL: Record<MobileUpdateEventAction, string> = {
	register: "Register",
	rollout: "Rollout",
	pause: "Pause",
	resume: "Resume",
	rollback: "Roll back",
};

export const JOB_KIND_LABEL: Record<MobileUpdateJobKind, string> = {
	publish: "Publish",
	rollback: "Roll back",
};

export const JOB_STATUS_LABEL: Record<MobileUpdateJobStatus, string> = {
	queued: "Queued",
	running: "Running",
	succeeded: "Succeeded",
	failed: "Failed",
	cancelled: "Cancelled",
};

export const JOB_STATUS_TONE: Record<
	MobileUpdateJobStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	queued: "secondary",
	running: "default",
	succeeded: "outline",
	failed: "destructive",
	cancelled: "outline",
};

export const STAGE_LABEL: Record<MobileUpdateJobStage, string> = {
	source: "Source check",
	install: "Dependency install",
	environment: "Channel environment",
	runtime: "Native runtime",
	update_note: "Update note",
	checks: "Checks",
	export: "Export",
	assets: "Asset upload",
	signing: "Signing",
	registration: "Registration",
	plan: "Rollback plan",
	unknown: "Unknown",
};

export const RECOVERY_LABEL: Record<MobileUpdateRecoveryKind, string> = {
	republish: "Re-signs the previous good release with a new timestamp",
	embedded:
		"Issues a signed instruction to return to the store binary's bundle",
	none: "It was a draft: no installs had it, so only the state is rolled back",
	blocked: "Can't roll back because a newer active release exists",
};

export const shortCommit = (sha: string | null): string =>
	sha ? sha.slice(0, 7) : "—";

export const can = (
	viewer: Viewer | null | undefined,
	capability: MobileUpdateCapability,
) => hasMobileUpdateCapability(viewer, capability);

export interface ReleaseActions {
	rolloutSteps: number[];
	pause: boolean;
	resume: boolean;
	rollback: boolean;
}

export function releaseActions(
	release: Pick<
		AdminMobileUpdateReleaseDto,
		"status" | "rolloutPercentage" | "kind"
	>,
	viewer: Viewer | null | undefined,
): ReleaseActions {
	const operate = can(viewer, "operate");
	const publish = can(viewer, "publish");
	return {
		rolloutSteps: operate
			? nextRolloutSteps(
					release.status,
					release.rolloutPercentage,
					release.kind,
				)
			: [],
		pause: operate && release.status === "active",
		resume: operate && release.status === "paused",
		rollback: publish && release.status !== "rolled_back",
	};
}

export interface PublishDraft {
	channel: MobileUpdateChannel | "";
	platform: MobileUpdatePlatform | "";
	sourceKind: "branch" | "commit";
	branch: MobileUpdateSourceBranch;
	commit: string;
	/** `"draft"` or an integer string. */
	rollout: string;
	/** A note date id or `"none"`; empty means not chosen yet. */
	note: string;
	reason: string;
}

export type PublishIssues = Partial<Record<keyof PublishDraft, string>>;

/** Production offers only draft (publishing is two steps). */
export const initialRolloutChoices = (
	channel: MobileUpdateChannel | "",
): { value: string; label: string }[] =>
	channel === "production"
		? [{ value: "draft", label: "draft: goes to nobody" }]
		: [
				{ value: "draft", label: "draft: goes to nobody" },
				{ value: "5", label: "5%" },
				{ value: "10", label: "10%" },
				{ value: "100", label: "100%" },
			];

/**
 * The browser picks only closed values: runtime version, API origin and manifest fields have no
 * slot in the form or in the request this builds.
 */
export function publishRequestOf(draft: PublishDraft): {
	request: AdminMobileUpdatePublishRequest | null;
	issues: PublishIssues;
} {
	const issues: PublishIssues = {};
	if (!draft.channel) issues.channel = "Choose a channel.";
	if (!draft.platform) issues.platform = "Choose a platform.";
	const commit = draft.commit.trim().toLowerCase();
	if (
		draft.sourceKind === "commit" &&
		!MOBILE_UPDATE_COMMIT_PATTERN.test(commit)
	)
		issues.commit =
			"Enter a 40-character commit hash (short hashes are not accepted).";
	if (!draft.note) issues.note = "Choose an update note or 'None'.";
	else if (
		draft.note !== "none" &&
		!MOBILE_UPDATE_NOTE_ID_PATTERN.test(draft.note)
	)
		issues.note = "Write the note as a date (YYYY-MM-DD).";
	if (!draft.reason.trim()) issues.reason = "Enter a reason.";
	const allowed = initialRolloutChoices(draft.channel).map((c) => c.value);
	if (!allowed.includes(draft.rollout))
		issues.rollout = "That percentage can't be chosen on this channel.";
	if (Object.keys(issues).length > 0 || !draft.channel || !draft.platform)
		return { request: null, issues };

	const initialRollout = (
		draft.rollout === "draft" ? null : Number(draft.rollout)
	) as MobileUpdateInitialRollout;
	return {
		issues,
		request: {
			channel: draft.channel,
			platform: draft.platform,
			source:
				draft.sourceKind === "branch"
					? { kind: "branch", branch: draft.branch }
					: { kind: "commit", sha: commit },
			initialRollout,
			note:
				draft.note === "none"
					? { kind: "none" }
					: { kind: "note", id: draft.note },
			reason: draft.reason.trim(),
		},
	};
}
