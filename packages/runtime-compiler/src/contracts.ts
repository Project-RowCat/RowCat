/**
 * Wire vocabulary of the compiler: inputs, diagnostics and artifacts. The file has no behavior on
 * purpose. Several consumers share these shapes: the studio draws diagnostics, tests compare
 * artifacts, and a server will verify the same values later.
 *
 * Authoring-store fields (draftId, fileId, rev, dirty, deletedAt, serverVersion) must not appear
 * here. If the compiler knew them, artifact identity would be tied to the device, and the same
 * manuscript would hash differently on different devices.
 */

/**
 * Format version of the artifact. Bump it when the shape of RuntimeArtifact changes, so that a
 * later VM can reject an artifact it cannot read without attempting to read it.
 */
export const RUNTIME_ARTIFACT_FORMAT_VERSION = 1;

/**
 * Semantic version of the compiler rules, not the package version. It answers one question: did the
 * rules that built this artifact change? Bump it when any of these change: module resolution order,
 * what the policy pass blocks, compiler options, the emit target, or the TypeScript version itself.
 *
 * A TypeScript change is not detected automatically. typescript-version.test.ts pins the version,
 * and the commit that breaks that test is where this value should be bumped or kept.
 */
export const RUNTIME_COMPILER_VERSION = 1;

/**
 * Root of the virtual project. The value is arbitrary, but it must come from one place: the
 * editor's model URIs and the compiler's file paths have to lay out the same tree. Otherwise the
 * two environments resolve modules differently, and errors appear only at compile time.
 */
export const RUNTIME_VIRTUAL_ROOT = "/rowcat-project";

export interface RuntimeCompileFile {
	path: string;
	content: string;
}

export interface RuntimeCompileInput {
	/**
	 * Version of the runtime language contract this source expects. This is the runtime API version,
	 * not the compiler version.
	 */
	apiVersion: number;
	entry: string;
	files: readonly RuntimeCompileFile[];
}

export type RuntimeDiagnosticSeverity = "error" | "warning";

/**
 * Origin of a diagnostic. This is an axis for tracing what a diagnostic was based on, not a value
 * the screen is expected to branch on.
 * - typescript: TypeScript's language verdict
 * - module: the module resolver's verdict
 * - policy: a prohibition set by RowCat
 * - runtime: a problem in the compiler itself. If it reaches the screen, the creator cannot fix
 *   it.
 */
export type RuntimeDiagnosticSource =
	| "typescript"
	| "module"
	| "policy"
	| "runtime";

export interface RuntimeDiagnostic {
	/** Stable code. RowCat's codes use the runtime_* prefix; TypeScript's use ts<number>. */
	code: string;
	severity: RuntimeDiagnosticSeverity;
	message: string;
	/** Project path. Diagnostics not tied to a file (for example, a missing entry point) have none. */
	path?: string;
	/** 1-based, following the editor convention. The screen renders this value as-is. */
	line?: number;
	column?: number;
	length?: number;
	source: RuntimeDiagnosticSource;
	/**
	 * The original TypeScript diagnostic number. Kept for tracing only; the screen must not branch on
	 * it.
	 */
	tsCode?: number;
}

/**
 * Diagnostic codes owned by RowCat. Machines read the code, not the message: wording can be
 * translated or improved, but codes stay fixed. The contract's error codes already make the same
 * decision.
 */
export const RUNTIME_DIAGNOSTIC_CODE = {
	entryMissing: "runtime_entry_missing",
	entryInvalidPath: "runtime_entry_invalid_path",
	moduleNotFound: "runtime_module_not_found",
	moduleEscape: "runtime_module_escape",
	moduleDuplicate: "runtime_module_duplicate",
	moduleInvalidPath: "runtime_module_invalid_path",
	importForbidden: "runtime_import_forbidden",
	dynamicImportForbidden: "runtime_dynamic_import_forbidden",
	requireForbidden: "runtime_require_forbidden",
	evalForbidden: "runtime_eval_forbidden",
	functionConstructorForbidden: "runtime_function_constructor_forbidden",
	webAssemblyForbidden: "runtime_webassembly_forbidden",
	defaultExportMissing: "runtime_default_export_missing",
	entryExportInvalid: "runtime_entry_export_invalid",
	apiVersionUnsupported: "runtime_api_version_unsupported",
	projectEmpty: "runtime_project_empty",
	remoteAssetLimit: "runtime_remote_asset_limit",
} as const;

export type RuntimeDiagnosticCode =
	(typeof RUNTIME_DIAGNOSTIC_CODE)[keyof typeof RUNTIME_DIAGNOSTIC_CODE];

/**
 * The specifier (what the creator wrote) and the resolved target are stored together so that a
 * later loader does not resolve again. If it did, the loader would implement a second copy of this
 * compiler's resolution rules, and the two copies would eventually diverge.
 */
export interface RuntimeArtifactDependency {
	specifier: string;
	kind: "local" | "builtin";
	/**
	 * For local dependencies, resolved is the module id (the source path). For builtin ones it is a
	 * controlled identifier such as rowcat:runtime. The builtin value must not be written as
	 * @rowcat/runtime: that looks like an npm package name, and a loader that receives it would
	 * eventually try to resolve it the way npm does.
	 */
	resolved: string;
}

export interface RuntimeArtifactModule {
	/**
	 * Module identity is the source path as written (src/main.tsx), not the emitted .js extension. The
	 * id is the key that diagnostics, source maps and later stack traces use to map back to the
	 * creator's file, and that mapping ends at the name the creator sees in the editor.
	 */
	id: string;
	code: string;
	dependencies: readonly RuntimeArtifactDependency[];
	/**
	 * Source map JSON. If none could be produced the field is absent; an empty string is never stored.
	 */
	map?: string;
}

export interface RuntimeArtifact {
	formatVersion: typeof RUNTIME_ARTIFACT_FORMAT_VERSION;
	apiVersion: number;
	compilerVersion: number;
	entry: string;
	modules: readonly RuntimeArtifactModule[];
	sourceHash: string;
	/**
	 * The remote image addresses this project declares statically: an allowlist. A remote address not
	 * on this list cannot become a proxy address at playback time.
	 *
	 * This closes an exfiltration path. asset() also accepts addresses built from runtime values, so
	 * without a list a single line such as a URL carrying player-typed text in its query would send
	 * that text to the creator's server. Not being able to read the response does not prevent it.
	 *
	 * An absent field and an empty list mean the same: no remote address is authorized. Treating a
	 * missing list as allow-all would let an artifact that drops the field open everything. Older
	 * artifacts never used remote addresses successfully, so they lose no capability; logical
	 * references still work.
	 *
	 * The value is canonicalized (deduplicated and sorted by code unit), so the same manuscript always
	 * produces the same list.
	 */
	remoteAssets?: readonly string[];
}

export type RuntimeCompileResult =
	| {
			ok: true;
			artifact: RuntimeArtifact;
			diagnostics: readonly RuntimeDiagnostic[];
	  }
	| { ok: false; artifact: null; diagnostics: readonly RuntimeDiagnostic[] };

/**
 * Result of the pass that runs without type checking. The absence of an artifact is encoded in the
 * type: this pass did no semantic checking, so it may not emit. A single result type with artifact:
 * null would let callers read 'no errors, so it passes', which lets code with type errors through.
 */
export interface RuntimeAnalyzeResult {
	diagnostics: readonly RuntimeDiagnostic[];
	/** Resolved module ids, only those reachable from the entry point. */
	modules: readonly string[];
}
