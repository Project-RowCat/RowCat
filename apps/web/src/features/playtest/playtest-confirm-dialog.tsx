import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";

/**
 * Confirmation for discarding the test conversation.
 *
 * The chat screen's `ConfirmRewriteDialog` is not reused. That one wraps a storage transaction and
 * carries progress, failure text, and duplicate-submit prevention. Here the only effect is swapping
 * React state: it cannot fail and there is nothing to wait for. Copying those guards would add
 * branches that can never be true, and they would suggest that saving can fail here.
 *
 * Confirmation is required because the action is irreversible. Test conversations are stored
 * nowhere, so discarding one is final.
 */
export function PlaytestConfirmDialog({
	title,
	description,
	confirmLabel,
	onClose,
	onConfirm,
}: {
	title: string;
	description: string;
	confirmLabel: string;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, false)) onClose();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common:actions.cancel")}
					</Button>
					<Button
						onClick={() => {
							onConfirm();
							onClose();
						}}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
