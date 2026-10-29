import { runtimePackageFiles } from "@rowcat/runtime/declarations";
import {
	RUNTIME_VIRTUAL_ROOT,
	runtimeCompilerOptions,
} from "@rowcat/runtime-compiler";
import type { TypeScriptWorker } from "monaco-editor/languages/features/typescript/register";
import { RuntimeTypeScriptWorker } from "#/features/runtime-studio/editor/monaco-ts.worker.ts";

/**
 * Sets up the studio's TypeScript worker for tests. No worker thread is needed: the class only
 * requires a context that provides a mirror model, and its language service is real.
 *
 * The class built here is the one monaco-ts.worker.ts exports, and the compiler options and ambient
 * declarations are the values monaco-setup.ts configures. A copy would make the measured thing a
 * copy.
 *
 * The type merges two surfaces because Monaco splits them. Language-service declarations come from
 * features/typescript/register, while the worker class comes from tsWorker, which has no .d.ts; tsc
 * infers its methods from JS and misses some. The merge lets one value expose both our functions
 * and Monaco's contract.
 */

export type RuntimeTestTsWorker = RuntimeTypeScriptWorker & TypeScriptWorker;

export interface RuntimeWorkerFile {
	/**
	 * The model address. Its extension determines ScriptKind, so `.tsx` is the value that matters.
	 */
	uri: string;
	content: string;
}

/**
 * Ambient declarations. This is the same list monaco-setup.ts registers through repeated
 * addExtraLib calls.
 */
function runtimeExtraLibs(): Record<
	string,
	{ content: string; version: number }
> {
	const libs: Record<string, { content: string; version: number }> = {};
	for (const file of runtimePackageFiles(RUNTIME_VIRTUAL_ROOT))
		libs[`file://${file.path}`] = { content: file.content, version: 1 };
	return libs;
}

export function createRuntimeTsWorker(
	files: readonly RuntimeWorkerFile[],
	{ declarations = false } = {},
): RuntimeTestTsWorker {
	return new RuntimeTypeScriptWorker(
		{
			getMirrorModels: () =>
				files.map((file) => ({
					uri: {
						path: file.uri.replace(/^file:\/\//, ""),
						toString: () => file.uri,
					},
					version: 1,
					getValue: () => file.content,
				})),
		} as never,
		{
			compilerOptions: runtimeCompilerOptions() as never,
			extraLibs: declarations ? runtimeExtraLibs() : {},
			inlayHintsOptions: undefined,
		} as never,
	) as RuntimeTestTsWorker;
}
