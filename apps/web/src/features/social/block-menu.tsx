import { canInteract, type Viewer } from "@rowcat/domain";
import { blockMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, MoreHorizontal, ShieldBan, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ReportDialog } from "#/features/moderation/report-dialog.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { BlockConfirmDialog } from "./block-confirm-dialog.tsx";
import { blockErrorMessage } from "./social-error.ts";

/**
 * The overflow menu on a profile, holding Report and Block. Block is not a red button next to
 * Follow. The two carry different weight: Follow is a reversible preference, while Block removes
 * the person's work from the viewer's screen and ends the follow. Side by side, it becomes an easy
 * mis-tap, and the destructive color becomes the most prominent element in the profile header.
 * Guests get no menu (decided by the caller in profile-actions.ts). The block list belongs to a
 * signed-in account, so a guest cannot carry a block attempt through login the way they can with
 * Follow. Report was added to this menu once an API existed (POST /v2/reports). This is the slot
 * the earlier file note had reserved for moderation features. Report sits above Block. Report is
 * reversible (it requests review), while Block removes the person from the viewer's screen, so the
 * destructive item goes last. Report is not styled as destructive. It requests review and is not a
 * punishment, and red would make it read as one. Unlike Block, Report has no capability
 * restriction. It closes only for suspended accounts, and the server decides that. Block stays open
 * under social.write restrictions too. The UI only shows the failure message.
 */
export function BlockMenu({
	creatorId,
	creatorName,
	blocked,
	viewer,
}: {
	creatorId: string;
	/**
	 * Display name used in the confirmation copy. The caller passes a value it has already normalized.
	 */
	creatorName: string;
	/** Block state, sourced from `/me/state`. */
	blocked: boolean;
	viewer: Viewer;
}) {
	const { t } = useTranslation("social");
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const [reporting, setReporting] = useState(false);
	const mutation = useMutation(
		blockMutationOptions(getRowCatClient(), queryClient, creatorId),
	);

	// Blocked and suspended accounts are rejected by the server anyway. This check is UX, not
	// authorization, the same rule as Follow.
	const disabled = mutation.isPending || !canInteract(viewer);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							/**
							 * The label names who the menu is for. With a generic 'menu' label, a user who cannot see
							 * the screen loses track of which profile the trigger refers to.
							 */
							aria-label={t("menu.manage", { name: creatorName })}
							// One size step larger on narrow screens, since it needs accurate thumb taps.
							className="size-9 shrink-0 sm:size-8"
						/>
					}
				>
					<MoreHorizontal aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => setReporting(true)}>
						<Flag aria-hidden="true" />
						{t("menu.report")}
					</DropdownMenuItem>
					{blocked ? (
						/**
						 * Unblocking needs no confirmation. It is reversible (block again) and loses nothing. Follow
						 * does not come back on unblock. The confirm dialog already says so beforehand.
						 */
						<DropdownMenuItem
							disabled={disabled}
							/**
							 * Unblock failures show as a toast. Block failures stay in the confirm dialog, which remains
							 * open. Unblock closes the menu as soon as the item is pressed, so no place on screen could
							 * show an inline error. A silent failure would leave the user believing they unblocked the
							 * creator while the creator stays hidden. The message comes from social-error.ts, the same
							 * function the confirm dialog uses.
							 */
							onClick={() =>
								mutation.mutate(false, {
									onError: (failure) =>
										showErrorToast(blockErrorMessage(failure)),
								})
							}
						>
							<ShieldCheck aria-hidden="true" />
							{t("menu.unblock")}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							variant="destructive"
							disabled={disabled}
							onClick={() => setConfirming(true)}
						>
							<ShieldBan aria-hidden="true" />
							{t("menu.block")}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{reporting && (
				<ReportDialog
					/**
					 * The target is a member, and the server takes the evidence from the public profile. The
					 * request has no slot for a snapshot (ReportTarget). If the reporter could supply evidence,
					 * that evidence would not be evidence.
					 */
					target={{ type: "member", memberId: creatorId }}
					targetLabel={t("menu.reportTarget")}
					onClose={() => setReporting(false)}
				/>
			)}

			{confirming && (
				<BlockConfirmDialog
					creatorName={creatorName}
					pending={mutation.isPending}
					error={mutation.isError ? mutation.error : null}
					onClose={() => setConfirming(false)}
					onConfirm={async () => {
						try {
							await mutation.mutateAsync(true);
							setConfirming(false);
						} catch {
							/**
							 * A failure stays as a message in the open dialog (rendered from mutation.error). Rethrowing
							 * here would close the dialog and leave the user unsure whether the block happened. It would
							 * also make `void onConfirm()` log an unhandled rejection.
							 */
						}
					}}
				/>
			)}
		</>
	);
}
