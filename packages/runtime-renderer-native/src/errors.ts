/**
 * Renderer failures are not the creator's failures. The code is identical to the web renderer's
 * errors.ts. Both receive the same protocol, so the same fault must have the same name on each
 * platform.
 *
 * Everything that reaches here is something the creator cannot fix; the VM reconciler and host
 * validator stand in front of it. So these errors stop the renderer rather than being drawn as
 * diagnostics: continuing to draw on a tree that has diverged from the host would be wrong.
 */

export const NATIVE_RENDERER_ERROR_CODE = {
	/**
	 * A batch number other than the expected next one: duplicate, skipped, or rewound. There is no
	 * rewind protocol, so this is not recovered.
	 */
	revisionMismatch: "renderer_revision_mismatch",
	/** The operation references a node that is not in the registry. */
	unknownNode: "renderer_unknown_node",
	/** Re-creates an id that already exists, or reuses a removed id. */
	nodeReused: "renderer_node_reused",
	/**
	 * An insert, move or remove does not fit the current tree: out-of-range index, a child not in the
	 * parent, or a node that is already attached.
	 */
	topology: "renderer_topology",
	/**
	 * A prop or value is outside the runtime contract: an unknown prop, a style of the wrong shape, or
	 * a color that is not a color.
	 */
	contract: "renderer_contract",
	/**
	 * An operation that arrives after an earlier failure. The tree can no longer be trusted, so it is
	 * not accepted.
	 */
	failed: "renderer_failed",
	/** An operation arrived at a disposed renderer. */
	disposed: "renderer_disposed",
} as const;

export type NativeRendererErrorCode =
	(typeof NATIVE_RENDERER_ERROR_CODE)[keyof typeof NATIVE_RENDERER_ERROR_CODE];

export class NativeRuntimeRendererError extends Error {
	readonly code: NativeRendererErrorCode;

	constructor(code: NativeRendererErrorCode, message: string) {
		super(message);
		this.name = "NativeRuntimeRendererError";
		this.code = code;
	}
}

export const rendererError = (
	code: NativeRendererErrorCode,
	message: string,
): NativeRuntimeRendererError => new NativeRuntimeRendererError(code, message);
