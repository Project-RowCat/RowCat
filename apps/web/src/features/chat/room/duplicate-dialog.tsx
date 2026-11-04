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
import { Trans, useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import type { ManagedRoom } from "./management.tsx";

/**
 * Confirmation for duplicating a conversation.
 *
 * Duplicating is not irreversible (the copy can be deleted), but it is not a single cheap press
 * either: a long conversation becomes thousands of new records that sync as their own, and a copy
 * made by a slipped finger lands at the top of the list. The confirmation says what travels, so the
 * user does not have to open the copy to learn whether memories and characters came along.
 *
 * The dialog is also the failure's place: it stays open while the copy is written, and a failure
 * is said inline (`docs/design/FAILURE-FEEDBACK.md`).
 */
export function DuplicateRoomDialog({
	room,
	onClose,
	onDuplicate,
}: {
	room: ManagedRoom;
	onClose: () => void;
	onDuplicate: () => Promise<void>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** One confirmation is one copy: a second press in the same tick must not make a second room. */
	const pendingRef = useRef(false);

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onDuplicate();
		} catch (failure) {
			console.error("[chat] couldn't duplicate the conversation", failure);
			setError(t("duplicateDialog.failed"));
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
				{/* `min-w-0`: a long unbroken title must not widen the dialog off screen (as in deletion). */}
				<DialogHeader className="min-w-0">
					<DialogTitle>{t("duplicateDialog.title")}</DialogTitle>
					<DialogDescription className="break-words">
						<Trans
							t={t}
							i18nKey="duplicateDialog.description"
							values={{ title: room.title }}
							components={{
								title: <span className="font-medium text-foreground" />,
							}}
						/>
					</DialogDescription>
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
					<Button onClick={() => void confirm()} disabled={pending}>
						{pending
							? t("duplicateDialog.duplicating")
							: t("duplicateDialog.duplicate")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
