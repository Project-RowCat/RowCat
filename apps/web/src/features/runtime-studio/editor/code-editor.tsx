import type { DraftRuntimeFile } from "@rowcat/authoring";
import { useEffect, useMemo, useRef } from "react";
import { translator } from "#/lib/i18n/current.ts";
import {
	createRuntimeAssetCatalogHandle,
	prepareRuntimeAssetCatalog,
	type RuntimeAssetEditorEntry,
} from "../assets/catalog.ts";
import type { RuntimeEditorRequest } from "../runtime-workspace-state.ts";
import {
	createRuntimeStudioModels,
	type RuntimeStudioModels,
} from "./models.ts";
import {
	applyRuntimeMonacoTheme,
	configureRuntimeMonaco,
	TS_LANGUAGE_ID,
} from "./monaco-setup.ts";

/**
 * Attaches Monaco to the workspace. React renders only an empty box; Monaco builds its DOM inside
 * it. This component coordinates: it feeds the repo's file list into the model set, restores view
 * positions when tabs change, and collects diagnostics.
 *
 * - Model lifetime and ownership live in `runtime-editor-models.ts`: one model per file, keyed by
 *   file id (renames replace models), scoped to this editor instance. Sharing models across two
 *   studios would mix screen, save, and autocomplete.
 * - Several models are required by the type service: `state.ts` must exist as a model for `import
 *   "./state.ts"` in `main.tsx` to resolve.
 * - The screen leads and the record follows: autosave lands 500ms later, so writing records into
 *   the model would erase in-flight typing. That judgment is in the model layer
 *   (`reconcileEditedValue`).
 * - Not done here: execution (no eval, new Function, iframe, or worker path), compilation, saving
 *   (only `onChange` is called), and model URI construction (`RuntimeStudioScope` enforces the
 *   scope).
 * - The image list is bound to the models: Monaco's providers are registered per language
 *   (`monaco-setup.ts`) and do not know the open draft. This component holds one image box that all
 *   models share, so an upload changes one value rather than re-registering providers.
 */

/**
 * Monaco takes the font as a string, not a CSS class, so Tailwind's `font-mono` utility cannot be
 * used. This stack is written by hand to match it. A different stack would make path text in the
 * explorer and tabs render in another font than the editor text.
 */
const MONO_STACK =
	'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export interface RuntimeMarker {
	fileId: string;
	path: string;
	line: number;
	column: number;
	message: string;
	severity: "error" | "warning" | "info";
}

export interface RuntimeCodeEditorProps {
	files: DraftRuntimeFile[];
	activeFileId: string | null;
	onChange: (fileId: string, content: string) => void;
	/** Diagnostics changed; the `Problems` cell draws them. */
	onMarkers: (markers: RuntimeMarker[]) => void;
	/** `⌘S`. Autosave stays authoritative; this only asks it to write now. */
	onFlush: () => void;
	/**
	 * A one-time request to the editor: a request, not state. It has two forms: move focus to a file
	 * just created, or move the cursor to the line a diagnostic points at. No timer is used because
	 * this component is `lazy` and models attach after the record arrives; an arbitrary delay would
	 * misalign on slow devices. Keeping the request addressed to a file lets the editor handle it on
	 * the frame where that file actually attaches. Cursor and scroll remain Monaco's; the request says
	 * only where to go, and view-state memory handles the rest.
	 */
	request: RuntimeEditorRequest;
	/** Handled. The caller clears the request, which prevents the same request from running twice. */
	onRequestHandled: () => void;
	/**
	 * `⌘P`. Outside the editor the hook handles it; inside code the editor handles it through its own
	 * command.
	 */
	onQuickOpen: () => void;
	onToggleExplorer: () => void;
	/**
	 * `⌘Enter` runs or restarts the preview, the primary action of the preview pane. It is the key
	 * most needed inside code: the usual loop is edit, restart, look, and the restart comes while the
	 * hand is still on the code.
	 */
	onRunPreview: () => void;
	onOpenCommands: () => void;
	/**
	 * Whether the current background is dark, including the case where the account theme overrides it.
	 * This is the effective value.
	 */
	dark: boolean;
	/**
	 * The images this draft binds to logical names; they feed autocomplete and hover. The prop takes
	 * the narrowed slice only (`runtime-asset-catalog.ts`), not the authored record. If the sync axis
	 * crossed this boundary, Monaco's provider code would start deciding things from it.
	 */
	assets: readonly RuntimeAssetEditorEntry[];
	/**
	 * Maps a media identity to an address on our origin. The rule belongs to the SDK and is not
	 * assembled here.
	 */
	mediaUrl: (mediaId: string) => string;
}

