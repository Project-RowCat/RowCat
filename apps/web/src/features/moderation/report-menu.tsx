import type { ReportTarget } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Flag, MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReportDialog } from "./report-dialog.tsx";

/**
 * Report entry point for public targets, shared by stories and profiles.
 *
 * Hidden from guests. Reporting requires a signed-in member (§14), and the screen says so first. A
 * visible entry that led to a login wall would make a guest log in and lose what they were viewing.
 *
 * Hidden on the viewer's own work or profile. The server does not block self-reports (§15 is not a
 * security decision), but the item would either return a 400 or do nothing.
 *
 * A single flag icon beside the body would carry the same weight as the favorite button. Reporting
 * is rare, and an accidental tap creates review work for others, so it sits behind a menu. `Share` and
 * `Block` are expected to join this menu later.
 */
export function ReportMenu({
	target,
	targetLabel,
	viewer,
	/**
	 * Owner of the target. If it matches the viewer, the menu is not rendered. Null when there is no
	 * owner.
	 */
	ownerId,
	triggerLabel,
}: {
	target: ReportTarget;
	targetLabel: string;
	viewer: Viewer | null;
	ownerId: string | null;
	/**
	 * Accessible name of the trigger. When several identical icons appear on screen, the name is what
	 * tells them apart.
	 */
	triggerLabel: string;
}): ReactNode {
	const { t } = useTranslation("moderation");
	const [open, setOpen] = useState(false);
	if (!viewer || (ownerId && ownerId === viewer.id)) return null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="ghost" size="icon-sm" aria-label={triggerLabel} />
					}
				>
					<MoreHorizontal aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => setOpen(true)}>
						<Flag aria-hidden="true" />
						{t("menu.report")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{open && (
				<ReportDialog
					target={target}
					targetLabel={targetLabel}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}
