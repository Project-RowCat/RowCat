import type { StoryDraft } from "@rowcat/authoring";
import {
	buildRuntimeTree,
	isRuntimeEnabled,
	RUNTIME_ENTRY_PATH,
	runtimeFolderOf,
} from "@rowcat/authoring";
import { Button } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Link, useParams } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { DraftLeaveGuard } from "#/features/create/editor/leave-guard.tsx";
import { useDraftAutosave } from "#/features/create/editor/use-autosave.ts";
import { useRuntimePreviewGeneration } from "#/features/runtime-preview/runtime-preview-generation.ts";
import { runtimePreviewControls } from "#/features/runtime-preview/runtime-preview-state.ts";
import { useRuntimePreview } from "#/features/runtime-preview/use-runtime-preview.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { draftTitleLabel } from "#/lib/i18n/vocab.ts";
import {
	useDraftRuntimeAssets,
	useDraftRuntimeFiles,
	useDraftRuntimeProject,
	useLocalDraft,
} from "#/lib/local-authoring/hooks.ts";
import { resolveWebRuntimeAsset } from "#/lib/runtime-assets/web-asset-resolver.ts";
import { runtimeAssetEditorEntry } from "./assets/catalog.ts";
import { RuntimeAssetsPanel } from "./assets/panel.tsx";
import { useRuntimeAssetActions } from "./assets/use-actions.ts";
import { RuntimeCommandPalette } from "./commands/palette.tsx";
import { RuntimeQuickOpenDialog } from "./commands/quick-open-dialog.tsx";
import type { RuntimeCommandId } from "./commands/registry.ts";
import type { RuntimeTabCommands } from "./commands/tab-commands.ts";
import { useCopyRuntimePath } from "./commands/use-copy-path.ts";
import { useRuntimeShortcuts } from "./commands/use-shortcuts.ts";
import { mergeRuntimeProblems } from "./compile/problems.ts";
import { useRuntimeCompile } from "./compile/use-compile.ts";
import { deriveRuntimeCompileView } from "./compile/view.ts";
import type { RuntimeMarker } from "./editor/code-editor.tsx";
import { useEffectiveDarkScheme } from "./editor/effective-scheme.ts";
import { RuntimeEditorEmpty } from "./editor/empty.tsx";
import { RuntimeEditorTabs } from "./editor/tabs.tsx";
import { RuntimeFileBreadcrumb } from "./explorer/breadcrumb.tsx";
import type { RuntimeExplorerCommands } from "./explorer/commands.ts";
import { RuntimeDeleteDialog } from "./explorer/delete-dialog.tsx";
import { runtimeEditCheck, runtimeEditIssue } from "./explorer/edit.ts";
import { RuntimeExplorer } from "./explorer/panel.tsx";
import { RuntimeBottomPanel } from "./layout/bottom-panel.tsx";
import { RuntimeMobileTabs } from "./layout/mobile-tabs.tsx";
import { RuntimeResizer } from "./layout/resizer.tsx";
import { RuntimeStudioShell } from "./layout/shell.tsx";
import { useRuntimeLayout } from "./layout/use-layout.ts";
import { RUNTIME_STUDIO } from "./runtime-copy.ts";
import {
	dismissRuntimeOnboarding,
	runtimeOnboardingDismissed,
	showsRuntimeOnboarding,
} from "./runtime-onboarding.ts";
import { RuntimeOnboardingStrip } from "./runtime-onboarding-strip.tsx";
import { RuntimePreview } from "./runtime-preview.tsx";
import { RuntimeStudioHeader } from "./runtime-studio-header.tsx";
import {
	initialRuntimeWorkspace,
	runtimeFileAncestors,
	runtimeWorkspaceReducer,
} from "./runtime-workspace-state.ts";
import { useRuntimeActions } from "./use-runtime-actions.ts";
import { useRuntimeSources } from "./use-runtime-sources.ts";

