import { RUNTIME_AI_GROUPS } from "@rowcat/runtime-ai-docs";
import { z } from "zod";
import { compileForAgent } from "./compile.ts";
import { apiReference, readDoc, readExample, searchDocs } from "./docs.ts";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "./errors.ts";
import { RUNTIME_MCP_LIMITS } from "./limits.ts";
import type { RuntimeMcpContext } from "./ports.ts";
import type { RuntimePreviewManager } from "./preview/manager.ts";
import {
	createRuntimeFile,
	deleteRuntimeFile,
	getRuntimeProjectView,
	listRuntimeFiles,
	listRuntimeProjects,
	readRuntimeFile,
	renameRuntimeFile,
	writeRuntimeFile,
} from "./project.ts";

/**
 * Tool list: the only surface this layer exposes.
 * - Tool descriptions are part of the contract. Agents choose tools by description, so each one
 *   says when to call the tool and what to do next (write_file recommends compiling;
 *   preview_get_tree states how long node numbers stay valid).
 * - Absent by design: arbitrary SQL, file system, shell, HTTP proxy, runtime.eval, artifact
 *   injection, skipping validation, publishing (irreversible, and confirmation is not this
 *   channel's job), turning the runtime on or off (the maker's decision; turning it off reads as
 *   deleting the manuscript), and editing the draft body, lore, or opening scene (locked while the
 *   runtime is on; MCP must not bypass the lock).
 * - The absence is a code fact, checked by value in boundaries.test.ts.
 * - No schema takes ownerId, memberId or viewerId. The authoring store already belongs to the
 *   member, so a request naming another member's draft cannot be expressed.
 */

export interface RuntimeMcpConnection {
	readonly context: RuntimeMcpContext;
	readonly preview: RuntimePreviewManager;
}

/**
 * Describes what the tool does, in protocol terms. The transport passes these values through.
 * - readOnly: changes nothing.
 * - destructive: can remove or replace existing data. This is not the same as adding to it or
 *   advancing it.
 * - openWorld: talks to the outside world.
 *
 * Two of the three annotations used to be hardcoded in the transport layer (destructiveHint: false
 * for every tool). That was true, because no tool performs irreversible product actions, but it did
 * not answer the protocol question: can this call replace what already exists? write_file,
 * rename_file and delete_file can. Clients use the value to decide whether to ask for confirmation,
 * so a false value lets a user lose a manuscript without being asked.
 *
 * The value sits beside each tool, so each definition answers for its own tool and a newly added
 * tool brings its own answer.
 *
 * In this repository, destructive refers to the maker's authored data. Preview sessions are tool
 * memory that lives and dies with the connection and is rebuilt from source. So operations that
 * discard a session (start, restart, stop) are destructive, while operations that advance the
 * screen inside a session (press, type, submit) are not.
 */
export interface RuntimeMcpToolAnnotations {
	readonly readOnly: boolean;
	readonly destructive: boolean;
	readonly openWorld: boolean;
}

export interface RuntimeMcpTool extends RuntimeMcpToolAnnotations {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly inputSchema: z.ZodObject<z.ZodRawShape>;
	run(connection: RuntimeMcpConnection, args: unknown): Promise<unknown>;
}

interface ToolSpec<TSchema extends z.ZodObject<z.ZodRawShape>> {
	name: string;
	title: string;
	description: string;
	readOnly: boolean;
	/**
	 * Omitted means false. Most tools are read-only or only add, so the default favors them. Only the
	 * three file-manipulation tools and the preview lifecycle operations set true. boundaries.test.ts
	 * locks those six values.
	 */
	destructive?: boolean;
	schema: TSchema;
	handler(
		connection: RuntimeMcpConnection,
		input: z.infer<TSchema>,
	): Promise<unknown>;
}

/**
 * Converts schema violations into a failure of this channel. Zod's messages are not passed through
 * as they are.
 */
