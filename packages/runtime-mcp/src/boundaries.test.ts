import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RUNTIME_MCP_TOOLS } from "./tools.ts";

/**
 * Boundaries of this layer, guarded by values: the absences it guarantees.
 * - No dangerous doors: shell, filesystem, DB, arbitrary HTTP, and eval are blocked by name.
 * - No owner argument: a request pointing at someone else's draft cannot be expressed.
 * - A closed tool vocabulary: publish, enabling the runtime, and skipping validation cannot grow
 *   into tools. These are tests rather than documentation because such absences disappear silently
 *   during refactoring. A commit that opens one door for convenience looks like an ordinary diff.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const sources = (dir: string): string[] => {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...sources(full));
			continue;
		}
		if (!entry.name.endsWith(".ts")) continue;
		if (entry.name.includes(".test.")) continue;
		out.push(full);
	}
	return out;
};

/**
 * Scans the code with comments stripped. Comments in this repository name things that are absent
 * (several files say `new Function` and `eval` do not exist), so a raw scan would flag those very
 * sentences. The easiest fix would then be to delete the comment. A check that forces deleting the
 * sentence it protects is badly built.
 */
const codeOf = (source: string): string =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");

interface Door {
	readonly pattern: RegExp;
	readonly why: string;
	/**
	 * Files allowed to use the construct. The adapter is the one place where Node-specific knowledge
	 * belongs.
	 */
	readonly except?: ReadonlySet<string>;
}

const NODE_ADAPTER = new Set(["node/host.ts"]);

