import { isRuntimeEnabled } from "@rowcat/authoring";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Link } from "@tanstack/react-router";
import { Boxes, Code2, Layers, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorSection } from "#/features/create/editor/fields.tsx";
import { RuntimeTemplateGallery } from "#/features/runtime-templates/runtime-template-gallery.tsx";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	useDraftRuntimeFiles,
	useDraftRuntimeProject,
} from "#/lib/local-authoring/hooks.ts";
import { runtimeSavedCheck } from "./compile/saved-check.ts";
import { RUNTIME_DISABLE_CONFIRM, RUNTIME_SECTION } from "./runtime-copy.ts";
import { RuntimeIntro } from "./runtime-intro.tsx";
import { useRuntimeActions } from "./use-runtime-actions.ts";

/**
 * The runtime block of the draft editor, and the only entry point into this feature.
 *
 * - Its position is meaningful. It sits last in the editor, just before publishing. The sections
 *   above describe the work itself (prompt, lore, opening scene, situation images); the runtime is
 *   an optional extension on top. Placing it there says the work is complete without it. It
 *   precedes publishing, which should always be last.
 * - No IDE is embedded here. This block shows a status line and controls. The code editor has its
 *   own width and height rules (three panes plus a bottom panel), and it fits neither in a vertical
 *   form row. Opening it therefore means moving to the studio.
 */
