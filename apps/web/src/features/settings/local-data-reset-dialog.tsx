import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";

/**
 * The question this dialog answers is not whether the user is sure. It is what disappears and what
 * remains.
 *
 * Three points users commonly confuse before pressing:
 * - The account is not deleted. That is a separate action on another screen.
 * - Conversations on other devices are not deleted. Only this browser's data is cleared.
 * - The data does come back through sync. This point is essential: re-entering the sync key
 *   brings the server ciphertext back down (lib/local-data/reset.ts). A user who does not know this
 *   takes the reappearing data to mean the reset failed.
 *
 * Failures render inline instead of as a toast, because the dialog stays open and the next step
 * (retry or close) lives inside it (docs/design/FAILURE-FEEDBACK.md).
 */
export function LocalDataResetDialog({
	pending,
	error,
	onClose,
	onConfirm,
}: {
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslation(["settings", "common"]);
	const errorId = useId();
	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader>
					<DialogTitle>
						{t("localDataResetDialog.clearThisDeviceSData")}
					</DialogTitle>
					<DialogDescription>
						{t("localDataResetDialog.onlyWhatSStoredIn")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 text-sm">
					<p>{t("localDataResetDialog.conversationsDraftsInProgressThis")}</p>
					<p className="text-muted-foreground">
						{/*
						 * State the difference from account deletion first. The two operations overlap in what they
						 * erase, so without this sentence users read this as a decision about their account and work.
						 */}
						{t("localDataResetDialog.yourAccountStaysPublishedStories")}
					</p>
					<p className="text-muted-foreground">
						{/*
						 * The most important line in this dialog (see the file header). This action has no access to
						 * the server-side ciphertext, so re-entering the sync key restores the copy unchanged.
						 */}
						{t("localDataResetDialog.ifYouUseSyncAcross")}
					</p>
					<p className="text-muted-foreground">
						{t("localDataResetDialog.thePageReloadsAfterClearing")}
					</p>

					{error && (
						<p id={errorId} role="alert" className="text-destructive">
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={pending}>
						{pending
							? t("localDataResetDialog.clearing")
							: t("localDataResetDialog.clearData")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
