import ts from "typescript-compiler-api";
import {
	RUNTIME_DIAGNOSTIC_CODE,
	type RuntimeArtifactDependency,
	type RuntimeCompileFile,
	type RuntimeDiagnostic,
} from "./contracts.ts";
import { positionOf, runtimeDiagnostic } from "./diagnostics.ts";
import {
	RUNTIME_RESOLUTION_ORDER,
	resolveRuntimeModule,
} from "./module-resolution.ts";
import {
	compareCodeUnits,
	isReservedProjectPath,
	isRuntimeSourcePath,
	normalizeProjectPath,
	RESERVED_PROJECT_ROOTS,
} from "./paths.ts";
import { scanRuntimePolicy } from "./policy.ts";

/**
 * Reads the project as a static module graph, without type checking.
 *
 * This pass is separate from type checking so that it can run anywhere with only a parser. Its
 * answers (what was imported, what it points to, whether forbidden syntax is present) need no
 * lib.d.ts. The studio's browser analysis uses this pass directly (analyzeRuntimeProject).
 *
 * Type checking is layered on top (compile.ts). Both passes share the same resolver and policy, so
 * they do not become two copies.
 */

export interface RuntimeParsedModule {
	path: string;
	file: ts.SourceFile;
	dependencies: readonly RuntimeArtifactDependency[];
	hasDefaultExport: boolean;
}

export interface RuntimeModuleGraph {
	modules: ReadonlyMap<string, RuntimeParsedModule>;
	/**
	 * Module ids actually reachable from the entry point, in path order so the output is
	 * deterministic.
	 */
	reachable: readonly string[];
	diagnostics: readonly RuntimeDiagnostic[];
}

/** Every string literal carried by import and export ... from, including type-only imports. */
function importSpecifiers(
	file: ts.SourceFile,
): { node: ts.StringLiteralLike; text: string }[] {
	const found: { node: ts.StringLiteralLike; text: string }[] = [];
	for (const statement of file.statements) {
		const moduleSpecifier =
			(ts.isImportDeclaration(statement) ||
				ts.isExportDeclaration(statement)) &&
			statement.moduleSpecifier !== undefined
				? statement.moduleSpecifier
				: undefined;
		if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier))
			found.push({ node: moduleSpecifier, text: moduleSpecifier.text });
	}
	return found;
}

/**
 * Checks whether a default export exists syntactically. The question can be answered without type
 * checking, so the browser analysis pass gives the same answer. Whether the default export has the
 * correct type is a different question, answered by the checker through the entry check file that
 * compile.ts injects.
 */
function hasDefaultExport(file: ts.SourceFile): boolean {
	for (const statement of file.statements) {
		if (ts.isExportAssignment(statement) && statement.isExportEquals !== true)
			return true;
		const modifiers = ts.canHaveModifiers(statement)
			? ts.getModifiers(statement)
			: undefined;
		if (
			modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
			)
		)
			return true;
		if (ts.isExportDeclaration(statement) && statement.exportClause)
			if (
				ts.isNamedExports(statement.exportClause) &&
				statement.exportClause.elements.some(
					(element) => element.name.text === "default",
				)
			)
				return true;
	}
	return false;
}

export interface RuntimeGraphInput {
	files: readonly RuntimeCompileFile[];
	entry: string;
}

/**
 * Folds the file list into a graph, indexing file paths once. Searching the list on every lookup
 * would cost files x imports, which becomes editing latency as the project grows.
 */
