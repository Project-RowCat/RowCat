import { Button } from "@rowcat/ui-web/components/button";
import { Play, RotateCcw, Sparkles, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RUNTIME_PREVIEW } from "#/features/runtime-preview/runtime-preview-copy.ts";
import {
	type OpenRuntimeSource,
	RuntimePreviewStage,
} from "#/features/runtime-preview/runtime-preview-stage.tsx";
import {
	type RuntimePreviewState,
	runtimePreviewControls,
} from "#/features/runtime-preview/runtime-preview-state.ts";
import type { RuntimePreview as RuntimePreviewHandle } from "#/features/runtime-preview/use-runtime-preview.ts";
import { runtimeShortcutLabel } from "./commands/use-shortcuts.ts";

/**
 * The preview panel. React owns only the shell.
 *
 * - React holds four controls (run, restart, stop, reset play state), the status sentence, and
 *   the stage that shows the executed code (`RuntimePreviewStage`). Below the stage,
 *   `@rowcat/runtime-renderer-web` draws imperatively and React does not re-render it.
 * - The stage is not in this file because there are two surfaces: this panel and the full-screen
 *   playtest (`features/playtest/runtime-playtest.tsx`). Their controls and wording differ, but
 *   what they draw (not yet run, compiling, the creator's own exception, our failure) must match.
 *   Two copies would drift apart.
 * - Opening a draft does not run its code. Starting the VM and WASM costs time, code that is
 *   already running can loop forever, and the user must be able to tell what is running. Run is one
 *   button, shown only when the check state allows it; the worker's full compile is the final
 *   authority.
 * - Restart and reset are different operations. Restart rebuilds the VM: `useState` starts fresh
 *   while saved state persists. Reset clears saved state and rebuilds the VM, so everything returns
 *   to its initial value. If they looked alike, a user who restarts because they dislike a response
 *   would delete their progress by accident. So reset has its own label, lower visual weight
 *   (`ghost`), and a sentence stating what disappears.
 * - AI is a control whose effect applies to the next run. Turning preview on must not create
 *   billable state (§36). Editing and re-running is the normal authoring loop; if each run cost
 *   money, creators would fear the run button. The toggle does not change a running session,
 *   because the capability table is fixed when the session starts, so the screen says to restart
 *   after enabling.
 * - Failure has two faces, and the stage draws them. An exception thrown by the creator's render
 *   and a renderer, worker, or VM failure are different sentences. `RuntimePreviewStage` decides
 *   which, so no other surface can read our failure as the creator's own code.
 */