function defineTool<TSchema extends z.ZodObject<z.ZodRawShape>>(
	spec: ToolSpec<TSchema>,
): RuntimeMcpTool {
	return {
		name: spec.name,
		title: spec.title,
		description: spec.description,
		readOnly: spec.readOnly,
		destructive: spec.destructive ?? false,
		/**
		 * The server has no open world. Docs search scans a bundled corpus rather than the web, and
		 * preview runs the project in an isolated VM. There is no arbitrary HTTP, file system or shell
		 * tool, so openWorld is false for all twenty-four tools.
		 */
		openWorld: false,
		inputSchema: spec.schema,
		run: async (connection, args) => {
			const parsed = spec.schema.safeParse(args ?? {});
			if (!parsed.success)
				throw new RuntimeMcpError(
					RUNTIME_MCP_ERROR_CODE.invalidInput,
					`${spec.name}'s input is not in the contract's shape.`,
					{
						issues: parsed.error.issues.map((issue) => ({
							path: issue.path.join("."),
							code: issue.code,
						})),
					},
				);
			return spec.handler(connection, parsed.data);
		},
	};
}

const draftId = z
	.string()
	.min(1)
	.max(200)
	.describe("The draft id. Use the value runtime_list_projects gave as is.");

const filePath = z
	.string()
	.min(1)
	.max(200)
	.describe(
		"A path from the project root (`src/main.tsx`), with no leading `/` or `./`.",
	);

const nodeId = z
	.number()
	.int()
	.min(0)
	.describe(
		"A node number from preview_get_tree. It can go stale when the revision rises; then read the tree again.",
	);

const listProjects = defineTool({
	name: "runtime_list_projects",
	title: "Runtime drafts",
	description:
		"Lists this account's drafts **with the runtime turned on**, most recently edited first. Drafts with the runtime off are not listed (there is no code for an agent to edit). Call this first when starting work.",
	readOnly: true,
	schema: z.object({}),
	handler: (connection) => listRuntimeProjects(connection.context),
});

const getProject = defineTool({
	name: "runtime_get_project",
	title: "Project overview",
	description:
		"An overview of one draft's runtime project: title, entry file, file list (path, size, fingerprint), logical names of managed images and limits. **Source bodies are not included** (read only the files you need with read_file).",
	readOnly: true,
	schema: z.object({ draftId }),
	handler: (connection, input) =>
		getRuntimeProjectView(connection.context, input.draftId),
});

const listFiles = defineTool({
	name: "runtime_list_files",
	title: "File list",
	description:
		"Lists the project's source files in path order. `hash` is the fingerprint of that file's content; pass it as write_file's `expectedHash` and the file is not overwritten if it changed in between.",
	readOnly: true,
	schema: z.object({ draftId }),
	handler: (connection, input) =>
		listRuntimeFiles(connection.context, input.draftId),
});

const readFile = defineTool({
	name: "runtime_read_file",
	title: "Read file",
	description:
		"The full text of one source file. Read only the files you will edit: reading the whole project is almost always waste.",
	readOnly: true,
	schema: z.object({ draftId, path: filePath }),
	handler: (connection, input) =>
		readRuntimeFile(connection.context, input.draftId, input.path),
});

const writeFile = defineTool({
	name: "runtime_write_file",
	title: "Overwrite file",
	description:
		"**Replaces the whole content of an existing file.** Create new files with create_file (so a path typo doesn't quietly become a new file). After writing, check with runtime_compile. **Always pass the `expectedHash` you got when reading**: then if another device (the studio or another agent) changed the same file after you read it, it stops with `file_conflict`, and that response's `hash` is the fingerprint of the current value. Then read again, merge, and write again with the new fingerprint.",
	readOnly: false,
	destructive: true,
	schema: z.object({
		draftId,
		path: filePath,
		content: z.string(),
		expectedHash: z
			.string()
			.optional()
			.describe(
				"The fingerprint of that file from read_file or list_files. **Pass it by default**: without it you may overwrite what another device changed after you read, and nothing in the response would show that.",
			),
	}),
	handler: (connection, input) =>
		writeRuntimeFile(connection.context, {
			draftId: input.draftId,
			path: input.path,
			content: input.content,
			...(input.expectedHash === undefined
				? {}
				: { expectedHash: input.expectedHash }),
		}),
});

const createFile = defineTool({
	name: "runtime_create_file",
	title: "Create file",
	description:
		"Creates one new source file. Only `.ts` and `.tsx` extensions; if the same path exists it refuses with `duplicate_path` (it never quietly overwrites an existing file).",
	readOnly: false,
	schema: z.object({
		draftId,
		path: filePath,
		content: z.string().optional(),
	}),
	handler: (connection, input) =>
		createRuntimeFile(connection.context, {
			draftId: input.draftId,
			path: input.path,
			...(input.content === undefined ? {} : { content: input.content }),
		}),
});

