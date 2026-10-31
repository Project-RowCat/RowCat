import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RUNTIME_AI_CORPUS } from "@rowcat/runtime-ai-docs";
import type {
	RuntimeAuthoringPort,
	RuntimeMcpConnection,
	RuntimeMcpContext,
} from "@rowcat/runtime-mcp";
import {
	RUNTIME_MCP_LIMITS,
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

const TRUNCATION_NOTICE =
	"\n… The response was truncated past the cap. Call again with narrower arguments.";
const encoder = new TextEncoder();

/**
 * Applies the per-response cap (`RUNTIME_MCP_LIMITS.responseBytes`, the one source of that number) to
 * a serialized result; a truncation is stated in the payload itself.
 *
 * The cap is **UTF-8 bytes of this text**. It was compared against `String.length` for a while,
 * which counts UTF-16 code units: a result of Korean tree text, console lines or state could reach
 * three times the documented cap. The notice fits **inside** the cap, so the number bounds the whole
 * text. The JSON-RPC frame that carries it on stdout escapes the text once more (quotes, tabs,
 * newlines), so that frame is larger than this number by the escaping; the cap bounds what the tool
 * returns, not the transport's encoding of it.
 *
 * The cut is made by `encodeInto`, which writes only whole characters and reports how many code units
 * it consumed, so it never lands between the halves of a surrogate pair. `JSON.stringify` escapes lone
 * surrogates, so the input itself is well formed.
 */
export const toolResultText = (json: string): string => {
	const cap = RUNTIME_MCP_LIMITS.responseBytes;
	if (Buffer.byteLength(json, "utf8") <= cap) return json;
	const budget = new Uint8Array(
		cap - Buffer.byteLength(TRUNCATION_NOTICE, "utf8"),
	);
	const { read } = encoder.encodeInto(json, budget);
	return `${json.slice(0, read)}${TRUNCATION_NOTICE}`;
};

const asContent = (value: unknown): CallToolResult["content"] => {
	const json = JSON.stringify(value, null, "\t") ?? "null";
	return [{ type: "text", text: toolResultText(json) }];
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
