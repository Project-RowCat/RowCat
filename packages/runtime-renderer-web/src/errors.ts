/**
 * Renderer failure: not the creator's failure.
 *
 * Everything here means the host and the screen no longer describe the same tree: revisions were
 * skipped, a missing node was referenced, a child was moved from a non-parent, or props outside the
 * contract arrived. The creator cannot fix any of these (the VM-side reconciler and host validator
 * stand before this), so the error is not drawn as a diagnostic. It stops the preview; drawing the
 * next batch on a misaligned tree would continue the error silently.
 *
 * The code is the axis; the sentence is for humans and may change.
 */

export const WEB_RENDERER_ERROR_CODE = {
	/**
	 * A batch whose number is not the next expected one: a duplicate, a skip, or going backwards.
	 * There is no rewind protocol, so this is not recovered from.
	 */
	revisionMismatch: "renderer_revision_mismatch",
	unknownNode: "renderer_unknown_node",
	nodeReused: "renderer_node_reused",
	topology: "renderer_topology",
	contract: "renderer_contract",
	failed: "renderer_failed",
	disposed: "renderer_disposed",
} as const;

export type WebRendererErrorCode =
	(typeof WEB_RENDERER_ERROR_CODE)[keyof typeof WEB_RENDERER_ERROR_CODE];

export class WebRuntimeRendererError extends Error {
	readonly code: WebRendererErrorCode;

	constructor(code: WebRendererErrorCode, message: string) {
		super(message);
		this.name = "WebRuntimeRendererError";
		this.code = code;
	}
}

export const rendererError = (
	code: WebRendererErrorCode,
	message: string,
): WebRuntimeRendererError => new WebRuntimeRendererError(code, message);
