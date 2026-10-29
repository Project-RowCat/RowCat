import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler-api";
import {
	collectRuntimeSources,
	digestRuntimeSources,
	type RuntimeSourceFile,
} from "./declaration-sources.ts";

/**
 * Converts the source of @rowcat/runtime into the JavaScript module the VM runs (the sandbox
 * build).
 * - Pipeline: src/** (one source), then collectRuntimeSources (same file list and digest as
 *   declaration generation), then relative imports rewritten to module ids (./asset becomes
 *   rowcat:internal/asset), then TypeScript 5.9.3 emit with types erased into
 *   src/sandbox/generated.ts.
 * - Why not a second hand-written source: the Phase 3 VM built-in was a stub whose only guard was
 *   a test comparing export names. A changed prop or validation rule passed it. Here both outputs
 *   carry the same digest, which the host compares at boot.
 * - Two consumers: tooling reads TypeScript directly, while the VM cannot (no types, no
 *   node_modules). The only transforms are erasing types and rewriting relative paths to controlled
 *   identifiers. Nothing is bundled, so the module graph stays static ESM in the VM too.
 * - Deterministic: path-ordered reads, no absolute paths, timestamps or machine names, and stable
 *   TypeScript emit. --check regenerates and compares to verify.
 */

const HERE = fileURLToPath(new URL("..", import.meta.url));
export const SANDBOX_FILE = join(HERE, "..", "src", "sandbox", "generated.ts");

/**
 * Version of the sandbox build rules. It is bumped when the transformation rules in this file
 * change, not when the source changes. The digest answers whether the source is the same; this
 * value answers whether the rules that converted it are the same. The host checks both. This stops
 * a commit that changes the rules without regenerating the output from installing a module built
 * with the old rules.
 */
export const RUNTIME_SANDBOX_BUILD_VERSION = 1;

/**
 * Public module set that creators can import. The names must match runtimeBuiltinId in the
 * compiler.
 */
const PUBLIC_IDS: Readonly<Record<string, string>> = {
	"index.ts": "rowcat:runtime",
	"jsx-runtime.ts": "rowcat:runtime/jsx-runtime",
	"jsx-dev-runtime.ts": "rowcat:runtime/jsx-dev-runtime",
};

/**
 * Maps a source path to the module id the loader sees.
 *
 * Everything outside the public set is rowcat:internal/..., including files in the internal/ folder
 * and other root files (asset.ts, component.ts). That prefix is the policy: if an artifact points
 * at such an id, validation rejects it, and the loader resolves internal names only among
 * built-ins.
 *
 * If a root file and an internal/ file share a name, that is a collision and generation fails. It
 * is never silently overwritten.
 */
export function sandboxModuleId(path: string): string {
	const publicId = PUBLIC_IDS[path];
	if (publicId !== undefined) return publicId;
	const stem = path.replace(/\.ts$/, "");
	return `rowcat:internal/${stem.startsWith("internal/") ? stem.slice("internal/".length) : stem}`;
}

export interface SandboxModule {
	id: string;
	source: string;
	internal: boolean;
}

/**
 * from './x' and from '../internal/y' become from '<module id>'.
 *
 * The declaration generator's copy already has extensions removed, so relative paths arriving here
 * carry no .ts. A path that points outside the file list is a failure. The VM loader knows only
 * this table, so the failure must occur at generation time, not at session boot.
 */
function rewriteImports(
	file: RuntimeSourceFile,
	ids: ReadonlyMap<string, string>,
): string {
	const directory = posix.dirname(file.path);
	return file.content.replace(
		/((?:from|import)\s+")(\.{1,2}\/[^"]+)(")/g,
		(_match, before: string, specifier: string, after: string) => {
			const target = posix.normalize(posix.join(directory, `${specifier}.ts`));
			const id = ids.get(target);
			if (id === undefined)
				throw new Error(
					`${file.path}: import "${specifier}" does not name a runtime source file (${target})`,
				);
			return `${before}${id}${after}`;
		},
	);
}

/**
 * Options that only erase types and nothing else. This is the same TypeScript version the compiler
 * uses for creator code.
 */
const EMIT_OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	verbatimModuleSyntax: true,
	removeComments: true,
	newLine: ts.NewLineKind.LineFeed,
	sourceMap: false,
};

export function buildSandboxModules(
	sources: readonly RuntimeSourceFile[],
): SandboxModule[] {
	/**
	 * Declaration files (globals.d.ts) have nothing to execute. They are assets for tooling, not VM
	 * modules.
	 */
	const files = sources.filter((file) => !file.path.endsWith(".d.ts"));
	const ids = new Map<string, string>();
	for (const file of files) {
		const id = sandboxModuleId(file.path);
		for (const [other, existing] of ids)
			if (existing === id)
				throw new Error(
					`${file.path} and ${other} both map to ${id} — rename one of them`,
				);
		ids.set(file.path, id);
	}
	return files.map((file) => {
		const rewritten = rewriteImports(file, ids);
		const output = ts.transpileModule(rewritten, {
			compilerOptions: EMIT_OPTIONS,
			fileName: file.path,
			reportDiagnostics: true,
		});
		const problem = output.diagnostics?.[0];
		if (problem !== undefined)
			throw new Error(
				`${file.path}: ${ts.flattenDiagnosticMessageText(problem.messageText, "\n")}`,
			);
		const id = ids.get(file.path) as string;
		return {
			id,
			source: output.outputText,
			internal: !Object.values(PUBLIC_IDS).includes(id),
		};
	});
}

const HEADER = `/**
 * **This is a generated file. Do not edit it by hand.**
 *
 * The source is \`packages/runtime/src/**\` and the command that makes it is \`pnpm runtime:sandbox\`. These modules
 * are \`rowcat:runtime\` inside the VM: not a hand-written stub but the emit of the same source. The rules and
 * rationale are in \`scripts/lib/sandbox-build.ts\`, and \`sandbox.test.ts\` checks freshness by value.
 */

export interface RuntimeSandboxModule {
	/** The controlled identifier the loader sees (\`rowcat:runtime\` · \`rowcat:internal/symbols\`). */
	readonly id: string;
	/** The emitted ES module source. */
	readonly source: string;
	/** When true it imports only other builtins: an artifact pointing at it is refused at validation. */
	readonly internal: boolean;
}

/** The runtime language contract version this build carried. It must equal the artifact's \`apiVersion\`. */
export const RUNTIME_SANDBOX_API_VERSION = `;

export function renderSandbox(
	files: readonly RuntimeSourceFile[],
	apiVersion: number,
): string {
	const modules = buildSandboxModules(files);
	const entries = modules
		.map(
			(module) =>
				`\t{\n\t\tid: ${JSON.stringify(module.id)},\n\t\tinternal: ${module.internal},\n\t\tsource: ${JSON.stringify(module.source)},\n\t},\n`,
		)
		.join("");
	return [
		`${HEADER}${apiVersion};`,
		"",
		"/** The version of the transformation rules that made this output (`RUNTIME_SANDBOX_BUILD_VERSION`). */",
		`export const RUNTIME_SANDBOX_BUILT_WITH = ${RUNTIME_SANDBOX_BUILD_VERSION};`,
		"",
		"/** The digest of the source bundle these modules derive from: it must equal the declaration output's. */",
		`export const RUNTIME_SANDBOX_SOURCE_DIGEST = ${JSON.stringify(digestRuntimeSources(files))};`,
		"",
		"export const RUNTIME_SANDBOX_MODULES: readonly RuntimeSandboxModule[] = [",
		`${entries}];`,
		"",
	].join("\n");
}

export { collectRuntimeSources };
