import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeProject,
} from "@rowcat/authoring";
import { runtimeProjectIdFor } from "@rowcat/authoring";
import type {
	RuntimeAuthoringPort,
	RuntimeMcpDraftView,
} from "@rowcat/runtime-mcp";
import { RUNTIME_MCP_TOOLS } from "@rowcat/runtime-mcp";
import { afterEach, describe, expect, test } from "vitest";
import { createRuntimeMcpServer } from "./server.ts";

/**
 * Round trip over the protocol: a real MCP client against the real server. Tool semantics are
 * tested in `@rowcat/runtime-mcp`; this file covers transport only (the list goes out, arguments
 * arrive through the schema, failures come back as structured values). Those need a connection, so
 * only this file pulls in the SDK.
 */

const STAMP = "2026-01-01T00:00:00.000Z";
const SOURCE = `import { Screen, Text } from "@rowcat/runtime";

export default function App() {
	return (
		<Screen>
			<Text>hello</Text>
		</Screen>
	);
}
`;

const draft: RuntimeMcpDraftView = {
	id: "draft-1",
	title: "Test draft",
	updatedAt: STAMP,
	deletedAt: null,
};

const project: DraftRuntimeProject = {
	id: runtimeProjectIdFor("draft-1"),
	draftId: "draft-1",
	enabled: true,
	entry: "src/main.tsx",
	createdAt: STAMP,
	updatedAt: STAMP,
	deletedAt: null,
	dirty: 1,
	serverVersion: 0,
	rev: { t: 0, c: 0, d: "test" },
};

const file: DraftRuntimeFile = {
	id: "file-1",
	draftId: "draft-1",
	path: "src/main.tsx",
	content: SOURCE,
	createdAt: STAMP,
	updatedAt: STAMP,
	deletedAt: null,
	dirty: 1,
	serverVersion: 0,
	rev: { t: 0, c: 0, d: "test" },
};

/** Stand-in authoring port; this file tests transport, not storage. */
const authoring: RuntimeAuthoringPort = {
	listDrafts: async () => [draft],
	getDraft: async (id) => (id === draft.id ? draft : null),
	getRuntimeProject: async (draftId) => (draftId === draft.id ? project : null),
	listRuntimeFiles: async (draftId) => (draftId === draft.id ? [file] : []),
	createRuntimeFile: async () => null,
	updateRuntimeFile: async () => undefined,
	deleteRuntimeFile: async () => undefined,
	listRuntimeAssets: async (): Promise<readonly DraftRuntimeAsset[]> => [],
};

interface Session {
	readonly client: Client;
	close(): Promise<void>;
}

