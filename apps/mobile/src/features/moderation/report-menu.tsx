import { DropdownMenu, MenuItem } from "@rowcat/ui-native";
import { type ReactNode, useState } from "react";
import type { PublicReportTarget } from "./report-dialog.tsx";
import { ReportDialog } from "./report-dialog.tsx";
import { canReportTarget } from "./report-visibility.ts";

/**
 * The report entry point for public targets. Works, comments and profiles all use this one.
 *
 * ## Why the item and the menu are exported separately
 *
 * The three places differ. A work detail has nothing else to put in its overflow, so it needs a
 * whole menu of its own. Comment rows and the profile header **already have a menu** (delete ·
 * block). A second trigger on either would put two `⋯` icons 20pt apart on the same target, and
 * nobody would remember which one holds what.
 *
 * So `useReportAction` exports **one row and one window**, and `ReportMenu` is a thin shell that
 * wraps both in its own trigger. Exporting the window together with the item is what
 * `useBlockCreator` does for the same reason. The menu closes when an item is pressed (the
 * primitive's `closeOnPress`), so a window living inside that menu would vanish right as it opened.
 *
 * ## Not drawn for guests
 *
 * The judgment belongs to one function, `report-visibility.ts` (own, guest, identity unknown).
 * Pressing and meeting a login wall would be better for discoverability, but reporting is a
 * procedure of choosing a reason and writing a description. Leaving for a login in the middle would
 * lose what the user had written.
 *
 * ## Why a menu for a single item
 *
 * Putting a flag icon beside the body would give it the weight of a favourite button. Reporting is
 * not a frequent action, and a mis-press creates review work for others, so one layer behind is
 * right. The web's `report-menu.tsx` made the same call.
 */

export interface ReportAction {
	/** One row placed as is inside the menu. A child of the caller's `DropdownMenu`. */
	item: ReactNode;
	/** The report window. Draws nothing while closed. */
	dialog: ReactNode;
}

export function useReportAction({
	target,
	targetLabel,
}: {
	/**
	 * **Only the id is carried.** The contract has no slot for a title, body, nickname, bio or avatar
	 * (`ReportTarget`), and the snapshot is taken by the server from its own row. If a reporter could
	 * fabricate evidence, that evidence would not be evidence.
	 */
	target: PublicReportTarget;
	targetLabel: string;
}): ReportAction {
	const [open, setOpen] = useState(false);

	return {
		item: (
			/**
			 * **Not destructive.** Reporting is a button that requests review, not a punishment for another
			 * person. Red would read it as a punishment, and if that colour lost its meaning, the red of
			 * truly destructive rows (delete, block) would stop reading as such too.
			 */
			<MenuItem icon="report" label="Report" onSelect={() => setOpen(true)} />
		),
		dialog: open ? (
			<ReportDialog
				target={target}
				targetLabel={targetLabel}
				onClose={() => setOpen(false)}
			/>
		) : null,
	};
}

export function ReportMenu({
	target,
	targetLabel,
	triggerLabel,
	viewerId,
	ownerId,
}: {
	target: PublicReportTarget;
	targetLabel: string;
	/** The trigger's accessible name. When several identical icons are on screen, the name tells them apart. */
	triggerLabel: string;
	viewerId: string | null;
	ownerId: string | null;
}): ReactNode {
	/** Always call the hook: a conditional call breaks the rules of hooks. Discard the value only when nothing is drawn. */
	const report = useReportAction({ target, targetLabel });
	if (!canReportTarget({ viewerId, ownerId })) return null;

	return (
		<>
			<DropdownMenu label={triggerLabel} icon="more" align="end">
				{report.item}
			</DropdownMenu>
			{report.dialog}
		</>
	);
}
