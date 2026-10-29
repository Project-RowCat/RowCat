import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import {
	ChevronLeft,
	Command,
	MoreHorizontal,
	PanelBottom,
	PanelLeft,
	PanelRight,
	Search,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import type { DraftAutosave } from "#/features/create/editor/use-autosave.ts";
import { RuntimeDocsEntryLink } from "#/features/docs/runtime-docs-entry.tsx";
import { StartPlaytestButton } from "#/features/playtest/start-playtest-button.tsx";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { contentEnter } from "#/lib/motion/surface-content.ts";
import { RUNTIME_BETA } from "#/lib/runtime-beta.ts";
import { runtimeShortcutLabel } from "./commands/use-shortcuts.ts";
import { RUNTIME_COMPILE_STATUS } from "./compile/state.ts";
import {
	type RuntimeCompileFamily,
	type RuntimeCompileView,
	runtimeCompileActionable,
	runtimeCompileFamily,
	runtimeCompileLabelParts,
} from "./compile/view.ts";
import { RUNTIME_STUDIO } from "./runtime-copy.ts";
import { RuntimeSaveState } from "./runtime-save-state.tsx";

/**
 * The studio header: the workspace's bar, not a page title.
 *
 * - No large heading. The editor's height is the real value here, and an `h1` would take about
 *   40px permanently. The name reads inline like a path (`← The Night Library / Runtime`).
 * - The exit is a pinned address, not history. The studio can open without going through the list
 *   (a saved address, session restore), so the back action may leave RowCat. Whatever the entry
 *   route, the exit is the draft's editor.
 */
export function RuntimeStudioHeader({
	draftId,
	title,
	autosave,
	compile,
	explorerVisible,
	previewVisible,
	onOpenProblems,
	onQuickOpen,
	onOpenCommands,
	onToggleExplorer,
	onTogglePreview,
	onResetLayout,
}: {
	draftId: string;
	title: string;
	autosave: DraftAutosave;
	compile: RuntimeCompileView;
	explorerVisible: boolean;
	previewVisible: boolean;
	/** Pressing the check status opens the bottom panel on `Problems`. */
	onOpenProblems: () => void;
	onQuickOpen: () => void;
	/** Opens the command palette: a name search over every operation on this screen. */
	onOpenCommands: () => void;
	onToggleExplorer: () => void;
	onTogglePreview: () => void;
	onResetLayout: () => void;
}) {
	return (
		<header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
			<Button
				variant="ghost"
				size="sm"
				className="-ms-2 h-8 gap-1 px-2"
				render={
					<Link to="/create/$draftId" params={{ draftId }}>
						<ChevronLeft className="size-4" />
						{RUNTIME_STUDIO.back}
					</Link>
				}
			/>
			<div className="flex min-w-0 items-center gap-1.5 text-sm">
				<span className="truncate font-medium" title={title}>
					{title}
				</span>
				<span aria-hidden className="text-muted-foreground">
					/
				</span>
				{/*
				 * The screen's name appears only once here. A second `h1` on the canvas would show the same
				 * text twice in a column without saying anything different. It is kept as hidden text rather
				 * than removed, because the document still needs a name.
				 */}
				<h1 className="text-sm font-semibold">{RUNTIME_STUDIO.title}</h1>
				{/*
				 * The product status word sits right beside the name. At the far right it would share a line
				 * with the check and save status, which change constantly, and this stable word would be lost
				 * among them.
				 *
				 * No warning band. This line tells the user where they are; it does not say 'do not do this'.
				 * A band across the full width would imply a warning the content does not contain.
				 */}
				<span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[0.6875rem] font-medium leading-4 text-muted-foreground">
					<span className="sr-only">{RUNTIME_BETA.srPrefix}</span>
					{RUNTIME_BETA.label}
				</span>
			</div>

			<div className="ms-auto flex items-center gap-1.5">
				<CompileStatus compile={compile} onOpenProblems={onOpenProblems} />
				<RuntimeSaveState autosave={autosave} />
				{/*
				 * Link to the public docs. Operations do not get individual help: inside the studio, this one
				 * link is the 'if stuck, go here'. The preview's empty state points to one more page of those
				 * docs.
				 */}
				<RuntimeDocsEntryLink variant="icon" />
				{/*
				 * Also shown on narrow screens. Choosing a file there requires switching panes, so this
				 * shortcut is worth more. What gets folded away is only the panel open and close operations.
				 */}
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={`${RUNTIME_STUDIO.quickOpen} (${runtimeShortcutLabel("p")})`}
					title={`${RUNTIME_STUDIO.quickOpen} (${runtimeShortcutLabel("p")})`}
					onClick={onQuickOpen}
				>
					<Search className="size-4" />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								aria-label={RUNTIME_STUDIO.studioMenu}
								title={RUNTIME_STUDIO.studioMenu}
							>
								<MoreHorizontal className="size-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end" className="min-w-52">
						{/*
						 * The palette is the first line. It is the only way, by name, to reach operations missing from
						 * this menu (run, stop, reset, panels, new file). The three items below are the most used and
						 * stay where a single press reaches them.
						 */}
						<DropdownMenuItem onClick={onOpenCommands}>
							<Command aria-hidden="true" />
							<span className="whitespace-nowrap">
								{RUNTIME_STUDIO.commandPalette}
							</span>
							<span className="ms-auto ps-4 text-xs text-muted-foreground">
								{runtimeShortcutLabel("p", { shift: true })}
							</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						{/*
						 * The two operations that open and close panels are wide-screen operations. On narrow screens,
						 * pane selection (`Files · Code · Preview`) does that job. Hiding the explorer there would remove
						 * every way to pick a file.
						 */}
						<DropdownMenuItem
							className="hidden lg:flex"
							onClick={onToggleExplorer}
						>
							<PanelLeft aria-hidden="true" />
							<span className="whitespace-nowrap">
								{explorerVisible
									? RUNTIME_STUDIO.hideExplorer
									: RUNTIME_STUDIO.showExplorer}
							</span>
							<span className="ms-auto ps-4 text-xs text-muted-foreground">
								{runtimeShortcutLabel("b")}
							</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							className="hidden lg:flex"
							onClick={onTogglePreview}
						>
							<PanelRight aria-hidden="true" />
							<span className="whitespace-nowrap">
								{previewVisible
									? RUNTIME_STUDIO.hidePreview
									: RUNTIME_STUDIO.showPreview}
							</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator className="hidden lg:block" />
						{/*
						 * Resets size only. Open tabs, the active file, expanded folders, and panel visibility do not
						 * move. The name is `Reset panel sizes` rather than `Reset` because that name is the promise:
						 * resetting the whole workspace would not be reversible.
						 */}
						<DropdownMenuItem onClick={onResetLayout}>
							<PanelBottom aria-hidden="true" />
							<span className="whitespace-nowrap">
								{RUNTIME_STUDIO.resetLayout}
							</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{/*
				 * The workspace test runs this draft full screen, without the editor. If the runtime is
				 * enabled, that screen runs the runtime too, following the draft's execution model (see
				 * `features/playtest/runtime-playtest.tsx`). It uses the same hook, worker, and stage as the
				 * preview panel on the right. It exists because while writing code one often wants to see the
				 * work itself at full size. Pending saves are flushed first, in the same order the editor uses.
				 */}
				<StartPlaytestButton draftId={draftId} autosave={autosave} />
			</div>
		</header>
	);
}

/**
 * Check status, shown as a button only when there is something to press.
 *
 * Check status and save status are separate axes and must not be merged: a compile failure does not
 * stop saving. A merged `Failed` would read as `not saved` and push the user out of the editor. The copy
 * has no `Running` because this build executes nothing.
 *
 * Why a button: a user who reads `2 problems` wants to look at them, and the `Problems` tab sits on the
 * far side of the screen. The status itself is the shortest path there. The outer `<output>` is the
 * live region, so changed text is announced in place. The button's accessible name includes its
 * action, which `aria-label` would hide from the live region.
 *
 * Motion: a changed count rolls one digit in place (`AnimatedCount`), and changed wording
 * cross-fades (`surface-content.ts`). Going through `Checking…` and back to the same answer moves
 * nothing. Analysis restarts on each keystroke, so the transition keys on the last settled answer
 * (`runtimeCompileFamily`), and `Checking…` does not change that key. Otherwise the line would move
 * constantly while typing. Color changes instantly, since it describes state.
 */
function CompileStatus({
	compile,
	onOpenProblems,
}: {
	compile: RuntimeCompileView;
	onOpenProblems: () => void;
}) {
	const failed = compile.status === RUNTIME_COMPILE_STATUS.failed;
	const tone =
		failed || compile.errors > 0 ? "text-destructive" : "text-muted-foreground";
	const label = <CompileLabel compile={compile} />;

	if (!runtimeCompileActionable(compile))
		return <output className={`text-xs ${tone}`}>{label}</output>;

	return (
		<output className="text-xs">
			<button
				type="button"
				className={`rounded-sm px-1.5 py-0.5 font-medium underline-offset-2 hover:bg-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${tone}`}
				onClick={onOpenProblems}
			>
				{label}
				<span className="sr-only">, {RUNTIME_STUDIO.openProblems}</span>
			</button>
		</output>
	);
}

/**
 * The last settled answer. `checking` does not change it. It is set during render (as in
 * `AnimatedCount`) because a ref would be discarded in StrictMode's thrown-away render. It carries
 * only the motion key; the truth about check status is still `compile`.
 */
function useSettledFamily(compile: RuntimeCompileView): RuntimeCompileFamily {
	const family = runtimeCompileFamily(compile);
	const [settled, setSettled] = useState(family);
	if (family !== "pending" && family !== settled) setSettled(family);
	return settled;
}

/**
 * One sentence. Wording changes only when the answer changes, and counts roll in place.
 * `initial={false}` so nothing animates when the heading first mounts. There is no exit either: the
 * old word disappears as the new one appears. A `mode="wait"` on the in-place swap would delay each
 * answer by that duration.
 */
function CompileLabel({ compile }: { compile: RuntimeCompileView }) {
	const parts = runtimeCompileLabelParts(compile);
	const family = useSettledFamily(compile);
	return (
		<AnimatePresence initial={false}>
			<m.span
				key={family}
				initial={contentEnter.initial}
				animate={contentEnter.animate}
				transition={contentEnter.transition}
				className="inline-flex items-baseline"
			>
				{parts.before}
				{parts.count !== null && <AnimatedCount value={parts.count} />}
				{parts.after}
			</m.span>
		</AnimatePresence>
	);
}
