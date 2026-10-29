import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { cn } from "@rowcat/ui-web/lib/utils";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { runtimeDeleteConfirm } from "../runtime-copy.ts";

/**
 * Confirmation for file deletion. It is the only explorer operation that cannot be undone, so it
 * gets a dialog.
 * - Delete is not one click in the menu, because the item sits directly below `Rename` and `Copy
 *   path`. Those two lose nothing, while deletion loses the file, and the product has no trash or
 *   undo.
 * - Closing a tab has no dialog. A closed tab can be reopened, while a deleted file cannot. The
 *   same confirmation on both would soon go unread.
 * - The text names the full path. `Delete this file?` is ambiguous here, because the open file and the
 *   right-clicked file can differ: selection and activation are separate axes in this slice.
 * - Folder deletion never reaches this dialog. Folders derive from descendant paths, so that
 *   operation needs a batch operation in the authoring layer. Until then the menu has no folder
 *   delete item.
 */
export function RuntimeDeleteDialog({
	path,
	pending,
	onCancel,
	onConfirm,
}: {
	/** The full path of the file to delete. `null` means no dialog is shown. */
	path: string | null;
	/** Whether the store is still answering. The dialog stays open while it is pending. */
	pending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	if (path === null) return null;
	const copy = runtimeDeleteConfirm(path);

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				/**
				 * While pending, outside clicks and `Escape` do not close the dialog. A shared rule decides
				 * this.
				 */
				if (!next && shouldCloseDialog(details?.reason ?? "", pending))
					onCancel();
			}}
		>
			<DialogContent className={cn(DIALOG_VIEWPORT_BOUND, "sm:max-w-md")}>
				<DialogHeader>
					<DialogTitle>{copy.title}</DialogTitle>
					{/*
					 * The path has no break points. It carries a user-chosen name of up to 200 characters with no
					 * spaces. Such a line would push the dialog sideways and move the `Delete` button off screen. The
					 * conversation delete confirmation makes the same decision in the same place.
					 */}
					<DialogDescription className="break-words">
						{copy.body}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" disabled={pending} onClick={onCancel}>
						{copy.cancel}
					</Button>
					<Button variant="destructive" disabled={pending} onClick={onConfirm}>
						{copy.confirm}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
