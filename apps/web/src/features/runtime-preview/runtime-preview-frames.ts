import type { RuntimeArtifact } from "@rowcat/runtime-compiler/contracts";
import type {
	originalPositionFor,
	RuntimeSourcePosition,
} from "@rowcat/runtime-compiler/source-map";
import type { CreatorStackFrame } from "@rowcat/runtime-host";
import type { PreviewErrorFrame } from "./protocol.ts";

/**
 * Turns the host stack into frames that can be shown to the creator, in source coordinates.
 * - Filters out modules not in the artifact (host built-ins, engine internals). The creator has
 *   no file to open for them.
 * - Maps each frame back to source line and column through the module's source map
 *   (originalPositionFor).
 * - Keeps only the top few frames. One recursion can produce dozens, and the screen needs to
 *   answer 'where'. A frame that cannot be mapped stays without a position, since its file and
 *   function name are still true. Emitted line numbers are never shown: they are not editor lines,
 *   so clicking would jump to the wrong place. The mapping function is passed in rather than
 *   imported. The compiler may enter this folder only through the worker
 *   (runtime-preview-boundaries.test.ts), and a small source-map decoder does not justify widening
 *   that list. The worker passes originalPositionFor.
 */

export type ResolveOriginalPosition = typeof originalPositionFor;

export const PREVIEW_ERROR_FRAME_LIMIT = 8;

export function previewErrorFrames(
	frames: readonly CreatorStackFrame[],
	artifact: Pick<RuntimeArtifact, "modules">,
	resolve: ResolveOriginalPosition,
): PreviewErrorFrame[] {
	const modules = new Map(
		artifact.modules.map((module) => [module.id, module]),
	);
	const out: PreviewErrorFrame[] = [];
	for (const frame of frames) {
		if (out.length >= PREVIEW_ERROR_FRAME_LIMIT) break;
		if (frame.moduleId === null) continue;
		const module = modules.get(frame.moduleId);
		if (!module) continue;
		const original: RuntimeSourcePosition | null =
			module.map !== undefined && frame.line !== null && frame.column !== null
				? resolve(module.map, { line: frame.line, column: frame.column })
				: null;
		out.push({
			path: module.id,
			functionName: frame.functionName,
			line: original?.line ?? null,
			column: original?.column ?? null,
		});
	}
	return out;
}
