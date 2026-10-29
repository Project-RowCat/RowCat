/**
 * Tool failure codes. The agent branches on the code, not on the message text. stale_node means
 * re-read the tree, file_conflict means re-read and merge, and compile_failed means fix the
 * diagnostics. Folding them into one generic failure would leave only a retry, and a retry fixes
 * none of them.
 *
 * Never leak SQL errors, server stacks, worker internals, host file paths, or credentials. Only
 * facts the creator can act on are sent. The studio preview follows the same rule: a creator's
 * failure and a platform failure are different sentences.
 */

export const RUNTIME_MCP_ERROR_CODE = {
	/**
	 * The draft does not exist or belongs to another member. The two cases are deliberately not
	 * distinguished.
	 */
	projectNotFound: "project_not_found",
	/** The draft exists, but the runtime is not enabled for it. */
	runtimeDisabled: "runtime_disabled",
	fileNotFound: "file_not_found",
	/** The file changed elsewhere after it was read. Re-read it and merge. */
	fileConflict: "file_conflict",
	/** The path shape violates the rules: length, characters, depth, or `..`. */
	invalidPath: "invalid_path",
	unsupportedExtension: "unsupported_extension",
	duplicatePath: "duplicate_path",
	/** The input does not match the contract shape, including the length limit. */
	invalidInput: "invalid_input",
	compileFailed: "compile_failed",
	previewNotRunning: "preview_not_running",
	previewFailed: "preview_failed",
	/**
	 * The node number is not in the current tree because a commit happened in between. Re-read the
	 * tree.
	 */
	staleNode: "stale_node",
	nodeNotFound: "node_not_found",
	/** The node cannot be pressed or typed into: it has no handler or it is disabled. */
	nodeNotInteractable: "node_not_interactable",
	/** Resource limit: session count, size, or call frequency. */
	resourceLimit: "resource_limit",
	notAuthorized: "not_authorized",
	/**
	 * Local edits succeeded, but the change could not be pushed to the server. The device adapter
	 * emits this.
	 *
	 * The code belongs in the vocabulary because of where storage lives. MCP device authoring records
	 * are held in memory, and durability comes from the push. An edit that failed to push is lost when
	 * the process exits. Reporting it as success would make the agent believe the edit was saved and
	 * move on.
	 */
	syncFailed: "sync_failed",
	docNotFound: "doc_not_found",
	symbolNotFound: "symbol_not_found",
	exampleNotFound: "example_not_found",
} as const;

export type RuntimeMcpErrorCode =
	(typeof RUNTIME_MCP_ERROR_CODE)[keyof typeof RUNTIME_MCP_ERROR_CODE];

/**
 * Details carry only values the agent can use, such as stale_node's currentRevision,
 * file_conflict's hash, and compile_failed's diagnostics. If server internals start appearing here,
 * those values end up in logs, and logs do not belong on this channel.
 */
export type RuntimeMcpErrorDetails = Readonly<Record<string, unknown>>;

export class RuntimeMcpError extends Error {
	override readonly name = "RuntimeMcpError";
	readonly code: RuntimeMcpErrorCode;
	readonly details: RuntimeMcpErrorDetails | null;

	constructor(
		code: RuntimeMcpErrorCode,
		message: string,
		details?: RuntimeMcpErrorDetails,
	) {
		super(message);
		this.code = code;
		this.details = details ?? null;
	}
}

export const isRuntimeMcpError = (value: unknown): value is RuntimeMcpError =>
	value instanceof RuntimeMcpError;

/**
 * Replaces an unnamed exception with a one-line tool failure. The original message is never carried
 * over. A path that passed an unnamed failure's message through once leaked credentials from the
 * preview generation failure (runtime-preview-generation-failure.ts). Unnamed exceptions are always
 * converted to our own sentence.
 */
export function toRuntimeMcpError(error: unknown): RuntimeMcpError {
	if (isRuntimeMcpError(error)) return error;
	return new RuntimeMcpError(
		RUNTIME_MCP_ERROR_CODE.previewFailed,
		"The tool ended with an unexpected failure.",
	);
}

/** Shape of a failed tool result. Agents read it as JSON. */
export interface RuntimeMcpErrorPayload {
	readonly error: {
		readonly code: RuntimeMcpErrorCode;
		readonly message: string;
		readonly details?: RuntimeMcpErrorDetails;
	};
}

export const runtimeMcpErrorPayload = (
	error: RuntimeMcpError,
): RuntimeMcpErrorPayload => ({
	error: {
		code: error.code,
		message: error.message,
		...(error.details === null ? {} : { details: error.details }),
	},
});