export function RuntimePreview({
	preview,
	onOpenSource,
}: {
	preview: RuntimePreviewHandle;
	/**
	 * Fires when a runtime error's stack line is pressed. This screen owns the path that opens that
	 * file at that position.
	 */
	onOpenSource: OpenRuntimeSource;
}) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const { state } = preview;
	const controls = runtimePreviewControls(state);
	const stale = state.status === "running" && state.stale;
	/**
	 * The shortcut is written into the run button's tooltip, because that is where the action happens.
	 * A shortcut that appears nowhere is known only to people who read the commit. When the preview is
	 * not eligible, the tooltip says why it cannot run and drops the key name: advertising a key that
	 * does nothing is not help.
	 */
	const runHint = preview.eligible
		? runtimeShortcutLabel("Enter")
		: RUNTIME_PREVIEW.notEligible;
	return (
		<section
			aria-label={t("runtimePreview.runtimePreview")}
			className="flex h-full min-h-0 flex-col"
		>
			<header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
				<h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{RUNTIME_PREVIEW.title}
				</h2>
				<StatusLine state={state} />
				{preview.generationSupported &&
					preview.generationEnabled &&
					state.status === "running" &&
					!preview.generationActive && (
						<span className="text-xs text-muted-foreground">
							{RUNTIME_PREVIEW.generationPending}
						</span>
					)}
				<div className="ms-auto flex items-center gap-1">
					{preview.generationSupported && (
						<label
							className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
							title={RUNTIME_PREVIEW.generationHint}
						>
							<input
								type="checkbox"
								className="size-3.5 accent-primary"
								checked={preview.generationEnabled}
								onChange={(event) =>
									preview.setGenerationEnabled(event.currentTarget.checked)
								}
							/>
							<Sparkles className="size-3.5" aria-hidden="true" />
							{RUNTIME_PREVIEW.generationToggle}
						</label>
					)}
					{controls.run && (
						<Button
							size="sm"
							className="h-7 gap-1"
							disabled={!preview.eligible}
							title={runHint}
							onClick={preview.run}
						>
							<Play className="size-3.5" aria-hidden="true" />
							{RUNTIME_PREVIEW.run}
						</Button>
					)}
					{controls.restart && (
						<Button
							size="sm"
							/**
							 * Restart is the primary action when the preview is stale or has failed. The filled button
							 * marks that.
							 */
							variant={
								stale || state.status === "failed" ? "default" : "outline"
							}
							className="h-7 gap-1"
							disabled={!preview.eligible}
							title={runHint}
							onClick={preview.restart}
						>
							<RotateCcw className="size-3.5" aria-hidden="true" />
							{state.status === "failed"
								? RUNTIME_PREVIEW.restartAfterFailure
								: RUNTIME_PREVIEW.restart}
						</Button>
					)}
					{controls.stop && (
						<Button
							size="sm"
							variant="ghost"
							className="h-7 gap-1"
							onClick={preview.stop}
						>
							<Square className="size-3.5" aria-hidden="true" />
							{RUNTIME_PREVIEW.stop}
						</Button>
					)}
					{/*
					 * Always shown. Resetting a stopped preview means the next run starts from scratch, so it is a
					 * valid action then too. It is deliberately not gated by `eligible`, because clearing saved
					 * state does not need a compile.
					 */}
					<Button
						size="sm"
						variant="ghost"
						className="h-7 gap-1 text-muted-foreground"
						title={RUNTIME_PREVIEW.resetPlaythroughHint}
						onClick={preview.resetPlaythrough}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
						{RUNTIME_PREVIEW.resetPlaythrough}
					</Button>
					{/*
					 * Reset of long progress is a separate button. Folding it into the common reset would make
					 * re-running a chapter also clear unlocks earned over several chapters, the opposite of why this
					 * lifetime exists. The copy states that it is for creators and debugging only; the product's
					 * play surface does not have it.
					 */}
					<Button
						size="sm"
						variant="ghost"
						className="h-7 gap-1 text-muted-foreground"
						title={RUNTIME_PREVIEW.resetPersistentHint}
						onClick={preview.resetPersistentState}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
						{RUNTIME_PREVIEW.resetPersistent}
					</Button>
				</div>
			</header>

			{/*
			 * Staleness is a fact, not a control. This line states that the screen is running previous code.
			 * Restart is the primary action above (filled when stale). A second button is not placed here:
			 * the same operation twice, 20px apart, would leave no answer to which one is canonical.
			 *
			 * Instead the key name is written here, because this line is read at the moment that key is
			 * needed. The button tooltip above only appears on hover, and touch devices have no hover.
			 */}
			{stale && (
				<output className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-1 border-b bg-accent/60 px-3 py-2 text-xs">
					<span className="font-medium">{RUNTIME_PREVIEW.stale}</span>
					<span className="text-muted-foreground">
						{RUNTIME_PREVIEW.staleBody}
					</span>
					{preview.eligible && (
						<span className="ms-auto shrink-0 font-mono text-[11px] text-muted-foreground">
							{runtimeShortcutLabel("Enter")}
						</span>
					)}
				</output>
			)}

			<RuntimePreviewStage preview={preview} onOpenSource={onOpenSource} />
		</section>
	);
}

/**
 * A one-line status inside `<output>`, so the sentence is announced when it changes. `running` has
 * no wording: the rendered frame already says it is running, and adding a word would be read past.
 * Only the other states need text.
 */
function StatusLine({ state }: { state: RuntimePreviewState }) {
	const text =
		state.status === "compiling"
			? RUNTIME_PREVIEW.compiling
			: state.status === "starting"
				? RUNTIME_PREVIEW.starting
				: state.status === "stopping"
					? RUNTIME_PREVIEW.stopping
					: null;
	return (
		<output className="text-xs text-muted-foreground">{text ?? ""}</output>
	);
}