export function RuntimeCodeEditor({
	files,
	activeFileId,
	onChange,
	onMarkers,
	onFlush,
	request,
	onRequestHandled,
	onQuickOpen,
	onToggleExplorer,
	onRunPreview,
	onOpenCommands,
	dark,
	assets,
	mediaUrl,
}: RuntimeCodeEditorProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	/**
	 * The image box for this editor: one per editor, shared by its models. It is filled during render,
	 * not in an effect. An effect would let autocomplete answer an empty list right after mount, and
	 * that frame is the one that arrives as soon as the user types `asset("`.
	 */
	const catalogRef = useRef(createRuntimeAssetCatalogHandle());
	catalogRef.current.current = useMemo(
		() => prepareRuntimeAssetCatalog(assets, mediaUrl),
		[assets, mediaUrl],
	);
	/**
	 * A channel for reading the latest props outside render. Monaco's listeners attach once for the
	 * editor's whole life. If a callback captured props in a closure, it would call the first render's
	 * function forever, which points at an already-unmounted state.
	 */
	const latest = useRef({
		onChange,
		onMarkers,
		onFlush,
		onRequestHandled,
		onQuickOpen,
		onToggleExplorer,
		onRunPreview,
		onOpenCommands,
		files,
	});
	latest.current = {
		onChange,
		onMarkers,
		onFlush,
		onRequestHandled,
		onQuickOpen,
		onToggleExplorer,
		onRunPreview,
		onOpenCommands,
		files,
	};

	/**
	 * Monaco's live objects, not React state. As state, every model creation would re-render the tree,
	 * and that render would change nothing: the editor's DOM belongs to Monaco.
	 */
	const world = useRef<{
		monaco: typeof import("monaco-editor/editor/editor.api") | null;
		editor:
			| import("monaco-editor/editor/editor.api").editor.IStandaloneCodeEditor
			| null;
		/**
		 * Models owned by this mount. They are created fresh on each mount, with a newly issued scope.
		 */
		models: RuntimeStudioModels<
			import("monaco-editor/editor/editor.api").editor.ITextModel
		> | null;
		views: Map<
			string,
			| import("monaco-editor/editor/editor.api").editor.ICodeEditorViewState
			| null
		>;
		disposables: import("monaco-editor/editor/editor.api").IDisposable[];
	}>({
		monaco: null,
		editor: null,
		models: null,
		views: new Map(),
		disposables: [],
	});

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const monaco = configureRuntimeMonaco();
		const current = world.current;
		current.monaco = monaco;

		/**
		 * The model layer sees only these four lines of Monaco. URIs pass as strings. Passing a `Uri`
		 * into that layer would require Monaco to validate the scope rule, and this repo's web tests have
		 * no DOM.
		 */
		current.models = createRuntimeStudioModels({
			registry: {
				getModel: (uri) => monaco.editor.getModel(monaco.Uri.parse(uri)),
				/**
				 * Names the language explicitly instead of relying on extension inference. Monaco can infer the
				 * language from the URI extension, but that inference works only after the language is
				 * registered, and `configureRuntimeMonaco()` does the registering. A model created in a frame
				 * where the order is off comes up with no language (no colors, diagnostics, or autocomplete)
				 * and raises no error. Pinning the value prevents that frame.
				 *
				 * `.tsx` must not fold to `.ts`. The URI guarantees this because the model layer passes the
				 * record's path through unchanged. The TypeScript worker picks JSX mode from that extension, so
				 * one letter decides whether `<Screen>` is a syntax error.
				 */
				createModel: (content, uri) =>
					monaco.editor.createModel(
						content,
						TS_LANGUAGE_ID,
						monaco.Uri.parse(uri),
					),
			},
			catalog: catalogRef.current,
			onChange: (fileId, content) => latest.current.onChange(fileId, content),
			onForget: (fileId) => world.current.views.delete(fileId),
		});

		const editor = monaco.editor.create(host, {
			/**
			 * Starts with no model. The sync effect below attaches the active file. An empty model created
			 * here would register with the type service as a file that is not in the project.
			 */
			model: null,
			automaticLayout: true,
			fontFamily: MONO_STACK,
			fontSize: 13,
			lineHeight: 21,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			renderLineHighlight: "line",
			smoothScrolling: false,
			tabSize: 2,
			insertSpaces: false,
			padding: { top: 12, bottom: 12 },
			/** Monaco manages the accessibility tree itself; the DOM we wrap must not obscure it. */
			/** Read once at mount: re-running this effect would rebuild the editor and drop its models. */
			ariaLabel: translator("runtimeStudio")("codeEditor.runtimeCodeEditor"),
			scrollbar: { useShadows: false },
			/**
			 * Turns on word wrap. This cell shares width with the preview and explorer and can narrow. With
			 * only horizontal scrolling, reading code would require moving in two directions.
			 */
			wordWrap: "on",
			/**
			 * Explicitly enables semantic highlighting. The default is `configuredByTheme`, and the standard
			 * distribution's theme object always holds that as false (`StandaloneTheme`'s
			 * `semanticHighlighting = false`, with no slot in theme data to change it). So even with a
			 * provider registered, nothing calls it without this line, and that silence raises no error.
			 */
			"semanticHighlighting.enabled": true,
		});
		current.editor = editor;

		current.disposables.push(
			/**
			 * Diagnostics are collected from all models together. Looking only at the active file would drop
			 * other files' errors from `Problems`, and those files would look error-free until opened. Other
			 * editors' diagnostics do not reach here: `byUri` is built only from this mount's models, and
			 * those URIs are confined to this editor's scope.
			 */
			monaco.editor.onDidChangeMarkers(() => {
				const owned = world.current.models;
				if (!owned) return;
				const byUri = new Map(
					owned
						.entries()
						.map(([fileId, entry]) => [
							entry.model.uri.toString(),
							{ fileId, path: entry.path },
						]),
				);
				const markers: RuntimeMarker[] = [];
				for (const marker of monaco.editor.getModelMarkers({})) {
					const owner = byUri.get(marker.resource.toString());
					if (!owner) continue;
					markers.push({
						fileId: owner.fileId,
						/** The path creators see, not the model's address. */
						path: owner.path,
						line: marker.startLineNumber,
						column: marker.startColumn,
						message: marker.message,
						severity:
							marker.severity === monaco.MarkerSeverity.Error
								? "error"
								: marker.severity === monaco.MarkerSeverity.Warning
									? "warning"
									: "info",
					});
				}
				latest.current.onMarkers(markers);
			}),
		);

		/**
		 * `⌘S` does not create a save. It flushes the autosave already in progress. Without this, the
		 * browser's 'Save page' dialog opens. That dialog means nothing on this screen, and the user
		 * would read their code as unsaved.
		 */
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
			latest.current.onFlush(),
		);

		/**
		 * `⌘P` and `⌘B` are registered here too. The window-level listener skips keys that come from
		 * input fields (`use-runtime-shortcuts.ts`), and Monaco's input is a hidden `<textarea>`, so
		 * those keys would be caught by that check. Typing code is exactly when these two keys matter
		 * most, so the editor binds the same actions with its own key binding. Without this registration,
		 * both shortcuts stop working as soon as the hand is on the code.
		 */
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () =>
			latest.current.onQuickOpen(),
		);
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () =>
			latest.current.onToggleExplorer(),
		);
		/**
		 * `⌘Enter` and `⌘⇧P` are also registered here, for the same reason. `⌘Enter` especially: the
		 * moment you want to rebuild a stale preview is right after editing a line, when the hand is on
		 * the code. Whether a run is possible is not checked here. That judgment lives in one function
		 * (`runPreview`), and the button, the palette, and this key all pass through it.
		 */
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
			latest.current.onRunPreview(),
		);
		editor.addCommand(
			monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
			() => latest.current.onOpenCommands(),
		);

		return () => {
			for (const disposable of current.disposables) disposable.dispose();
			current.disposables = [];
			/**
			 * Disposes only this mount's models. A second studio open side by side may have the same project
			 * path open, but its models sit at different addresses, so this cleanup does not reach them.
			 */
			current.models?.dispose();
			current.models = null;
			current.views.clear();
			editor.dispose();
			current.editor = null;
		};
	}, []);

	useEffect(() => {
		world.current.models?.sync(files);
	}, [files]);

	/**
	 * `files` is a required dependency. The linter sees it as unused in this effect's body, but
	 * renaming a file discards and recreates its model (the URI is immutable). The effect above does
	 * that replacement. If this effect does not rerun, the editor keeps a disposed model: the screen
	 * goes blank and typing stops working.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the paragraph above; replacing the model is the signal.
	useEffect(() => {
		const { editor, models, views } = world.current;
		if (!editor || !models) return;

		const target = activeFileId ? models.get(activeFileId) : undefined;
		const previous = editor.getModel();

		/**
		 * Does not swap the model when it is already the same. This effect now also runs when a request
		 * arrives (the file may already be active when a diagnostic is clicked). Calling `setModel` again
		 * would add a round-trip of view-state save and restore, and the cursor moved below would be
		 * overwritten by that restore.
		 */
		if (previous !== target?.model) {
			if (previous)
				for (const [fileId, entry] of models.entries())
					if (entry.model === previous)
						views.set(fileId, editor.saveViewState());

			if (!target) {
				editor.setModel(null);
				return;
			}
			editor.setModel(target.model);
			const view = views.get(activeFileId ?? "");
			if (view) editor.restoreViewState(view);
		}

		if (!target) return;

		/**
		 * A request is handled only on the frame where its file is actually attached. Called from an
		 * outside timer, it would focus an editor with no model yet, and typing would go nowhere. Moving
		 * the position without a model does nothing, silently. Focus is also not taken without a request.
		 * A user who picked a file in the explorer has not decided what to do next and may view other
		 * files; taking focus would make arrow keys move the code instead of the list.
		 */
		if (request === null || request.fileId !== activeFileId) return;

		if (request.kind === "reveal") {
			const position = {
				lineNumber: Math.max(1, request.line),
				column: Math.max(1, request.column),
			};
			/**
			 * If the line is already visible, do not scroll (`…IfOutsideViewport`). If the view jumped on
			 * every diagnostic click, moving between two diagnostics in the same file would be disorienting.
			 */
			editor.revealLineInCenterIfOutsideViewport(position.lineNumber);
			editor.setPosition(position);
		}
		editor.focus();
		latest.current.onRequestHandled();
	}, [activeFileId, files, request]);

	/**
	 * On an appearance change, the theme is redefined and reapplied. Redefining is needed because the
	 * surface comes from the screen (the account theme overrides the background). The value is read
	 * where this box actually sits, and the rule comes from the same function, so no path swaps only
	 * the colors.
	 */
	useEffect(() => {
		if (!world.current.monaco) return;
		applyRuntimeMonacoTheme(dark, hostRef.current);
	}, [dark]);

	/**
	 * One box. Its inside is Monaco's DOM, so no children go here; children would shift the reference
	 * Monaco uses to measure its own height.
	 */
	return <div ref={hostRef} className="h-full w-full min-w-0" />;
}
