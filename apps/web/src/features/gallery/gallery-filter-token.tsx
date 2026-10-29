import type { AppliedGalleryFilter } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import { X } from "lucide-react";
import * as m from "motion/react-m";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { rowEnter, rowExit } from "#/lib/motion/list-motion.ts";

/**
 * One applied-filter line that shows why the results look the way they do outside the menu.
 *
 * The × button is the operation: it clears only its own axis. The whole token is not a button,
 * because a user could not tell whether pressing the text removes the filter or opens a menu. The
 * button fills the token height; its name says what it clears (`Remove Orientation For women filter`).
 *
 * The component holds no state. `appliedGalleryFilters` decides what is applied, and removal goes
 * out through `onRemove`.
 *
 * The li lives here because presence and useExitGuard() need a component. The markup (ul > li) is
 * unchanged.
 *
 * Unlike the editor's tag chip (tag-input.tsx, docs/motion/ARCHITECTURE.md), this token uses
 * presence: it appears after the menu closes and its removal re-queries the list, so the link
 * between choice and result has to be drawn. The first render is skipped via AnimatePresence
 * initial={false}. The exit stays in flow and useExitGuard() blocks presses while it runs.
 * popLayout is not used: the remove button sits inside the exiting token, and taking it out of flow
 * would leave the focused button floating.
 */
export function GalleryFilterToken({
	applied,
	layoutKey,
	onRemove,
}: {
	applied: AppliedGalleryFilter;
	/**
	 * Used only as the trigger for Motion to re-measure geometry, so it is a string, not the array.
	 * `appliedGalleryFilters` returns a new array every render; depending on it would re-measure every
	 * token each time the total arrives.
	 */
	layoutKey: string;
	onRemove: () => void;
}) {
	/**
	 * Prevents pressing during exit. Putting the value on the exit target applies it only when the
	 * animation starts, so on a tab that gets no frames it never applies, and by then the condition
	 * that was just removed has been present the longest (exit-guard.ts).
	 */
	const exiting = useExitGuard();

	return (
		<m.li
			/*
			 * When one token leaves, the ones after it shift forward. If the row is full, the whole line
			 * wrap is recomputed; if that finishes in one frame, the list looks replaced rather than one
			 * condition removed (same as the tag chip). Only position moves (layout="position"); the token's
			 * width is set by its text, which does not change while the token lives.
			 */
			layout="position"
			layoutDependency={layoutKey}
			initial={rowEnter.initial}
			animate={rowEnter.animate}
			exit={rowExit}
			transition={rowEnter.transition}
			style={exiting}
		>
			<span className="inline-flex h-9 items-center gap-0.5 rounded-md border border-border bg-muted/40 pl-2.5 text-sm sm:h-8">
				<span className="whitespace-nowrap">{applied.text}</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={applied.removeLabel}
					className="size-9 rounded-[inherit] text-muted-foreground sm:size-8"
					onClick={onRemove}
				>
					<X aria-hidden="true" />
				</Button>
			</span>
		</m.li>
	);
}
