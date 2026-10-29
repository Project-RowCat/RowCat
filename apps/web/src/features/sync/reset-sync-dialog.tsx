import { isRowCatApiError } from "@rowcat/sdk";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";

/**
 * Confirmation dialog for resetting sync: the exit for an account that is locked with no key.
 *
 * This cannot be undone, so the copy first states what is removed and what stays. Removed: the
 * server's sync data (ciphertext) and this device's key. Kept: this device's conversations and
 * drafts, which are uploaded under the new key when sync is turned on again. Other devices' local
 * data is also unchanged, and those devices return to 'not set up' the next time they open.
 *
 * The server can require a recent login (`recent_login_required`). Only that failure has different
 * wording, because the user's next step is to log in again, not to press again.
 */
export function ResetSyncDialog({
	open,
	onClose,
	onReset,
}: {
	open: boolean;
	onClose: () => void;
	onReset: () => Promise<void>;
}) {
	const { t } = useTranslation(["sync", "common"]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/**
	 * One confirmation performs one reset. The server is idempotent, but a screen that runs the reset
	 * twice would still confuse users.
	 */
	const pendingRef = useRef(false);

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onReset();
			onClose();
		} catch (failure) {
			setError(
				isRowCatApiError(failure) && failure.code === "recent_login_required"
					? t("reset.recentLogin")
					: t("reset.failed"),
			);
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader>
					<DialogTitle>{t("reset.title")}</DialogTitle>
					<DialogDescription>{t("reset.description")}</DialogDescription>
				</DialogHeader>

				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => void confirm()}
						disabled={pending}
					>
						{pending ? t("reset.pending") : t("reset.submit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