const DOORS: readonly Door[] = [
	{ pattern: /\bnode:child_process\b/, why: "shell execution" },
	{ pattern: /\bnode:net\b/, why: "sockets" },
	{ pattern: /\bnode:fs\b/, why: "file system", except: NODE_ADAPTER },
	{ pattern: /\bnode:crypto\b/, why: "crypto", except: NODE_ADAPTER },
	{ pattern: /\bdrizzle-orm\b/, why: "database" },
	{ pattern: /\bfrom "pg"/, why: "database" },
	{ pattern: /@rowcat\/sdk/, why: "product API client" },
	{ pattern: /@rowcat\/api/, why: "server internals" },
	{ pattern: /\bnew Function\b/, why: "dynamic code" },
	{ pattern: /\beval\(/, why: "dynamic code" },
	{ pattern: /[^.\w]import\(/, why: "dynamic import" },
	{ pattern: /\bfetch\(/, why: "network" },
];

describe("there are no dangerous doors", () => {
	const files = sources(HERE)
		.filter((file) => !file.includes(join("src", "test")))
		.map((file) => relative(HERE, file).replace(/\\/g, "/"));

	test.each(files)("%s", (name) => {
		const code = codeOf(readFileSync(join(HERE, name), "utf8"));
		for (const door of DOORS) {
			if (door.except?.has(name) === true) continue;
			expect(code, `${name}: ${door.why}`).not.toMatch(door.pattern);
		}
	});
});

describe("tool vocabulary", () => {
	test("names share one shape", () => {
		for (const tool of RUNTIME_MCP_TOOLS)
			expect(tool.name).toMatch(/^runtime_[a-z]+(_[a-z]+)*$/);
	});

	test("names do not repeat", () => {
		const names = RUNTIME_MCP_TOOLS.map((tool) => tool.name);
		expect(new Set(names).size).toBe(names.length);
	});

	/**
	 * Warning: adding a name to this list is a capability-widening commit. The list is written as
	 * values because an added tool looks like an ordinary diff. When adding a name, answer again what
	 * that tool opens up.
	 */
	test("the tool list is exactly this", () => {
		expect(RUNTIME_MCP_TOOLS.map((tool) => tool.name)).toEqual([
			"runtime_list_projects",
			"runtime_get_project",
			"runtime_list_files",
			"runtime_read_file",
			"runtime_write_file",
			"runtime_create_file",
			"runtime_rename_file",
			"runtime_delete_file",
			"runtime_compile",
			"runtime_get_diagnostics",
			"runtime_search_docs",
			"runtime_read_doc",
			"runtime_get_api_reference",
			"runtime_get_example",
			"runtime_preview_start",
			"runtime_preview_restart",
			"runtime_preview_stop",
			"runtime_preview_status",
			"runtime_preview_get_tree",
			"runtime_preview_press",
			"runtime_preview_input",
			"runtime_preview_submit",
			"runtime_preview_get_console",
			"runtime_preview_get_state",
		]);
	});

	/** If this vocabulary appears in a tool name, the nature of the capability has changed. */
	test("there are no names for operations chosen not to open", () => {
		const banned = [
			"publish",
			"eval",
			"exec",
			"shell",
			"sql",
			"query",
			"fetch",
			"http",
			"upload",
			"enable_runtime",
			"delete_project",
			"skip",
		];
		for (const tool of RUNTIME_MCP_TOOLS)
			for (const word of banned)
				expect(tool.name, `${tool.name}: ${word}`).not.toContain(word);
	});

	test("exactly these ten tools change state", () => {
		expect(
			RUNTIME_MCP_TOOLS.filter((tool) => !tool.readOnly).map(
				(tool) => tool.name,
			),
		).toEqual([
			"runtime_write_file",
			"runtime_create_file",
			"runtime_rename_file",
			"runtime_delete_file",
			"runtime_preview_start",
			"runtime_preview_restart",
			"runtime_preview_stop",
			"runtime_preview_press",
			"runtime_preview_input",
			"runtime_preview_submit",
		]);
	});

	/**
	 * Warning: this table is the basis on which the client asks a human for confirmation.
	 *
	 * It is written as values because of an earlier defect's shape. The hint was a constant in the
	 * transport layer (`destructiveHint: false` on all twenty-four tools), and its rationale was that
	 * no tool performs an irreversible product action. That is true, but it does not answer the
	 * question the hint is asked, and the wrong direction loses the creator's manuscript.
	 *
	 * Criterion: can the tool remove or replace something that already existed? Adding (`create_file`)
	 * and advancing (pressing, entering text, submitting) are false. The three that alter the
	 * manuscript and the three that discard a session are true.
	 */
	test("exactly these six tools replace what was there", () => {
		expect(
			RUNTIME_MCP_TOOLS.filter((tool) => tool.destructive).map(
				(tool) => tool.name,
			),
		).toEqual([
			"runtime_write_file",
			"runtime_rename_file",
			"runtime_delete_file",
			"runtime_preview_start",
			"runtime_preview_restart",
			"runtime_preview_stop",
		]);
	});

	test("a tool both read-only and destructive is not representable", () => {
		for (const tool of RUNTIME_MCP_TOOLS)
			expect(tool.readOnly && tool.destructive, tool.name).toBe(false);
	});

	/**
	 * This server has no open world. Document search covers a bundled corpus, and preview runs this
	 * project in an isolated VM. If either becomes true, the capability has widened.
	 */
	test("no tool reaches the outside world", () => {
		for (const tool of RUNTIME_MCP_TOOLS)
			expect(tool.openWorld, tool.name).toBe(false);
	});

	/**
	 * Operations that take a fingerprint, the key for optimistic concurrency. All three are expensive
	 * to undo.
	 */
	test("exactly these three tools take a fingerprint", () => {
		expect(
			RUNTIME_MCP_TOOLS.filter(
				(tool) => "expectedHash" in tool.inputSchema.shape,
			).map((tool) => tool.name),
		).toEqual([
			"runtime_write_file",
			"runtime_rename_file",
			"runtime_delete_file",
		]);
	});

	test("descriptions are not empty", () => {
		for (const tool of RUNTIME_MCP_TOOLS) {
			expect(tool.title.length, tool.name).toBeGreaterThan(1);
			expect(tool.description.length, tool.name).toBeGreaterThan(40);
		}
	});
});

describe("no tool takes an owner", () => {
	const OWNERISH = [
		"owner",
		"ownerid",
		"member",
		"memberid",
		"viewer",
		"viewerid",
		"userid",
		"account",
		"session",
		"token",
	];

	test.each(RUNTIME_MCP_TOOLS.map((tool) => tool.name))("%s", (name) => {
		const tool = RUNTIME_MCP_TOOLS.find((entry) => entry.name === name);
		for (const key of Object.keys(tool?.inputSchema.shape ?? {}))
			expect(OWNERISH.includes(key.toLowerCase()), `${key} of ${name}`).toBe(
				false,
			);
	});
});