const open = async (): Promise<Session> => {
	const { server, dispose } = createRuntimeMcpServer({
		authoring,
		version: "test",
	});
	const client = new Client({ name: "test-agent", version: "test" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);
	return {
		client,
		close: async () => {
			await client.close();
			await dispose();
		},
	};
};

const sessions: Session[] = [];
const session = async (): Promise<Session> => {
	const opened = await open();
	sessions.push(opened);
	return opened;
};

afterEach(async () => {
	while (sessions.length > 0) await sessions.pop()?.close();
});

const textOf = (result: unknown): string => {
	const content = (result as { content?: { type: string; text?: string }[] })
		.content;
	return content?.map((entry) => entry.text ?? "").join("") ?? "";
};

describe("tool list", () => {
	test("the registry's tools go out as is", async () => {
		const { client } = await session();
		const listed = await client.listTools();
		expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
			RUNTIME_MCP_TOOLS.map((tool) => tool.name).sort(),
		);
	});

	/** A dot in a name trips several clients' tool-name validation. */
	test("names have a shape that works anywhere", async () => {
		const { client } = await session();
		for (const tool of (await client.listTools()).tools)
			expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
	});

	/**
	 * Checks what the client actually receives; checking the registry alone guards nothing. An earlier
	 * version of the transport hard-coded `destructiveHint: false` for every tool whatever the
	 * registry said. Clients use the hint to decide whether to ask the person first, so a false value
	 * lets a manuscript be lost without a prompt.
	 */
	test("tool characteristics go out as they are", async () => {
		const { client } = await session();
		const listed = await client.listTools();
		const annotationsOf = (name: string) =>
			listed.tools.find((tool) => tool.name === name)?.annotations;

		expect(annotationsOf("runtime_read_file")).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
		});
		expect(annotationsOf("runtime_compile")).toMatchObject({
			readOnlyHint: true,
		});
		/** Additive only; an existing path is refused, not overwritten. */
		expect(annotationsOf("runtime_create_file")).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
		});
		for (const name of [
			"runtime_write_file",
			"runtime_delete_file",
			"runtime_preview_start",
		])
			expect(annotationsOf(name), name).toMatchObject({
				readOnlyHint: false,
				destructiveHint: true,
			});
	});

	/** This server has no open world; any true value would mean widened capability. */
	test("does not advertise reaching the outside world", async () => {
		const { client } = await session();
		for (const tool of (await client.listTools()).tools)
			expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
	});

	/** The transport must not alter registry values; compares every tool. */
	test("the registry's characteristics go as is", async () => {
		const { client } = await session();
		const listed = await client.listTools();
		for (const tool of RUNTIME_MCP_TOOLS) {
			const wire = listed.tools.find((entry) => entry.name === tool.name);
			expect(wire?.annotations, tool.name).toMatchObject({
				readOnlyHint: tool.readOnly,
				destructiveHint: tool.destructive,
				openWorldHint: tool.openWorld,
			});
		}
	});

	test("descriptions go along: agents choose by description", async () => {
		const { client } = await session();
		for (const tool of (await client.listTools()).tools)
			expect((tool.description ?? "").length, tool.name).toBeGreaterThan(40);
	});
});

describe("calls", () => {
	test("the result is one block of JSON", async () => {
		const { client } = await session();
		const result = await client.callTool({
			name: "runtime_list_projects",
			arguments: {},
		});
		const parsed = JSON.parse(textOf(result)) as {
			projects: { draftId: string }[];
		};
		expect(parsed.projects[0]?.draftId).toBe("draft-1");
	});

	test("failures come as values with a code", async () => {
		const { client } = await session();
		const result = await client.callTool({
			name: "runtime_get_project",
			arguments: { draftId: "missing-draft" },
		});
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(textOf(result)) as {
			error: { code: string; message: string };
		};
		expect(parsed.error.code).toBe("project_not_found");
		expect(parsed.error.message.length).toBeGreaterThan(0);
	});

	test("arguments outside the schema are blocked before arriving", async () => {
		const { client } = await session();
		const result = await client.callTool({
			name: "runtime_read_file",
			arguments: { draftId: "draft-1" },
		});
		expect(result.isError).toBe(true);
	});

	test("doc tools answer even without a store", async () => {
		const { client } = await session();
		const result = await client.callTool({
			name: "runtime_get_api_reference",
			arguments: { name: "useStoryState" },
		});
		const parsed = JSON.parse(textOf(result)) as {
			symbols: { name: string; signature?: string }[];
		};
		expect(parsed.symbols[0]?.name).toBe("useStoryState");
		expect(parsed.symbols[0]?.signature).toContain("StoryStateDefinition");
	});

	test("compile goes through the real compiler", async () => {
		const { client } = await session();
		const result = await client.callTool({
			name: "runtime_compile",
			arguments: { draftId: "draft-1" },
		});
		const parsed = JSON.parse(textOf(result)) as {
			ok: boolean;
			artifact?: { sourceHash: string };
		};
		expect(parsed.ok).toBe(true);
		expect(parsed.artifact?.sourceHash.length).toBeGreaterThan(0);
	});
});
