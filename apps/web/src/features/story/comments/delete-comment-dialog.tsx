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
import { commentErrorMessage } from "./comment-error.ts";

/**
 * Delete confirmation.
 *
 * The confirmation is deliberately light: it does not ask the user to type a sentence. What is lost
 * is one comment, and friction matched to that weight is one button press. Reusing account
 * deletion's heavier friction would wrongly signal that the two actions weigh the same.
 *
 * The body is shown again because when there are several rows, which row is being deleted is the
 * whole point of the confirmation. Long bodies are truncated, since a dialog taller than the screen
 * pushes the confirm button behind scrolling.
 */
const PREVIEW_MAX = 120;

export function DeleteCommentDialog({
	body,
	tombstoneNotice = false,
	onClose,
	onDelete,
}: {
	body: string;
	/**
	 * Whether this deletion leaves a row in place. When replies exist, the row stays so that other
	 * people's replies are not deleted. That is a deliberate decision, and the cost is stated before
	 * the user presses the button.
	 *
	 * The notice is guidance only. The actual result (row removed or turned into a tombstone) comes
	 * from the server's response, and the cache follows it, so the dialog does not predict it.
	 */
	tombstoneNotice?: boolean;
	onClose: () => void;
	onDelete: () => Promise<void>;
}) {
	const { t } = useTranslation("comments");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** One confirmation means one deletion. Running the delete twice would confuse the user. */
	const pendingRef = useRef(false);

	const preview =
		body.length > PREVIEW_MAX ? `${body.slice(0, PREVIEW_MAX)}…` : body;

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onDelete();
			onClose();
		} catch (failure) {
			// Do not log the comment body. It is user-written text.
			setError(commentErrorMessage(failure));
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			/**
			 * Check why the dialog is closing. A dialog opened from a menu item looks like an outside press
			 * when the menu returns focus to its trigger, so it closes immediately (see
			 * `lib/dialog/dismiss.ts`).
			 */
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				<DialogHeader>
					{/* The title says what the dialog does. Red alone does not tell anyone what the action is. */}
					<DialogTitle>{t("deleteTitle")}</DialogTitle>
					<DialogDescription>
						{tombstoneNotice ? t("deleteWithReplies") : t("deleteBody")}
					</DialogDescription>
				</DialogHeader>

				<p className="rounded-md border bg-muted/40 p-3 text-sm break-words whitespace-pre-wrap">
					{preview}
				</p>

				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => void confirm()}
						disabled={pending}
					>
						{pending ? t("deleting") : t("delete")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
