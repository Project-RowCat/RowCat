import { Button } from "@rowcat/ui-web/components/button";
import * as m from "motion/react-m";
import { contentEnter } from "#/lib/motion/surface-content.ts";
import { runtimeShortcutLabel } from "../commands/use-shortcuts.ts";
import { RUNTIME_EDITOR_EMPTY } from "../runtime-copy.ts";

/**
 * The editor cell's empty state has two branches. Saying 'pick one in the explorer' when there are
 * zero files asks the user to pick something that does not exist. That was the only dead end on
 * this screen, and someone opening a new project arrives in exactly that state.
 *
 * The sentence only enters: it arrives after the cell's geometry is set, so it arrives by opacity
 * only (`surface-content.ts`). It has no exit. Waiting for it to leave before a file opens would
 * make Monaco appear later, and opening a file is the most direct action on this screen. The editor
 * appears at once and the sentence disappears in the same render.
 *
 * It is detached from the page for the same reason as `runtime-mobile-tabs.tsx`: no moving element
 * lives in the page file.
 */
export function RuntimeEditorEmpty({
	fileCount,
	onCreateFile,
}: {
	fileCount: number;
	/**
	 * The action when no files exist: opens an inline input, and on narrow screens moves to that
	 * surface instead.
	 */
	onCreateFile: () => void;
}) {
	return (
		<m.div
			initial={contentEnter.initial}
			animate={contentEnter.animate}
			transition={contentEnter.transition}
			className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground"
		>
			{fileCount === 0 ? (
				<>
					<p>{RUNTIME_EDITOR_EMPTY.noFiles}</p>
					<Button variant="outline" size="sm" onClick={onCreateFile}>
						{RUNTIME_EDITOR_EMPTY.noFilesAction}
					</Button>
				</>
			) : (
				<>
					<p>{RUNTIME_EDITOR_EMPTY.noSelection}</p>
					{/*
					 * Only states that the shortcut exists. Adding a button would make three ways to open a file (the
					 * explorer
					 * line, the header magnifier, and this one), and this one would exist only on this screen. Someone
					 * who
					 * learned the operation on another screen would look for it here.
					 *
					 * The key name is set by the platform (`runtimeShortcutLabel`). On a Mac, writing `Ctrl+P` would
					 * make the
					 * user press it, see nothing, and read the dead key as a bug.
					 */}
					<p className="font-mono text-xs text-muted-foreground/80">
						{runtimeShortcutLabel("p")}{" "}
						{RUNTIME_EDITOR_EMPTY.noSelectionShortcut}
					</p>
				</>
			)}
		</m.div>
	);
}
