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
 * Confirmation for operations that wipe history.
 *
 * Confirmation is required because there is no way back. The deletion is soft (the row stays so
 * sync can convey the fact), but there is no restore screen and none is planned in this slice, so
 * to the user it is a permanent delete. An undo log was not built for the same reason: one exact
 * confirmation sentence is more honest at this scale, and undo would itself require a new product
 * state (what is kept, and for how long).
 *
 * **The caller supplies the copy.** `Delete from here` (delete from here) and `Regenerate` (regenerate) remove
 * the same range, but the person means different things (one tidies up, the other starts over), and
 * that difference must show in the sentence. The rules of the dialog (when it closes, duplicate
 * submission, where the failure copy appears) stay here in one place.
 */
export function ConfirmRewriteDialog({
	title,
	description,
	confirmLabel,
	pendingLabel,
	failureMessage,
	onClose,
	onConfirm,
}: {
	title: string;
	/** What disappears: a sentence stating the count (see `actions.ts` in this folder). */
	description: string;
	confirmLabel: string;
	pendingLabel: string;
	failureMessage: string;
	onClose: () => void;
	onConfirm: () => Promise<void>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** One confirmation is one operation. Even if idempotent, a screen that runs twice is confusing. */
	const pendingRef = useRef(false);

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onConfirm();
		} catch (failure) {
			console.error("[chat] couldn't rewrite the conversation", failure);
			setError(failureMessage);
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

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
					{/* The title says what this window does. Red alone tells no one. */}
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
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
						{pending ? pendingLabel : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