const renameFile = defineTool({
	name: "runtime_rename_file",
	title: "Rename file",
	description:
		"Changes a file's path (the same operation as moving it). **It does not fix imports in other files**: runtime_compile's diagnostics name the broken imports, and fixing them from that is safer than string replacement. Pass `expectedHash` and it stops if the file changed after you read it.",
	readOnly: false,
	destructive: true,
	schema: z.object({
		draftId,
		path: filePath,
		to: filePath,
		expectedHash: z
			.string()
			.optional()
			.describe(
				"The fingerprint of that file from read_file or list_files. **Pass it by default**: without it you may overwrite what another device changed after you read, and nothing in the response would show that.",
			),
	}),
	handler: (connection, input) =>
		renameRuntimeFile(connection.context, {
			draftId: input.draftId,
			path: input.path,
			to: input.to,
			...(input.expectedHash === undefined
				? {}
				: { expectedHash: input.expectedHash }),
		}),
});

const deleteFile = defineTool({
	name: "runtime_delete_file",
	title: "Delete file",
	description:
		"Deletes one source file. Deleting the entry file makes the result's `entryMissing` true, and the project then fails its next compile with `runtime_entry_missing`. **Pass the `expectedHash` you got when reading**: deletion is the most expensive operation to undo, and this prevents deleting content another device wrote in the meantime without ever seeing it.",
	readOnly: false,
	destructive: true,
	schema: z.object({
		draftId,
		path: filePath,
		expectedHash: z
			.string()
			.optional()
			.describe(
				"The fingerprint of that file from read_file or list_files. **Pass it by default**: without it you may overwrite what another device changed after you read, and nothing in the response would show that.",
			),
	}),
	handler: (connection, input) =>
		deleteRuntimeFile(connection.context, {
			draftId: input.draftId,
			path: input.path,
			...(input.expectedHash === undefined
				? {}
				: { expectedHash: input.expectedHash }),
		}),
});

const compile = defineTool({
	name: "runtime_compile",
	title: "Compile",
	description:
		'Checks the saved source with **RowCat\'s real compiler** and builds an artifact (the same path as publishing). Always call it after editing files. If `ok: false`, fix every error in `diagnostics` and call it again. Diagnostics with `source: "runtime"` are not something the creator can fix.',
	readOnly: true,
	schema: z.object({ draftId }),
	handler: (connection, input) =>
		compileForAgent(connection.context, input.draftId),
});

const getDiagnostics = defineTool({
	name: "runtime_get_diagnostics",
	title: "Diagnostics only",
	description:
		"Runs **the same compile** as runtime_compile and returns only the diagnostics (without the artifact summary). It is not a separate checker: a fast pass without type checking here would make its pass answer diverge from the compile's.",
	readOnly: true,
	schema: z.object({ draftId }),
	handler: async (connection, input) => {
		const result = await compileForAgent(connection.context, input.draftId);
		return {
			ok: result.ok,
			errors: result.errors,
			warnings: result.warnings,
			omittedDiagnostics: result.omittedDiagnostics,
			infrastructureFailure: result.infrastructureFailure,
			diagnostics: result.diagnostics,
		};
	},
});

const searchDocsTool = defineTool({
	name: "runtime_search_docs",
	title: "Search runtime docs",
	description:
		"Searches **only inside the public docs** of the RowCat creator runtime (not the web). Call this before inventing an API you don't know. Results are title, address and excerpt; to read a body, read that slug with runtime_read_doc.",
	readOnly: true,
	schema: z.object({
		query: z.string().min(1).max(200),
		group: z.enum(RUNTIME_AI_GROUPS).optional(),
		limit: z
			.number()
			.int()
			.min(1)
			.max(RUNTIME_MCP_LIMITS.searchResults)
			.optional(),
	}),
	handler: async (connection, input) =>
		searchDocs(connection.context.corpus, {
			query: input.query,
			...(input.group === undefined ? {} : { group: input.group }),
			...(input.limit === undefined ? {} : { limit: input.limit }),
		}),
});

