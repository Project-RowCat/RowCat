import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RUNTIME_AI_CORPUS } from "@rowcat/runtime-ai-docs";
import type {
	RuntimeAuthoringPort,
	RuntimeMcpConnection,
	RuntimeMcpContext,
} from "@rowcat/runtime-mcp";
import {
	RUNTIME_MCP_TOOLS,
	RuntimePreviewManager,
	runtimeMcpErrorPayload,
	toRuntimeMcpError,
} from "@rowcat/runtime-mcp";
import { createNodeRuntimeMcpHost } from "@rowcat/runtime-mcp/node";

/**
 * MCP transport. It holds no tool semantics: it mounts the registry's tools on the protocol, wraps
 * results as one JSON blob and turns failures into structured values. Rules, validation, limits and
 * previews live in `@rowcat/runtime-mcp`, which is why they can be tested without a connection.
 *
 * Tool names carry no dot (`runtime_write_file`, not `runtime.write_file`): several clients limit
 * names to `[A-Za-z0-9_-]`, and one dot makes every tool of this server vanish in those clients.
 *
 * Results are JSON, not human-readable tables; the reader is an agent that builds the next call
 * from `nodeId`, `hash` and `revision`.
 */

export interface RuntimeMcpServerOptions {
	readonly authoring: RuntimeAuthoringPort;
	readonly version: string;
}

/** Per-response cap; a truncation is stated in the payload itself. */
const MAX_RESULT_BYTES = 512 * 1024;

const asContent = (value: unknown): CallToolResult["content"] => {
	const json = JSON.stringify(value, null, "\t") ?? "null";
	const text =
		json.length > MAX_RESULT_BYTES
			? `${json.slice(0, MAX_RESULT_BYTES)}\n… The response was truncated past the cap. Call again with narrower arguments.`
			: json;
	return [{ type: "text", text }];
};

export function createRuntimeMcpServer(options: RuntimeMcpServerOptions): {
	server: McpServer;
	dispose: () => Promise<void>;
} {
	const context: RuntimeMcpContext = {
		authoring: options.authoring,
		host: createNodeRuntimeMcpHost(),
		corpus: RUNTIME_AI_CORPUS,
	};
	const preview = new RuntimePreviewManager(context);
	const connection: RuntimeMcpConnection = { context, preview };

	const server = new McpServer(
		{ name: "rowcat-runtime", version: options.version },
		{
			instructions:
				"The authoring tools for the RowCat creator runtime (story screens made with TypeScript/TSX). Before writing code, check the real API with runtime_search_docs and runtime_get_api_reference; after editing, confirm with runtime_compile → runtime_preview_start → runtime_preview_get_tree. Names @rowcat/runtime does not export do not exist in this language.",
		},
	);

	for (const tool of RUNTIME_MCP_TOOLS)
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema.shape,
				/**
				 * Carried verbatim from the registry. This used to be a constant `destructiveHint: false`, but
				 * clients use the hint to decide whether to ask the person first, and
				 * `write_file`/`rename_file`/`delete_file` replace existing manuscripts.
				 */
				annotations: {
					readOnlyHint: tool.readOnly,
					destructiveHint: tool.destructive,
					openWorldHint: tool.openWorld,
				},
			},
			async (args: unknown): Promise<CallToolResult> => {
				try {
					return { content: asContent(await tool.run(connection, args)) };
				} catch (error) {
					return {
						isError: true,
						content: asContent(
							runtimeMcpErrorPayload(toRuntimeMcpError(error)),
						),
					};
				}
			},
		);

	return {
		server,
		/** Releases remaining VMs; without it the process lingers holding WASM. */
		dispose: async () => {
			await preview.disposeAll();
			await server.close();
		},
	};
}
