import type { DraftRuntimeProject } from "@rowcat/authoring";
import type { PlaytestDebugTab } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Link } from "@tanstack/react-router";
import { Bug, Play, RotateCcw, Sparkles, Square, Trash2 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { RUNTIME_CANVAS_COLUMN } from "#/features/runtime-player/runtime-canvas.ts";
import { RUNTIME_PREVIEW } from "#/features/runtime-preview/runtime-preview-copy.ts";
import { useRuntimePreviewGeneration } from "#/features/runtime-preview/runtime-preview-generation.ts";
import { RuntimePreviewStage } from "#/features/runtime-preview/runtime-preview-stage.tsx";
import { runtimePreviewControls } from "#/features/runtime-preview/runtime-preview-state.ts";
import { useRuntimeDebug } from "#/features/runtime-preview/use-runtime-debug.ts";
import { useRuntimePreview } from "#/features/runtime-preview/use-runtime-preview.ts";
import { useRuntimeSources } from "#/features/runtime-studio/use-runtime-sources.ts";
import {
	useDraftRuntimeAssets,
	useDraftRuntimeFiles,
} from "#/lib/local-authoring/hooks.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { resolveWebRuntimeAsset } from "#/lib/runtime-assets/web-asset-resolver.ts";
import { RuntimeDebugger } from "./debugger/runtime-debugger.tsx";
import {
	playtestRuntimeEmpty,
	playtestRuntimeNote,
	playtestRuntimeRestartAfterFailure,
	playtestRuntimeRun,
	playtestRuntimeStudioLink,
} from "./playtest-copy.ts";

/**
 * - Branch exists because the playtest must follow the draft's execution model. In
 *   runtime-enabled drafts the four conversation materials are locked
 *   (`resolveConversationAuthoringMode`) and playback creates no room, so the old conversation-only
 *   screen showed an empty conversation with no reason given. The decision uses one axis,
 *   `DraftRuntimeProject.enabled`.
 * - No second execution path. The studio preview hook (`useRuntimePreview`) starts the same
 *   worker, and the same surface (`RuntimePreviewStage`) draws the result. A separate path would
 *   make a work run differently in the two places.
 * - Eligibility is decided by the worker's full compile. This screen has no editor, so the
 *   studio's Monaco-based gate (`compileView.eligible`) is not reproduced; the only question here
 *   is whether any file exists. Blocking errors appear over the surface.
 * - Storage is never touched. The preview snapshot lives in worker memory (§71), and this screen
 *   reads and writes no product storage, so a test cannot change the player's progress.
 */
export function RuntimePlaytest({
	project,
	title,
	adult,
}: {
	project: DraftRuntimeProject;
	title: string;
	/** The draft's rating; generations in the test run under the same guards publication would give them. */
	adult: boolean;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	const draftId = project.draftId;
	const files = useDraftRuntimeFiles(draftId);
	const assets = useDraftRuntimeAssets(draftId);
	/**
	 * The snapshot rule is owned by the same hook the studio uses. Nothing is edited on this screen,
	 * so what comes out is always the saved record's revision, which is the honest input here. The
	 * path from the editor has already flushed pending saves (`start-draft-playtest.ts`).
	 */
	const sources = useRuntimeSources({
		files: files.items,
		entry: project.entry,
		assets: assets.items,
	});
	const generation = useRuntimePreviewGeneration({ storyId: null, adult });
	const empty = !files.loading && sources.snapshot.files.length === 0;
	/**
	 * Observation log: it reads the messages already flowing by, from the side. Neither the worker,
	 * the VM, nor the commit order changes a line because of this hook. The studio does not pass it,
	 * since that screen already has a bottom panel.
	 */
	const debug = useRuntimeDebug();
	const preview = useRuntimePreview({
		snapshot: sources.snapshot,
		eligible: !files.loading && !empty,
		generation,
		resolveAsset: resolveWebRuntimeAsset,
		debug: debug.sink,
	});
	const [debuggerOpen, setDebuggerOpen] = useState(false);
	const [debugTab, setDebugTab] = useState<PlaytestDebugTab>("state");
	const debuggerId = useId();
	const { state } = preview;
	const controls = runtimePreviewControls(state);
	const stale = state.status === "running" && state.stale;

	return (
		<PageEnter className="flex min-h-0 flex-1 flex-col">
			<div className={RUNTIME_CANVAS_COLUMN}>
				<h1 className="sr-only">{t("runtimePlaytest.storyTest")}</h1>
				<header className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
					<p className="min-w-0 truncate text-sm font-medium">{title}</p>
					<output className="text-xs text-muted-foreground">
						{state.status === "compiling"
							? RUNTIME_PREVIEW.compiling
							: state.status === "starting"
								? RUNTIME_PREVIEW.starting
								: state.status === "stopping"
									? RUNTIME_PREVIEW.stopping
									: ""}
					</output>
					<div className="ms-auto flex items-center gap-1">
						{/*
						 * AI is a choice for the next run; the capability table of the running session does not
						 * change. The wording and explanation match the preview control's because it is the same
						 * promise: turning it on calls the real model and incurs charges.
						 */}
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
						{/*
						 * The debugger is a different kind of control from the run controls, so it sits to their
						 * left. The run controls start and stop a session; the debugger reads what the running
						 * session did.
						 */}
						<Button
							size="sm"
							variant="ghost"
							className="h-7 gap-1 text-muted-foreground"
							aria-expanded={debuggerOpen}
							aria-controls={debuggerOpen ? debuggerId : undefined}
							onClick={() => setDebuggerOpen((open) => !open)}
						>
							<Bug className="size-3.5" aria-hidden="true" />
							{debuggerOpen
								? t("runtimePlaytest.closeDebugger")
								: t("runtimePlaytest.debugger")}
						</Button>
						{controls.run && (
							<Button
								size="sm"
								className="h-7 gap-1"
								disabled={!preview.eligible}
								onClick={preview.run}
							>
								<Play className="size-3.5" aria-hidden="true" />
								{playtestRuntimeRun()}
							</Button>
						)}
						{controls.restart && (
							<Button
								size="sm"
								variant={
									stale || state.status === "failed" ? "default" : "outline"
								}
								className="h-7 gap-1"
								disabled={!preview.eligible}
								onClick={preview.restart}
							>
								<RotateCcw className="size-3.5" aria-hidden="true" />
								{state.status === "failed"
									? playtestRuntimeRestartAfterFailure()
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
						 * Resetting play and resetting long progress are different operations. Folding them
						 * together would make the common action of replaying a chapter also erase unlocks worth
						 * several chapters. The preview control uses the same shape for the same reason.
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
				 * Staleness is a fact, not an action. Restart is the primary action in the header above
				 * and becomes the filled button when stale. The only difference from the preview control
				 * is that no key name is printed, because this screen has no such shortcut.
				 */}
				{stale && (
					<output className="mb-2 flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md bg-accent/60 px-3 py-2 text-xs">
						<span className="font-medium">{RUNTIME_PREVIEW.stale}</span>
						<span className="text-muted-foreground">
							{RUNTIME_PREVIEW.staleBody}
						</span>
					</output>
				)}

				<AnimatePresence>
					{debuggerOpen && (
						<div className="mb-2 shrink-0">
							<RuntimeDebugger
								key="runtime-playtest-debugger"
								id={debuggerId}
								state={debug.state}
								tab={debugTab}
								onTabChange={setDebugTab}
								running={state.status === "running"}
								onClose={() => setDebuggerOpen(false)}
							/>
						</div>
					)}
				</AnimatePresence>

				{/*
				 * The border marks a boundary; it is not decoration (`runtime-canvas.ts`). The inside is
				 * the creator's screen and the outside is RowCat's. The boundary must show the same
				 * geometry as playback, so what the creator sees here matches what players will see.
				 */}
				<div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
					<RuntimePreviewStage preview={preview} />
				</div>

				{/*
				 * What is kept and what is not, always as a single line. In a draft with no files at all,
				 * this slot shows the next step: an empty project is not a failure, just a state where
				 * code has not been written yet.
				 */}
				<p className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-xs text-muted-foreground">
					<span>{empty ? playtestRuntimeEmpty() : playtestRuntimeNote()}</span>
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0 text-xs"
						render={<Link to="/create/$draftId/runtime" params={{ draftId }} />}
					>
						{playtestRuntimeStudioLink()}
					</Button>
				</p>
			</div>
		</PageEnter>
	);
}
