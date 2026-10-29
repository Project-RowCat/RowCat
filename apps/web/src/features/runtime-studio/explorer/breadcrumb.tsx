import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { ChevronDown, Copy, FolderTree } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Fragment } from "react";
import { contentEnter } from "#/lib/motion/surface-content.ts";
import type { RuntimeTabCommands } from "../commands/tab-commands.ts";
import { RUNTIME_STUDIO } from "../runtime-copy.ts";
import { runtimeBreadcrumb } from "./breadcrumb.ts";

/**
 * One-line location indicator above the editor.
 * - Tab labels are short by design (runtime-tab-labels.ts). They show what is open, not where.
 *   This line supplies the location.
 * - Not a second header. Height is the main constraint, since the editor area is scarce. The line
 *   uses 11px text, no card or background, and a single bottom border.
 * - Folder segments are not clickable. Clicking would give the line its own expansion and scroll
 *   state, which the left tree already owns. The only menu is for the file, and its two items call
 *   the same commands as the tab menu. Clipboard and reveal logic are not reimplemented here.
 * - The accessible name is the full path. Visible segments may be truncated with `…`, so the
 *   trigger's `aria-label` carries the whole path and the segments are hidden from the
 *   accessibility tree. The tab makes the same decision (`aria-label={file.path}`).
 * - When the active file changes, only the name fades in (surface-content.ts). The whole line
 *   does not slide, because it answers where, not what changed. Monaco switches models in the same
 *   render, so the transition does not wait for it. The old name has no exit: it disappears when
 *   the new name appears.
 */
export function RuntimeFileBreadcrumb({
	fileId,
	path,
	commands,
}: {
	fileId: string;
	path: string;
	/**
	 * Receives the same commands as the tab menu. Only two are used, but the type is narrowed on
	 * purpose. A wider type would let an unrelated item such as `Close all tabs` appear here later.
	 */
	commands: Pick<RuntimeTabCommands, "revealInExplorer" | "copyPath">;
}) {
	const { folders, truncated, name } = runtimeBreadcrumb(path);

	return (
		<nav
			aria-label={RUNTIME_STUDIO.breadcrumb}
			/*
			 * The layout contract of this line is `overflow-hidden` with `min-w-0`. Segment length is capped
			 * at 64 characters. Without clipping, the line would push the editor column sideways, and Monaco
			 * would measure its own width wrongly.
			 */
			className="flex min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b px-3 py-1.5 text-[11px]"
			title={path}
		>
			{truncated && (
				<>
					<span aria-hidden="true" className="shrink-0 text-muted-foreground">
						…
					</span>
					<Separator />
				</>
			)}
			{folders.map((folder, index) => (
				/*
				 * The key is the segment's position. The same folder name can appear twice in one path
				 * (`src/ui/ui`), and a value-based key would collide. The list is never sorted or reordered, so
				 * position is identity.
				 */
				// biome-ignore lint/suspicious/noArrayIndexKey: the segment's identity is its position in the path (see the comment above).
				<Fragment key={index}>
					<span aria-hidden="true" className="shrink-0 text-muted-foreground">
						{folder}
					</span>
					<Separator />
				</Fragment>
			))}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="sm"
							/*
							 * Height is set explicitly. The default `size="sm"` (32px) would make this line
							 * header-sized, and the line would be permanently lost from the editor.
							 */
							className="h-5 min-w-0 gap-0.5 px-1 font-mono text-[11px] font-medium"
							aria-label={path}
						>
							{/*
							 * `initial={false}` means the name does not fade in when the line first appears, such as when
							 * the first file opens. The whole line is new at that moment, so the name has no reason to arrive
							 * separately.
							 * The file name is also the key on purpose. Moving to a different file with the same name leaves
							 * the text unchanged, so there is nothing to animate.
							 */}
							<AnimatePresence initial={false}>
								<m.span
									key={name}
									initial={contentEnter.initial}
									animate={contentEnter.animate}
									transition={contentEnter.transition}
									className="truncate"
								>
									{name}
								</m.span>
							</AnimatePresence>
							<ChevronDown
								aria-hidden="true"
								className="size-3 shrink-0 text-muted-foreground"
							/>
						</Button>
					}
				/>
				<DropdownMenuContent align="start" className="min-w-44">
					<DropdownMenuItem
						onClick={() => commands.revealInExplorer(fileId, path)}
					>
						<FolderTree aria-hidden="true" />
						<span className="whitespace-nowrap">
							{RUNTIME_STUDIO.revealInExplorer}
						</span>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => commands.copyPath(path)}>
						<Copy aria-hidden="true" />
						<span className="whitespace-nowrap">{RUNTIME_STUDIO.copyPath}</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</nav>
	);
}

/**
 * The separator between segments is text, not an icon. An icon would add an SVG per segment, and
 * beside 11px text its strokes would look heavier than the text. It is hidden from the
 * accessibility tree along with the segments.
 */
function Separator() {
	return (
		<span aria-hidden="true" className="shrink-0 text-muted-foreground/50">
			/
		</span>
	);
}
