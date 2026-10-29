import { DropdownMenu } from "@rowcat/ui-native";
import type { ReactNode } from "react";
import type { ViewerAction } from "../../lib/viewer-action.ts";
import { useReportAction } from "../moderation/report-menu.tsx";
import { useBlockCreator } from "./use-block-creator.tsx";

/**
 * The profile header's overflow: **one trigger, containing two items.**
 *
 * ```text
 * Report      review request, not destructive
 * ─────
 * Block / Unblock
 * ```
 *
 * ## Why not a second trigger
 *
 * The quickest answer for someone asked to add reporting is to put another `⋯` beside follow. That
 * leaves two overflow triggers 20pt apart for the same person, and nobody remembers which one holds
 * what. The two would then start behaving differently (one hidden from guests, the other not). The
 * web's `block-menu.tsx` puts both in one menu for the same reason.
 *
 * ## Report is **above** block
 *
 * The order carries meaning. Report ends in a review; block removes the person from your screen and
 * also cuts the follow. The destructive item therefore sits last. For the same reason report is not
 * painted `destructive`: it is a button that asks for a review, not one that punishes, and red
 * would read it as a punishment.
 *
 * ## The two are not merged into one action
 *
 * Reporting does not double as blocking, and blocking does not double as reporting. They are
 * different product actions reaching different places (the operator's queue versus this viewer's
 * screen). Merging them would leave no way to undo the unwanted half when someone wanted only one.
 * Block in particular cuts the follow, and unblocking does not restore it. Each confirmation states
 * only its own action.
 *
 * ## The rules do not live here
 *
 * The block mutation, confirmation and failure placement live in `use-block-creator.tsx`. The
 * report submission order and failure copy belong to `features/moderation`. What remains in this
 * file is **only the arrangement that puts those two into one trigger.**
 */
export interface ProfileMenuControls {
	/** The overflow trigger and its menu. Placed as-is in the profile header's action row. */
	trigger: ReactNode;
	/** Unblock failure line. `null` when there is no failure, so it takes no space. */
	notice: ReactNode;
	/** Two dialogs (block confirmation and report form). Draws nothing while both are closed. */
	dialog: ReactNode;
}

export function useProfileMenu({
	creatorId,
	creatorName,
	blocked,
	action,
}: {
	creatorId: string;
	/** Name the confirmation copy and the trigger label call. A display name the caller has already folded. */
	creatorName: string;
	/** Whether `/me/state` reports the creator as blocked. */
	blocked: boolean;
	action: ViewerAction;
}): ProfileMenuControls {
	const report = useReportAction({
		/**
		 * **A single member id.** The contract has no slot for a nickname, bio, avatar or follower count
		 * (`ReportTarget`), and the snapshot is taken by the server from the public profile. If a
		 * reporter could invent evidence, that evidence would not be evidence.
		 */
		target: { type: "member", memberId: creatorId },
		targetLabel: "Profile",
	});
	const block = useBlockCreator({ creatorId, creatorName, blocked, action });

	return {
		trigger: (
			<DropdownMenu
				/** The label says whose menu this is. Leaving it as "menu" would erase what the trigger acts on. */
				label={`Manage creator ${creatorName}`}
				icon="more"
				align="end"
			>
				{/**
				 * **Reporting has no capability restriction.** It is the same axis as block staying open under a
				 * `social.write` restriction: only a suspended account is closed by the server. The screen just
				 * carries the failure copy across, so this row has no `disabled`.
				 */}
				{report.item}
				{block.item}
			</DropdownMenu>
		),
		notice: block.notice,
		dialog: (
			<>
				{report.dialog}
				{block.dialog}
			</>
		),
	};
}
