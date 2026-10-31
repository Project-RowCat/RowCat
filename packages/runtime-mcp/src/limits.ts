/**
 * Limits this layer sets itself, to stop an agent from accidentally requesting unbounded work.
 *
 * - Project limits (file count, path length, content length) are not here. They are
 *   RUNTIME_PROJECT_LIMITS in @rowcat/authoring. A copy here would give MCP-made and studio-made
 *   files different rules, and the mismatch would only show after sync, on another device.
 * - Run limits (tree depth, node count, commit bytes, execution budget) are not here either. They
 *   are the host's DEFAULT_ROOT_LIMITS and DEFAULT_SESSION_LIMITS. Previews must use the product's
 *   values, or a project that runs in the studio could hit a limit after publishing.
 * - What is here is specific to this channel: how large one response can be, how many VMs one
 *   connection can create, and when an abandoned preview expires on its own.
 */

export const RUNTIME_MCP_LIMITS = {
	/**
	 * Preview sessions one connection may hold at once: exactly one. Same reason as the studio
	 * preview, plus one more: each session is one WASM instance, and its memory belongs to this
	 * process. A new preview_start cleans up the previous session and starts; it does not reject.
	 * Rejecting would force agents to memorize a preview_stop-first procedure.
	 */
	previewSessions: 1,
	/**
	 * Sessions are released after this long without an operation. A scheduled timer performs the
	 * cleanup. The earlier design swept only on the next tool call. On a connection that stopped
	 * making calls, nothing swept, so the WASM session stayed as long as the connection lived. Only
	 * operations that write to the session extend its lifetime, not status queries.
	 */
	previewIdleMs: 10 * 60 * 1000,
	/**
	 * Console ring buffer. On overflow, the oldest lines are dropped and the number dropped is
	 * reported.
	 */
	consoleBuffer: 500,
	consolePage: 100,
	/** Longer console lines are cut and marked as truncated. */
	consoleEntryChars: 2_000,
	/**
	 * Maximum nodes in a tree response. Beyond this the tree is cut and reported as truncated. It is
	 * never silently reduced.
	 */
	treeNodes: 400,
	treeDepth: 32,
	treePropChars: 400,
	/**
	 * Maximum lines in a file listing. It matches the project file limit, so this is never hit in
	 * practice.
	 */
	filesListed: 200,
	inputChars: 10_000,
	searchResults: 20,
	/**
	 * Maximum UTF-8 bytes of the text one tool returns, the truncation notice included. An overflow is
	 * cut on a character boundary, and the cut is reported in the response. The transport
	 * (`apps/mcp/src/server.ts`) reads this value; it keeps no copy.
	 */
	responseBytes: 512 * 1024,
} as const;

export type RuntimeMcpLimits = typeof RUNTIME_MCP_LIMITS;
