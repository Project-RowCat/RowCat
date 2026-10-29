import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import {
	compileRuntimeProject,
	type RuntimeArtifact,
	type RuntimeCompileFile,
} from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import { POC_BUILTIN_ID } from "../poc/host-builtin.ts";
import { createQuickJsEngine } from "../vm/quickjs.ts";
import type { RuntimeVmEngine } from "../vm/types.ts";

/**
 * Test material comes in two kinds of artifact.
 * - `compiled` goes through the real compiler (TSX → artifact). Only this path confirms that the
 *   language contract, JSX transform, and module table hold in the VM.
 * - `poc` is a hand-written artifact. The PoC bridge (`rowcat:internal/poc`) is outside the
 *   compiler's allowlist, so TS source cannot import it. That is correct: it is not the creator's
 *   vocabulary. Both are artifacts, and the VM does not distinguish them.
 */

let engine: RuntimeVmEngine | null = null;

const require = createRequire(import.meta.url);

/**
 * Node reads bytes from a file. The browser uses an asset URL. WebView uses the bytes bundled with
 * the app.
 */
export const readWasmBinary = (): Promise<ArrayBuffer> =>
	readFile(require.resolve("@jitl/quickjs-ng-wasmfile-release-sync/wasm")).then(
		(buffer) =>
			buffer.buffer.slice(
				buffer.byteOffset,
				buffer.byteOffset + buffer.byteLength,
			),
	);

export function testEngine(): RuntimeVmEngine {
	if (engine === null)
		engine = createQuickJsEngine(variant, { wasmBinary: readWasmBinary });
	return engine;
}

/**
 * Engine that accepts a candidate stack ceiling instead of the adapter's default cap, for stack
 * probes.
 */
export const engineWithStackCeiling = (
	stackCeilingBytes: number,
): RuntimeVmEngine =>
	createQuickJsEngine(variant, {
		wasmBinary: readWasmBinary,
		stackCeilingBytes,
	});

const environment = nodeRuntimeEnvironment();

export function compiled(
	files: readonly RuntimeCompileFile[],
	entry = "src/main.tsx",
): RuntimeArtifact {
	const result = compileRuntimeProject(
		{ apiVersion: RUNTIME_API_VERSION, entry, files },
		environment,
	);
	if (!result.ok)
		throw new Error(
			`fixture does not compile: ${result.diagnostics.map((d) => d.message).join(" / ")}`,
		);
	return result.artifact;
}

export interface PocModule {
	id: string;
	code: string;
	locals?: Record<string, string>;
	poc?: boolean;
}

/** Hand-written artifact. The first module is the entry point. */
export function poc(modules: readonly PocModule[]): RuntimeArtifact {
	return {
		formatVersion: 1,
		apiVersion: RUNTIME_API_VERSION,
		compilerVersion: 1,
		entry: modules[0]?.id ?? "src/main.ts",
		sourceHash: "fixture",
		modules: modules.map((module) => ({
			id: module.id,
			code: module.code,
			dependencies: [
				...(module.poc === false
					? []
					: [
							{
								specifier: POC_BUILTIN_ID,
								kind: "builtin" as const,
								resolved: POC_BUILTIN_ID,
							},
						]),
				...Object.entries(module.locals ?? {}).map(([specifier, resolved]) => ({
					specifier,
					kind: "local" as const,
					resolved,
				})),
			],
		})),
	};
}

export const pocMain = (
	code: string,
	locals?: Record<string, string>,
): RuntimeArtifact =>
	poc([
		{
			id: "src/main.ts",
			code: `import { hostCall } from "rowcat:internal/poc";\n${code}`,
			locals,
		},
	]);
