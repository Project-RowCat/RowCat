import { VISUAL_LAB_TEXT } from "@rowcat/design/visual-lab";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { useState } from "react";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";

/**
 * Canonical state of the floating layers. It pairs with the native lab's same section, but not
 * one-to-one. The mismatch itself belongs in the ledger, so it is recorded here:
 *
 * - Native `Dialog placement="center"` -> web `DialogContent` (default)
 * - Native `Dialog placement="adaptive"` -> web `DialogContent placement="adaptive"`, with
 *   bottom-sheet geometry
 * - Native `Dialog size="full"` -> a box filling the screen (the shape the settings page draws on
 *   narrow screens)
 * - Native `AlertDialog` -> none; web uses a Dialog for irreversible confirmations too
 * - Native `ChoiceSheet` -> none; web uses a closed Select in the same spot
 * - Native `NavigationDrawer` -> the shell's left drawer (not in this lab; it belongs to the
 *   navigation IA)
 *
 * The last three have no counterpart this lab can produce. Imitating a missing container would make
 * this screen prove something about the imitation, so they stay absent and the ledger records why.
 */
export function OverlayLab() {
	const [open, setOpen] = useState<null | "compact" | "adaptive" | "full">(
		null,
	);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" onClick={() => setOpen("compact")}>
					Dialog center
				</Button>
				<Button variant="outline" size="sm" onClick={() => setOpen("adaptive")}>
					Dialog adaptive
				</Button>
				<Button variant="outline" size="sm" onClick={() => setOpen("full")}>
					Dialog full
				</Button>
			</div>

			<Dialog
				open={open === "compact"}
				onOpenChange={(next) => setOpen(next ? "compact" : null)}
			>
				<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-md`}>
					<DialogHeader>
						<DialogTitle>{VISUAL_LAB_TEXT.dialogTitle}</DialogTitle>
						<DialogDescription>
							{VISUAL_LAB_TEXT.dialogDescription}
						</DialogDescription>
					</DialogHeader>
					<Input
						aria-label={VISUAL_LAB_TEXT.fieldLabel}
						defaultValue={VISUAL_LAB_TEXT.fieldValue}
					/>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(null)}>
							{VISUAL_LAB_TEXT.secondaryAction}
						</Button>
						<Button onClick={() => setOpen(null)}>
							{VISUAL_LAB_TEXT.action}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={open === "adaptive"}
				onOpenChange={(next) => setOpen(next ? "adaptive" : null)}
			>
				<DialogContent
					placement="adaptive"
					className="top-auto bottom-0 flex max-h-[85dvh] w-full max-w-full flex-col rounded-t-xl rounded-b-none sm:top-1/2 sm:bottom-auto sm:max-w-md sm:rounded-xl"
				>
					<DialogHeader className="text-left">
						<DialogTitle>{VISUAL_LAB_TEXT.dialogTitle}</DialogTitle>
						<DialogDescription>
							{VISUAL_LAB_TEXT.dialogDescription}
						</DialogDescription>
					</DialogHeader>
					<Input
						aria-label={VISUAL_LAB_TEXT.fieldLabel}
						defaultValue={VISUAL_LAB_TEXT.fieldValue}
					/>
					<DialogFooter>
						<Button onClick={() => setOpen(null)}>
							{VISUAL_LAB_TEXT.action}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={open === "full"}
				onOpenChange={(next) => setOpen(next ? "full" : null)}
			>
				<DialogContent className="flex h-dvh w-full max-w-full flex-col gap-0 rounded-none p-0">
					<DialogHeader className="border-b px-5 py-4 text-left">
						<DialogTitle>{VISUAL_LAB_TEXT.dialogTitle}</DialogTitle>
					</DialogHeader>
					<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
						<p className="text-sm">{VISUAL_LAB_TEXT.paragraph}</p>
						<Input
							aria-label={VISUAL_LAB_TEXT.fieldLabel}
							defaultValue={VISUAL_LAB_TEXT.fieldValue}
						/>
						<p className="text-sm">{VISUAL_LAB_TEXT.paragraph}</p>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
