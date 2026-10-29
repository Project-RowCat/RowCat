import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { RUNTIME_PLAYER_COPY } from "./runtime-player-copy.ts";

/**
 * Confirmation for `Reset play`. It is a trusted RowCat window. Reset cannot be undone, so it requires
 * confirmation; the mobile version of this screen had that from the start.
 * - The copy says first what remains. Reset clears only the progress of this playthrough. Records
 *   accumulated across earlier playthroughs are kept.
 * - Creator code controls neither the window's existence nor its wording. The window opens from
 *   outside the creator canvas, in the header. Only after confirmation does one request cross into
 *   the canvas (`runtime-chat-controls.ts`).
 * - It is a plain `Dialog`, not `AlertDialog`, because the repository has only one dialog
 *   primitive. Chat room deletion uses the same one (`features/chat/room/delete-dialog.tsx`).
 */
export function ResetPlaythroughDialog({
	onCancel,
	onConfirm,
}: {
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
				<DialogHeader className="min-w-0">
					<DialogTitle>{RUNTIME_PLAYER_COPY.resetTitle}</DialogTitle>
					<DialogDescription>
						{RUNTIME_PLAYER_COPY.resetDescription}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						{RUNTIME_PLAYER_COPY.cancel}
					</Button>
					<Button variant="destructive" onClick={onConfirm}>
						{RUNTIME_PLAYER_COPY.resetConfirm}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