const readDocTool = defineTool({
	name: "runtime_read_doc",
	title: "Read runtime doc",
	description:
		"Reads the full text of one doc by slug (`concepts/state`, `reference/hooks`). An unknown slug comes back with nearby candidates.",
	readOnly: true,
	schema: z.object({ slug: z.string().max(200) }),
	handler: async (connection, input) =>
		readDoc(connection.context.corpus, input.slug),
});

const getApiReference = defineTool({
	name: "runtime_get_api_reference",
	title: "Public API reference",
	description:
		"The names `@rowcat/runtime` really exports. Pass `name` to get that one's **declaration signature** too; without it you get the full list of names with one-line summaries. A name not here does not exist in this language: don't invent names from memories of React, the DOM or React Native.",
	readOnly: true,
	schema: z.object({
		name: z.string().max(100).optional(),
		kind: z
			.enum([
				"component",
				"hook",
				"function",
				"constant",
				"class",
				"type",
				"interface",
			])
			.optional(),
	}),
	handler: async (connection, input) =>
		apiReference(connection.context.corpus, {
			...(input.name === undefined ? {} : { name: input.name }),
			...(input.kind === undefined ? {} : { kind: input.kind }),
		}),
});

const getExample = defineTool({
	name: "runtime_get_example",
	title: "Example project",
	description:
		"One example project from the public docs. These examples are **only ones that passed the real compiler**, so they compile when pasted as is. If you don't know the name, call it without arguments and the list comes in the failure sentence.",
	readOnly: true,
	schema: z.object({ id: z.string().min(1).max(100) }),
	handler: async (connection, input) =>
		readExample(connection.context.corpus, input.id),
});

const previewStart = defineTool({
	name: "runtime_preview_start",
	title: "Start preview",
	description:
		"Compiles the saved source and runs it in **an isolated QuickJS VM**. This connection holds only one preview; starting another draft cleans up the previous one. If compilation fails no VM is created and the status becomes `compile_failed`. On success, see what was drawn with preview_get_tree.",
	readOnly: false,
	/**
	 * Discards the previous session. With the reset flags on, it also clears the accumulated progress
	 * snapshots.
	 */
	destructive: true,
	schema: z.object({
		draftId,
		resetStory: z
			.boolean()
			.optional()
			.describe("Clears this run's progress (useStoryState) before starting."),
		resetPersistent: z
			.boolean()
			.optional()
			.describe(
				"Clears long progress (usePersistentState) too. Product playback has no such operation.",
			),
	}),
	handler: (connection, input) =>
		connection.preview.start(input.draftId, {
			...(input.resetStory === undefined
				? {}
				: { resetStory: input.resetStory }),
			...(input.resetPersistent === undefined
				? {}
				: { resetPersistent: input.resetPersistent }),
		}),
});

const previewRestart = defineTool({
	name: "runtime_preview_restart",
	title: "Restart preview",
	description:
		"Restarts the same draft with the current source. `useState` starts over and the run's progress carries on (use `resetStory` to clear it). **It does not swap code into a running VM**: it is a new VM.",
	readOnly: false,
	destructive: true,
	schema: z.object({
		resetStory: z.boolean().optional(),
		resetPersistent: z.boolean().optional(),
	}),
	handler: (connection, input) =>
		connection.preview.restart({
			...(input.resetStory === undefined
				? {}
				: { resetStory: input.resetStory }),
			...(input.resetPersistent === undefined
				? {}
				: { resetPersistent: input.resetPersistent }),
		}),
});

const previewStop = defineTool({
	name: "runtime_preview_stop",
	title: "Stop preview",
	description:
		"Runs cleanup functions (useEffect's return values) and releases the VM. Call it when the work is done; even if you don't, it disappears on its own ten minutes after the last operation (status lookups do not extend its lifetime).",
	readOnly: false,
	destructive: true,
	schema: z.object({}),
	handler: (connection) => connection.preview.stop(),
});

const previewStatus = defineTool({
	name: "runtime_preview_status",
	title: "Preview status",
	description:
		"The current session's status (`idle`, `compiling`, `starting`, `running`, `compile_failed`, `failed`, `stopped`), revision, last compile result and creator errors. `null` without a session. **This lookup does not extend the idle lifetime**: polling alone must not keep a forgotten VM alive.",
	readOnly: true,
	schema: z.object({}),
	handler: async (connection) => ({ preview: connection.preview.status() }),
});