export function buildRuntimeModuleGraph(
	input: RuntimeGraphInput,
): RuntimeModuleGraph {
	const diagnostics: RuntimeDiagnostic[] = [];
	const byPath = new Map<string, RuntimeCompileFile>();

	for (const file of input.files) {
		const path = normalizeProjectPath(file.path);
		if (!isRuntimeSourcePath(path)) {
			diagnostics.push(
				runtimeDiagnostic(
					RUNTIME_DIAGNOSTIC_CODE.moduleInvalidPath,
					"module",
					`${file.path} is not runtime source. Only .ts and .tsx files are compiled.`,
					{ path: file.path },
				),
			);
			continue;
		}
		/**
		 * Refused before indexing, so an import pointing there answers 'not found' rather than reaching a
		 * file the compiler would read as its own (paths.ts, isReservedProjectPath).
		 */
		if (isReservedProjectPath(path)) {
			diagnostics.push(
				runtimeDiagnostic(
					RUNTIME_DIAGNOSTIC_CODE.moduleReservedPath,
					"module",
					`${path} is in a folder the compiler reserves (${RESERVED_PROJECT_ROOTS.map((root) => `${root}/`).join(" · ")}). Move it to another folder.`,
					{ path },
				),
			);
			continue;
		}
		if (byPath.has(path)) {
			diagnostics.push(
				runtimeDiagnostic(
					RUNTIME_DIAGNOSTIC_CODE.moduleDuplicate,
					"module",
					`${path} came in twice.`,
					{ path },
				),
			);
			continue;
		}
		byPath.set(path, { path, content: file.content });
	}

	const names: ReadonlySet<string> = new Set(byPath.keys());
	const modules = new Map<string, RuntimeParsedModule>();

	for (const [path, file] of byPath) {
		const source = ts.createSourceFile(
			path,
			file.content,
			ts.ScriptTarget.ES2022,
			true,
			path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);

		diagnostics.push(...scanRuntimePolicy(source, path));

		const dependencies: RuntimeArtifactDependency[] = [];
		for (const specifier of importSpecifiers(source)) {
			const resolution = resolveRuntimeModule(specifier.text, path, {
				files: names,
			});
			const at = positionOf(
				source,
				specifier.node.getStart(source),
				specifier.node.getWidth(source),
				path,
			);

			if (resolution.kind === "error") {
				diagnostics.push(resolutionDiagnostic(resolution, at));
				continue;
			}
			dependencies.push({
				specifier: resolution.specifier,
				kind: resolution.kind,
				resolved: resolution.resolved,
			});
		}

		modules.set(path, {
			path,
			file: source,
			/**
			 * Deduplicates imports so that a file importing the same module twice does not create two rows.
			 */
			dependencies: dedupe(dependencies),
			hasDefaultExport: hasDefaultExport(source),
		});
	}

	return {
		modules,
		reachable: reachableFrom(normalizeProjectPath(input.entry), modules),
		diagnostics,
	};
}

function dedupe(
	dependencies: readonly RuntimeArtifactDependency[],
): RuntimeArtifactDependency[] {
	const seen = new Set<string>();
	const kept: RuntimeArtifactDependency[] = [];
	for (const dependency of dependencies) {
		if (seen.has(dependency.specifier)) continue;
		seen.add(dependency.specifier);
		kept.push(dependency);
	}
	return kept;
}

function resolutionDiagnostic(
	resolution: Extract<
		ReturnType<typeof resolveRuntimeModule>,
		{ kind: "error" }
	>,
	at: ReturnType<typeof positionOf>,
): RuntimeDiagnostic {
	switch (resolution.reason) {
		case "forbidden":
			return runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.importForbidden,
				"module",
				`"${resolution.specifier}" can't be imported. A runtime project can import only @rowcat/runtime and files inside the project.`,
				at,
			);
		case "escape":
			return runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.moduleEscape,
				"module",
				`"${resolution.specifier}" points outside the project.`,
				at,
			);
		case "not_found":
			return runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.moduleNotFound,
				"module",
				`"${resolution.specifier}" can't be found. It is looked up in the order ${RUNTIME_RESOLUTION_ORDER.join(" · ")}.`,
				at,
			);
		default:
			return runtimeDiagnostic(
				RUNTIME_DIAGNOSTIC_CODE.moduleInvalidPath,
				"module",
				`"${resolution.specifier}" is not a valid module path.`,
				at,
			);
	}
}

/**
 * Only what is reachable from the entry point, in path order. Using depth-first visit order would
 * tie module order to where the imports were written, so moving one line would change the artifact.
 * Determinism is the purpose of this list.
 */
function reachableFrom(
	entry: string,
	modules: ReadonlyMap<string, RuntimeParsedModule>,
): string[] {
	if (!modules.has(entry)) return [];
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const id = queue.shift() as string;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const dependency of modules.get(id)?.dependencies ?? [])
			if (dependency.kind === "local" && !seen.has(dependency.resolved))
				queue.push(dependency.resolved);
	}
	// Code-unit comparison. See compareCodeUnits in paths.ts for why.
	return [...seen].sort(compareCodeUnits);
}