/**
 * The studio page: opens the workspace for one draft's code project.
 *
 * - Four states: scope opening, no draft, runtime disabled, ready. The third is specific to this
 *   screen, and its answer is to send the user back to the editor. Enabling lives in the draft
 *   editor's runtime section; a second enable here would put the same action in two places.
 * - Monaco is lazy-loaded because it is the largest dependency. The placeholder shown meanwhile
 *   must occupy the same space as the editor pane, or the three panes would jump in width when the
 *   bundle arrives.
 * - Execution lives outside this folder. The preview's worker, VM, and renderer belong to
 *   `features/runtime-preview`; this page receives one handle from that hook (`useRuntimePreview`).
 *   No code here runs creator code through eval, new Function, iframe, Blob URLs, or workers. A
 *   static scan enforces that (`runtime-boundaries.test.ts`). Creator code runs inside QuickJS/WASM
 *   in the worker.
 * - This file has no motion. Pane sizes, visibility, Monaco's box, and resizers change instantly.
 *   Expanding the explorer or opening the bottom panel resizes the editor; interpolating that
 *   geometry would make Monaco re-measure through the transition (see the height-animation section
 *   of `docs/motion/ARCHITECTURE.md`). The editor is not cross-faded on file change either, since
 *   opening files is the most frequent action here. The file uses no `m.*` or `AnimatePresence`,
 *   and it omits the screen-wide entrance (`PageEnter`), because animating arrival above a
 *   placeholder would stack two waits. `runtime-motion.test.ts` enforces this.
 */

const RuntimeCodeEditor = lazy(() =>
	import("./editor/code-editor.tsx").then((module) => ({
		default: module.RuntimeCodeEditor,
	})),
);

/**
 * Passes the pane width as a CSS variable. An inline `style={{ width }}` is not responsive: it
 * would also apply on narrow screens and stop the file pane from using the full width. Reading the
 * variable only in `lg:` utilities keeps the two axes from interfering.
 */
const widthVar = (name: string, px: number): CSSProperties =>
	({ [name]: `${px}px` }) as CSSProperties;

export function RuntimeStudioPage() {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const { draftId } = useParams({ from: "/(app)/create/$draftId_/runtime" });
	const state = useLocalDraft(draftId);

	if (state.status === "loading")
		return (
			<StudioMessage>{t("runtimeStudioPage.loadingTheProject")}</StudioMessage>
		);

	if (state.status === "missing")
		return (
			<StudioNotice
				title={t("runtimeStudioPage.thisDraftIsnTIn")}
				body={t("runtimeStudioPage.draftsAreSavedOnThe")}
				action={
					<Button variant="outline" render={<Link to="/create" />}>
						{t("runtimeStudioPage.backToDrafts")}
					</Button>
				}
			/>
		);

	return <RuntimeStudio draft={state.draft} />;
}

