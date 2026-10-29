import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import ts from "typescript-compiler-api";
import { canonicalSourceBytes, normalizeNewlines } from "./canonical.ts";
import {
	RUNTIME_ARTIFACT_FORMAT_VERSION,
	RUNTIME_COMPILER_VERSION,
	RUNTIME_DIAGNOSTIC_CODE,
	RUNTIME_VIRTUAL_ROOT,
	type RuntimeAnalyzeResult,
	type RuntimeArtifact,
	type RuntimeArtifactModule,
	type RuntimeCompileInput,
	type RuntimeCompileResult,
	type RuntimeDiagnostic,
} from "./contracts.ts";
import {
	fromTypeScript,
	hasBlockingError,
	runtimeDiagnostic,
	sortRuntimeDiagnostics,
} from "./diagnostics.ts";
import {
	buildRuntimeModuleGraph,
	type RuntimeModuleGraph,
} from "./module-graph.ts";
import {
	isRuntimeSourcePath,
	normalizeProjectPath,
	toVirtualPath,
} from "./paths.ts";
import {
	checkRemoteAssetManifest,
	projectRemoteAssets,
} from "./remote-assets.ts";
import {
	createRuntimeHost,
	type RuntimeCompilerEnvironment,
	runtimeCompilerOptions,
} from "./typescript-host.ts";

/**
 * The assembly point of compilation. Two passes are kept apart on purpose:
 * - analyzeRuntimeProject uses only the parser, needs no library, and runs anywhere (entry point,
 *   module resolution, banned syntax, default export).
 * - compileRuntimeProject adds type checking, emit, and the artifact. It needs lib.d.ts, so the
 *   environment is injected.
 *
 * The studio already gets type diagnostics from Monaco's type service, which builds the same
 * program. Repeating that here would ship the lib.es2022 family in the web bundle, so the studio
 * takes types from Monaco and RowCat's own rules from this package. Both passes share the resolver
 * and policy code, so the rules do not fork.
 *
 * Program reuse drives speed: 307 ms cold vs 192 ms reused on 201 files, all from `oldProgram`. The
 * previous program is therefore passed in, and the editing caller keeps it.
 *
 * No author code runs here. The package has no eval, new Function, import(), workers, or vm, and a
 * static scan enforces that (boundaries.test.ts).
 */

const ENTRY_CHECK_PATH = `${RUNTIME_VIRTUAL_ROOT}/.rowcat/entry-check.ts`;

interface Prelude {
	entry: string;
	graph: RuntimeModuleGraph;
	diagnostics: RuntimeDiagnostic[];
}

/**
 * Work shared by both passes: version check, entry-point check, and the module graph.
 *
 * If there is no entry point, nothing in the graph is reachable, so that is reported first.
 * Otherwise the author gets a flood of 'module not found' errors and cannot find the real cause.
 */
function prelude(input: RuntimeCompileInput): Prelude {
	const diagnostics: RuntimeDiagnostic[] = [];
	const entry = normalizeProjectPath(input.entry);

	if (input.apiVersion !== RUNTIME_API_VERSION)
		diagnostics.push(
			runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.apiVersionUnsupported,
				"runtime",
				`This compiler reads only runtime API v${RUNTIME_API_VERSION} (requested: v${input.apiVersion}).`,
			),
		);

	if (input.files.length === 0)
		diagnostics.push(
			runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.projectEmpty,
				"module",
				"The runtime project has no files.",
			),
		);

	if (entry.length === 0 || !isRuntimeSourcePath(entry))
		diagnostics.push(
			runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.entryInvalidPath,
				"module",
				`The entry point "${input.entry}" is not a valid runtime source path.`,
			),
		);

	const graph = buildRuntimeModuleGraph({ files: input.files, entry });
	diagnostics.push(...graph.diagnostics);

	const entryModule = graph.modules.get(entry);
	if (!entryModule) {
		if (entry.length > 0 && isRuntimeSourcePath(entry))
			diagnostics.push(
				runtimeDiagnostic(
					RUNTIME_DIAGNOSTIC_CODE.entryMissing,
					"module",
					`The entry point ${entry} is not in the project.`,
				),
			);
	} else if (!entryModule.hasDefaultExport)
		diagnostics.push(
			runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.defaultExportMissing,
				"module",
				`${entry} has no default export. Export the component that becomes the screen with export default.`,
				{ path: entry },
			),
		);

	return { entry, graph, diagnostics };
}

/**
 * Answers only what can be answered without type checking.
 *
 * This path runs in the browser, so it needs neither lib.d.ts nor an environment. It does NOT
 * create an artifact: emitting code that has not passed semantic checks is something this compiler
 * does not do. That rule is encoded in the return type.
 */
