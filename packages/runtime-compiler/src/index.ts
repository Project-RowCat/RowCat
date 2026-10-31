/**
 * @rowcat/runtime-compiler statically checks and emits runtime source. It never runs it.
 *
 * Pipeline: virtual source -> path and module resolution -> TypeScript program -> syntax and
 * semantic diagnostics -> RowCat policy checks -> TS/TSX emit -> static module graph ->
 * RuntimeArtifact.
 *
 * The package does not know the authoring store, UI, publish API or sandbox execution. Input is a
 * plain list of { path, content }. Draft ids, HLC revisions and Dexie rows never reach it, so the
 * same manuscript yields the same artifact on any device.
 *
 * The policy pass is not a sandbox. It blocks eval, dynamic import and npm imports for fast
 * feedback and deterministic language policy, not isolation. Workarounds exist (for example
 * globalThis['ev' + 'al']). The real security boundary is the isolated WASM JavaScript VM planned
 * for later. Never write anywhere that 'the compiler blocks eval, so it is safe.'
 *
 * TypeScript is called only from typescript-host.ts and compile.ts, so swapping the engine later is
 * a one-file change. The 5.9.3 version is used via the typescript-compiler-api alias because the
 * repo's typescript@7 (tsgo, native) does not yet expose a JS emit API. Swap it here when that API
 * opens.
 */

export {
	canonicalArtifactJson,
	canonicalSourceBytes,
} from "./canonical.ts";
export {
	analyzeRuntimeProject,
	compileRuntimeProject,
	type RuntimeCompileHandle,
	type RuntimeCompileOptions,
	type RuntimeCompileOutcome,
} from "./compile.ts";
export {
	RUNTIME_ARTIFACT_FORMAT_VERSION,
	RUNTIME_COMPILER_VERSION,
	RUNTIME_DIAGNOSTIC_CODE,
	RUNTIME_VIRTUAL_ROOT,
	type RuntimeAnalyzeResult,
	type RuntimeArtifact,
	type RuntimeArtifactDependency,
	type RuntimeArtifactModule,
	type RuntimeCompileFile,
	type RuntimeCompileInput,
	type RuntimeCompileResult,
	type RuntimeDiagnostic,
	type RuntimeDiagnosticCode,
	type RuntimeDiagnosticSeverity,
	type RuntimeDiagnosticSource,
} from "./contracts.ts";
export { sortRuntimeDiagnostics } from "./diagnostics.ts";
export {
	RUNTIME_RESOLUTION_ORDER,
	resolveRuntimeModule,
	runtimeBuiltinId,
} from "./module-resolution.ts";
export {
	directoryOf,
	escapesProjectRoot,
	isReservedProjectPath,
	isRuntimeSourcePath,
	normalizeProjectPath,
	RESERVED_PROJECT_ROOTS,
	resolveProjectPath,
	toProjectPath,
	toVirtualPath,
} from "./paths.ts";
export {
	checkRemoteAssetManifest,
	collectStaticRemoteAssets,
	projectRemoteAssets,
	RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS,
} from "./remote-assets.ts";
export {
	originalPositionFor,
	type RuntimeSourcePosition,
} from "./source-map.ts";
export {
	RUNTIME_DEFAULT_LIB,
	type RuntimeCompilerEnvironment,
	runtimeCompilerOptions,
} from "./typescript-host.ts";
