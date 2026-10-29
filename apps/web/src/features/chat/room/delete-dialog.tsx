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
import { deleteFailureMessage } from "./rename.ts";

/**
 * Confirmation for deleting a conversation.
 *
 * Confirmation is required because there is no undo. Deletion is soft (the row stays so sync can
 * propagate it) and there is no restore screen, so to the user it is permanent.
 *
 * The copy must be exact. It does not say the server erases plaintext: the server never held
 * plaintext (only ciphertext and tombstones), and saying so would misstate what is stored. The sync
 * sentence is conditional, because for a user who never enabled sync, talk of other devices
 * describes a feature they do not have.
 */
export function DeleteRoomDialog({
	room,
	onClose,
	onDelete,
}: {
	room: ManagedRoom;
	onClose: () => void;
	onDelete: () => Promise<void>;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/** One confirmation is one deletion, even though `deleteRoom` is idempotent. */
	const pendingRef = useRef(false);

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onDelete();
		} catch (failure) {
			console.error("[chat] couldn't delete the conversation", failure);
			setError(deleteFailureMessage());
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<Dialog
			open
			/**
			 * Checks why the dialog is closing. A dialog opened from a menu item sees the menu return focus
			 * to its trigger as an outside press and would close at once (`lib/dialog/dismiss.ts`).
			 */
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}
			>
				{/*
				 * `min-w-0` lets the grid child shrink below its min-content width. The room title is
				 * user-typed and goes into the description verbatim, so a long unbroken string would
				 * otherwise widen the dialog off screen and hide the confirm button.
				 */}
				<DialogHeader className="min-w-0">
					{/* The title states what the dialog does; color alone is not enough. */}
					<DialogTitle>{t("deleteDialog.deleteThisConversation")}</DialogTitle>
					<DialogDescription className="break-words">
						{/*
						 * Memories are named too: room deletion removes them in the same transaction as the
						 * messages (`ChatStore.deleteRoom`). Without listing everything removed, the user
						 * agrees to an irreversible action without knowing what is lost.
						 */}
						<Trans
							t={t}
							i18nKey="deleteDialog.description"
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
					<Button
						variant="destructive"
						onClick={() => void confirm()}
						disabled={pending}
					>
						{pending ? t("deleteDialog.deleting") : t("common:actions.delete")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
