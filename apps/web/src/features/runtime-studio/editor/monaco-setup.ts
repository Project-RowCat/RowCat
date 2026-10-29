/**
 * The TypeScript language API is exported directly by the contribution module. The
 * monaco.languages.typescript namespace is a placeholder in 0.5x (its type is { deprecated: true
 * }), and the real settings handle lives in this import. A side-effect-only import would leave no
 * way to set compiler options.
 */
import { runtimePackageFiles } from "@rowcat/runtime/declarations";
import {
	RUNTIME_VIRTUAL_ROOT,
	runtimeCompilerOptions,
} from "@rowcat/runtime-compiler";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
/**
 * Language definition and language service are separate modules. The service below provides
 * diagnostics and completions. typescript.js next to it provides the language itself (syntax,
 * bracket pairs, comment rules). Without it, the editor opens with every character in one color,
 * and that symptom raises no error.
 */
import {
	getTypeScriptWorker,
	typescriptDefaults,
} from "monaco-editor/languages/features/typescript/register";
import "monaco-editor/features/register.all";
/**
 * Warning: do not use definitions/typescript/register. That module registers the language with lazy
 * loading (loader: () => import(...)), which moves the timing of the grammar out of our hands. Our
 * JSX extension would race with the lazy load, and the late-arriving official grammar would
 * silently overwrite ours. Passing the definition object directly keeps the ordering inside this
 * function.
 *
 * The grammar is not copied: conf and language are Monaco's official definitions, and withJsx
 * layers four states on top (runtime-tsx-grammar.ts explains why).
 */
import {
	conf as typescriptConf,
	language as typescriptLanguage,
} from "monaco-editor/languages/definitions/typescript/typescript";
import { createRuntimeAssetCompletionProvider } from "../assets/completions.ts";
import { createRuntimeAssetHoverProvider } from "../assets/hover.ts";
import { readRuntimeEditorChrome } from "./chrome.ts";
import { runtimeMonacoTheme } from "./monaco-theme.ts";
/**
 * The TypeScript worker entry point is ours. Monaco's worker contract (0.56) has no semantic
 * classification, so a derived class adds a read function. Everything else behaves exactly like
 * Monaco's worker; the header of monaco-ts.worker.ts explains why.
 */
import TypeScriptWorker from "./monaco-ts.worker.ts?worker";
import {
	provideRuntimeSemanticTokens,
	RUNTIME_SEMANTIC_TOKEN_MODIFIERS,
	RUNTIME_SEMANTIC_TOKEN_TYPES,
	type RuntimeSemanticWorker,
} from "./semantic-tokens.ts";
import { withJsx } from "./tsx-grammar.ts";

/**
 * Single place where Monaco is attached to the app. It is evaluated only in the browser: the route
 * lazy-loads the studio under ClientOnly, so server rendering never loads this file, which keeps
 * several megabytes out of the SSR bundle.
 * - Only three Monaco entry points are assembled: the editor API, the feature set, and the
 *   TypeScript language. The default monaco-editor entry pulls in more than ninety language
 *   definitions, and this studio opens only .ts and .tsx.
 * - Workers are bundled, not fetched from a CDN. @monaco-editor/react is avoided because its
 *   default loader fetches Monaco from jsdelivr, which would leak viewers' IP addresses to a third
 *   party.
 * - Image completion and hover are registered here once per language. The asset list is not part
 *   of the registration: the model supplies it, so uploading an image does not re-register the
 *   providers.
 *
 * Not here:
 * - Code execution. Nothing in this folder runs author code; that belongs to an isolated WASM VM
 *   in a later slice.
 * - Network type acquisition. typeAcquisition stays off, because the product does not install npm
 *   packages.
 */

/**
 * Installs the worker factory on self, once. Monaco reads this global when the first editor is
 * created, so it is installed at module top level to happen before that. This module is the editor
 * component's only entry point, so the ordering is guaranteed structurally.
 */
declare global {
	// eslint-disable-next-line no-var
	var MonacoEnvironment: monaco.Environment | undefined;
}