const previewGetTree = defineTool({
	name: "runtime_preview_get_tree",
	title: "Drawn screen tree",
	description:
		"Returns **what the creator code really drew** as structure: component names, props, text and whether it can be pressed. `nodeId` is for this revision's tree, and pressing or entering text raises the revision. An operation pointing at a vanished number is refused with `stale_node`; then call this tool again.",
	readOnly: true,
	schema: z.object({}),
	handler: async (connection) => connection.preview.require().treeSnapshot(),
});

const previewPress = defineTool({
	name: "runtime_preview_press",
	title: "Press",
	description:
		"Calls `onPress` of a `Button` or `Pressable` (it goes through the runtime's handler number rather than imitating a browser event). It returns the new revision after the commit, so then see what changed with preview_get_tree.",
	readOnly: false,
	schema: z.object({ nodeId }),
	handler: async (connection, input) =>
		connection.preview.require().dispatch(input.nodeId, "press"),
});

const previewInput = defineTool({
	name: "runtime_preview_input",
	title: "Enter text",
	description:
		"Passes one string to `onChangeText` of a `TextInput` or `TextArea`. It does not imitate typing; it sends **one confirmed value** (sending one character at a time would run creator code on every character).",
	readOnly: false,
	schema: z.object({
		nodeId,
		text: z.string().max(RUNTIME_MCP_LIMITS.inputChars),
	}),
	handler: async (connection, input) =>
		connection.preview.require().dispatch(input.nodeId, "input", input.text),
});

const previewSubmit = defineTool({
	name: "runtime_preview_submit",
	title: "Submit",
	description:
		"Calls `onSubmit` of a `TextInput` (the same as a person pressing Enter). **It sends no text along**: enter the value with preview_input first, then call this. `TextArea` has no such operation (in multi-line fields Enter is a line break).",
	readOnly: false,
	schema: z.object({ nodeId }),
	handler: async (connection, input) =>
		connection.preview.require().dispatch(input.nodeId, "submit"),
});

const previewGetConsole = defineTool({
	name: "runtime_preview_get_console",
	title: "Console",
	description:
		"Returns the creator code's `console.*` and the runtime's diagnostics in sequence order. Pass the previous response's `nextCursor` as `since` to get only what came after. Call it only when a result is unexplained: the tree answers whether the screen is right.",
	readOnly: true,
	schema: z.object({
		since: z.number().int().min(0).optional(),
		limit: z
			.number()
			.int()
			.min(1)
			.max(RUNTIME_MCP_LIMITS.consolePage)
			.optional(),
		level: z.enum(["log", "warn", "error"]).optional(),
	}),
	handler: async (connection, input) =>
		connection.preview.require().consoleSince({
			...(input.since === undefined ? {} : { since: input.since }),
			...(input.limit === undefined ? {} : { limit: input.limit }),
			...(input.level === undefined ? {} : { level: input.level }),
		}),
});

const previewGetState = defineTool({
	name: "runtime_preview_get_state",
	title: "Saved state",
	description:
		"Snapshots of this preview's two saved states: the run (`useStoryState`) and long progress (`usePersistentState`). `useState` is the VM's heap and is not here. This value is **the authoring tool's memory**, not the player's save.",
	readOnly: true,
	schema: z.object({}),
	handler: async (connection) => connection.preview.require().stateSnapshot(),
});

export const RUNTIME_MCP_TOOLS: readonly RuntimeMcpTool[] = [
	listProjects,
	getProject,
	listFiles,
	readFile,
	writeFile,
	createFile,
	renameFile,
	deleteFile,
	compile,
	getDiagnostics,
	searchDocsTool,
	readDocTool,
	getApiReference,
	getExample,
	previewStart,
	previewRestart,
	previewStop,
	previewStatus,
	previewGetTree,
	previewPress,
	previewInput,
	previewSubmit,
	previewGetConsole,
	previewGetState,
];

export const findRuntimeMcpTool = (name: string): RuntimeMcpTool | null =>
	RUNTIME_MCP_TOOLS.find((tool) => tool.name === name) ?? null;