export function analyzeRuntimeProject(
	input: RuntimeCompileInput,
): RuntimeAnalyzeResult {
	const { graph, diagnostics } = prelude(input);
	return {
		diagnostics: sortRuntimeDiagnostics(diagnostics),
		modules: graph.reachable,
	};
}

/**
 * A planted file that asks, through types, whether the entry's default export is the app type.
 *
 * This question needs the checker, so a file is added to the program. The alternative is worse:
 * comparing types by walking symbols would become a copy of the checker, and only that copy would
 * go stale when the `RuntimeApp` definition changes.
 *
 * The file is not the project's, so it is not emitted and not put in the artifact (toProjectPath
 * reads .rowcat/ from outside the project).
 */
function entryCheckSource(entry: string): string {
	const withoutExtension = entry.replace(/\.tsx?$/, "");
	return [
		'import type { RuntimeApp } from "@rowcat/runtime";',
		`import Entry from "../${withoutExtension}";`,
		"const entry: RuntimeApp = Entry;",
		"export default entry;",
		"",
	].join("\n");
}

/**
 * Normalizes the source map deterministically.
 *
 * The `sources` TypeScript produces are relative to the output location, so the virtual root leaks
 * out. `sourcesContent` carries the author's full source. Neither belongs in the artifact: identity
 * already lives in the module id, and the content would duplicate bytes already present.
 */
function normalizeSourceMap(raw: string, moduleId: string): string | undefined {
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return JSON.stringify({
			version: parsed.version ?? 3,
			file: moduleId,
			sources: [moduleId],
			names: parsed.names ?? [],
			mappings: parsed.mappings ?? "",
		});
	} catch {
		return undefined;
	}
}

/**
 * Strips the trailing sourceMappingURL comment from emitted code.
 *
 * That comment points at a file that does not exist: the artifact is never written as files, and
 * the map travels as a module field. If left in, a later loader or dev tool would search for the
 * file, and the failure would be silent (indistinguishable from having no map).
 */
