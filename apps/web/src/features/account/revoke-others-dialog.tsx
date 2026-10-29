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
import { Trans, useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";

/**
 * Confirms signing out every other device.
 *
 * The count goes into the sentence on purpose. "All other sessions will end" does not say whether
 * that is one device or six, and that difference is the information the user decides with.
 *
 * The sentence stating that this device stays signed in is required. Without it the button is an
 * action whose effect on the current device is unknown, and users would not press it, yet it is the
 * right action when a device is lost.
 */
export function RevokeOthersDialog({
	count,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	/** Number of sessions that will end. The current device is excluded. */
	count: number;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslation(["account", "common"]);
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
						{t("revokeOthersDialog.signOutAllOtherDevices")}
					</DialogTitle>
					<DialogDescription>
						{t("revokeOthersDialog.thisDeviceStaysSignedIn")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 text-sm">
					<p>
						{/* The count is not abbreviated (no `12.4K`), following the repository-wide rule. */}
						<Trans
							t={t}
							i18nKey="revokeOthersDialog.endsSessions"
							values={{ count }}
							components={{ strong: <strong className="font-medium" /> }}
						/>
					</p>
					<p className="text-muted-foreground">
						{/* States what remains on this device. Ending a session does not erase data, and this screen must not blur that distinction from account deletion. */}
						{t("revokeOthersDialog.dataSavedOnEachDevice")}
					</p>

					{error && (
						<p id={errorId} role="alert" className="text-destructive">
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("revokeOthersDialog.cancel")}
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={pending}>
						{pending
							? t("revokeOthersDialog.signingOut")
							: t("revokeOthersDialog.signOutOtherDevices")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
