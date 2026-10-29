import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Trans, useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { blockErrorMessage } from "./social-error.ts";

/**
 * Block confirmation. Confirmation is required because the effect is large and not fully
 * reversible. Blocking removes the person's work from the viewer's screen and ends the follow.
 * Unblocking does not restore the follow. The copy must be exact. Do not write 'this user cannot
 * see you', 'reported', or 'this user will be sanctioned'. The server does none of that. Blocking
 * is a personal setting that hides content on your own screen. It does not stop the other user from
 * viewing and does not notify them. Stating stronger privacy than is real would lead people who
 * rely on it into danger. Mixing in moderation words would make users believe an operator
 * intervened.
 */
export function BlockConfirmDialog({
	creatorName,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	creatorName: string;
	pending: boolean;
	/**
	 * The reason the server rejected the request. The message text is decided by social-error.ts
	 * alone.
	 */
	error: unknown;
	onClose: () => void;
	onConfirm: () => Promise<void>;
}) {
	const { t } = useTranslation(["social", "common"]);
	return (
		<Dialog
			open
			/**
			 * Checks why the dialog is closing. A dialog opened from a menu item would otherwise close right
			 * away. When the menu returns focus to its trigger, that looks like an outside click
			 * (lib/dialog/dismiss.ts).
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
				 * min-w-0 and break-words are needed because the description contains a name another user chose.
				 * DialogContent is a grid, so a child's minimum width is auto. An unbroken name would widen its
				 * grid track instead of wrapping, pushing the Block and Cancel buttons off screen.
				 * The nickname limit is 20 characters (NICKNAME_LIMITS), so this dialog does not break today.
				 * The guard is written down because that limit lives in another package. If the layout depended on
				 * that number, a future increase would break only this dialog, and nobody would link the two.
				 * A similar dialog (chat/delete-room-dialog.tsx) has a higher limit and did break in practice.
				 */}
				<DialogHeader className="min-w-0">
					{/* The title states what the dialog does. Color alone cannot convey the action. */}
					<DialogTitle>{t("blockDialog.title")}</DialogTitle>
					<DialogDescription className="break-words">
						<Trans
							t={t}
							i18nKey="blockDialog.description"
							values={{ name: creatorName }}
							components={{
								name: <span className="font-medium text-foreground" />,
							}}
						/>
						{/*
						 * States only what actually happens: the work is hidden, the person's comments are hidden, and the
						 * follow ends.
						 * The third sentence matters most. It must say, before pressing, that unblocking does not restore
						 * the follow, so users do not later ask why they were unfollowed.
						 */}
					</DialogDescription>
				</DialogHeader>

				{error != null && (
					<p role="alert" className="text-sm text-destructive">
						{blockErrorMessage(error)}
					</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => void onConfirm()}
						disabled={pending}
					>
						{pending ? t("blockDialog.submitting") : t("blockDialog.submit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