const stripSourceMappingUrl = (code: string): string =>
	code.replace(/\n?\/\/# sourceMappingURL=.*\n?$/, "\n");

export interface RuntimeCompileOptions {
	/**
	 * The previous compile's program. The editing caller holds it.
	 *
	 * TypeScript reuses unchanged source files, so after a one-character edit the recompile does not
	 * re-parse every file. This is a speed axis, not a correctness condition: the result is the same
	 * without it.
	 */
	previous?: RuntimeCompileHandle;
}

/** Opaque handle passed to the next compile. Callers have no reason to know its internal shape. */
export interface RuntimeCompileHandle {
	readonly program: ts.Program;
}

/**
 * Compile result plus a handle for the next compile.
 *
 * It is an intersection rather than an interface extension because RuntimeCompileResult is a
 * discriminated union. Extending it would lose the guarantee that `ok: true` always carries an
 * artifact, forcing callers to read `artifact` with null checks.
 */
export type RuntimeCompileOutcome = RuntimeCompileResult & {
	/** Reused by the next compile if passed. Valid even after a failed compile. */
	handle?: RuntimeCompileHandle;
};

export function compileRuntimeProject(
	input: RuntimeCompileInput,
	environment: RuntimeCompilerEnvironment,
	options: RuntimeCompileOptions = {},
): RuntimeCompileOutcome {
	const { entry, graph, diagnostics } = prelude(input);
	const fail = (
		extra: readonly RuntimeDiagnostic[] = [],
		handle?: RuntimeCompileHandle,
	): RuntimeCompileOutcome => ({
		ok: false,
		artifact: null,
		diagnostics: sortRuntimeDiagnostics([...diagnostics, ...extra]),
		...(handle === undefined ? {} : { handle }),
	});

	/**
	 * If the entry point or resolution is already broken, no program is built.
	 *
	 * Building anyway makes TypeScript state the same fact in its own words (`Cannot find module`), so the
	 * author receives the same problem twice. One of the two messages suggests an npm install.
	 */
	if (hasBlockingError(diagnostics)) return fail();

	const files = new Map<string, string>();
	for (const id of graph.reachable) {
		const module = graph.modules.get(id);
		/**
		 * Newlines are folded with the same rule as the hash (normalizeNewlines). Only the CR at line
		 * ends disappears, so diagnostic line and column positions do not change.
		 */
		if (module) files.set(id, normalizeNewlines(module.file.text));
	}

	const injected = new Map<string, string>([
		[ENTRY_CHECK_PATH, entryCheckSource(entry)],
	]);

	const { host, rootNames } = createRuntimeHost({
		files,
		environment,
		injected,
	});
	const program = ts.createProgram({
		rootNames,
		options: runtimeCompilerOptions(),
		host,
		oldProgram: options.previous?.program,
	});
	const handle: RuntimeCompileHandle = { program };

	const creator: RuntimeDiagnostic[] = [];
	const infrastructure: ts.Diagnostic[] = [];
	const entryProblems: ts.Diagnostic[] = [];

	for (const diagnostic of [
		...program.getOptionsDiagnostics(),
		...program.getGlobalDiagnostics(),
		...program.getSyntacticDiagnostics(),
		...program.getSemanticDiagnostics(),
	]) {
		if (diagnostic.file?.fileName === ENTRY_CHECK_PATH) {
			entryProblems.push(diagnostic);
			continue;
		}
		const mapped = fromTypeScript(diagnostic);
		if (mapped === null) {
			infrastructure.push(diagnostic);
			continue;
		}
		creator.push(mapped);
	}

	/**
	 * Diagnostics from outside the project are NOT the author's problem.
	 *
	 * They mean the runtime package source or an injected file does not hold in this environment,
	 * which is our defect. Shown in Problems, they would send the author looking for the cause in
	 * their own code. Instead they are reported as infrastructure failures, and the original message
	 * stays in the body so we can trace it.
	 */
	const first = infrastructure[0];
	if (first !== undefined)
		return fail(
			[
				runtimeDiagnostic(
					RUNTIME_DIAGNOSTIC_CODE.apiVersionUnsupported,
					"runtime",
					`The runtime compiler environment is invalid: ${first.file?.fileName ?? ""} ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
				),
			],
			handle,
		);

	for (const problem of entryProblems)
		creator.push(
			runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.entryExportInvalid,
				"module",
				`${entry}'s default export is not a runtime app: ${ts.flattenDiagnosticMessageText(problem.messageText, " ")}`,
				{ path: entry, line: 1, column: 1 },
			),
		);

	if (hasBlockingError(creator)) return fail(creator, handle);

	const modules: RuntimeArtifactModule[] = [];
	for (const id of graph.reachable) {
		const source = program.getSourceFile(toVirtualPath(id));
		if (!source) continue;

		let code: string | undefined;
		let map: string | undefined;
		const emitted = program.emit(source, (fileName, text) => {
			if (fileName.endsWith(".map")) map = normalizeSourceMap(text, id);
			else code = stripSourceMappingUrl(text);
		});

		if (code === undefined || emitted.emitSkipped)
			return fail(
				[
					...creator,
					runtimeDiagnostic(
						RUNTIME_DIAGNOSTIC_CODE.apiVersionUnsupported,
						"runtime",
						`Could not emit ${id}.`,
						{ path: id },
					),
				],
				handle,
			);

		modules.push({
			id,
			code,
			dependencies: graph.modules.get(id)?.dependencies ?? [],
			...(map === undefined ? {} : { map }),
		});
	}

	/**
	 * The allow-list of remote images, taken from source rather than emitted code.
	 *
	 * It walks the parsed source files, not the output. Searching emitted JS would tie the list to how
	 * TypeScript's transform rewrites strings, which changes between versions, and the list could then
	 * diverge from the characters the author actually wrote.
	 *
	 * Only reachable modules count (graph.reachable). A file outside the graph never runs, so an
	 * address inside it is not something this artifact can use.
	 */
	const remoteAssets = projectRemoteAssets(
		graph.reachable
			.map((id) => graph.modules.get(id)?.file)
			.filter((file): file is ts.SourceFile => file !== undefined),
	);
	const manifestProblem = checkRemoteAssetManifest(remoteAssets);
	if (manifestProblem !== null)
		return fail(
			[
				...creator,
				runtimeDiagnostic(
					RUNTIME_DIAGNOSTIC_CODE.remoteAssetLimit,
					"policy",
					manifestProblem,
				),
			],
			handle,
		);

	const artifact: RuntimeArtifact = {
		formatVersion: RUNTIME_ARTIFACT_FORMAT_VERSION,
		apiVersion: input.apiVersion,
		compilerVersion: RUNTIME_COMPILER_VERSION,
		entry,
		modules,
		sourceHash: environment.digest(canonicalSourceBytes(input)),
		remoteAssets,
	};

	return {
		ok: true,
		artifact,
		diagnostics: sortRuntimeDiagnostics([...diagnostics, ...creator]),
		handle,
	};
}
