import {
	CAPABILITY_LABEL,
	type ModerationCapability as Capability,
	MODERATION_ACTION_LABEL,
	type ModerationActionKind,
	ModerationCapability,
	type ModerationReportDetailDto,
} from "@rowcat/contracts";

/**
 * The actions applicable to this case, as a pure function: inside a component the rules could not
 * be checked without rendering, and the failure is quiet — an operator presses an action that does
 * not exist, gets a 400, and reads it as a server problem.
 *
 * - Kinds come only from the contract's `ModerationActionKind`, and the return type is bound to
 *   it, so an invented name (`shadow_ban`, `warn`, `quarantine`) fails to type-check.
 * - The server is the final authority (`requireCaseTarget`, `resolveCaseMember`); this only folds
 *   away buttons that would plainly be refused.
 * - `ai_response` cases get no account actions: the server cannot know whose conversation it was
 *   (E2EE), and the target is the model's reply, not the reporter. Drawing the button invites
 *   sanctioning the reporter.
 */

export interface AvailableAction {
	kind: ModerationActionKind;
	capability?: Capability;
	label: string;
	/** The "what happens" sentence the confirm dialog shows. */
	consequence: string;
	destructive: boolean;
}

/** Whether this kind is still live in this case; decides whether to offer the reversal. */
const hasActive = (
	report: ModerationReportDetailDto,
	kind: ModerationActionKind,
): boolean =>
	report.caseActions.some(
		(action) => action.kind === kind && !action.reversedByActionId,
	);

const capabilityRestricted = (
	report: ModerationReportDetailDto,
	capability: Capability,
): boolean =>
	report.caseActions.some(
		(action) =>
			action.kind === "restrict_capability" &&
			action.capability === capability &&
			!action.reversedByActionId,
	);

export function availableActions(
	report: ModerationReportDetailDto,
): AvailableAction[] {
	const actions: AvailableAction[] = [];

	if (report.targetType === "story") {
		if (hasActive(report, "hide_story"))
			actions.push({
				kind: "unhide_story",
				label: MODERATION_ACTION_LABEL.unhide_story,
				consequence:
					"The story appears in the catalogue again. The visibility the creator chose (private or archived) stays as is: unhiding does not return it to public.",
				destructive: false,
			});
		else
			actions.push({
				kind: "hide_story",
				label: MODERATION_ACTION_LABEL.hide_story,
				consequence:
					"The story disappears from the gallery, detail, playback and profiles. The creator can see the hidden state in their own workspace and can appeal this action.",
				destructive: true,
			});
	}

	if (report.targetType === "comment" && report.current)
		actions.push({
			kind: "remove_comment",
			label: MODERATION_ACTION_LABEL.remove_comment,
			consequence:
				"The comment is deleted. The original stays as a snapshot in the action record as the basis for handling appeals. This can't be undone.",
			destructive: true,
		});

	/**
	 * Account actions apply to every target except `ai_response`. The server derives the member (story
	 * owner, comment author, or the member itself); retracing that path here would eventually diverge
	 * for one kind and sanction the wrong person.
	 */
	if (report.targetType !== "ai_response") {
		if (hasActive(report, "suspend_member") || hasActive(report, "ban_member"))
			actions.push({
				kind: "restore_member",
				label: MODERATION_ACTION_LABEL.restore_member,
				consequence:
					"Reverses every account sanction issued in this case. If active sanctions from other cases remain, the account status stays as is.",
				destructive: false,
			});
		else {
			actions.push({
				kind: "suspend_member",
				label: MODERATION_ACTION_LABEL.suspend_member,
				consequence:
					"Blocks all of the account's writes (publishing, comments, follows). Reading and appealing stay open.",
				destructive: true,
			});
			actions.push({
				kind: "ban_member",
				label: MODERATION_ACTION_LABEL.ban_member,
				consequence:
					"Bans the account. It blocks the same scope as suspension but marks that there is no intent to lift it. No data is deleted.",
				destructive: true,
			});
		}

		/**
		 * The capability list comes from the contract, not a hand-written list: a new
		 * `ModerationCapability` value appears here automatically, and the contract header's rule
		 * guarantees a route actually checks it.
		 */
		for (const capability of ModerationCapability.options) {
			const restricted = capabilityRestricted(report, capability);
			actions.push({
				kind: restricted ? "unrestrict_capability" : "restrict_capability",
				capability,
				label: `${restricted ? "Lift" : "Restrict"} ${CAPABILITY_LABEL[capability]}`,
				consequence: restricted
					? `Lifts the ${CAPABILITY_LABEL[capability]} restriction placed in this case. If restrictions from other cases remain, it is still blocked.`
					: `Restricts this member's ${CAPABILITY_LABEL[capability]}. A narrower sanction than full suspension; other features keep working.`,
				destructive: !restricted,
			});
		}
	}

	return actions;
}