export function RuntimeSection({ draftId }: { draftId: string }) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const project = useDraftRuntimeProject(draftId);
	const files = useDraftRuntimeFiles(draftId);
	const actions = useRuntimeActions(draftId);
	const [confirming, setConfirming] = useState(false);
	/**
	 * Whether re-enabling is in progress; this is one button's state. Re-enabling edits a project row
	 * in a transaction, so it does not finish instantly. A second press during that time would
	 * re-enable an already-enabled row (the store is idempotent). The button is still disabled,
	 * because a button that does nothing when pressed looks broken.
	 *
	 * The first creation has no such state. That path's button only opens the gallery, and the wait
	 * lives inside that window.
	 */
	const [enabling, setEnabling] = useState(false);
	/**
	 * Whether the template gallery is open. It can only be true on first creation. This open condition
	 * is the guarantee against overwriting (§28, §29). The state is set only in the branch where the
	 * project has never existed; the re-enable path and the already-enabled path never see this
	 * window.
	 */
	const [choosing, setChoosing] = useState(false);

	const enabled = isRuntimeEnabled(project.project);
	/**
	 * Has this draft ever had a runtime project? Even when it is off, leftover code makes 'enable
	 * again' the accurate wording.
	 */
	const hasProject = project.project !== null;

	/**
	 * Structural check of the saved files. It re-runs only when the file list changes; it is a
	 * parser-only pass, a few milliseconds even at the limit. It reads the stored value rather than an
	 * editor snapshot because this screen has no editor: what it reports is what publishing will
	 * actually send.
	 */
	const savedCheck = useMemo(
		() =>
			enabled && !files.loading
				? runtimeSavedCheck({
						entry: project.project?.entry ?? "src/main.tsx",
						files: files.items,
					})
				: null,
		[enabled, files.loading, files.items, project.project?.entry],
	);

	return (
		<EditorSection
			title={RUNTIME_SECTION.title}
			description={RUNTIME_SECTION.description}
			action={
				project.loading ? null : (
					<Badge variant={enabled ? "default" : "secondary"}>
						{enabled
							? RUNTIME_SECTION.enabledBadge
							: RUNTIME_SECTION.disabledBadge}
					</Badge>
				)
			}
			/** Turning the runtime on and off is the only structural change in this section. */
			layoutDependency={enabled}
		>
			{project.loading ? (
				<p className="text-sm text-muted-foreground">
					{t("common:state.loading")}
				</p>
			) : enabled ? (
				<div className="flex flex-col gap-3">
					<p className="text-sm text-muted-foreground">
						{files.loading
							? t("section.loadingProject")
							: t("section.fileCount", { count: files.items.length })}
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							render={
								<Link to="/create/$draftId/runtime" params={{ draftId }} />
							}
						>
							<Code2 className="size-4" />
							{RUNTIME_SECTION.open}
						</Button>
						{/*
						 * Turning off is the secondary action. It is reversible, but reversing costs something (the
						 * studio must be reopened to verify), so it is not placed beside the filled button.
						 */}
						<Button variant="ghost" onClick={() => setConfirming(true)}>
							{RUNTIME_SECTION.disable}
						</Button>
					</div>
					{/*
					 * While enabled, two facts are stated: publishing ships the code along, and the code is not a
					 * secret store. They are said here rather than on the publish screen because of timing. Secrets
					 * get written into code while the user is writing it, so by publish time they are already
					 * there.
					 */}
					{savedCheck !== null && (
						<output
							/**
							 * Uses `output` (the status role), not `alert`, because it does not block publishing. The
							 * final verdict is the server's compile; this line previews that result.
							 */
							className={cn(
								"block text-xs",
								savedCheck.status === "clean"
									? "text-muted-foreground"
									: "text-destructive",
							)}
						>
							{savedCheck.status === "clean"
								? RUNTIME_SECTION.savedCheckClean
								: savedCheck.status === "problems"
									? RUNTIME_SECTION.savedCheckProblems(savedCheck.errors)
									: RUNTIME_SECTION.savedCheckFailed}
							{savedCheck.status !== "clean" && (
								<>
									{" "}
									<Link
										to="/create/$draftId/runtime"
										params={{ draftId }}
										className="underline underline-offset-2"
									>
										{RUNTIME_SECTION.savedCheckOpen}
									</Link>
								</>
							)}
						</output>
					)}
					<p className="text-xs text-muted-foreground">
						{RUNTIME_SECTION.publishNotice}
					</p>
					<p className="text-xs text-muted-foreground">
						{RUNTIME_SECTION.confidentiality}
					</p>
				</div>
			) : hasProject ? (
				/**
				 * Turned off but code remains: do not redraw the intro. The user already knows the feature, and
				 * an intro here would read as their code having disappeared.
				 */
				<div className="flex flex-col gap-3">
					<p className="text-sm text-muted-foreground">
						{t("runtimeSection.runtimeIsOffTheCode")}
					</p>
					<div>
						<Button
							variant="outline"
							disabled={enabling}
							onClick={() => {
								setEnabling(true);
								void actions.setEnabled(true).finally(() => setEnabling(false));
							}}
						>
							{RUNTIME_SECTION.enable}
						</Button>
					</div>
				</div>
			) : (
				<RuntimeIntro
					capabilityIcons={[Sparkles, Layers, Boxes, Code2]}
					onStart={() => setChoosing(true)}
				/>
			)}

			{/*
			 * The gallery is mounted only for drafts that have never been created. If it were always
			 * rendered and only `open` toggled it, its window would exist in the tree even for drafts that
			 * have code. A second path that opened it would then become an operation that overwrites
			 * someone else's files.
			 */}
			{!hasProject && (
				<RuntimeTemplateGallery
					draftId={draftId}
					open={choosing}
					onOpenChange={setChoosing}
				/>
			)}

			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent className={cn(DIALOG_VIEWPORT_BOUND, "sm:max-w-md")}>
					<DialogHeader>
						<DialogTitle>{RUNTIME_DISABLE_CONFIRM.title}</DialogTitle>
						{/*
						 * The copy states what remains first. This dialog's purpose is to say the action is reversible,
						 * not to alarm. If it read as deleting the code, users would not turn the runtime off, and the
						 * action would be effectively absent.
						 */}
						<DialogDescription>
							{RUNTIME_DISABLE_CONFIRM.body}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirming(false)}>
							{RUNTIME_DISABLE_CONFIRM.cancel}
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setConfirming(false);
								void actions.setEnabled(false);
							}}
						>
							{RUNTIME_DISABLE_CONFIRM.confirm}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</EditorSection>
	);
}
