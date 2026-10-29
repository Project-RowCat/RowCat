import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import type {
	RuntimeArtifact,
	RuntimeCompileResult,
	RuntimeDiagnostic,
} from "@rowcat/runtime-compiler";
import type { RuntimeMcpContext } from "./ports.ts";
import { resolveRuntimeProject } from "./project.ts";

/**
 * Compilation: passes through the same compiler as the studio and publishing.
 *
 * This file contains no TypeScript and no policy checks. That is the whole of the claim. It maps
 * the draft's files into `RuntimeCompileInput` and narrows the result's diagnostics to this
 * channel's shape. If a second compiler existed, a project could pass MCP and then be rejected at
 * publish, and the mismatch would surface only after the creator presses publish.
 *
 * Diagnostics are narrowed on output. Only values the creator can act on leave: severity, code,
 * message, file, line, column, and source. No compiler internals, host file paths, or TypeScript
 * stacks (the studio's preview already follows the same rule).
 *
 * A `source: "runtime"` diagnostic is not the creator's problem. That source is the compiler's own
 * failure. Mixed into the same list, it would send an agent to search its own code for the cause,
 * so the result reports it separately.
 */

export interface RuntimeMcpDiagnostic {
	readonly severity: "error" | "warning";
	readonly code: string;
	readonly message: string;
	readonly path?: string;
	readonly line?: number;
	readonly column?: number;
	readonly source: RuntimeDiagnostic["source"];
}

/**
 * Cap on diagnostics in one response. Beyond it, the list is truncated and the number cut is
 * reported.
 */
const MAX_DIAGNOSTICS = 200;

export interface RuntimeMcpCompileResult {
	readonly ok: boolean;
	readonly diagnostics: readonly RuntimeMcpDiagnostic[];
	/** Number of diagnostics cut. 0 means all were included. */
	readonly omittedDiagnostics: number;
	readonly errors: number;
	readonly warnings: number;
	/**
	 * Whether compiler-internal failures are mixed in. If true, the creator cannot fix the problem.
	 */
	readonly infrastructureFailure: boolean;
	/**
	 * Present only on success. The artifact itself is not emitted, since an agent has no use for it.
	 */
	readonly artifact?: {
		readonly sourceHash: string;
		readonly modules: number;
		readonly apiVersion: number;
		readonly remoteAssets: readonly string[];
	};
}

const toDiagnostic = (diagnostic: RuntimeDiagnostic): RuntimeMcpDiagnostic => ({
	severity: diagnostic.severity,
	code: diagnostic.code,
	message: diagnostic.message,
	...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
	...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
	...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
	source: diagnostic.source,
});

const artifactSummary = (
	artifact: RuntimeArtifact,
): NonNullable<RuntimeMcpCompileResult["artifact"]> => ({
	sourceHash: artifact.sourceHash,
	modules: artifact.modules.length,
	apiVersion: artifact.apiVersion,
	remoteAssets: [...(artifact.remoteAssets ?? [])],
});

export function shapeCompileResult(
	result: RuntimeCompileResult,
): RuntimeMcpCompileResult {
	const diagnostics = result.diagnostics.map(toDiagnostic);
	const shown = diagnostics.slice(0, MAX_DIAGNOSTICS);
	return {
		ok: result.ok,
		diagnostics: shown,
		omittedDiagnostics: diagnostics.length - shown.length,
		errors: diagnostics.filter((entry) => entry.severity === "error").length,
		warnings: diagnostics.filter((entry) => entry.severity === "warning")
			.length,
		infrastructureFailure: diagnostics.some(
			(entry) => entry.source === "runtime",
		),
		...(result.ok ? { artifact: artifactSummary(result.artifact) } : {}),
	};
}

/** Compiles the currently saved source as-is. Does not wait for autosave. */
export async function compileRuntimeDraft(
	context: RuntimeMcpContext,
	draftId: string,
): Promise<{ result: RuntimeCompileResult; entry: string }> {
	const { entry, files } = await resolveRuntimeProject(context, draftId);
	const result = context.host.compile({
		apiVersion: RUNTIME_API_VERSION,
		entry,
		files: files.map((file) => ({ path: file.path, content: file.content })),
	});
	return { result, entry };
}

export async function compileForAgent(
	context: RuntimeMcpContext,
	draftId: string,
): Promise<RuntimeMcpCompileResult> {
	const { result } = await compileRuntimeDraft(context, draftId);
	return shapeCompileResult(result);
}
