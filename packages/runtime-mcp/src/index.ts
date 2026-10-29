/**
 * `@rowcat/runtime-mcp` is the tool set that lets an agent drive creator runtime authoring. It sits
 * on @rowcat/authoring (path rules, file operations), @rowcat/runtime-compiler,
 * @rowcat/runtime-host (QuickJS/WASM execution and the patch protocol), and
 * @rowcat/runtime-ai-docs.
 *
 * - Adds no second compiler, VM, authoring store, or MCP-only project format. It is a thin
 *   adapter over existing operations. Two copies of the authoring rules would make MCP-made and
 *   studio-made projects diverge.
 * - Execution stays inside the isolated QuickJS/WASM VM. The package has no eval, new Function,
 *   or dynamic import(). Do not write anywhere that 'MCP validates, so it is safe.'
 * - Tools take no owner argument. The authoring store already belongs to one member, so the
 *   missing argument is the access control.
 */

export {
	compileForAgent,
	type RuntimeMcpCompileResult,
	type RuntimeMcpDiagnostic,
	shapeCompileResult,
} from "./compile.ts";
export {
	apiReference,
	type RuntimeMcpApiReference,
	type RuntimeMcpDocResult,
	readDoc,
	readExample,
	searchDocs,
} from "./docs.ts";
export {
	isRuntimeMcpError,
	RUNTIME_MCP_ERROR_CODE,
	RuntimeMcpError,
	type RuntimeMcpErrorCode,
	type RuntimeMcpErrorPayload,
	runtimeMcpErrorPayload,
	toRuntimeMcpError,
} from "./errors.ts";
export { RUNTIME_MCP_LIMITS, type RuntimeMcpLimits } from "./limits.ts";
export type {
	RuntimeAuthoringPort,
	RuntimeMcpContext,
	RuntimeMcpDraftView,
	RuntimeMcpHost,
	RuntimeMcpVmOptions,
} from "./ports.ts";
export { RuntimePreviewManager } from "./preview/manager.ts";
export {
	type RuntimeMcpConsoleEntry,
	type RuntimeMcpPreviewFailure,
	type RuntimeMcpPreviewStartOptions,
	type RuntimeMcpPreviewStatus,
	type RuntimeMcpPreviewStatusView,
	RuntimePreviewSession,
} from "./preview/session.ts";
export {
	type RuntimeMcpAction,
	RuntimeMcpTree,
	type RuntimeMcpTreeNode,
	type RuntimeMcpTreeSnapshot,
} from "./preview/tree.ts";
export {
	createRuntimeFile,
	deleteRuntimeFile,
	getRuntimeProjectView,
	listRuntimeFiles,
	listRuntimeProjects,
	type RuntimeMcpFileView,
	type RuntimeMcpProjectView,
	type RuntimeMcpWriteResult,
	readRuntimeFile,
	renameRuntimeFile,
	resolveRuntimeProject,
	writeRuntimeFile,
} from "./project.ts";
export {
	findRuntimeMcpTool,
	RUNTIME_MCP_TOOLS,
	type RuntimeMcpConnection,
	type RuntimeMcpTool,
	type RuntimeMcpToolAnnotations,
} from "./tools.ts";