function RuntimeStudio({ draft }: { draft: StoryDraft }) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const autosave = useDraftAutosave(draft.id);
	const actions = useRuntimeActions(draft.id);
	const project = useDraftRuntimeProject(draft.id);
	const files = useDraftRuntimeFiles(draft.id);
	const [layout, setLayout, resetLayout] = useRuntimeLayout();
	const dark = useEffectiveDarkScheme();

	const [workspace, dispatch] = useReducer(
		runtimeWorkspaceReducer,
		undefined,
		initialRuntimeWorkspace,
	);
	const [markers, setMarkers] = useState<RuntimeMarker[]>([]);
	const [quickOpen, setQuickOpen] = useState(false);
	const [commandPalette, setCommandPalette] = useState(false);
	/**
	 * Whether the first-run hint was already dismissed. It is read once, lazily, on first render, the
	 * same judgment as the pane width (`useRuntimeLayout`). The page sits behind `ClientOnly` and is
	 * not drawn on the server, but reading once on first render is cheaper than relying on that.
	 */
	const [onboardingDismissed, setOnboardingDismissed] = useState(
		runtimeOnboardingDismissed,
	);

	/**
	 * The file awaiting deletion. This is separate from the explorer selection: the user can select
	 * another row while the confirm dialog is open, and the file deleted must be the one the dialog
	 * named. Deriving it from the selection would split the dialog's text from the file actually
	 * removed, and that operation cannot be undone.
	 */
	const [deleting, setDeleting] = useState<{
		fileId: string;
		path: string;
	} | null>(null);
	const [deletePending, setDeletePending] = useState(false);
	const clipboard = useCopyRuntimePath();
	/**
	 * Image assets bound to logical names in this draft. They are the same kind of child as files.
	 * Preview snapshots and publish assembly both carry this list. Publishing reads it directly from
	 * storage inside its own transaction; passing this screen's value would open a gap where the two
	 * copies could disagree.
	 */
	const assets = useDraftRuntimeAssets(draft.id);
	const assetActions = useRuntimeAssetActions(draft.id);
	/**
	 * Maps a media identity to a preview URL. The rule belongs to the SDK (`media.url`), and this
	 * screen calls it as is. Writing `${base}/media/${id}` here would break only the asset thumbnails
	 * when the deployment changes its origin.
	 */
	const mediaUrl = useCallback(
		(mediaId: string) => getRowCatClient().media.url(mediaId),
		[],
	);
	/**
	 * The list the editor sees: only the columns it writes, from the authoring record. Without this
	 * projection, `dirty`, `rev`, and `serverVersion` would flow into Monaco's provider code, and
	 * values arriving there could eventually feed decisions.
	 */
	const assetEntries = useMemo(
		() => assets.items.map(runtimeAssetEditorEntry),
		[assets.items],
	);

	const items = files.items;
	/**
	 * Only the list's identity drives effects. Watching its contents, which change on every keystroke,
	 * would run effects per character.
	 */
	const identity = items.map((file) => file.id).join(" ");

	/**
	 * Tabs are reconciled when the stored list changes. Files disappear by three paths (deleted in
	 * this tab, deleted in another tab, or a sync applying another device's deletion), so they are
	 * handled in one place. The last two happen without any action here. If cleanup lived only on the
	 * close path, a tab would remain pointing at a missing file.
	 */
	useEffect(() => {
		dispatch({ type: "sync", fileIds: identity ? identity.split(" ") : [] });
	}, [identity]);

	const entryPath = project.project?.entry ?? RUNTIME_ENTRY_PATH;

	/**
	 * The current editor source is the only snapshot that analysis and preview read. The stored list
	 * (`items`) lags behind the editor by the autosave debounce. Passing that list to the worker used
	 * to run a copy up to 500ms old rather than the code just typed, and when the save arrived the
	 * draft was marked `Changes pending`. The editor's `onChange` updates this table first, while autosave
	 * runs alongside. Preview neither waits for nor forwards saves.
	 */
	const sources = useRuntimeSources({
		files: items,
		entry: entryPath,
		/**
		 * Managed images travel in the same snapshot. Preview resolves logical names, so this table must
		 * be frozen at run time (§34), and this one snapshot is where that freezing happens.
		 */
		assets: assets.items,
	});
	const snapshot = sources.snapshot;

	/**
	 * The runtime compiler's verdict, asked only about what Monaco cannot answer. It is not tied to
	 * autosave: compile failure does not stop saving. That independence is what lets the screen work
	 * as an editor, since broken syntax mid-edit is a normal state while typing. Its input is the same
	 * snapshot the preview uses, so the diagnostics that decide eligibility and the code that actually
	 * runs come from the same copy.
	 */
	const compile = useRuntimeCompile({
		files: snapshot.files,
		entry: snapshot.entry,
	});

	/**
	 * One list for `Problems`, built from two sources and shown on one screen. On collision, RowCat's
	 * verdict wins: TypeScript's `Cannot find module` implies a fix the product does not offer (installing
	 * npm packages) (`runtime-problems.ts`).
	 */
	const problems = useMemo(
		() => mergeRuntimeProblems({ markers, diagnostics: compile.diagnostics }),
		[markers, compile.diagnostics],
	);

	/**
	 * The check status drawn on screen must have one answer built from two inputs. When the screen
	 * drew the runtime analysis state directly, it contradicted itself: `Problems` held a TypeScript
	 * error while the header and the `Runtime` row said `No problems`. Such a contradiction raises no error;
	 * the creator simply believes one of them (`runtime-compile-view.ts`).
	 */
	const compileView = useMemo(
		() => deriveRuntimeCompileView({ compile, problems }),
		[compile, problems],
	);

	/**
	 * The preview receives the editor's current file snapshot (`snapshot` above), not the stored
	 * `items`. `eligible` is an early gate from check status, so a project with blocking errors does
	 * not start a VM. The final authority is the worker's full compile, which closes the window
	 * between Monaco's worker and this debounce.
	 */
	/**
	 * The generation adapter is built outside the preview and passed in as one handle. The preview's
	 * lifetime and the generation wiring are separate concerns; merging them would make the preview
	 * hook aware of the SDK, credentials, and the billing cache.
	 */
	const generation = useRuntimePreviewGeneration({
		storyId: null,
		adult: draft.adult,
	});
	const preview = useRuntimePreview({
		snapshot,
		eligible: compileView.eligible,
		generation,
		resolveAsset: resolveWebRuntimeAsset,
	});
	/**
	 * On first open, two things happen: the entry file is opened, and only its ancestor folders are
	 * expanded so the file is visible. They share one effect because both follow from the same fact:
	 * what was opened decides what to expand. Split apart, that decision would be made twice and could
	 * diverge when the list arrives late. `openedRef` counts this single time, so a tab the user
	 * closes does not reopen; closing was the user's action.
	 *
	 * Folders are not expanded wholesale. That rule suited a three-file project; in a large one the
	 * first screen would be a long list that answers nothing. After this, nothing collapses folders
	 * the user opened.
	 */
	const openedRef = useRef(false);
	useEffect(() => {
		if (openedRef.current || files.loading || items.length === 0) return;
		openedRef.current = true;
		const entry = items.find((file) => file.path === entryPath) ?? items[0];
		dispatch({ type: "open", fileId: entry.id });
		dispatch({
			type: "expandFolders",
			paths: runtimeFileAncestors(entry.path),
		});
	}, [files.loading, items, entryPath]);

	const tree = useMemo(
		() => buildRuntimeTree(items, workspace.draftFolders),
		[items, workspace.draftFolders],
	);

	/**
	 * Each keystroke reaches two consumers: the snapshot (immediately) and autosave (debounced).
	 * Snapshot first is not an ordering requirement; it expresses independence. Neither waits for the
	 * other's result.
	 */
	const onChange = useCallback(
		(fileId: string, content: string) => {
			sources.onChange(fileId, content);
			autosave.patchRuntimeFile(fileId, { content });
		},
		[sources.onChange, autosave],
	);
	const onFlush = useCallback(() => void autosave.flush(), [autosave]);

	/**
	 * Every operation the explorer calls is defined once and triggered from three places: context
	 * menu, overflow menu, and keyboard. State transitions go through the reducer; storage writes go
	 * through `useRuntimeActions`. The explorer deliberately does not know which operations persist,
	 * because if it did, menu rendering code would start deciding what gets saved.
	 */
	const commands = useMemo<RuntimeExplorerCommands>(
		() => ({
			/**
			 * Opening also moves to the narrow-screen files pane. That transition belongs to the one
			 * reducer.
			 */
			open: (fileId) => dispatch({ type: "open", fileId }),
			startCreateFile: (parent) =>
				dispatch({ type: "startCreate", kind: "file", parent }),
			startCreateFolder: (parent) =>
				dispatch({ type: "startCreate", kind: "folder", parent }),
			startRenameFile: (fileId, path) =>
				dispatch({ type: "startRename", fileId, path }),
			/** Does not delete; it asks. The confirm dialog's button performs the actual deletion. */
			requestDeleteFile: (fileId, path) => setDeleting({ fileId, path }),
			copyPath: clipboard.copy,
			collapseAll: () => dispatch({ type: "collapseAll" }),
		}),
		[clipboard.copy],
	);

	/**
	 * The tab row's operations: same shape as the explorer's, different table. The absence of delete
	 * is what separates them. Closing a tab can be undone by reopening it; deleting a file cannot.
	 * Merging the two tables would turn that difference into a gap between menu rows.
	 */
	const tabCommands = useMemo<RuntimeTabCommands>(
		() => ({
			close: (fileId) => dispatch({ type: "close", fileId }),
			closeOthers: (fileId) => dispatch({ type: "closeOthers", fileId }),
			closeAll: () => dispatch({ type: "closeAll" }),
			revealInExplorer: (fileId, path) =>
				dispatch({ type: "revealInExplorer", fileId, path }),
			copyPath: clipboard.copy,
		}),
		[clipboard.copy],
	);

	/**
	 * Going to a file, with three callers: `Quick open` goes to the chosen file, a diagnostic press goes to
	 * its line (the position is passed along), and the Entry in the `Runtime` row goes to the entry
	 * file.
	 *
	 * Unlike selecting a row in the explorer (`open`), this also expands ancestor folders, hands
	 * editor focus over, and jumps to a position if there is one. Callers here are about to write code
	 * rather than browse, so a second navigation path would drop one of these steps, and the mismatch
	 * would show only to the people using that path.
	 */
	const navigateToFile = useCallback((fileId: string, path: string) => {
		dispatch({ type: "navigate", fileId, path });
	}, []);

	/**
	 * The preview's main action: run if idle, restart if running. The eligibility check lives here on
	 * purpose. The button, the palette, and `⌘Enter` all pass through this function, so for a project
	 * with blocking errors the three paths give the same answer. If one path skipped `eligible`, only
	 * that path would start a VM, and the mismatch would show only to the people using it.
	 */
	const runPreview = useCallback(() => {
		if (!preview.eligible) return;
		const controls = runtimePreviewControls(preview.state);
		if (controls.run) preview.run();
		else if (controls.restart) preview.restart();
	}, [preview]);

	useRuntimeShortcuts({
		quickOpen: () => setQuickOpen(true),
		toggleExplorer: () => dispatch({ type: "toggleExplorer" }),
		runPreview,
		openCommands: () => setCommandPalette(true),
	});

	/**
	 * Submits the inline input. The validity rule is pure (`runtimeEditCheck`); here we decide only
	 * what to do with its result. Doing nothing for a value that fails validation is the point: the
	 * input stays open, and the reason is already written next to it. Keeping the input open after a
	 * failed save follows the same logic. Closing it would erase the name the user just typed, leaving
	 * only a toast and a list that looks unchanged.
	 */
	const submitEdit = useCallback(() => {
		const edit = workspace.edit;
		if (edit === null) return;
		const check = runtimeEditCheck(edit, items);
		if (check === null || !check.ok) return;

		if (edit.kind === "create-folder") {
			dispatch({ type: "createdFolder", path: check.path });
			return;
		}
		if (edit.kind === "rename-file") {
			void actions.rename(edit.fileId, check.path).then((ok) => {
				if (ok) dispatch({ type: "cancelEdit" });
			});
			return;
		}
		void actions.createFile(check.path).then((file) => {
			if (!file) return;
			/**
			 * Reads the parent from the normalized path. The user can type `ui/panel.tsx` into the name
			 * field, and then the folder to expand is not where creation started but `ui` beneath it.
			 */
			dispatch({
				type: "createdFile",
				fileId: file.id,
				parent: runtimeFolderOf(check.path),
			});
		});
	}, [actions, items, workspace.edit]);

	const confirmDelete = useCallback(() => {
		if (deleting === null) return;
		setDeletePending(true);
		void actions.remove(deleting.fileId).then((ok) => {
			setDeletePending(false);
			/**
			 * On failure the dialog stays open. If it closed, the screen would show the file still present
			 * with only a toast, and the user could not tell whether it had been deleted.
			 */
			if (ok) setDeleting(null);
		});
	}, [actions, deleting]);

	if (project.loading || files.loading)
		return (
			<StudioMessage>{t("runtimeStudioPage.loadingTheProject")}</StudioMessage>
		);

	/**
	 * Opening this address for a draft that never enabled the runtime, or has disabled it, sends the
	 * user back to the editor. It does not enable here, for two reasons. The enable action must live
	 * in one place (the draft editor's section). And if someone who turned the runtime off silently
	 * re-enabled it by opening this URL, they would see their own action reversed.
	 */
	if (!isRuntimeEnabled(project.project))
		return (
			<StudioNotice
				title={t("runtimeStudioPage.runtimeIsnTOnFor")}
				body={t("runtimeStudioPage.youCanTurnItOn")}
				action={
					<Button
						variant="outline"
						render={
							<Link to="/create/$draftId" params={{ draftId: draft.id }} />
						}
					>
						{RUNTIME_STUDIO.back}
					</Button>
				}
			/>
		);

	/**
	 * The file the editor is showing and the entry file are looked up from the list rather than
	 * stored. Both are facts the storage answers. The active id and entry path each live where they
	 * belong (the reducer and the runtime project), and this code only finds the records they point
	 * to; a copy would go stale the moment a file is renamed. The entry file may be missing. That is a
	 * state of the project, not an error, and the `Problems` row says so in its own words. Here the
	 * value only decides whether an open action is offered, because a button for a missing file does
	 * nothing when pressed.
	 */
	const activeFile =
		items.find((file) => file.id === workspace.activeId) ?? null;
	const entryFile = items.find((file) => file.path === entryPath) ?? null;

	const explorer = (
		<RuntimeExplorer
			tree={tree}
			activeFileId={workspace.activeId}
			selection={workspace.selection}
			expanded={workspace.expanded}
			edit={workspace.edit}
			editIssue={runtimeEditIssue(workspace.edit, items)}
			announcement={clipboard.announcement}
			commands={commands}
			onToggleFolder={(path) => dispatch({ type: "toggleFolder", path })}
			onSelect={(selection) => dispatch({ type: "select", selection })}
			onEditValue={(value) => dispatch({ type: "editValue", value })}
			onSubmitEdit={submitEdit}
			onCancelEdit={() => dispatch({ type: "cancelEdit" })}
		/>
	);

	/**
	 * The explorer column draws two things: the file tree and the asset list. Assets sit below because
	 * of their nature: the top says what the project is made of, and the bottom says what it calls.
	 * The list has its own height cap and scrolls internally, so it never pushes the tree out. The
	 * narrow-screen `Files` pane uses the same order.
	 */
	const explorerPane = (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1">{explorer}</div>
			<RuntimeAssetsPanel
				assets={assets.items}
				actions={assetActions}
				mediaUrl={mediaUrl}
				onCopy={clipboard.copy}
				/*
				 * Rename and removal count references written directly in the current editor source, not the
				 * stored record. The reason is the autosave debounce: if the user has just typed
				 * `asset("ui/heart")` and the record does not yet contain it, a removal in that frame would
				 * report the name as unused while deleting a name in use. Counting neither waits for nor
				 * forwards autosave.
				 */
				sources={snapshot.files}
			/>
		</div>
	);

	return (
		<RuntimeStudioShell>
			{/*
			 * The navigation-guard dialog is the same one the draft editor uses. Code goes through the same
			 * autosave queue (`patchRuntimeFile`), so a path that leaves while a save has failed also exists
			 * here.
			 */}
			<DraftLeaveGuard autosave={autosave} />
			<RuntimeStudioHeader
				draftId={draft.id}
				title={draftTitleLabel(draft)}
				autosave={autosave}
				compile={compileView}
				explorerVisible={workspace.explorerVisible}
				previewVisible={workspace.preview}
				onOpenProblems={() => dispatch({ type: "setPanel", panel: "problems" })}
				onQuickOpen={() => setQuickOpen(true)}
				onOpenCommands={() => setCommandPalette(true)}
				onToggleExplorer={() => dispatch({ type: "toggleExplorer" })}
				onTogglePreview={() => dispatch({ type: "togglePreview" })}
				onResetLayout={resetLayout}
			/>

			{/*
			 * The first-run hint sits below the header and above the pane selector. The header is always
			 * visible,
			 * so mixing a temporary hint into it would change that line's geometry when the hint closes. Below
			 * the pane selector, a user on the narrow `Preview` pane would never see it.
			 */}
			{showsRuntimeOnboarding({
				dismissed: onboardingDismissed,
				fileCount: items.length,
			}) && (
				<RuntimeOnboardingStrip
					entry={entryPath}
					onOpenEntry={
						entryFile === null
							? null
							: () => navigateToFile(entryFile.id, entryFile.path)
					}
					onDismiss={() => {
						dismissRuntimeOnboarding();
						setOnboardingDismissed(true);
					}}
				/>
			)}

			<RuntimeMobileTabs
				active={workspace.mobileTab}
				onSelect={(tab) => dispatch({ type: "setMobileTab", tab })}
			/>

			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex min-h-0 flex-1">
					{/*
					 * On wide screens the explorer is a collapsible column; on narrow screens it is a single pane. The
					 * two axes must not interfere. `explorerVisible` applies only to `lg:` utilities, and the narrow
					 * `files` pane draws its list regardless of that value, because hiding it there would remove every
					 * way to pick a file. Position is set by utilities, and the width is carried by a CSS variable: an
					 * inline `style={{ width }}` would also apply on narrow screens and keep the file pane from using
					 * the
					 * full width.
					 */}
					<div
						style={widthVar("--runtime-explorer", layout.explorer)}
						className={cn(
							"min-h-0 border-e",
							workspace.mobileTab === "files" ? "block w-full" : "hidden",
							workspace.explorerVisible
								? "lg:block lg:w-(--runtime-explorer) lg:shrink-0"
								: "lg:hidden",
						)}
					>
						{explorerPane}
					</div>
					{workspace.explorerVisible && (
						<RuntimeResizer
							axis="explorer"
							side="end"
							value={layout.explorer}
							label={t("runtimeStudioPage.explorerWidth")}
							className="hidden lg:block"
							onChange={(explorer) => setLayout({ explorer })}
						/>
					)}

					<div
						className={cn(
							"min-h-0 min-w-0 flex-1",
							workspace.mobileTab === "code" ? "flex" : "hidden",
							"lg:flex",
						)}
					>
						<div className="flex min-h-0 min-w-0 flex-1 flex-col">
							<RuntimeEditorTabs
								files={items}
								openIds={workspace.openIds}
								activeId={workspace.activeId}
								onSelect={(fileId) => dispatch({ type: "open", fileId })}
								commands={tabCommands}
							/>
							{/*
							 * This row appears only when a file is active. Drawing it over an empty editor would show a line
							 * pointing at nothing, using space borrowed from the editor. The tab bar likewise does not appear
							 * without an open tab. Its actions call the same commands as the tab menu; clipboard and explorer
							 * navigation are not reimplemented here.
							 */}
							{activeFile !== null && (
								<RuntimeFileBreadcrumb
									fileId={activeFile.id}
									path={activeFile.path}
									commands={tabCommands}
								/>
							)}
							<div className="min-h-0 flex-1">
								{workspace.activeId === null ? (
									<RuntimeEditorEmpty
										fileCount={items.length}
										onCreateFile={() => {
											commands.startCreateFile("");
											/*
											 * The create input appears inside the explorer. On narrow screens that pane is not
											 * visible, so the view moves to it as well; otherwise this button would appear to do
											 * nothing.
											 */
											dispatch({ type: "setMobileTab", tab: "files" });
										}}
									/>
								) : (
									<Suspense
										fallback={
											<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
												{t("runtimeStudioPage.loadingTheEditor")}
											</div>
										}
									>
										<RuntimeCodeEditor
											files={items}
											/*
											 * Autocomplete and hover inputs. These come from the narrowed column, not the authoring
											 * record, so the sync axis never reaches Monaco's provider code.
											 */
											assets={assetEntries}
											mediaUrl={mediaUrl}
											activeFileId={workspace.activeId}
											onChange={onChange}
											onMarkers={setMarkers}
											onFlush={onFlush}
											request={workspace.editorRequest}
											onRequestHandled={() =>
												dispatch({ type: "editorRequestHandled" })
											}
											onQuickOpen={() => setQuickOpen(true)}
											onToggleExplorer={() =>
												dispatch({ type: "toggleExplorer" })
											}
											onRunPreview={runPreview}
											onOpenCommands={() => setCommandPalette(true)}
											dark={dark}
										/>
									</Suspense>
								)}
							</div>
						</div>
					</div>

					{/*
					 * The preview is a collapsible column on wide screens and a single pane on narrow ones. It is one
					 * element, not two, with utilities deciding placement. The renderer attaches to a single element,
					 * and
					 * that element must stay mounted even when hidden, so a late-arriving bundle has somewhere to go.
					 */}
					{workspace.preview && (
						<RuntimeResizer
							axis="preview"
							side="start"
							value={layout.preview}
							label={t("runtimeStudioPage.previewWidth")}
							className="hidden lg:block"
							onChange={(preview) => setLayout({ preview })}
						/>
					)}
					<div
						style={widthVar("--runtime-preview", layout.preview)}
						className={cn(
							"min-h-0 border-s",
							workspace.mobileTab === "preview" ? "block w-full" : "hidden",
							workspace.preview
								? "lg:block lg:w-(--runtime-preview) lg:shrink-0"
								: "lg:hidden",
						)}
					>
						<RuntimePreview
							preview={preview}
							/**
							 * A runtime error's stack is opened by the same route as `Problems` diagnostics: the
							 * position is stored as a request, and the editor handles it in the frame where it has
							 * attached the model.
							 */
							onOpenSource={(frame) => {
								const owner = items.find((file) => file.path === frame.path);
								if (!owner) return;
								dispatch({
									type: "navigate",
									fileId: owner.id,
									path: owner.path,
									line: frame.line ?? 1,
									column: frame.column ?? 1,
								});
							}}
						/>
					</div>
				</div>

				{workspace.panel !== null && (
					<RuntimeResizer
						axis="panel"
						side="start"
						value={layout.panel}
						label={t("runtimeStudioPage.panelHeight")}
						onChange={(panel) => setLayout({ panel })}
					/>
				)}
				<div
					style={
						workspace.panel === null
							? undefined
							: { height: `${layout.panel}px` }
					}
					className="flex shrink-0 flex-col"
				>
					<RuntimeBottomPanel
						panel={workspace.panel}
						problems={problems}
						entry={entryPath}
						fileCount={items.length}
						enabled
						modules={compile.modules}
						compile={compileView}
						entryExists={entryFile !== null}
						execution={preview.state.status}
						console={preview.console}
						storyState={preview.storyState}
						persistentState={preview.persistentState}
						onClearConsole={preview.clearConsole}
						onSelect={(panel) => dispatch({ type: "setPanel", panel })}
						/**
						 * Goes to the entry file, using the same transition as quick open and diagnostics. Before
						 * this, the runtime row recorded the entry path but offered no way to open it, so a reader
						 * had to find that name by eye in the explorer. For a missing file the action is not offered
						 * (`entryExists`), so it is not checked again here.
						 */
						onOpenEntry={() => {
							if (entryFile) navigateToFile(entryFile.id, entryFile.path);
						}}
						/**
						 * A diagnostic press opens its file and goes to its line. The position is stored as a request
						 * rather than applied now, because the editor may not yet hold this file's model (the file
						 * was just opened). A timer would be racy on slow devices, so the editor applies it in the
						 * frame where it attaches the model. A missing line or column defaults to 1: some diagnostics
						 * belong to a file without a known position, and the first line is the least wrong guess.
						 * Document coordinates are 1-based.
						 */
						onOpenProblem={(problem) => {
							const owner = items.find((file) => file.path === problem.path);
							if (!owner) return;
							dispatch({
								type: "navigate",
								fileId: owner.id,
								path: owner.path,
								line: problem.line ?? 1,
								column: problem.column ?? 1,
							});
						}}
					/>
				</div>
			</div>

			{/*
			 * Quick open sees all source files, not only open ones. If it showed only open files, it would be a
			 * switcher between files already open, which is what the tab row does.
			 */}
			<RuntimeQuickOpenDialog
				open={quickOpen}
				files={items}
				onOpenChange={setQuickOpen}
				onPick={navigateToFile}
			/>

			{/*
			 * The command palette: find operations by name rather than adding header icons.
			 *
			 * The executor is typed as `Record<RuntimeCommandId, () => void>` on purpose. When the command
			 * vocabulary
			 * grows, compilation fails here. With a spread or a `switch` plus `default`, a command with no
			 * wiring
			 * would appear in the list and do nothing when pressed.
			 *
			 * No handler is created here. Each one is something the screen already calls; the palette only adds
			 * a
			 * keyboard route to them.
			 */}
			<RuntimeCommandPalette
				open={commandPalette}
				context={{
					preview: runtimePreviewControls(preview.state),
					previewEligible: preview.eligible,
					explorerVisible: workspace.explorerVisible,
					previewVisible: workspace.preview,
					panel: workspace.panel,
					entryExists: entryFile !== null,
				}}
				onOpenChange={setCommandPalette}
				onRun={(id) => {
					const run: Record<RuntimeCommandId, () => void> = {
						"quick-open": () => setQuickOpen(true),
						"preview-run": runPreview,
						"preview-restart": runPreview,
						"preview-stop": preview.stop,
						"preview-reset-playthrough": preview.resetPlaythrough,
						"preview-reset-persistent": preview.resetPersistentState,
						"panel-problems": () =>
							dispatch({ type: "setPanel", panel: "problems" }),
						"panel-console": () =>
							dispatch({ type: "setPanel", panel: "console" }),
						"panel-state": () => dispatch({ type: "setPanel", panel: "state" }),
						"panel-runtime": () =>
							dispatch({ type: "setPanel", panel: "runtime" }),
						"panel-close": () => dispatch({ type: "setPanel", panel: null }),
						"toggle-explorer": () => dispatch({ type: "toggleExplorer" }),
						"toggle-preview": () => dispatch({ type: "togglePreview" }),
						"reset-layout": resetLayout,
						/*
						 * The create input appears in the explorer. On narrow screens that pane is not currently
						 * visible, so the view moves there too; otherwise this command would appear to do nothing.
						 * The editor's empty state makes the same call.
						 */
						"new-file": () => {
							commands.startCreateFile("");
							dispatch({ type: "setMobileTab", tab: "files" });
						},
						"new-folder": () => {
							commands.startCreateFolder("");
							dispatch({ type: "setMobileTab", tab: "files" });
						},
						"open-entry": () => {
							if (entryFile) navigateToFile(entryFile.id, entryFile.path);
						},
					};
					run[id]();
				}}
			/>

			<RuntimeDeleteDialog
				path={deleting?.path ?? null}
				pending={deletePending}
				onCancel={() => setDeleting(null)}
				onConfirm={confirmDelete}
			/>
		</RuntimeStudioShell>
	);
}

function StudioMessage({ children }: { children: string }) {
	return (
		<RuntimeStudioShell>
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				{children}
			</div>
		</RuntimeStudioShell>
	);
}

/**
 * A dead-end screen always shows a way out. A message alone would leave the user only the back
 * action, but this screen can be opened without going through the list, so the back direction may
 * lead outside RowCat.
 */
function StudioNotice({
	title,
	body,
	action,
}: {
	title: string;
	body: string;
	action: React.ReactNode;
}) {
	return (
		<RuntimeStudioShell>
			<div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
				<div>
					<p className="text-sm font-medium">{title}</p>
					<p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
				</div>
				{action}
			</div>
		</RuntimeStudioShell>
	);
}