globalThis.MonacoEnvironment = {
	getWorker: (_workerId: string, label: string) =>
		label === "typescript" || label === "javascript"
			? new TypeScriptWorker()
			: new EditorWorker(),
};

/**
 * The language this studio opens: a single value. It is a constant because several places use it
 * (registration, grammar, semantic tokens, completion, hover, model creation). If the string were
 * spelled out in each, a typo in one would still compile, and that screen would open normally with
 * no colors and no completion.
 *
 * .ts and .tsx share one language in Monaco's own definition. Keeping them apart would require two
 * copies of the JSX grammar and two TypeScript services. Whether a file is TSX is decided by the
 * model address's extension, which sets the worker's ScriptKind.
 */
export const TS_LANGUAGE_ID = "typescript";

/**
 * Names of this app's two themes. They are Monaco's built-in themes overridden with our token
 * rules.
 */
export const RUNTIME_THEME = {
	light: "rowcat-light",
	dark: "rowcat-dark",
} as const;

let configured = false;

/**
 * Sets up the language service and theme, and runs only once however many times it is called.
 *
 * The editor calls this on every mount (opening and closing the studio is common), so it must be
 * idempotent. Re-adding the ambient declarations in particular would declare the same module twice
 * and produce errors that did not exist before.
 */
export function configureRuntimeMonaco(): typeof monaco {
	if (configured) return monaco;
	configured = true;

	/**
	 * Registers the language first, because everything after it depends on this registration. This
	 * does by hand what the register module does (registration, configuration, grammar), except that
	 * the grammar is ours. Order is the rule: registration fires onLanguage, and the TypeScript
	 * service attaches to that signal.
	 */
	monaco.languages.register({
		id: TS_LANGUAGE_ID,
		extensions: [".ts", ".tsx", ".cts", ".mts"],
		aliases: ["TypeScript", "ts", "typescript"],
		mimetypes: ["text/typescript"],
	});
	monaco.languages.setLanguageConfiguration(TS_LANGUAGE_ID, typescriptConf);
	monaco.languages.setMonarchTokensProvider(
		TS_LANGUAGE_ID,
		withJsx(typescriptLanguage) as monaco.languages.IMonarchLanguage,
	);

	const ts = typescriptDefaults;

	/**
	 * Imports the compiler settings from the compiler itself. In this repo, this one line matters
	 * most. If the editor and the compiler each wrote their own options, they would diverge. The
	 * symptom is code that autocomplete allows failing at compile time, and no test catches it,
	 * because each side is correct under its own settings.
	 *
	 * Monaco's enum types look outdated because those typings have been frozen for a long time, but
	 * the values below are the same numbers (the worker bundles TypeScript 5.9.3). So only the type is
	 * passed and the values are used as-is. Copying them by hand would create a second copy.
	 */
	ts.setCompilerOptions({
		...(runtimeCompilerOptions() as Record<string, unknown>),
		/**
		 * The editor does not emit output. noEmit is the only axis where it differs from the compiler's
		 * settings, and the difference is intended: this worker produces only diagnostics, so no runnable
		 * output is generated anywhere in it.
		 */
		noEmit: true,
		sourceMap: false,
		noEmitOnError: false,
		/** Permits model URIs that are not .tsx. Monaco requires this setting. */
		allowNonTsExtensions: true,
	});

	/**
	 * Diagnostics stay on. They supply half of the Problems material; the runtime compiler supplies
	 * the other half. Error 2307 (cannot find module) is deliberately left on. An import of a missing
	 * file is really missing, and it stays an error even when an execution engine arrives.
	 */
	ts.setDiagnosticsOptions({
		noSemanticValidation: false,
		noSyntaxValidation: false,
		noSuggestionDiagnostics: false,
	});

	/** Types are never fetched from the network, because this product has no npm install step. */
	ts.setEagerModelSync(true);

	/**
	 * Mounts the runtime package source as-is.
	 *
	 * Phase 1 had a hand-written .d.ts string here, and its defect is concrete: its JSX.Element was
	 * unknown, so nested children (<Screen><Text/></Screen>) were not assignable to children:
	 * RuntimeNode, and the starter project opened with red lines. While a second source exists,
	 * mismatches like that recur, and none of them raise an error.
	 *
	 * What is mounted now are the same files the compiler places in its virtual file system, under the
	 * same layout (node_modules/@rowcat/runtime/...), so both environments resolve identically.
	 */
	for (const file of runtimePackageFiles(RUNTIME_VIRTUAL_ROOT))
		ts.addExtraLib(file.content, `file://${file.path}`);

	/**
	 * The theme is built by one function, so color rules and surfaces can never diverge.
	 *
	 * This sets the default surface palette. When an editor mounts, it redefines the theme with the
	 * actual colors of its position (applyRuntimeMonacoTheme). That second call also goes through the
	 * same function, so rules cannot be dropped. A regression where defineTheme({ colors, rules: [] })
	 * silently disables syntax highlighting cannot be expressed in this setup.
	 */
	monaco.editor.defineTheme(
		RUNTIME_THEME.light,
		runtimeMonacoTheme({ dark: false }),
	);
	monaco.editor.defineTheme(
		RUNTIME_THEME.dark,
		runtimeMonacoTheme({ dark: true }),
	);

	/**
	 * Semantic tokens use a single viewport provider. Two reasons: Monaco's standard distribution
	 * includes the viewport contribution in register.all (viewportSemanticTokens), and the editor
	 * shows one screen of text at a time. Classifying all 2,000 lines of a file would answer a
	 * question the screen does not ask.
	 *
	 * Lexical colors come first and this layer overlays them. Before the worker answers, the editor
	 * already has colors (the grammar runs on the main thread), and if this fails, those colors
	 * remain.
	 */
	monaco.languages.registerDocumentRangeSemanticTokensProvider(TS_LANGUAGE_ID, {
		getLegend: () => ({
			tokenTypes: [...RUNTIME_SEMANTIC_TOKEN_TYPES],
			tokenModifiers: [...RUNTIME_SEMANTIC_TOKEN_MODIFIERS],
		}),
		/**
		 * The rules are not in this file; this is only the line that finds the worker.
		 *
		 * Converting ranges to offsets, and the classification back to deltas, is the most error-prone
		 * part of this layer. A failure looks like colors shifting one character at a time, which is hard
		 * to spot by eye. So the rules live where they can be verified as values without an editor.
		 */
		provideDocumentRangeSemanticTokens: (model, range) =>
			provideRuntimeSemanticTokens(model, range, async (target) => {
				const worker = await getTypeScriptWorker();
				return (await worker(
					target.uri as monaco.Uri,
				)) as RuntimeSemanticWorker;
			}),
	});

	/**
	 * Image autocomplete and hover for managed images.
	 *
	 * The language is typescript only, because this project opens only .ts and .tsx files and Monaco
	 * registers both under the same language. Undoing the registration is unnecessary: the wiring
	 * lasts for the whole app lifetime, and isolation between drafts comes from the model-bound list,
	 * not from the registration's lifetime.
	 */
	monaco.languages.registerCompletionItemProvider(
		TS_LANGUAGE_ID,
		createRuntimeAssetCompletionProvider(monaco),
	);
	monaco.languages.registerHoverProvider(
		TS_LANGUAGE_ID,
		createRuntimeAssetHoverProvider(),
	);

	return monaco;
}

/**
 * Changes the appearance. Definition and application happen in one call.
 *
 * If they were split, a caller that only redefines colors could appear someday and produce a theme
 * with no rules. The only function called here is runtimeMonacoTheme, so that state cannot be
 * expressed.
 *
 * Models are not recreated. Appearance changes the picture, not the document. Replacing a model
 * would lose the cursor, undo history, diagnostics, and the viewing position.
 */
export function applyRuntimeMonacoTheme(
	dark: boolean,
	host: Element | null,
): void {
	const name = dark ? RUNTIME_THEME.dark : RUNTIME_THEME.light;
	monaco.editor.defineTheme(
		name,
		runtimeMonacoTheme({ dark, chrome: readRuntimeEditorChrome(host, dark) }),
	);
	monaco.editor.setTheme(name);
}

export type { monaco };
